import { Client } from '@notionhq/client';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { generateContentHtml, getRichText, formatHighlights } from './html-generator.js';

// Load .env from project root manually (only if exists - for local dev)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '..', '.env');

if (existsSync(envPath)) {
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
}

const notion = new Client({ auth: process.env.NOTION_API_KEY });

const NEWSLETTER_DB_ID = process.env.NOTION_NEWSLETTER_DB_ID!;
const LOOPS_API_KEY = process.env.LOOPS_API_KEY!;
const LOOPS_TRANSACTIONAL_ID = process.env.LOOPS_TRANSACTIONAL_ID!;

interface NewsletterToSend {
  id: string;
  url: string;
  title: string;
  issueDate: string;
  highlights: string;
  primaryCustomer: string;
  content: string;
  collateral: string; // HTML for embedded GIFs, images, videos
}

interface LoopsContact {
  email: string;
  firstName?: string;
  lastName?: string;
}

/**
 * Find newsletters with Status = "Ready to Send"
 */
async function getReadyNewsletters(): Promise<NewsletterToSend[]> {
  const response = await notion.databases.query({
    database_id: NEWSLETTER_DB_ID,
    filter: {
      property: 'Status',
      status: { equals: 'Ready' },
    },
  });

  const newsletters: NewsletterToSend[] = [];

  for (const page of response.results) {
    const p = page as any;

    // Get page content using shared HTML generator
    const blocks = await notion.blocks.children.list({ block_id: p.id, page_size: 100 });
    const content = await generateContentHtml(blocks.results as any[]);

    newsletters.push({
      id: p.id,
      url: p.url,
      title: p.properties.Issue?.title?.[0]?.plain_text || 'Newsletter',
      issueDate: p.properties['Issue date']?.date?.start || new Date().toISOString().split('T')[0],
      highlights: formatHighlights(getRichText(p.properties.Highlights?.rich_text)),
      primaryCustomer: getRichText(p.properties['Primary customer']?.rich_text),
      content,
      // Collateral: HTML for GIFs/images - stored in Notion "Collateral" rich_text property
      // Example: <img src="https://your-cdn.com/demo.gif" alt="Demo" style="max-width:100%;border-radius:8px;">
      collateral: p.properties.Collateral?.rich_text?.[0]?.plain_text || '',
    });
  }

  return newsletters;
}


/**
 * Get email recipients
 * Currently hardcoded for testing - can be expanded to pull from Loops audience or Notion
 */
async function getEmailRecipients(): Promise<LoopsContact[]> {
  // Hardcoded recipients for testing
  // TODO: Expand to pull from Loops audience or Notion database
  const recipients: LoopsContact[] = [
    { email: 'olivier@lilee.ai', firstName: 'Olivier' },
  ];

  console.log(`   📧 Found ${recipients.length} recipient(s)`);
  return recipients;
}

/**
 * Send newsletter via Loops transactional email
 */
async function sendViaLoops(
  newsletter: NewsletterToSend,
  recipients: LoopsContact[]
): Promise<{ sent: number; failed: number }> {
  if (!LOOPS_API_KEY || LOOPS_API_KEY === 'your-loops-api-key') {
    console.log('   ⚠️  Loops API key not configured. Skipping email send.');
    return { sent: 0, failed: 0 };
  }

  if (!LOOPS_TRANSACTIONAL_ID || LOOPS_TRANSACTIONAL_ID === 'your-transactional-email-id') {
    console.log('   ⚠️  Loops transactional ID not configured. Skipping email send.');
    return { sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;

  for (const recipient of recipients) {
    try {
      const response = await fetch('https://app.loops.so/api/v1/transactional', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOOPS_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transactionalId: LOOPS_TRANSACTIONAL_ID,
          email: recipient.email,
          dataVariables: {
            issueTitle: newsletter.title,
            issueDate: newsletter.issueDate,
            highlights: newsletter.highlights,
            contentHtml: newsletter.content,
            collateralHtml: newsletter.collateral,
            firstName: recipient.firstName || 'there',
          },
        }),
      });

      if (response.ok) {
        sent++;
      } else {
        console.log(`   ❌ Failed to send to ${recipient.email}: ${response.statusText}`);
        failed++;
      }
    } catch (error) {
      console.log(`   ❌ Error sending to ${recipient.email}: ${error}`);
      failed++;
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return { sent, failed };
}

/**
 * Update newsletter status to "Sent" in Notion
 */
async function markAsSent(pageId: string): Promise<void> {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      Status: {
        status: { name: 'Sent' },
      },
    },
  });
}

/**
 * Main function to send ready newsletters
 */
async function sendNewsletters() {
  console.log('📧 Newsletter Send Agent\n');
  console.log('='.repeat(50));

  // Step 1: Find newsletters ready to send
  console.log('\n📋 Step 1: Finding newsletters with Status = "Ready"...');
  const newsletters = await getReadyNewsletters();

  if (newsletters.length === 0) {
    console.log('   No newsletters ready to send.');
    console.log('   Set Status to "Ready" in Notion to trigger email send.');
    return;
  }

  console.log(`   Found ${newsletters.length} newsletter(s) ready to send:`);
  for (const n of newsletters) {
    console.log(`   - ${n.title}`);
  }

  // Step 2: Get recipients
  console.log('\n📬 Step 2: Getting email recipients...');
  const recipients = await getEmailRecipients();

  if (recipients.length === 0) {
    console.log('   No recipients configured. Skipping email send.');
    console.log('   Configure recipients in Loops or update getEmailRecipients().');

    // Still mark as sent for demo purposes
    for (const newsletter of newsletters) {
      console.log(`\n📝 Marking "${newsletter.title}" as Sent (no emails sent)...`);
      await markAsSent(newsletter.id);
    }
    return;
  }

  console.log(`   Found ${recipients.length} recipient(s)`);

  // Step 3: Send each newsletter
  for (const newsletter of newsletters) {
    console.log(`\n📤 Step 3: Sending "${newsletter.title}"...`);
    const result = await sendViaLoops(newsletter, recipients);

    console.log(`   Sent: ${result.sent}, Failed: ${result.failed}`);

    // Step 4: Update status to Sent
    if (result.sent > 0 || recipients.length === 0) {
      console.log('\n✅ Step 4: Updating status to "Sent"...');
      await markAsSent(newsletter.id);
      console.log(`   Updated: ${newsletter.url}`);
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('✅ Newsletter send complete!');
}

/**
 * Send a single newsletter by page ID
 * Used by the webhook endpoint for auto-send on status change
 */
async function sendSingleNewsletter(pageId: string): Promise<{
  success: boolean;
  sent: number;
  failed: number;
  error?: string;
}> {
  console.log('📧 Sending single newsletter\n');
  console.log('='.repeat(50));
  console.log(`Page ID: ${pageId}`);

  try {
    // Get the newsletter page
    const page = await notion.pages.retrieve({ page_id: pageId }) as any;
    const status = page.properties.Status?.status?.name;

    // Verify status is Ready (not already Sent)
    if (status === 'Sent') {
      console.log('   ℹ️  Newsletter already sent, skipping');
      return { success: true, sent: 0, failed: 0 };
    }

    if (status !== 'Ready') {
      console.log(`   ⚠️  Status is "${status}", not "Ready". Skipping.`);
      return { success: false, sent: 0, failed: 0, error: `Status is "${status}", expected "Ready"` };
    }

    // Get content using shared HTML generator
    const blocks = await notion.blocks.children.list({ block_id: pageId, page_size: 100 });
    const content = await generateContentHtml(blocks.results as any[]);

    const newsletter: NewsletterToSend = {
      id: pageId,
      url: page.url,
      title: page.properties.Issue?.title?.[0]?.plain_text || 'Newsletter',
      issueDate: page.properties['Issue date']?.date?.start || new Date().toISOString().split('T')[0],
      highlights: formatHighlights(getRichText(page.properties.Highlights?.rich_text)),
      primaryCustomer: getRichText(page.properties['Primary customer']?.rich_text),
      content,
      collateral: page.properties.Collateral?.rich_text?.[0]?.plain_text || '',
    };

    console.log(`\n📰 Sending: ${newsletter.title}`);

    // Get recipients
    const recipients = await getEmailRecipients();
    console.log(`   Recipients: ${recipients.length}`);

    if (recipients.length === 0) {
      console.log('   ⚠️  No recipients. Marking as sent.');
      await markAsSent(pageId);
      return { success: true, sent: 0, failed: 0 };
    }

    // Send
    const result = await sendViaLoops(newsletter, recipients);
    console.log(`   Sent: ${result.sent}, Failed: ${result.failed}`);

    // Mark as sent
    await markAsSent(pageId);
    console.log('   ✅ Marked as Sent');

    return { success: true, sent: result.sent, failed: result.failed };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`   ❌ Error: ${errorMessage}`);
    return { success: false, sent: 0, failed: 0, error: errorMessage };
  }
}

// Run if called directly
sendNewsletters().catch(console.error);

export { sendNewsletters, sendSingleNewsletter };
