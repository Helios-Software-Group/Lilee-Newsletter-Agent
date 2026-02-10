import type { Client } from '@notionhq/client';

/**
 * Extract plain text from a Notion rich_text array.
 *
 * Shared helper used by fetchPageContent and any code that reads
 * Notion block content.
 */
export function getRichText(richText: any[]): string {
  if (!richText) return '';
  return richText.map((t: any) => t.plain_text || '').join('');
}

/**
 * Read the blocks of a Notion page and return a markdown string.
 *
 * Handles headings, paragraphs, lists, quotes, dividers, callouts,
 * and to-do items. Blocks that have no simple text representation
 * (embeds, images, etc.) are silently skipped.
 *
 * @param notion  - An authenticated Notion Client instance
 * @param pageId  - The Notion page (or block) ID to read
 */
export async function fetchPageContent(notion: Client, pageId: string): Promise<string> {
  const blocks = await notion.blocks.children.list({
    block_id: pageId,
    page_size: 100,
  });

  let markdown = '';

  for (const block of blocks.results) {
    const b = block as any;
    const type = b.type;

    switch (type) {
      case 'heading_1':
        markdown += `# ${getRichText(b.heading_1?.rich_text)}\n\n`;
        break;
      case 'heading_2':
        markdown += `## ${getRichText(b.heading_2?.rich_text)}\n\n`;
        break;
      case 'heading_3':
        markdown += `### ${getRichText(b.heading_3?.rich_text)}\n\n`;
        break;
      case 'paragraph':
        const text = getRichText(b.paragraph?.rich_text);
        if (text) markdown += `${text}\n\n`;
        break;
      case 'bulleted_list_item':
        markdown += `- ${getRichText(b.bulleted_list_item?.rich_text)}\n`;
        break;
      case 'numbered_list_item':
        markdown += `1. ${getRichText(b.numbered_list_item?.rich_text)}\n`;
        break;
      case 'quote':
        markdown += `> ${getRichText(b.quote?.rich_text)}\n\n`;
        break;
      case 'divider':
        markdown += '---\n\n';
        break;
      case 'callout':
        markdown += `> **Note:** ${getRichText(b.callout?.rich_text)}\n\n`;
        break;
      case 'to_do':
        const checked = b.to_do?.checked ? '[x]' : '[ ]';
        markdown += `- ${checked} ${getRichText(b.to_do?.rich_text)}\n`;
        break;
    }
  }

  return markdown.trim();
}
