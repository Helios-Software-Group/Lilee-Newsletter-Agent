import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@notionhq/client';
import type { MeetingBucket } from './types/index.js';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

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

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const notion = new Client({ auth: process.env.NOTION_API_KEY });

const MEETINGS_DB_ID = process.env.NOTION_MEETINGS_DB_ID!;

// Valid topics for the multi-select field
const VALID_TOPICS = [
  'Product Demo', 'Pricing', 'Technical', 'Strategy',
  'Hiring', 'Partnership', 'Support', 'Onboarding', 'Feedback'
] as const;

interface MeetingMetadata {
  bucket: MeetingBucket;
  company: string;
  topics: string[];
  actionItems: string;
  summary: string;
}

/**
 * Get page content using Notion API - tries multiple approaches
 */
async function getPageContent(pageId: string, pageUrl: string): Promise<string> {
  const textParts: string[] = [];

  // First, get the page title
  try {
    const page = await notion.pages.retrieve({ page_id: pageId }) as any;
    const title = page.properties?.Name?.title?.[0]?.plain_text ||
                  page.properties?.title?.title?.[0]?.plain_text || '';
    if (title) textParts.push(`Title: ${title}`);
  } catch {}

  // Then read all accessible blocks
  async function readBlocks(blockId: string, depth = 0): Promise<void> {
    if (depth > 4) return;

    let cursor: string | undefined;
    do {
      try {
        const response = await notion.blocks.children.list({
          block_id: blockId,
          page_size: 100,
          start_cursor: cursor,
        });

        for (const block of response.results) {
          const b = block as any;
          const type = b.type;

          // Skip unsupported block types gracefully
          if (type === 'unsupported' || type === 'transcription') continue;

          // Extract text from various block types
          if (b[type]?.rich_text) {
            const text = b[type].rich_text.map((t: any) => t.plain_text).join('');
            if (text) textParts.push(text);
          }

          // Handle headings
          if (type.startsWith('heading_') && b[type]?.rich_text) {
            const heading = b[type].rich_text.map((t: any) => t.plain_text).join('');
            if (heading) textParts.push(`## ${heading}`);
          }

          // Handle toggle blocks (often contain summaries)
          if (type === 'toggle' && b.toggle?.rich_text) {
            const toggleTitle = b.toggle.rich_text.map((t: any) => t.plain_text).join('');
            if (toggleTitle) textParts.push(`### ${toggleTitle}`);
          }

          // Handle callouts
          if (type === 'callout' && b.callout?.rich_text) {
            const callout = b.callout.rich_text.map((t: any) => t.plain_text).join('');
            if (callout) textParts.push(`> ${callout}`);
          }

          // Recurse into blocks with children (except pages/databases)
          if (b.has_children && !['child_page', 'child_database', 'transcription'].includes(type)) {
            try {
              await readBlocks(b.id, depth + 1);
            } catch {}
          }
        }

        cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
      } catch (error: any) {
        // Skip blocks that can't be read (like transcription)
        if (!error.message?.includes('not supported')) {
          console.log(`      Note: Some content not accessible via API`);
        }
        break;
      }
    } while (cursor);
  }

  await readBlocks(pageId);

  return textParts.join('\n').slice(0, 10000);
}

/**
 * Use Claude to extract ALL metadata fields from meeting content
 */
async function extractMeetingMetadata(title: string, content: string): Promise<MeetingMetadata> {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: `Analyze this meeting and extract metadata. Respond ONLY with valid JSON.

Meeting Title: ${title}

Meeting Content:
${content.slice(0, 7000)}

Extract:
{
  "bucket": "Customer" | "Pipeline" | "Internal",
  "company": "external company/organization discussed (NOT Lilee, Helios, or internal team names), or empty string",
  "topics": ["1-3 relevant topics from: Product Demo, Pricing, Technical, Strategy, Hiring, Partnership, Support, Onboarding, Feedback"],
  "actionItems": "bullet-pointed list of action items/next steps mentioned, or empty string if none",
  "summary": "1-2 sentence summary if not already present in content, or empty string if good summary exists"
}

Bucket rules:
- Customer: Meetings with EXISTING customers, beta testers, active support, demos to CURRENT clients
- Pipeline: Sales calls, prospect demos, partnership discussions, intro calls with POTENTIAL customers/partners
- Internal: Team meetings, hiring, strategy, R&D, planning, 1:1s, internal discussions, company updates

Important: Extract action items like "schedule follow-up", "send proposal", "review document", etc.

Respond with ONLY valid JSON, no markdown.`
    }]
  });

  const responseText = (message.content[0] as any).text.trim();

  try {
    const jsonStr = responseText.replace(/```json\n?|\n?```/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    const bucket = ['Customer', 'Pipeline', 'Internal'].includes(parsed.bucket)
      ? parsed.bucket
      : 'Internal';

    const topics = Array.isArray(parsed.topics)
      ? parsed.topics.filter((t: string) => VALID_TOPICS.includes(t as any)).slice(0, 3)
      : [];

    return {
      bucket,
      company: String(parsed.company || '').slice(0, 100),
      topics,
      actionItems: String(parsed.actionItems || '').slice(0, 1000),
      summary: String(parsed.summary || '').slice(0, 500),
    };
  } catch {
    console.log(`      Warning: Could not parse AI response`);
    return {
      bucket: 'Internal',
      company: '',
      topics: [],
      actionItems: '',
      summary: '',
    };
  }
}

/**
 * Find meetings that need categorization (empty Bucket)
 */
async function getUncategorizedMeetings(): Promise<Array<{ id: string; title: string; url: string }>> {
  const meetings: Array<{ id: string; title: string; url: string }> = [];
  let cursor: string | undefined;

  do {
    const response = await notion.databases.query({
      database_id: MEETINGS_DB_ID,
      filter: {
        property: 'Bucket',
        select: { is_empty: true },
      },
      page_size: 100,
      start_cursor: cursor,
    });

    for (const page of response.results) {
      const p = page as any;
      const title = p.properties.Name?.title?.[0]?.plain_text || 'Untitled';
      meetings.push({ id: p.id, title, url: p.url });
    }

    cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (cursor);

  return meetings;
}

/**
 * Update meeting with extracted metadata
 */
async function updateMeetingMetadata(pageId: string, metadata: MeetingMetadata): Promise<void> {
  const properties: any = {
    Bucket: { select: { name: metadata.bucket } },
  };

  if (metadata.company) {
    properties.Company = {
      rich_text: [{ text: { content: metadata.company } }],
    };
  }

  if (metadata.topics.length > 0) {
    properties.Topics = {
      multi_select: metadata.topics.map(t => ({ name: t })),
    };
  }

  if (metadata.actionItems) {
    properties['Action Items'] = {
      rich_text: [{ text: { content: metadata.actionItems } }],
    };
  }

  // Only update Summary if it's empty and we extracted one
  if (metadata.summary) {
    properties.Summary = {
      rich_text: [{ text: { content: metadata.summary } }],
    };
  }

  await notion.pages.update({
    page_id: pageId,
    properties,
  });
}

/**
 * Main categorization function
 */
async function categorizeUncategorizedMeetings() {
  console.log('🔍 Finding uncategorized meetings in Meetings DB...\n');
  const meetings = await getUncategorizedMeetings();

  if (meetings.length === 0) {
    console.log('✅ All meetings are already categorized!');
    return;
  }

  console.log(`Found ${meetings.length} meetings to categorize\n`);

  let categorized = 0;
  let skipped = 0;
  let errors = 0;

  for (const meeting of meetings) {
    try {
      console.log(`📄 ${meeting.title}`);
      console.log(`   Reading content...`);

      const content = await getPageContent(meeting.id, meeting.url);

      if (content.length < 30) {
        console.log(`   ⏭️  Skipping - no content yet`);
        skipped++;
        continue;
      }

      console.log(`   🤖 Analyzing with AI...`);
      const metadata = await extractMeetingMetadata(meeting.title, content);

      await updateMeetingMetadata(meeting.id, metadata);

      // Pretty output
      const parts = [metadata.bucket];
      if (metadata.company) parts.push(metadata.company);
      if (metadata.topics.length) parts.push(metadata.topics.join(', '));

      console.log(`   ✅ ${parts.join(' | ')}`);
      if (metadata.actionItems) {
        console.log(`      Action Items: ${metadata.actionItems.slice(0, 100)}${metadata.actionItems.length > 100 ? '...' : ''}`);
      }

      categorized++;

      // Rate limiting for API calls
      await new Promise(resolve => setTimeout(resolve, 700));
    } catch (error: any) {
      console.error(`   ❌ Error: ${error.message || error}`);
      errors++;
    }
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`✅ Complete!`);
  console.log(`   Categorized: ${categorized}`);
  console.log(`   Skipped (no content): ${skipped}`);
  console.log(`   Errors: ${errors}`);
}

categorizeUncategorizedMeetings().catch(console.error);
