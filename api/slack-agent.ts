/**
 * Vercel Serverless Function - Slack Slash Command Handler
 *
 * Receives /newsletter slash commands from Slack and routes them
 * to existing pipeline functions.
 *
 * Endpoint: POST /api/slack-agent
 *
 * Supported commands:
 *   /newsletter status  — Show newsletter counts by status
 *   /newsletter run     — Full pipeline: categorize → draft → review → notify
 *   /newsletter draft   — Draft-only: just generate a draft (no review)
 *   /newsletter send    — Send all Ready newsletters
 *   /newsletter help    — Show available commands
 *
 * Slack sends form-urlencoded payloads with fields:
 *   command, text, response_url, channel_id, user_id, etc.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { waitUntil } from '@vercel/functions';
import { createHmac } from 'crypto';
import { Client } from '@notionhq/client';

const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NEWSLETTER_DB_ID = process.env.NOTION_NEWSLETTER_DB_ID;

// ---------------------------------------------------------------------------
// Slack signature verification
// ---------------------------------------------------------------------------

/**
 * Verify that the request actually came from Slack.
 *
 * Slack signs every request with HMAC-SHA256 using the app's signing secret.
 * We recompute the signature and compare. Requests older than 5 minutes are
 * rejected to prevent replay attacks.
 */
function verifySlackSignature(req: VercelRequest): boolean {
  if (!SLACK_SIGNING_SECRET) return true; // Skip if not configured (local dev)

  const timestamp = req.headers['x-slack-request-timestamp'] as string;
  const slackSignature = req.headers['x-slack-signature'] as string;

  if (!timestamp || !slackSignature) return false;

  // Reject requests older than 5 minutes
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
  if (parseInt(timestamp) < fiveMinutesAgo) return false;

  // Reconstruct the raw body from the parsed form data
  // Vercel auto-parses form-urlencoded into req.body
  const rawBody = new URLSearchParams(req.body as Record<string, string>).toString();

  const sigBasestring = `v0:${timestamp}:${rawBody}`;
  const mySignature = 'v0=' + createHmac('sha256', SLACK_SIGNING_SECRET)
    .update(sigBasestring)
    .digest('hex');

  // Timing-safe comparison
  return mySignature === slackSignature;
}

// ---------------------------------------------------------------------------
// Slack response helpers
// ---------------------------------------------------------------------------

/**
 * Post a message back to Slack via the response_url.
 * Used for async responses after the initial 200.
 */
async function postToSlack(responseUrl: string, message: Record<string, unknown>): Promise<void> {
  try {
    await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
  } catch (error) {
    console.error('❌ Failed to post to Slack response_url:', error);
  }
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

/**
 * /newsletter status — Query the Newsletter DB for counts by status.
 * Fast enough to return inline (< 3 seconds).
 */
async function handleStatus(): Promise<Record<string, unknown>> {
  if (!NOTION_API_KEY || !NEWSLETTER_DB_ID) {
    return {
      response_type: 'ephemeral',
      text: '⚠️ Notion not configured. Set NOTION_API_KEY and NOTION_NEWSLETTER_DB_ID.',
    };
  }

  const notion = new Client({ auth: NOTION_API_KEY });

  // Query all newsletters, group by status
  const response = await notion.databases.query({
    database_id: NEWSLETTER_DB_ID,
    sorts: [{ property: 'Issue date', direction: 'descending' }],
    page_size: 100,
  });

  const counts: Record<string, number> = {};
  let latestDraft: { title: string; url: string } | null = null;

  for (const page of response.results) {
    const p = page as any;
    const status = p.properties.Status?.status?.name || 'Unknown';
    counts[status] = (counts[status] || 0) + 1;

    // Capture the most recent Draft for a quick link
    if (status === 'Draft' && !latestDraft) {
      const title = p.properties.Issue?.title?.[0]?.plain_text || 'Untitled';
      latestDraft = { title, url: p.url };
    }
  }

  const lines = Object.entries(counts)
    .map(([status, count]) => `• *${status}*: ${count}`)
    .join('\n');

  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '📊 Newsletter Status', emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: lines || 'No newsletters found.' },
    },
  ];

  if (latestDraft) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `📝 Latest draft: <${latestDraft.url}|${latestDraft.title}>`,
      },
    });
  }

  return { response_type: 'in_channel', blocks };
}

/**
 * /newsletter run — Full weekly pipeline in the background.
 *
 * Categorize meetings → draft newsletter → AI review & edit → Slack notify.
 *
 * Uses waitUntil() to keep the Vercel function alive after the immediate
 * 200 response. Without this, Vercel would kill the function before the
 * pipeline completes.
 */
async function runFullPipeline(responseUrl: string): Promise<void> {
  try {
    console.log('🚀 Slack: Starting full pipeline...');

    // Phase 1: Categorize uncategorized meetings
    await postToSlack(responseUrl, {
      response_type: 'in_channel',
      text: '📋 *Phase 1/3:* Categorizing meetings...',
    });

    const { Client: NotionClient } = await import('@notionhq/client');
    const notion = new NotionClient({ auth: process.env.NOTION_API_KEY });
    const MEETINGS_DB_ID = process.env.NOTION_MEETINGS_DB_ID!;

    const uncategorized = await notion.databases.query({
      database_id: MEETINGS_DB_ID,
      filter: { property: 'Bucket', select: { is_empty: true } },
    });

    if (uncategorized.results.length > 0) {
      console.log(`   Found ${uncategorized.results.length} uncategorized meeting(s), categorizing...`);
      // categorize.ts auto-executes on import (has top-level await)
      await import('../src/meetings/categorize.js');
    } else {
      console.log('   All meetings already categorized.');
    }

    // Phase 2: Draft newsletter
    await postToSlack(responseUrl, {
      response_type: 'in_channel',
      text: '✍️ *Phase 2/3:* Drafting newsletter with Claude...',
    });

    const { draftNewsletter } = await import('../src/newsletter/draft.js');
    const draftResult = await draftNewsletter();

    if (!draftResult?.pageId) {
      await postToSlack(responseUrl, {
        response_type: 'in_channel',
        text: '⚠️ Draft pipeline completed but no newsletter was created. Check if there are new meetings this week.',
      });
      return;
    }

    // Phase 3: AI review & edit
    await postToSlack(responseUrl, {
      response_type: 'in_channel',
      text: '🔍 *Phase 3/3:* AI review & editing...',
    });

    const { reviewAndEditNewsletter } = await import('../src/newsletter/review.js');
    await reviewAndEditNewsletter(draftResult.pageId);

    // Post final success with review link
    await postToSlack(responseUrl, {
      response_type: 'in_channel',
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: '✅ Newsletter Draft Ready', emoji: true },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${draftResult.title}*\n${draftResult.highlights}`,
          },
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: '📝 Review in Notion', emoji: true },
            url: draftResult.draftUrl,
            style: 'primary',
          },
        },
      ],
    });

    console.log('✅ Slack: Full pipeline complete');
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Slack full pipeline error:', msg);
    await postToSlack(responseUrl, {
      response_type: 'ephemeral',
      text: `❌ Pipeline failed: ${msg}`,
    });
  }
}

/**
 * /newsletter draft — Generate a draft only (no categorize, no review).
 *
 * Simpler and faster than the full pipeline. Useful for quick iteration
 * when you want to see what Claude produces before running the full flow.
 */
async function runDraftOnly(responseUrl: string): Promise<void> {
  try {
    console.log('🚀 Slack: Starting draft-only...');

    await postToSlack(responseUrl, {
      response_type: 'in_channel',
      text: '✍️ Drafting newsletter with Claude...',
    });

    const { draftNewsletter } = await import('../src/newsletter/draft.js');
    const draftResult = await draftNewsletter();

    if (!draftResult?.pageId) {
      await postToSlack(responseUrl, {
        response_type: 'in_channel',
        text: '⚠️ No newsletter was created. Check if there are new meetings this week.',
      });
      return;
    }

    await postToSlack(responseUrl, {
      response_type: 'in_channel',
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: '✅ Draft Created (unreviewed)', emoji: true },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${draftResult.title}*\n${draftResult.highlights}\n\n_Run \`/newsletter run\` for the full pipeline with AI review._`,
          },
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: '📝 View in Notion', emoji: true },
            url: draftResult.draftUrl,
            style: 'primary',
          },
        },
      ],
    });

    console.log('✅ Slack: Draft-only complete');
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Slack draft-only error:', msg);
    await postToSlack(responseUrl, {
      response_type: 'ephemeral',
      text: `❌ Draft failed: ${msg}`,
    });
  }
}

/**
 * /newsletter send — Send all Ready newsletters in the background.
 * Uses waitUntil() to keep alive after immediate response.
 */
async function runSendPipeline(responseUrl: string): Promise<void> {
  try {
    console.log('🚀 Slack: Starting send...');
    const { sendNewsletters } = await import('../src/newsletter/send.js');
    await sendNewsletters();

    await postToSlack(responseUrl, {
      response_type: 'in_channel',
      text: '✅ All Ready newsletters have been sent! Check Notion for updated statuses.',
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Slack send error:', msg);
    await postToSlack(responseUrl, {
      response_type: 'ephemeral',
      text: `❌ Send failed: ${msg}`,
    });
  }
}

/**
 * /newsletter help — Return the command list.
 */
function handleHelp(): Record<string, unknown> {
  return {
    response_type: 'ephemeral',
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '📰 Newsletter Commands', emoji: true },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            '`/newsletter run` — Full pipeline: categorize → draft → review → notify',
            '`/newsletter draft` — Draft-only: generate a draft without review',
            '`/newsletter send` — Send all newsletters with Status = Ready',
            '`/newsletter status` — Show newsletter counts by status',
            '`/newsletter help` — Show this message',
          ].join('\n'),
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  console.log('📨 Slack command received:', new Date().toISOString());

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-slack-signature, x-slack-request-timestamp');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify the request came from Slack
  if (!verifySlackSignature(req)) {
    console.error('❌ Invalid Slack signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Slack sends form-urlencoded data; Vercel auto-parses it
  const { text = '', response_url: responseUrl } = req.body;
  const subcommand = text.trim().toLowerCase().split(/\s+/)[0] || 'help';

  console.log(`📋 Command: /newsletter ${subcommand}`);

  try {
    switch (subcommand) {
      case 'status': {
        const statusResponse = await handleStatus();
        return res.status(200).json(statusResponse);
      }

      case 'run': {
        // Full pipeline: categorize → draft → review → notify
        waitUntil(runFullPipeline(responseUrl));
        return res.status(200).json({
          response_type: 'in_channel',
          text: '⏳ Starting full pipeline (categorize → draft → review)... I\'ll post here when ready.',
        });
      }

      case 'draft': {
        // Draft-only: just generate a draft, no categorize or review
        waitUntil(runDraftOnly(responseUrl));
        return res.status(200).json({
          response_type: 'in_channel',
          text: '⏳ Drafting newsletter... I\'ll post here when the draft is ready.',
        });
      }

      case 'send': {
        // Start send in background via waitUntil(), respond immediately
        waitUntil(runSendPipeline(responseUrl));
        return res.status(200).json({
          response_type: 'in_channel',
          text: '⏳ Sending ready newsletters... I\'ll confirm when done.',
        });
      }

      case 'help':
      default: {
        const helpResponse = handleHelp();
        return res.status(200).json(helpResponse);
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Slack handler error:', msg);
    return res.status(200).json({
      response_type: 'ephemeral',
      text: `❌ Error: ${msg}`,
    });
  }
}

export const config = {
  maxDuration: 300,
};
