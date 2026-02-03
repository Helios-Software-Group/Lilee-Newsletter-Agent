import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@notionhq/client';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load .env from project root manually
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '..', '.env');

try {
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
} catch {
  // In CI, env vars are already set
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const notion = new Client({ auth: process.env.NOTION_API_KEY });

/**
 * System prompt for reviewing and editing newsletter drafts
 * Focuses on payer-specific language and operational framing
 */
const REVIEW_SYSTEM_PROMPT = `You are a healthcare SaaS content editor specializing in payer operations.

Your job is to review and improve newsletter content for health plan executives.

## Target Audience
- VPs of Operations at health plans, TPAs, ACOs
- CMOs / Medical Directors
- UM Directors
- Compliance Officers

## Review Criteria

### 1. Payer Language (CRITICAL)
Replace generic terms with payer-specific language:
- "fast" or "quick" → "reduced TAT" or specific turnaround times
- "compliant" → cite specific regulations (CMS-0057-F, NCQA, URAC)
- "decision support" → "LCD/NCD criteria alignment"
- "documentation" → "audit-ready determination letters"
- "AI accuracy" → "reviewer confidence" or "first-pass approval rate"
- "easy to use" → quantify clicks saved or time per auth

### 2. Compliance Integration
Where relevant, reference specific standards:
- CMS-0057-F (prior auth interoperability rule)
- CMS 72hr/7-day requirements for prior auth
- NCQA accreditation standards
- URAC health utilization management standards

### 3. Impact Quantification
Add specific metrics where possible:
- "X% reduction in TAT"
- "Y fewer clicks per auth"
- "Z hours saved per reviewer per day"
- "W% increase in first-pass approval rate"

### 4. Audience Framing
Frame every benefit from the perspective of a VP of Operations:
- Staffing efficiency (FTE reduction, capacity increase)
- SLA compliance (TAT metrics, deadline adherence)
- Audit readiness (documentation quality, defensibility)
- Member/provider satisfaction (faster turnaround)

### 5. Customer Evidence
- Format quotes properly with attribution and title
- Add context for why the quote matters to the audience
- Connect quotes to operational outcomes

### 6. Call to Action
Ensure the "One Ask" or call to action includes:
- Specific qualifying criteria (volume threshold, team size)
- Clear next step (demo, pilot, call)

## Output Instructions
Return the improved content in the exact same Markdown structure.
Make edits directly - do not add comments or explanations inline.
At the very end, add a section titled "---\n## Review Summary" with a brief list of key changes made.`;

interface ReviewResult {
  success: boolean;
  pageId: string;
  changesSummary: string[];
  error?: string;
}

/**
 * Fetch the content of a newsletter page from Notion
 */
async function fetchPageContent(pageId: string): Promise<string> {
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

/**
 * Extract plain text from Notion rich text array
 */
function getRichText(richText: any[]): string {
  if (!richText) return '';
  return richText.map((t: any) => t.plain_text || '').join('');
}

/**
 * Review the newsletter content using Claude
 */
async function reviewWithClaude(content: string): Promise<{ improved: string; summary: string[] }> {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
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
 * Convert markdown to Notion blocks and update the page
 */
async function updatePageContent(pageId: string, markdown: string): Promise<void> {
  const blocks: any[] = [];
  const lines = markdown.split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;

    // Headers
    if (line.startsWith('### ')) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: [{ type: 'text', text: { content: line.slice(4) } }],
        },
      });
    } else if (line.startsWith('## ')) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{ type: 'text', text: { content: line.slice(3) } }],
        },
      });
    } else if (line.startsWith('# ')) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: {
          rich_text: [{ type: 'text', text: { content: line.slice(2) } }],
        },
      });
    }
    // Bullet points
    else if (line.startsWith('- ') || line.startsWith('* ')) {
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [{ type: 'text', text: { content: line.slice(2) } }],
        },
      });
    }
    // Numbered lists
    else if (/^\d+\.\s/.test(line)) {
      blocks.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: {
          rich_text: [{ type: 'text', text: { content: line.replace(/^\d+\.\s/, '') } }],
        },
      });
    }
    // Blockquotes
    else if (line.startsWith('> ')) {
      blocks.push({
        object: 'block',
        type: 'quote',
        quote: {
          rich_text: [{ type: 'text', text: { content: line.slice(2) } }],
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
          rich_text: [{ type: 'text', text: { content: line } }],
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
    const originalContent = await fetchPageContent(pageId);

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

// Allow running directly for testing
if (process.argv[2]) {
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
