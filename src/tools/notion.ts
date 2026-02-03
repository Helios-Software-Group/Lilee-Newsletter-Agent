import { Client } from '@notionhq/client';
import type { Meeting, MeetingBucket, MeetingWithContent, NewsletterDraft } from '../types/index.js';

const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

const MEETINGS_DB_ID = process.env.NOTION_MEETINGS_DB_ID!;
const NEWSLETTER_DB_ID = process.env.NOTION_NEWSLETTER_DB_ID!;
const MEETINGS_COLLECTION_ID = process.env.NOTION_MEETINGS_COLLECTION_ID!;
const NEWSLETTER_COLLECTION_ID = process.env.NOTION_NEWSLETTER_COLLECTION_ID!;

/**
 * Get meetings from the past N days, optionally filtered by bucket
 */
export async function getMeetings(
  daysBack: number = 7,
  bucket?: MeetingBucket
): Promise<Meeting[]> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);

  const filter: any = {
    property: 'createdTime',
    date: {
      on_or_after: startDate.toISOString(),
    },
  };

  if (bucket) {
    filter.and = [
      filter,
      {
        property: 'Bucket',
        select: {
          equals: bucket,
        },
      },
    ];
  }

  const response = await notion.databases.query({
    database_id: MEETINGS_DB_ID,
    filter: bucket ? filter.and[1] : undefined,
    sorts: [
      {
        timestamp: 'created_time',
        direction: 'descending',
      },
    ],
  });

  return response.results.map((page: any) => ({
    id: page.id,
    url: page.url,
    name: page.properties.Name?.title?.[0]?.plain_text || 'Untitled',
    bucket: page.properties.Bucket?.select?.name || 'Internal',
    date: page.created_time,
  }));
}

/**
 * Get meetings grouped by bucket
 */
export async function getMeetingsByBucket(daysBack: number = 7): Promise<{
  customer: Meeting[];
  pipeline: Meeting[];
  internal: Meeting[];
}> {
  const allMeetings = await getMeetings(daysBack);

  return {
    customer: allMeetings.filter((m) => m.bucket === 'Customer'),
    pipeline: allMeetings.filter((m) => m.bucket === 'Pipeline'),
    internal: allMeetings.filter((m) => m.bucket === 'Internal'),
  };
}

/**
 * Create a new newsletter draft
 */
export async function createNewsletterDraft(
  draft: Omit<NewsletterDraft, 'id' | 'url'>
): Promise<NewsletterDraft> {
  const response = await notion.pages.create({
    parent: { database_id: NEWSLETTER_DB_ID },
    properties: {
      Issue: {
        title: [{ text: { content: draft.title } }],
      },
      'Issue date': {
        date: { start: draft.date },
      },
      Status: {
        status: { name: draft.status },
      },
      Audience: {
        select: { name: draft.audience },
      },
      Highlights: {
        rich_text: [{ text: { content: draft.highlights } }],
      },
      ...(draft.primaryCustomer && {
        'Primary customer': {
          rich_text: [{ text: { content: draft.primaryCustomer } }],
        },
      }),
    },
    children: parseMarkdownToBlocks(draft.content),
  });

  return {
    ...draft,
    id: response.id,
    url: (response as any).url,
  };
}

/**
 * Update newsletter status
 */
export async function updateNewsletterStatus(
  pageId: string,
  status: NewsletterDraft['status']
): Promise<void> {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      Status: {
        status: { name: status },
      },
    },
  });
}

/**
 * Get newsletters with "Ready to Send" status
 */
export async function getReadyToSendNewsletters(): Promise<NewsletterDraft[]> {
  const response = await notion.databases.query({
    database_id: NEWSLETTER_DB_ID,
    filter: {
      property: 'Status',
      status: {
        equals: 'Ready to Send',
      },
    },
  });

  return response.results.map((page: any) => ({
    id: page.id,
    url: page.url,
    title: page.properties.Issue?.title?.[0]?.plain_text || 'Untitled',
    date: page.properties['Issue date']?.date?.start || new Date().toISOString(),
    status: page.properties.Status?.status?.name || 'Draft',
    audience: page.properties.Audience?.select?.name || 'Customers',
    highlights: page.properties.Highlights?.rich_text?.[0]?.plain_text || '',
    primaryCustomer: page.properties['Primary customer']?.rich_text?.[0]?.plain_text,
    content: '', // Would need to fetch page content separately
  }));
}

/**
 * Get page content as markdown
 */
export async function getPageContent(pageId: string): Promise<string> {
  const blocks = await notion.blocks.children.list({
    block_id: pageId,
    page_size: 100,
  });

  return blocks.results
    .map((block: any) => blockToMarkdown(block))
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Convert a Notion block to markdown
 */
function blockToMarkdown(block: any): string {
  const type = block.type;
  const content = block[type];

  switch (type) {
    case 'paragraph':
      return richTextToMarkdown(content.rich_text);
    case 'heading_1':
      return `# ${richTextToMarkdown(content.rich_text)}`;
    case 'heading_2':
      return `## ${richTextToMarkdown(content.rich_text)}`;
    case 'heading_3':
      return `### ${richTextToMarkdown(content.rich_text)}`;
    case 'bulleted_list_item':
      return `- ${richTextToMarkdown(content.rich_text)}`;
    case 'numbered_list_item':
      return `1. ${richTextToMarkdown(content.rich_text)}`;
    case 'to_do':
      const checked = content.checked ? 'x' : ' ';
      return `- [${checked}] ${richTextToMarkdown(content.rich_text)}`;
    case 'toggle':
      return `▶ ${richTextToMarkdown(content.rich_text)}`;
    case 'code':
      return `\`\`\`${content.language || ''}\n${richTextToMarkdown(content.rich_text)}\n\`\`\``;
    case 'quote':
      return `> ${richTextToMarkdown(content.rich_text)}`;
    case 'divider':
      return '---';
    case 'callout':
      return `> ${content.icon?.emoji || '💡'} ${richTextToMarkdown(content.rich_text)}`;
    default:
      return '';
  }
}

/**
 * Convert rich text array to markdown string
 */
function richTextToMarkdown(richText: any[]): string {
  if (!richText || !Array.isArray(richText)) return '';

  return richText
    .map((text) => {
      let content = text.plain_text || '';
      if (text.annotations?.bold) content = `**${content}**`;
      if (text.annotations?.italic) content = `*${content}*`;
      if (text.annotations?.strikethrough) content = `~~${content}~~`;
      if (text.annotations?.code) content = `\`${content}\``;
      if (text.href) content = `[${content}](${text.href})`;
      return content;
    })
    .join('');
}

/**
 * Parse markdown to Notion blocks (simplified)
 */
function parseMarkdownToBlocks(markdown: string): any[] {
  const lines = markdown.split('\n');
  const blocks: any[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    if (line.startsWith('# ')) {
      blocks.push({
        type: 'heading_1',
        heading_1: {
          rich_text: [{ type: 'text', text: { content: line.slice(2) } }],
        },
      });
    } else if (line.startsWith('## ')) {
      blocks.push({
        type: 'heading_2',
        heading_2: {
          rich_text: [{ type: 'text', text: { content: line.slice(3) } }],
        },
      });
    } else if (line.startsWith('### ')) {
      blocks.push({
        type: 'heading_3',
        heading_3: {
          rich_text: [{ type: 'text', text: { content: line.slice(4) } }],
        },
      });
    } else if (line.startsWith('- ')) {
      blocks.push({
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [{ type: 'text', text: { content: line.slice(2) } }],
        },
      });
    } else if (line.startsWith('> ')) {
      blocks.push({
        type: 'quote',
        quote: {
          rich_text: [{ type: 'text', text: { content: line.slice(2) } }],
        },
      });
    } else if (line === '---') {
      blocks.push({ type: 'divider', divider: {} });
    } else {
      blocks.push({
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: line } }],
        },
      });
    }
  }

  return blocks;
}

/**
 * Search for meeting notes pages (AI Meeting Notes)
 */
export async function searchMeetingNotes(query: string): Promise<any[]> {
  const response = await notion.search({
    query,
    filter: {
      property: 'object',
      value: 'page',
    },
    sort: {
      direction: 'descending',
      timestamp: 'last_edited_time',
    },
    page_size: 20,
  });

  return response.results;
}

/**
 * Categorize a meeting and add to the Meetings database
 */
export async function addMeetingToDatabase(
  name: string,
  bucket: MeetingBucket,
  sourcePageId?: string
): Promise<Meeting> {
  const response = await notion.pages.create({
    parent: { database_id: MEETINGS_DB_ID },
    properties: {
      Name: {
        title: [{ text: { content: name } }],
      },
      Bucket: {
        select: { name: bucket },
      },
    },
  });

  return {
    id: response.id,
    url: (response as any).url,
    name,
    bucket,
    date: (response as any).created_time,
  };
}
