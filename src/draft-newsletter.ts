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
const TASKS_DB_ID = process.env.NOTION_TASKS_DB_ID!;
const NEWSLETTER_DB_ID = process.env.NOTION_NEWSLETTER_DB_ID!;

interface MeetingSummary {
  title: string;
  bucket: MeetingBucket;
  date: string;
  company: string;
  summary: string;
  topics: string[];
  actionItems: string;
  url: string;
}

interface TaskSummary {
  title: string;
  project: string;
  status: string;
  completedDate: string;
  assignee: string;
  url: string;
}

interface ProjectTasks {
  projectName: string;
  tasks: TaskSummary[];
}

/**
 * Get meetings from the past 7 days, grouped by bucket
 */
async function getRecentMeetings(): Promise<{
  customer: MeetingSummary[];
  pipeline: MeetingSummary[];
  internal: MeetingSummary[];
}> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const dateFilter = sevenDaysAgo.toISOString().split('T')[0];

  const response = await notion.databases.query({
    database_id: MEETINGS_DB_ID,
    filter: {
      property: 'Date',
      date: { on_or_after: dateFilter },
    },
    sorts: [{ property: 'Date', direction: 'descending' }],
  });

  const meetings: { customer: MeetingSummary[]; pipeline: MeetingSummary[]; internal: MeetingSummary[] } = {
    customer: [],
    pipeline: [],
    internal: [],
  };

  for (const page of response.results) {
    const p = page as any;
    const bucket = p.properties.Bucket?.select?.name as MeetingBucket | undefined;
    if (!bucket) continue;

    const meeting: MeetingSummary = {
      title: p.properties.Name?.title?.[0]?.plain_text || 'Untitled',
      bucket,
      date: p.properties.Date?.date?.start || '',
      company: p.properties.Company?.rich_text?.[0]?.plain_text || '',
      summary: p.properties.Summary?.rich_text?.[0]?.plain_text || '',
      topics: p.properties.Topics?.multi_select?.map((t: any) => t.name) || [],
      actionItems: p.properties['Action Items']?.rich_text?.[0]?.plain_text || '',
      url: p.url,
    };

    if (bucket === 'Customer') meetings.customer.push(meeting);
    else if (bucket === 'Pipeline') meetings.pipeline.push(meeting);
    else meetings.internal.push(meeting);
  }

  return meetings;
}

/**
 * Get completed tasks from the past 7 days, grouped by project
 */
async function getCompletedTasks(): Promise<ProjectTasks[]> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  // Query tasks with "Done" status
  const response = await notion.databases.query({
    database_id: TASKS_DB_ID,
    filter: {
      property: 'Status',
      status: { equals: 'Done' },
    },
    sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
  });

  // Group tasks by project
  const projectMap = new Map<string, TaskSummary[]>();

  for (const page of response.results) {
    const p = page as any;

    // Check if task was completed in the last 7 days
    const lastEdited = new Date(p.last_edited_time);
    if (lastEdited < sevenDaysAgo) continue;

    // Get project name from relation
    let projectName = 'Other';
    const projectRelation = p.properties.Project?.relation;
    if (projectRelation && projectRelation.length > 0) {
      try {
        const projectPage = await notion.pages.retrieve({ page_id: projectRelation[0].id }) as any;
        projectName = projectPage.properties?.Name?.title?.[0]?.plain_text ||
                     projectPage.properties?.['Project name']?.title?.[0]?.plain_text ||
                     'Other';
      } catch {
        projectName = 'Other';
      }
    }

    const task: TaskSummary = {
      title: p.properties['Task name']?.title?.[0]?.plain_text || 'Untitled',
      project: projectName,
      status: p.properties.Status?.status?.name || 'Done',
      completedDate: p.last_edited_time.split('T')[0],
      assignee: '', // Would need to resolve person IDs
      url: p.url,
    };

    if (!projectMap.has(projectName)) {
      projectMap.set(projectName, []);
    }
    projectMap.get(projectName)!.push(task);
  }

  // Convert to array
  return Array.from(projectMap.entries()).map(([projectName, tasks]) => ({
    projectName,
    tasks,
  }));
}

/**
 * Format meetings into context for Claude
 */
function formatMeetingsForPrompt(meetings: {
  customer: MeetingSummary[];
  pipeline: MeetingSummary[];
  internal: MeetingSummary[];
}): string {
  let context = '';

  if (meetings.customer.length > 0) {
    context += '## Customer Meetings (Existing Clients)\n';
    for (const m of meetings.customer) {
      context += `### ${m.title} (${m.date})\n`;
      if (m.company) context += `Company: ${m.company}\n`;
      if (m.summary) context += `Summary: ${m.summary}\n`;
      if (m.topics.length) context += `Topics: ${m.topics.join(', ')}\n`;
      if (m.actionItems) context += `Action Items: ${m.actionItems}\n`;
      context += '\n';
    }
  }

  if (meetings.pipeline.length > 0) {
    context += '## Pipeline Meetings (Prospects & Partners)\n';
    for (const m of meetings.pipeline) {
      context += `### ${m.title} (${m.date})\n`;
      if (m.company) context += `Company: ${m.company}\n`;
      if (m.summary) context += `Summary: ${m.summary}\n`;
      if (m.topics.length) context += `Topics: ${m.topics.join(', ')}\n`;
      context += '\n';
    }
  }

  if (meetings.internal.length > 0) {
    context += '## Internal Meetings (Team Discussions)\n';
    for (const m of meetings.internal) {
      context += `### ${m.title} (${m.date})\n`;
      if (m.summary) context += `Summary: ${m.summary}\n`;
      if (m.topics.length) context += `Topics: ${m.topics.join(', ')}\n`;
      context += '\n';
    }
  }

  return context || 'No meetings found in the past 7 days.';
}

/**
 * Format completed tasks into context for Claude
 */
function formatTasksForPrompt(projectTasks: ProjectTasks[]): string {
  if (projectTasks.length === 0) {
    return 'No tasks completed in the past 7 days.';
  }

  let context = '## Engineering Tasks Completed This Week (by Project)\n\n';

  for (const project of projectTasks) {
    context += `### ${project.projectName}\n`;
    for (const task of project.tasks) {
      context += `- ${task.title} (completed ${task.completedDate})\n`;
    }
    context += '\n';
  }

  return context;
}

/**
 * Generate newsletter draft using Claude
 */
async function generateNewsletterDraft(
  meetingsContext: string,
  tasksContext: string
): Promise<{
  title: string;
  highlights: string;
  content: string;
  primaryCustomer: string;
  suggestedCollateral: string[];
  reviewQuestions: string[];
}> {
  const today = new Date().toISOString().split('T')[0];

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    messages: [{
      role: 'user',
      content: `You are drafting a weekly product newsletter for Lilee, an AI-powered healthcare workflow platform.

**Audience:** VPs of Operations, CMOs, UM Directors, Compliance Officers at health plans, TPAs, and ACOs.

**What they care about:**
- CMS compliance (prior auth timelines, interoperability)
- Operational efficiency (TAT, SLA, staffing costs)
- Clinical quality (consistent criteria, audit-ready docs)
- Provider/member experience

---

**ENGINEERING TASKS COMPLETED THIS WEEK:**
${tasksContext}

---

**MEETING NOTES FROM THIS WEEK:**
${meetingsContext}

---

**Instructions:**
1. Generate a newsletter with 2-3 Big Features based on the completed engineering tasks and meeting discussions
2. Focus on what was SHIPPED/COMPLETED this week (from the tasks)
3. Use customer feedback from meetings to add context and validate the features
4. For each feature, include:
   - What shipped (bullets from the actual tasks completed)
   - Why this matters for their operation (connect to CMS, TAT, staffing, care quality)
   - Operational impact (quantify where possible)
   - Compliance angle where relevant

5. Use payer language: TAT, LCD/NCD criteria, medical necessity, audit-ready, reviewer confidence
6. Include a Roadmap section with regulatory alignment
7. Include Customer Feedback section with quotes from meetings
8. End with a specific "One Ask"

**Response Format (JSON):**
{
  "title": "Lilee Product Update — ${today}",
  "highlights": "Brief 1-2 sentence summary of key updates",
  "primaryCustomer": "Name of primary customer mentioned, or empty string",
  "content": "Full newsletter content in Markdown format",
  "suggestedCollateral": ["List of screenshots, videos, or attachments that would enhance this newsletter"],
  "reviewQuestions": ["Questions the team should answer before sending", "e.g., 'Should we include the TAT metrics from ACV?'"]
}

Respond with ONLY valid JSON.`
    }]
  });

  const responseText = (message.content[0] as any).text.trim();

  try {
    const jsonStr = responseText.replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(jsonStr);
  } catch {
    console.error('Failed to parse Claude response, using fallback');
    return {
      title: `Lilee Product Update — ${today}`,
      highlights: 'Weekly product updates',
      content: responseText,
      primaryCustomer: '',
      suggestedCollateral: [],
      reviewQuestions: ['Please review the generated content'],
    };
  }
}

/**
 * Create newsletter draft in Notion
 */
async function createNewsletterInNotion(draft: {
  title: string;
  highlights: string;
  content: string;
  primaryCustomer: string;
}): Promise<{ id: string; url: string }> {
  const today = new Date().toISOString().split('T')[0];

  const page = await notion.pages.create({
    parent: { database_id: NEWSLETTER_DB_ID },
    properties: {
      Issue: {
        title: [{ text: { content: draft.title } }],
      },
      Status: {
        status: { name: 'Draft' },
      },
      Audience: {
        select: { name: 'Customers' },
      },
      'Issue date': {
        date: { start: today },
      },
      Highlights: {
        rich_text: [{ text: { content: draft.highlights.slice(0, 2000) } }],
      },
      ...(draft.primaryCustomer && {
        'Primary customer': {
          rich_text: [{ text: { content: draft.primaryCustomer } }],
        },
      }),
    },
  });

  // Add content as blocks
  const contentBlocks = convertMarkdownToBlocks(draft.content);

  if (contentBlocks.length > 0) {
    // Append blocks in batches of 100
    for (let i = 0; i < contentBlocks.length; i += 100) {
      const batch = contentBlocks.slice(i, i + 100);
      await notion.blocks.children.append({
        block_id: page.id,
        children: batch,
      });
    }
  }

  return { id: page.id, url: (page as any).url };
}

/**
 * Standard collateral items for every newsletter
 */
const STANDARD_COLLATERAL_ITEMS = [
  'Demo video (60-90 sec Loom of main feature)',
  'Hero screenshot of feature in action',
  'Before/after comparison (if applicable)',
  'Customer quote graphic (branded)',
  'Mobile preview tested',
];

/**
 * Add collateral checklist to the newsletter page
 */
async function addCollateralChecklist(
  pageId: string,
  suggestedCollateral: string[],
  reviewQuestions: string[]
): Promise<void> {
  const checklistBlocks: any[] = [];

  // Divider before checklist
  checklistBlocks.push({
    object: 'block',
    type: 'divider',
    divider: {},
  });

  // Collateral section header
  checklistBlocks.push({
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: 'Collateral Checklist' } }],
    },
  });

  // Callout with instructions
  checklistBlocks.push({
    object: 'block',
    type: 'callout',
    callout: {
      icon: { emoji: '📋' },
      rich_text: [{
        type: 'text',
        text: { content: 'Complete these items before setting Status to "Ready"' }
      }],
    },
  });

  // AI-suggested collateral items (feature-specific)
  if (suggestedCollateral.length > 0) {
    checklistBlocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{
          type: 'text',
          text: { content: 'Feature-specific:' },
          annotations: { bold: true },
        }],
      },
    });

    for (const item of suggestedCollateral) {
      checklistBlocks.push({
        object: 'block',
        type: 'to_do',
        to_do: {
          rich_text: [{ type: 'text', text: { content: item } }],
          checked: false,
        },
      });
    }
  }

  // Standard items
  checklistBlocks.push({
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{
        type: 'text',
        text: { content: 'Standard items:' },
        annotations: { bold: true },
      }],
    },
  });

  for (const item of STANDARD_COLLATERAL_ITEMS) {
    checklistBlocks.push({
      object: 'block',
      type: 'to_do',
      to_do: {
        rich_text: [{ type: 'text', text: { content: item } }],
        checked: false,
      },
    });
  }

  // Review questions section
  if (reviewQuestions.length > 0) {
    checklistBlocks.push({
      object: 'block',
      type: 'divider',
      divider: {},
    });

    checklistBlocks.push({
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: 'Review Questions' } }],
      },
    });

    checklistBlocks.push({
      object: 'block',
      type: 'callout',
      callout: {
        icon: { emoji: '❓' },
        rich_text: [{
          type: 'text',
          text: { content: 'Answer these before sending:' }
        }],
      },
    });

    for (const question of reviewQuestions) {
      checklistBlocks.push({
        object: 'block',
        type: 'to_do',
        to_do: {
          rich_text: [{ type: 'text', text: { content: question } }],
          checked: false,
        },
      });
    }
  }

  // Append checklist blocks to the page
  await notion.blocks.children.append({
    block_id: pageId,
    children: checklistBlocks,
  });
}

/**
 * Convert markdown content to Notion blocks (simplified)
 */
function convertMarkdownToBlocks(markdown: string): any[] {
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

  return blocks;
}

/**
 * Main function to draft the newsletter
 */
async function draftNewsletter() {
  console.log('📰 Newsletter Drafter Agent\n');
  console.log('=' .repeat(50));

  // Step 1: Gather meeting notes
  console.log('\n📅 Step 1: Gathering meeting notes from past 7 days...');
  const meetings = await getRecentMeetings();

  const totalMeetings = meetings.customer.length + meetings.pipeline.length + meetings.internal.length;
  console.log(`   Found ${totalMeetings} meetings:`);
  console.log(`   - Customer: ${meetings.customer.length}`);
  console.log(`   - Pipeline: ${meetings.pipeline.length}`);
  console.log(`   - Internal: ${meetings.internal.length}`);

  // Step 2: Gather completed tasks
  console.log('\n📋 Step 2: Gathering completed tasks from past 7 days...');
  const projectTasks = await getCompletedTasks();

  const totalTasks = projectTasks.reduce((sum, p) => sum + p.tasks.length, 0);
  console.log(`   Found ${totalTasks} completed tasks across ${projectTasks.length} projects:`);
  for (const project of projectTasks) {
    console.log(`   - ${project.projectName}: ${project.tasks.length} tasks`);
  }

  if (totalMeetings === 0 && totalTasks === 0) {
    console.log('\n⚠️  No meetings or tasks found in the past 7 days. Cannot generate newsletter.');
    return;
  }

  // Step 3: Format for Claude
  const meetingsContext = formatMeetingsForPrompt(meetings);
  const tasksContext = formatTasksForPrompt(projectTasks);

  // Step 4: Generate draft with Claude
  console.log('\n🤖 Step 3: Generating newsletter draft with AI...');
  const draft = await generateNewsletterDraft(meetingsContext, tasksContext);
  console.log(`   Title: ${draft.title}`);
  console.log(`   Highlights: ${draft.highlights}`);

  // Step 5: Create in Notion
  console.log('\n📝 Step 4: Creating draft in Notion...');
  const notionPage = await createNewsletterInNotion(draft);
  console.log(`   Created: ${notionPage.url}`);

  // Step 6: Add collateral checklist
  console.log('\n📋 Step 5: Adding collateral checklist...');
  await addCollateralChecklist(
    notionPage.id,
    draft.suggestedCollateral,
    draft.reviewQuestions
  );
  console.log('   Checklist added to page');

  // Step 7: Output summary
  console.log('\n' + '='.repeat(50));
  console.log('✅ Newsletter Draft Complete!\n');
  console.log(`📄 Draft URL: ${notionPage.url}`);
  console.log(`📅 Issue Date: ${new Date().toISOString().split('T')[0]}`);

  if (draft.suggestedCollateral.length > 0) {
    console.log('\n📎 Suggested Collateral:');
    for (const item of draft.suggestedCollateral) {
      console.log(`   - ${item}`);
    }
  }

  if (draft.reviewQuestions.length > 0) {
    console.log('\n❓ Review Questions:');
    for (const question of draft.reviewQuestions) {
      console.log(`   - ${question}`);
    }
  }

  // Return data for Slack notification and review step
  return {
    pageId: notionPage.id,
    draftUrl: notionPage.url,
    issueDate: new Date().toISOString().split('T')[0],
    title: draft.title,
    highlights: draft.highlights,
    suggestedCollateral: draft.suggestedCollateral,
    reviewQuestions: draft.reviewQuestions,
  };
}

// Run if called directly
draftNewsletter().catch(console.error);

export { draftNewsletter };
