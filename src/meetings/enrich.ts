/**
 * Lilee Newsletter Agent - Claude Agent SDK Implementation
 *
 * This agent handles meeting enrichment using Notion AI Search:
 * 1. Receives webhook when new meeting note is created in Notion
 * 2. Uses Notion AI Search to find calendar/Teams info (via connected sources)
 * 3. Extracts external attendee email
 * 4. Updates Notion meeting's Email and Company fields
 *
 * NO MICROSOFT AZURE REQUIRED - Uses Notion's existing AI connectors!
 */

import '../lib/env.js';
import { query } from '@anthropic-ai/claude-agent-sdk';

// Internal email domains to filter out
const INTERNAL_DOMAINS = [
  'lilee', 'helios', 'lily', 'chordline', 'cordline', 'valsoft',
  'gmail', 'yahoo', 'hotmail', 'outlook', 'icloud', 'me',
  'proton', 'protonmail', 'live', 'msn', 'aol'
].join(', ');

// System prompt for the meeting enrichment agent
const SYSTEM_PROMPT = `You are the Lilee Newsletter Agent, responsible for enriching meeting notes with attendee information.

Your job is to find external attendee emails for meetings and update the Notion database.

## Search Strategy

Notion AI Search indexes Outlook emails, Slack messages, GitHub, and Notion pages. Use multiple search queries to find attendee information:

### Search Queries to Try (in order of priority):
1. **Meeting name + email keywords**: "[meeting name] attendees email participants"
2. **Meeting name + organization**: "[meeting name] [company mentioned in transcript]"
3. **Email thread search**: "Re: [meeting name]" or "invite [meeting name]"
4. **Date-based search**: "[meeting date] meeting attendees"

### Where to Find Emails:
- **Outlook results** (type: "outlook") - Email threads about the meeting often contain attendee addresses
- **Meeting transcripts** - Sometimes participants mention their email addresses
- **CRM entries** - If a company is mentioned, search for that company in the Customer database

## Email Validation

1. **Extract emails** using pattern: word@domain.tld
2. **Filter out internal emails** - Skip these domains: ${INTERNAL_DOMAINS}
3. **Prioritize business domains** - Prefer @company.com over personal email providers

## Company Extraction

From email like john@acv.com:
1. Take domain: "acv.com"
2. Remove TLD: "acv"
3. Capitalize: "Acv" or match to known company name

## Update Process

Once you find a valid external email:
1. Fetch the meeting page to confirm the Email field exists
2. Update the meeting page with:
   - Email: the external attendee's email address
   - Company: the company name extracted from email domain

## Important Rules
- Run multiple searches before giving up
- Be efficient - stop once you find a valid external email
- If no external attendees found after multiple searches, report clearly
- Only update fields if you found valid, verified data
- Log which search query was successful for debugging`;


/**
 * Run the meeting enrichment agent
 */
export async function enrichMeeting(meetingId: string, meetingDate: string, meetingName: string) {
  console.log(`\n🤖 Enriching meeting: ${meetingName}`);
  console.log(`   ID: ${meetingId}`);
  console.log(`   Date: ${meetingDate}`);

  // Extract key terms from meeting name for better searches
  const meetingKeywords = meetingName
    .replace(/@.*$/, '') // Remove timestamp if present
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .trim();

  const formattedDate = new Date(meetingDate).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });

  const prompt = `Enrich this Notion meeting with external attendee information.

## Meeting Details
- **Notion Page ID**: ${meetingId}
- **Meeting Name**: ${meetingName}
- **Meeting Date**: ${meetingDate} (${formattedDate})
- **Search Keywords**: ${meetingKeywords}

## Your Task

### Step 1: Search for Attendee Information
Run these Notion AI searches (using notion-search with ai_search mode):

1. First search: "${meetingKeywords} attendees email"
2. Second search: "${meetingKeywords} ${formattedDate}"
3. If company name visible in results, search: "[company name] email contact"

Look specifically for:
- Outlook emails (type: "outlook") about this meeting
- Email addresses in @domain.com format
- Names that could be looked up

### Step 2: Extract External Email
From the search results, find an email address that is NOT from these internal domains:
${INTERNAL_DOMAINS}

Valid examples: john@acv.com, sarah@simpra.com, mike@healthplan.org
Invalid (skip): anything@lilee.ai, personal@gmail.com

### Step 3: Update the Notion Meeting
If you found a valid external email, update the meeting page (${meetingId}):
- Set "Email" property to the external attendee's email
- Set "Company" property to the company name from the domain (e.g., "Acv" from acv.com)

### Step 4: Report Results
Clearly state:
- Which search query found the email (or "no email found")
- The email address and company name (if found)
- Whether the Notion page was updated

If no external email is found after all searches, report that clearly - don't make up data.`;


  try {
    const result = query({
      prompt,
      options: {
        systemPrompt: SYSTEM_PROMPT,
        model: 'claude-opus-4-6',
        maxTurns: 15,
        cwd: process.cwd(),
        // Use Notion MCP which is already connected via Claude Code
        // The agent will use notion-search with ai_search mode
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
      },
    });

    let finalResult = '';

    for await (const message of result) {
      if (message.type === 'assistant') {
        // Log assistant messages for debugging
        const content = message.message.content;
        for (const block of content) {
          if (block.type === 'text') {
            const text = block.text;
            // Only log meaningful content
            if (text.length > 20) {
              console.log(`   💬 ${text.slice(0, 150)}${text.length > 150 ? '...' : ''}`);
            }
          } else if (block.type === 'tool_use') {
            console.log(`   🔧 Using tool: ${block.name}`);
          }
        }
      } else if (message.type === 'result') {
        if (message.subtype === 'success') {
          finalResult = message.result;
          console.log(`\n   ✅ Success!`);
          console.log(`   📊 Result: ${message.result.slice(0, 300)}`);
          console.log(`   💰 Cost: $${message.total_cost_usd.toFixed(4)}`);
        } else {
          console.log(`   ❌ Error: ${message.subtype}`);
          if ('errors' in message) {
            console.log(`      ${message.errors.join(', ')}`);
          }
        }
      }
    }

    return { success: true, result: finalResult };
  } catch (error: any) {
    console.error(`   ❌ Agent error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Process a Notion webhook payload
 */
export async function handleWebhook(payload: {
  meetingId: string;
  meetingDate: string;
  meetingName: string;
}) {
  return enrichMeeting(payload.meetingId, payload.meetingDate, payload.meetingName);
}

// CLI mode - run directly
if (process.argv[1]?.includes('enrich')) {
  const testMeetingId = process.argv[2] || 'test-meeting-id';
  const testDate = process.argv[3] || new Date().toISOString();
  const testName = process.argv[4] || 'Test Meeting';

  enrichMeeting(testMeetingId, testDate, testName)
    .then(result => {
      console.log('\n📊 Final Result:', JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    })
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}
