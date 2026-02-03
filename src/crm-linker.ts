import { Client } from '@notionhq/client';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  findCRMEntryByCompany,
  findCRMEntryByEmail,
  createCRMEntry,
  linkMeetingToCRM,
  updateLastContact,
} from './tools/crm.js';
import {
  getCalendarEvents,
  getPrimaryExternalContact,
  extractCompanyFromEmail,
  type CalendarAttendee,
} from './tools/graph.js';
import type { MeetingBucket, CRMStatus } from './types/index.js';

// Load .env from project root manually
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '..', '.env');

// Parse .env file manually
const envContent = readFileSync(envPath, 'utf-8');
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#')) {
    const [key, ...valueParts] = trimmed.split('=');
    if (key && valueParts.length > 0) {
      process.env[key] = valueParts.join('=');
    }
  }
}

// Initialize Notion client after env loads
const notion = new Client({ auth: process.env.NOTION_API_KEY });

const MEETINGS_DB_ID = process.env.NOTION_MEETINGS_DB_ID!;
const CALENDAR_USER_EMAIL = process.env.AZURE_CALENDAR_USER_EMAIL || 'o.trudeau@lilee.ai';

interface MeetingForCRM {
  id: string;
  url: string;
  name: string;
  bucket: MeetingBucket;
  email: string;
  hasCRMLink: boolean;
  date: string;
}

/**
 * Update meeting's Email field
 */
async function updateMeetingEmail(meetingId: string, email: string): Promise<void> {
  await notion.pages.update({
    page_id: meetingId,
    properties: {
      Email: {
        email: email,
      },
    },
  });
}

/**
 * Get meetings from the past N days that need CRM linking
 */
async function getMeetingsForCRMLinking(daysBack: number = 7): Promise<MeetingForCRM[]> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);

  const response = await notion.databases.query({
    database_id: MEETINGS_DB_ID,
    filter: {
      and: [
        {
          property: 'Date',
          date: { on_or_after: startDate.toISOString().split('T')[0] },
        },
        {
          or: [
            { property: 'Bucket', select: { equals: 'Customer' } },
            { property: 'Bucket', select: { equals: 'Pipeline' } },
          ],
        },
      ],
    },
    sorts: [{ property: 'Date', direction: 'descending' }],
  });

  return response.results.map((page: any) => {
    const props = page.properties;
    const crmRelation = props['CRM Entry']?.relation || [];

    return {
      id: page.id,
      url: page.url,
      name: props.Name?.title?.[0]?.plain_text || 'Untitled',
      bucket: props.Bucket?.select?.name || 'Internal',
      email: props.Email?.email || '',
      hasCRMLink: crmRelation.length > 0,
      date: props.Date?.date?.start || page.created_time,
    };
  });
}

/**
 * Find matching calendar event for a meeting by date/time
 */
async function findCalendarEventForMeeting(
  meetingDate: string,
  meetingName: string
): Promise<CalendarAttendee | null> {
  try {
    // Parse the meeting date and create a window
    const date = new Date(meetingDate);
    const startDate = new Date(date.getTime() - 2 * 60 * 60 * 1000); // 2 hours before
    const endDate = new Date(date.getTime() + 2 * 60 * 60 * 1000);   // 2 hours after

    const events = await getCalendarEvents(CALENDAR_USER_EMAIL, startDate, endDate);

    // Find best match by time proximity
    const normalizedMeetingName = meetingName.toLowerCase();

    // First try to find by matching subject
    for (const event of events) {
      const normalizedSubject = event.subject.toLowerCase();
      if (
        normalizedSubject.includes(normalizedMeetingName) ||
        normalizedMeetingName.includes(normalizedSubject) ||
        // Check if both contain same key words
        normalizedMeetingName.split(' ').some(word =>
          word.length > 3 && normalizedSubject.includes(word)
        )
      ) {
        const contact = getPrimaryExternalContact(event);
        if (contact) {
          console.log(`   📅 Matched calendar event: "${event.subject}"`);
          return contact;
        }
      }
    }

    // Fall back to any event in the time window with external attendees
    for (const event of events) {
      const contact = getPrimaryExternalContact(event);
      if (contact) {
        console.log(`   📅 Using calendar event by time: "${event.subject}"`);
        return contact;
      }
    }

    return null;
  } catch (error: any) {
    // Graph API not configured or failed - this is expected during setup
    if (error.message?.includes('AZURE_CLIENT_ID') ||
        error.message?.includes('auth') ||
        error.code === 'AuthenticationError') {
      console.log(`   ⚠️  Graph API not configured (set AZURE_* env vars)`);
    } else {
      console.log(`   ⚠️  Calendar lookup failed: ${error.message}`);
    }
    return null;
  }
}

/**
 * Main CRM linking logic with Microsoft Graph calendar integration
 */
async function linkMeetingsToCRM() {
  console.log('🔗 CRM Linker - Connecting meetings to CRM entries...\n');
  console.log('📅 Using Microsoft Graph API for attendee emails\n');

  const meetings = await getMeetingsForCRMLinking(7);
  console.log(`Found ${meetings.length} Pipeline/Customer meetings from the past 7 days\n`);

  let linked = 0;
  let created = 0;
  let emailsExtracted = 0;
  let skippedAlreadyLinked = 0;
  let skippedNoContact = 0;
  let errors = 0;

  for (const meeting of meetings) {
    try {
      // Skip if already has CRM link
      if (meeting.hasCRMLink) {
        console.log(`⏭️  Already linked: ${meeting.name}`);
        skippedAlreadyLinked++;
        continue;
      }

      console.log(`\n📄 Processing: ${meeting.name}`);
      console.log(`   📅 Date: ${meeting.date}`);

      let email = meeting.email;
      let company: string | null = null;
      let contactName: string | null = null;

      // If no email in the Email field, get from calendar event
      if (!email) {
        console.log(`   🔍 No email field - checking calendar...`);

        const calendarContact = await findCalendarEventForMeeting(meeting.date, meeting.name);

        if (calendarContact) {
          email = calendarContact.email;
          contactName = calendarContact.name;
          console.log(`   📧 Found attendee: ${contactName} <${email}>`);

          // Update meeting's Email field
          await updateMeetingEmail(meeting.id, email);
          emailsExtracted++;
          console.log(`   ✅ Updated meeting Email field`);
        }
      } else {
        console.log(`   📧 Email: ${email}`);
      }

      // Extract company from email
      if (email) {
        company = extractCompanyFromEmail(email);
      }

      if (company) {
        console.log(`   🏢 Company: ${company}`);
      }

      console.log(`   📁 Bucket: ${meeting.bucket}`);

      // If no email and no company, skip
      if (!email && !company) {
        console.log(`   ⏭️  No external contact found`);
        skippedNoContact++;
        continue;
      }

      // Try to find existing CRM entry
      let existingEntry = null;

      if (email) {
        existingEntry = await findCRMEntryByEmail(email);
        if (existingEntry) {
          console.log(`   ✅ Found CRM by email: ${existingEntry.name} (${existingEntry.status})`);
        }
      }

      if (!existingEntry && company) {
        existingEntry = await findCRMEntryByCompany(company);
        if (existingEntry) {
          console.log(`   ✅ Found CRM by company: ${existingEntry.name} (${existingEntry.status})`);
        }
      }

      if (existingEntry) {
        // Link to existing entry
        await linkMeetingToCRM(meeting.id, existingEntry.id);
        await updateLastContact(existingEntry.id);
        linked++;
        console.log(`   🔗 Linked meeting to CRM entry`);
      } else {
        // Create new CRM entry
        console.log(`   🆕 Creating new CRM entry...`);

        const status: CRMStatus = meeting.bucket === 'Customer' ? 'In progress' : 'Lead';
        const companyName = company || 'Unknown';

        // Build contact name
        let finalContactName = contactName;
        if (!finalContactName && email) {
          const emailUser = email.split('@')[0];
          finalContactName = `${emailUser} at ${companyName}`;
        }
        if (!finalContactName) {
          finalContactName = `Contact at ${companyName}`;
        }

        const newEntry = await createCRMEntry({
          name: finalContactName,
          company: companyName,
          email: email || undefined,
          status,
          sourceMeetingBucket: meeting.bucket,
        });

        console.log(`   ✅ Created: ${newEntry.name} (Status: ${status})`);

        await linkMeetingToCRM(meeting.id, newEntry.id);
        created++;
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 300));
    } catch (error: any) {
      console.error(`   ❌ Error: ${error.message || error}`);
      errors++;
    }
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`✅ CRM Linking complete!`);
  console.log(`   Emails from calendar: ${emailsExtracted}`);
  console.log(`   Linked to existing: ${linked}`);
  console.log(`   Created new entries: ${created}`);
  console.log(`   Skipped (already linked): ${skippedAlreadyLinked}`);
  console.log(`   Skipped (no contact): ${skippedNoContact}`);
  console.log(`   Errors: ${errors}`);
}

// Run if called directly
linkMeetingsToCRM().catch(console.error);
