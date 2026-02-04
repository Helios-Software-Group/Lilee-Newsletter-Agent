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

// Initialize clients after env loads
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const notion = new Client({ auth: process.env.NOTION_API_KEY });

const MEETINGS_DB_ID = process.env.NOTION_MEETINGS_DB_ID!;

// Valid topics for the multi-select field
const VALID_TOPICS = [
  'Product Demo', 'Pricing', 'Technical', 'Strategy',
  'Hiring', 'Partnership', 'Support', 'Onboarding', 'Feedback'
] as const;

interface StandaloneMeetingPage {
  id: string;
  url: string;
  title: string;
  content: string;
  createdTime: string;
}

interface MeetingMetadata {
  bucket: MeetingBucket;
  company: string;
  summary: string;
  topics: string[];
  actionItems: string;
}

/**
 * Search for all standalone meeting pages in the workspace (NOT in a database)
 */
async function findStandaloneMeetingPages(): Promise<StandaloneMeetingPage[]> {
  // Search terms to find meeting pages
  const searchTerms = [
    // Time-based patterns (AI Meeting Notes format)
    '@January', '@February', '@March', '@April', '@May', '@June',
    '@July', '@August', '@September', '@October', '@November', '@December',
    '@Last', '@Yesterday', '@Today',
    // Date prefixes
    '2026-01', '2026-02', '2025-12', '2025-11', '2025-10', '2025-09',
    // Meeting keywords
    'Meeting', 'Call', 'Discussion', 'Demo', 'Sync', 'Intro',
    'Walkthrough', 'Session', 'Weekly', 'Convo', 'CTO', 'Beta Testing',
    // Company/context specific
    'ACV', 'Chordline', 'Lilee', 'Helios', 'PCC', 'Saleshive',
  ];
  const allPages: Map<string, StandaloneMeetingPage> = new Map();

  for (const term of searchTerms) {
    console.log(`   Searching for: "${term}"...`);

    let cursor: string | undefined;
    do {
      const response = await notion.search({
        query: term,
        filter: { property: 'object', value: 'page' },
        sort: { direction: 'descending', timestamp: 'last_edited_time' },
        page_size: 100,
        start_cursor: cursor,
      });

      for (const page of response.results) {
        if (page.object !== 'page') continue;
        const p = page as any;

        // Skip pages that are already in a database (they have a parent.database_id)
        if (p.parent?.database_id) continue;

        // Skip if already processed
        if (allPages.has(p.id)) continue;

        const title = p.properties?.title?.title?.[0]?.plain_text ||
                     p.properties?.Name?.title?.[0]?.plain_text ||
                     'Untitled';

        // Filter for meeting-like pages
        const isMeetingPage =
          title.includes('@') ||
          title.toLowerCase().includes('meeting') ||
          title.toLowerCase().includes('call') ||
          title.toLowerCase().includes('discussion') ||
          title.toLowerCase().includes('demo') ||
          title.toLowerCase().includes('sync') ||
          title.toLowerCase().includes('intro') ||
          title.toLowerCase().includes('walkthrough') ||
          title.toLowerCase().includes('session') ||
          title.toLowerCase().includes('weekly') ||
          title.toLowerCase().includes('convo') ||
          title.match(/^\d{4}-\d{2}-\d{2}/) || // Date-prefixed pages
          title.match(/^@/); // Starts with @ (AI Meeting Notes)

        if (isMeetingPage) {
          allPages.set(p.id, {
            id: p.id,
            url: p.url,
            title,
            content: '', // Will fetch later
            createdTime: p.created_time,
          });
        }
      }

      cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
    } while (cursor);

    // Rate limit between search terms
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  console.log(`\n   Total unique meeting pages found: ${allPages.size}\n`);
  return Array.from(allPages.values());
}

/**
 * Get content of a page - returns empty string if no meaningful content
 */
async function getPageContent(pageId: string): Promise<string> {
  try {
    const blocks = await notion.blocks.children.list({
      block_id: pageId,
      page_size: 100,
    });

    const textParts: string[] = [];

    for (const block of blocks.results) {
      const b = block as any;
      const type = b.type;

      // Skip unsupported block types
      if (type === 'unsupported' || type === 'transcription') continue;

      // Extract text from various block types
      if (b[type]?.rich_text) {
        const text = b[type].rich_text.map((t: any) => t.plain_text).join('');
        if (text.trim()) textParts.push(text);
      }

      // Handle toggle blocks
      if (type === 'toggle' && b.toggle?.rich_text) {
        const toggleTitle = b.toggle.rich_text.map((t: any) => t.plain_text).join('');
        if (toggleTitle.trim()) textParts.push(toggleTitle);
      }

      // Handle callouts
      if (type === 'callout' && b.callout?.rich_text) {
        const callout = b.callout.rich_text.map((t: any) => t.plain_text).join('');
        if (callout.trim()) textParts.push(callout);
      }
    }

    return textParts.join('\n').slice(0, 6000);
  } catch {
    return '';
  }
}

/**
 * Get all blocks from a source page to copy content
 */
async function getAllPageBlocks(pageId: string): Promise<any[]> {
  const blocks: any[] = [];
  let cursor: string | undefined;

  do {
    const response = await notion.blocks.children.list({
      block_id: pageId,
      page_size: 100,
      start_cursor: cursor,
    });

    blocks.push(...response.results);
    cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (cursor);

  return blocks;
}

/**
 * Convert blocks to appendable format (strip IDs and read-only props)
 */
function convertBlocksForAppend(blocks: any[]): any[] {
  return blocks
    .filter((block) => {
      // Skip unsupported block types for creation
      const unsupported = ['child_page', 'child_database', 'link_preview', 'synced_block', 'template', 'unsupported', 'transcription'];
      return !unsupported.includes(block.type);
    })
    .map((block) => {
      const { id, created_time, last_edited_time, created_by, last_edited_by, has_children, archived, in_trash, parent, ...rest } = block;
      return rest;
    });
}

/**
 * Use Claude to extract all meeting metadata at once
 */
async function extractMeetingMetadata(title: string, content: string): Promise<MeetingMetadata> {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `Analyze this meeting and extract structured metadata. Respond ONLY with valid JSON.

Meeting Title: ${title}

Meeting Content:
${content.slice(0, 4000)}

Extract the following as JSON:
{
  "bucket": "Customer" | "Pipeline" | "Internal",
  "company": "external company/organization mentioned (NOT Lilee, Helios, or internal team names), or empty string",
  "summary": "1-2 sentence summary of what was discussed",
  "topics": ["array of relevant topics from: Product Demo, Pricing, Technical, Strategy, Hiring, Partnership, Support, Onboarding, Feedback"],
  "actionItems": "bullet points of action items or next steps, or empty string if none"
}

Rules for bucket:
- Customer: Meetings with existing customers, beta testing, support, product demos to current clients
- Pipeline: Sales calls, prospect demos, partnership discussions, intro calls with potential customers
- Internal: Team meetings, hiring, strategy, R&D, internal planning, 1:1s

Respond with ONLY the JSON object, no markdown or explanation.`
    }]
  });

  const responseText = (message.content[0] as any).text.trim();

  try {
    const parsed = JSON.parse(responseText);

    // Validate and sanitize the response
    const bucket = ['Customer', 'Pipeline', 'Internal'].includes(parsed.bucket)
      ? parsed.bucket
      : 'Internal';

    const topics = Array.isArray(parsed.topics)
      ? parsed.topics.filter((t: string) => VALID_TOPICS.includes(t as any))
      : [];

    return {
      bucket,
      company: String(parsed.company || '').slice(0, 100),
      summary: String(parsed.summary || '').slice(0, 500),
      topics,
      actionItems: String(parsed.actionItems || '').slice(0, 1000),
    };
  } catch {
    // Fallback if JSON parsing fails
    return {
      bucket: 'Internal',
      company: '',
      summary: '',
      topics: [],
      actionItems: '',
    };
  }
}

/**
 * Check if a meeting with this source URL already exists in the DB
 */
async function meetingExistsByTitle(title: string): Promise<boolean> {
  const response = await notion.databases.query({
    database_id: MEETINGS_DB_ID,
    filter: {
      property: 'Name',
      title: { equals: title },
    },
    page_size: 1,
  });
  return response.results.length > 0;
}

/**
 * Create a new meeting entry in the Meetings DB with content copied from source
 */
async function createMeetingEntry(
  title: string,
  metadata: MeetingMetadata,
  sourcePageId: string,
  sourceUrl: string,
  createdTime: string
): Promise<string> {
  // Create the page with properties
  const newPage = await notion.pages.create({
    parent: { database_id: MEETINGS_DB_ID },
    properties: {
      Name: {
        title: [{ text: { content: title } }],
      },
      Bucket: {
        select: { name: metadata.bucket },
      },
      Date: {
        date: { start: createdTime.split('T')[0] },
      },
      ...(metadata.company && {
        Company: {
          rich_text: [{ text: { content: metadata.company } }],
        },
      }),
      ...(metadata.summary && {
        Summary: {
          rich_text: [{ text: { content: metadata.summary } }],
        },
      }),
      ...(metadata.topics.length > 0 && {
        Topics: {
          multi_select: metadata.topics.map(t => ({ name: t })),
        },
      }),
      ...(metadata.actionItems && {
        'Action Items': {
          rich_text: [{ text: { content: metadata.actionItems } }],
        },
      }),
    },
  });

  // Copy content blocks from source page
  const sourceBlocks = await getAllPageBlocks(sourcePageId);
  const appendableBlocks = convertBlocksForAppend(sourceBlocks);

  // Add a link to the original source at the top
  const sourceLink = {
    object: 'block',
    type: 'callout',
    callout: {
      rich_text: [{
        type: 'text',
        text: {
          content: 'Original meeting: ',
        },
      }, {
        type: 'text',
        text: {
          content: title,
          link: { url: sourceUrl },
        },
      }],
      icon: { emoji: '🔗' },
      color: 'gray_background',
    },
  };

  // Append source link first
  await notion.blocks.children.append({
    block_id: newPage.id,
    children: [sourceLink],
  });

  // Then append content blocks in batches
  if (appendableBlocks.length > 0) {
    for (let i = 0; i < appendableBlocks.length; i += 100) {
      const batch = appendableBlocks.slice(i, i + 100);
      try {
        await notion.blocks.children.append({
          block_id: newPage.id,
          children: batch,
        });
      } catch (error) {
        console.log(`      Warning: Could not copy some blocks`);
      }
    }
  }

  return (newPage as any).url;
}

/**
 * Main sync function - creates entries in Meetings DB from standalone pages
 */
async function syncMeetings() {
  console.log('🔍 Finding standalone meeting pages to import...\n');
  const pages = await findStandaloneMeetingPages();
  console.log(`Found ${pages.length} potential meeting pages\n`);

  let imported = 0;
  let skippedEmpty = 0;
  let skippedExists = 0;
  let errors = 0;

  for (const page of pages) {
    try {
      // Check if already exists in Meetings DB by title
      const exists = await meetingExistsByTitle(page.title);
      if (exists) {
        console.log(`⏭️  Already exists: ${page.title}`);
        skippedExists++;
        continue;
      }

      // Get content
      console.log(`\n📄 Checking: ${page.title}`);
      const content = await getPageContent(page.id);

      // Skip empty pages (less than 50 chars of content)
      if (content.length < 50) {
        console.log(`   ⏭️  Skipping - no meaningful content (${content.length} chars)`);
        skippedEmpty++;
        continue;
      }

      // Extract metadata with AI
      console.log(`   🤖 Analyzing content...`);
      const metadata = await extractMeetingMetadata(page.title, content);

      // Create entry in Meetings DB
      console.log(`   📦 Creating entry in Meetings DB...`);
      const newUrl = await createMeetingEntry(page.title, metadata, page.id, page.url, page.createdTime);

      console.log(`   ✅ Imported as ${metadata.bucket}`);
      if (metadata.company) console.log(`      Company: ${metadata.company}`);
      if (metadata.topics.length > 0) console.log(`      Topics: ${metadata.topics.join(', ')}`);

      imported++;

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 800));
    } catch (error: any) {
      console.error(`   ❌ Error: ${error.message || error}`);
      errors++;
    }
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`✅ Sync complete!`);
  console.log(`   Imported: ${imported}`);
  console.log(`   Skipped (empty): ${skippedEmpty}`);
  console.log(`   Skipped (already exists): ${skippedExists}`);
  console.log(`   Errors: ${errors}`);
}

// Run if called directly
syncMeetings().catch(console.error);
