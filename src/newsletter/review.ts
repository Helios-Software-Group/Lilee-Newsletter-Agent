import '../lib/env.js';
import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@notionhq/client';
import { loadPrompt } from '../lib/load-prompt.js';
import { fetchPageContent } from '../lib/notion-utils.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY?.trim() });
const notion = new Client({ auth: process.env.NOTION_API_KEY });

const REVIEW_SYSTEM_PROMPT = loadPrompt('review-newsletter');

interface ReviewResult {
  success: boolean;
  pageId: string;
  changesSummary: string[];
  error?: string;
}

/**
 * Review the newsletter content using Claude
 */
async function reviewWithClaude(content: string): Promise<{ improved: string; summary: string[] }> {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 8000,
    system: REVIEW_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Please review and improve the following newsletter draft. Make direct edits to improve payer language, add compliance angles, quantify impacts, and ensure proper audience framing.

---

${content}

---

Return the improved content with a "## Review Summary" section at the end listing key changes.`
    }]
  });

  const responseText = (message.content[0] as any).text.trim();

  // Split out the review summary
  const summaryMatch = responseText.match(/## Review Summary\n([\s\S]*?)$/);
  let improved = responseText;
  let summary: string[] = [];

  if (summaryMatch) {
    improved = responseText.replace(/---\n## Review Summary\n[\s\S]*$/, '').trim();
    const summaryText = summaryMatch[1];
    summary = summaryText
      .split('\n')
      .filter((line: string) => line.trim().startsWith('-') || line.trim().startsWith('*'))
      .map((line: string) => line.replace(/^[-*]\s*/, '').trim());
  }

  return { improved, summary };
}

/**
 * Clear existing content blocks from a page
 */
async function clearPageContent(pageId: string): Promise<void> {
  const blocks = await notion.blocks.children.list({
    block_id: pageId,
    page_size: 100,
  });

  for (const block of blocks.results) {
    try {
      await notion.blocks.delete({ block_id: block.id });
    } catch {
      // Some blocks may not be deletable, continue
    }
  }
}

/**
 * Parse inline markdown (bold, italic, code, links) into Notion rich_text array
 */
function parseInlineMarkdown(text: string): any[] {
  const richText: any[] = [];

  // Regex to match markdown patterns: **bold**, *italic*, `code`, [text](url)
  const pattern = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[(.+?)\]\((.+?)\))/g;

  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    // Add plain text before this match
    if (match.index > lastIndex) {
      const plainText = text.slice(lastIndex, match.index);
      if (plainText) {
        richText.push({
          type: 'text',
          text: { content: plainText },
        });
      }
    }

    const fullMatch = match[0];

    if (fullMatch.startsWith('**') && fullMatch.endsWith('**')) {
      // Bold: **text**
      richText.push({
        type: 'text',
        text: { content: match[2] },
        annotations: { bold: true },
      });
    } else if (fullMatch.startsWith('*') && fullMatch.endsWith('*') && !fullMatch.startsWith('**')) {
      // Italic: *text*
      richText.push({
        type: 'text',
        text: { content: match[3] },
        annotations: { italic: true },
      });
    } else if (fullMatch.startsWith('`') && fullMatch.endsWith('`')) {
      // Code: `text`
      richText.push({
        type: 'text',
        text: { content: match[4] },
        annotations: { code: true },
      });
    } else if (fullMatch.startsWith('[')) {
      // Link: [text](url)
      richText.push({
        type: 'text',
        text: { content: match[5], link: { url: match[6] } },
      });
    }

    lastIndex = match.index + fullMatch.length;
  }

  // Add remaining plain text
  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex);
    if (remaining) {
      richText.push({
        type: 'text',
        text: { content: remaining },
      });
    }
  }

  // If no matches found, return the whole text as plain
  if (richText.length === 0) {
    richText.push({
      type: 'text',
      text: { content: text },
    });
  }

  return richText;
}

/**
 * Convert markdown to Notion blocks and update the page
 */
async function updatePageContent(pageId: string, markdown: string): Promise<void> {
  const blocks: any[] = [];
  const lines = markdown.split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;

    // Headers (#### mapped to heading_3 as safety net — Notion has no heading_4)
    if (line.startsWith('#### ')) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: parseInlineMarkdown(line.slice(5)),
        },
      });
    } else if (line.startsWith('### ')) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: parseInlineMarkdown(line.slice(4)),
        },
      });
    } else if (line.startsWith('## ')) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: parseInlineMarkdown(line.slice(3)),
        },
      });
    } else if (line.startsWith('# ')) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: {
          rich_text: parseInlineMarkdown(line.slice(2)),
        },
      });
    }
    // Bullet points
    else if (line.startsWith('- ') || line.startsWith('* ')) {
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: parseInlineMarkdown(line.slice(2)),
        },
      });
    }
    // Numbered lists
    else if (/^\d+\.\s/.test(line)) {
      blocks.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: {
          rich_text: parseInlineMarkdown(line.replace(/^\d+\.\s/, '')),
        },
      });
    }
    // Blockquotes
    else if (line.startsWith('> ')) {
      blocks.push({
        object: 'block',
        type: 'quote',
        quote: {
          rich_text: parseInlineMarkdown(line.slice(2)),
        },
      });
    }
    // Dividers
    else if (line.trim() === '---') {
      blocks.push({
        object: 'block',
        type: 'divider',
        divider: {},
      });
    }
    // Regular paragraphs
    else {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: parseInlineMarkdown(line),
        },
      });
    }
  }

  // Clear existing content
  await clearPageContent(pageId);

  // Append new blocks in batches of 100
  for (let i = 0; i < blocks.length; i += 100) {
    const batch = blocks.slice(i, i + 100);
    await notion.blocks.children.append({
      block_id: pageId,
      children: batch,
    });
  }
}

/**
 * Main function to review and edit a newsletter draft
 */
export async function reviewAndEditNewsletter(pageId: string): Promise<ReviewResult> {
  console.log('📝 Newsletter Review Agent\n');
  console.log('=' .repeat(50));

  try {
    // Step 1: Fetch current content
    console.log('\n📄 Step 1: Fetching draft content...');
    const originalContent = await fetchPageContent(notion, pageId);

    if (!originalContent || originalContent.length < 100) {
      console.log('   ⚠️  Draft content is too short or empty. Skipping review.');
      return {
        success: false,
        pageId,
        changesSummary: [],
        error: 'Draft content too short or empty',
      };
    }

    console.log(`   Found ${originalContent.length} characters of content`);

    // Step 2: Review with Claude
    console.log('\n🤖 Step 2: Reviewing with AI...');
    const { improved, summary } = await reviewWithClaude(originalContent);
    console.log(`   Generated ${improved.length} characters of improved content`);
    console.log(`   Made ${summary.length} key improvements`);

    // Step 3: Update the page
    console.log('\n✏️  Step 3: Updating Notion page...');
    await updatePageContent(pageId, improved);
    console.log('   Page content updated successfully');

    // Step 4: Log summary
    console.log('\n' + '='.repeat(50));
    console.log('✅ Review Complete!\n');
    console.log('Key improvements made:');
    for (const change of summary) {
      console.log(`   - ${change}`);
    }

    return {
      success: true,
      pageId,
      changesSummary: summary,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`\n❌ Review failed: ${errorMessage}`);
    return {
      success: false,
      pageId,
      changesSummary: [],
      error: errorMessage,
    };
  }
}

// Allow running directly for testing (only when this is the main module)
// Check if this script is being run directly (not imported)
const isMainModule = process.argv[1]?.includes('review');
if (isMainModule && process.argv[2]) {
  const pageId = process.argv[2];
  reviewAndEditNewsletter(pageId)
    .then(result => {
      if (result.success) {
        console.log('\n✅ Review completed successfully');
      } else {
        console.log(`\n❌ Review failed: ${result.error}`);
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}
