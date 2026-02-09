/**
 * Lilee Newsletter Agent - Main Orchestrator
 *
 * This agent runs on a schedule to:
 * 1. Categorize any new meetings in the Meetings DB
 * 2. Draft a weekly newsletter based on recent meetings
 * 3. Send a Slack notification for review
 * 4. (Separate trigger) Send approved newsletters via Loops
 */

import './lib/env.js';

async function main() {
  const command = process.argv[2] || 'weekly';

  console.log('🚀 Lilee Newsletter Agent\n');
  console.log('='.repeat(60));
  console.log(`Command: ${command}`);
  console.log(`Time: ${new Date().toISOString()}`);
  console.log('='.repeat(60));

  switch (command) {
    case 'weekly':
    case 'draft':
      await runWeeklyWorkflow();
      break;

    case 'categorize':
      await runCategorize();
      break;

    case 'send':
      await runSend();
      break;

    case 'notify':
      await runNotify();
      break;

    default:
      console.log(`
Usage: npm run dev [command]

Commands:
  weekly     Run full weekly workflow (categorize + draft + notify)
  draft      Generate newsletter draft only
  categorize Categorize uncategorized meetings
  send       Send newsletters with Status = "Ready"
  notify     Send a test Slack notification
`);
  }
}

/**
 * Full weekly workflow
 */
async function runWeeklyWorkflow() {
  console.log('\n📋 PHASE 1: Categorizing new meetings...\n');

  // Dynamically import to avoid circular dependencies
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const { Client } = await import('@notionhq/client');

  // Run categorization inline to avoid module issues
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const notion = new Client({ auth: process.env.NOTION_API_KEY });
  const MEETINGS_DB_ID = process.env.NOTION_MEETINGS_DB_ID!;

  // Find uncategorized meetings
  const uncategorizedResponse = await notion.databases.query({
    database_id: MEETINGS_DB_ID,
    filter: {
      property: 'Bucket',
      select: { is_empty: true },
    },
  });

  if (uncategorizedResponse.results.length === 0) {
    console.log('   ✅ All meetings are already categorized!\n');
  } else {
    console.log(`   Found ${uncategorizedResponse.results.length} uncategorized meeting(s)`);
    console.log('   Running auto-categorization...\n');

    // Import and run categorization
    await import('./meetings/categorize.js');
    console.log('   ✅ Categorization complete\n');
  }

  console.log('\n📰 PHASE 2: Drafting newsletter...\n');

  // Import and run draft
  const { draftNewsletter } = await import('./newsletter/draft.js');
  const draftResult = await draftNewsletter();

  if (draftResult && draftResult.pageId) {
    console.log('\n✏️  PHASE 3: AI Review & Edit...\n');

    // Import and run review
    const { reviewAndEditNewsletter } = await import('./newsletter/review.js');
    const reviewResult = await reviewAndEditNewsletter(draftResult.pageId);

    if (reviewResult.success) {
      console.log('   ✅ AI review completed');
      if (reviewResult.changesSummary.length > 0) {
        console.log('   Key improvements:');
        for (const change of reviewResult.changesSummary.slice(0, 5)) {
          console.log(`      - ${change}`);
        }
      }
    } else {
      console.log(`   ⚠️  AI review skipped: ${reviewResult.error}`);
    }

    console.log('\n📤 PHASE 4: Sending Slack notification...\n');

    const { notifySlack } = await import('./integrations/slack.js');
    await notifySlack(draftResult);
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ Weekly workflow complete!');
  console.log('='.repeat(60));
  console.log(`
Next steps:
1. Review the AI-edited draft in Notion
2. Complete the collateral checklist
3. Set Status to "Ready" to auto-send via email
`);
}

/**
 * Categorize uncategorized meetings
 */
async function runCategorize() {
  // Dynamic import
  const categorizeModule = await import('./meetings/categorize.js');
  // The module runs on import
}

/**
 * Send ready newsletters
 */
async function runSend() {
  const { sendNewsletters } = await import('./newsletter/send.js');
  await sendNewsletters();
}

/**
 * Send test Slack notification
 */
async function runNotify() {
  const { notifySlack } = await import('./integrations/slack.js');
  await notifySlack();
}

main().catch(console.error);
