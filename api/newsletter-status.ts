/**
 * Vercel Serverless Function - Newsletter Status Webhook
 *
 * This endpoint receives webhooks from Notion when newsletter status changes.
 * When status changes to "Ready", it automatically triggers email send via Loops.
 *
 * Endpoint: POST /api/newsletter-status
 *
 * Request Body (from Notion automation):
 * {
 *   "pageId": "notion-page-id",
 *   "status": "Ready"
 * }
 *
 * Headers:
 *   x-webhook-secret: [NOTION_WEBHOOK_SECRET]
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Client } from '@notionhq/client';

const WEBHOOK_SECRET = process.env.NOTION_WEBHOOK_SECRET;
const NOTION_API_KEY = process.env.NOTION_API_KEY;
const LOOPS_API_KEY = process.env.LOOPS_API_KEY;
const LOOPS_TRANSACTIONAL_ID = process.env.LOOPS_TRANSACTIONAL_ID;

interface NewsletterStatusPayload {
  pageId: string;
  status: string;
}

interface LoopsContact {
  email: string;
  firstName?: string;
  lastName?: string;
}

/**
 * Extract page ID from various Notion webhook formats
 */
function extractPageId(body: any): string | null {
  console.log('🔍 Attempting to extract pageId from body keys:', Object.keys(body || {}));

  // Direct pageId field (our custom format)
  if (body?.pageId) {
    console.log('   Found pageId in body.pageId');
    return body.pageId;
  }

  // Notion automation format - data.id
  if (body?.data?.id) {
    console.log('   Found pageId in body.data.id');
    return body.data.id;
  }

  // Notion automation format - id at root (most common for automation webhooks)
  if (body?.id) {
    console.log('   Found pageId in body.id');
    return body.id;
  }

  // Notion automation format with page object
  if (body?.page?.id) {
    console.log('   Found pageId in body.page.id');
    return body.page.id;
  }

  // Check for pageID variable (case variation)
  if (body?.pageID) {
    console.log('   Found pageId in body.pageID');
    return body.pageID;
  }

  // Check if body itself has object_type of "page" (Notion native format)
  if (body?.object === 'page') {
    console.log('   Body is a Notion page object, using root id');
    return body.id;
  }

  console.log('   ❌ Could not find pageId in any expected location');
  return null;
}

/**
 * Extract status from various Notion webhook formats
 */
function extractStatus(body: any): string | null {
  // Direct status field
  if (body?.status) return body.status;

  // Notion properties format
  if (body?.data?.properties?.Status?.status?.name) {
    return body.data.properties.Status.status.name;
  }

  // Nested in properties
  if (body?.properties?.Status?.status?.name) {
    return body.properties.Status.status.name;
  }

  return null;
}

/**
 * Validate the incoming webhook request
 */
function validateRequest(req: VercelRequest): { valid: boolean; error?: string; pageId?: string; status?: string } {
  if (req.method !== 'POST') {
    return { valid: false, error: 'Method not allowed. Use POST.' };
  }

  // Validate webhook secret
  if (WEBHOOK_SECRET) {
    const providedSecret = req.headers['x-webhook-secret'] as string;
    if (providedSecret !== WEBHOOK_SECRET) {
      return { valid: false, error: 'Invalid webhook secret' };
    }
  }

  // Log the raw body for debugging
  console.log('📥 Raw webhook body:', JSON.stringify(req.body, null, 2));

  const pageId = extractPageId(req.body);
  const status = extractStatus(req.body);

  if (!pageId) {
    return { valid: false, error: `Missing pageId. Received body: ${JSON.stringify(req.body)}` };
  }

  // Status is optional - we can fetch it from Notion if not provided
  return { valid: true, pageId, status: status || 'Ready' };
}

/**
 * Fetch newsletter content from Notion
 */
async function fetchNewsletterContent(notion: Client, pageId: string): Promise<{
  title: string;
  issueDate: string;
  highlights: string;
  contentHtml: string;
  collateralHtml: string;
}> {
  // Get page properties
  const page = await notion.pages.retrieve({ page_id: pageId }) as any;

  const title = page.properties.Issue?.title?.[0]?.plain_text || 'Newsletter';
  const issueDate = page.properties['Issue date']?.date?.start || new Date().toISOString().split('T')[0];
  const highlights = page.properties.Highlights?.rich_text?.[0]?.plain_text || '';
  // Collateral: raw HTML for GIFs/images stored in Notion "Collateral" rich_text property
  const collateralHtml = page.properties.Collateral?.rich_text?.[0]?.plain_text || '';

  // Get page content blocks
  const blocks = await notion.blocks.children.list({
    block_id: pageId,
    page_size: 100,
  });

  let html = '';

  for (const block of blocks.results) {
    const b = block as any;
    const type = b.type;

    // Skip collateral checklist and review questions sections
    if (type === 'heading_2') {
      const text = b.heading_2?.rich_text?.[0]?.plain_text || '';
      if (text === 'Collateral Checklist' || text === 'Review Questions') {
        break; // Stop processing after these sections
      }
    }

    switch (type) {
      case 'heading_1':
        html += `<h1>${getRichText(b.heading_1?.rich_text)}</h1>\n`;
        break;
      case 'heading_2':
        html += `<h2>${getRichText(b.heading_2?.rich_text)}</h2>\n`;
        break;
      case 'heading_3':
        html += `<h3>${getRichText(b.heading_3?.rich_text)}</h3>\n`;
        break;
      case 'paragraph':
        const text = getRichText(b.paragraph?.rich_text);
        if (text) html += `<p>${text}</p>\n`;
        break;
      case 'bulleted_list_item':
        html += `<li>${getRichText(b.bulleted_list_item?.rich_text)}</li>\n`;
        break;
      case 'numbered_list_item':
        html += `<li>${getRichText(b.numbered_list_item?.rich_text)}</li>\n`;
        break;
      case 'quote':
        html += `<blockquote>${getRichText(b.quote?.rich_text)}</blockquote>\n`;
        break;
      case 'divider':
        html += '<hr>\n';
        break;
      case 'callout':
        html += `<div style="background:#f5f5f5;padding:12px;border-radius:4px;margin:16px 0;">${getRichText(b.callout?.rich_text)}</div>\n`;
        break;
      case 'image':
        // Handle images and GIFs from Notion
        const imageUrl = b.image?.file?.url || b.image?.external?.url;
        const imageCaption = b.image?.caption?.[0]?.plain_text || '';
        if (imageUrl) {
          html += `<img src="${imageUrl}" alt="${imageCaption}" style="max-width:100%;border-radius:8px;margin:16px 0;">\n`;
          if (imageCaption) {
            html += `<p style="text-align:center;font-size:14px;color:#666;margin-top:8px;">${imageCaption}</p>\n`;
          }
        }
        break;
      case 'video':
        // Handle video embeds
        const videoUrl = b.video?.file?.url || b.video?.external?.url;
        if (videoUrl) {
          html += `<p><a href="${videoUrl}" style="color:#503666;">📹 Watch Video</a></p>\n`;
        }
        break;
      case 'embed':
        // Handle embeds (GIFs from external sources like Giphy)
        const embedUrl = b.embed?.url;
        if (embedUrl) {
          // Check if it's a GIF or image
          if (embedUrl.includes('.gif') || embedUrl.includes('giphy') || embedUrl.includes('.png') || embedUrl.includes('.jpg')) {
            html += `<img src="${embedUrl}" alt="Embedded content" style="max-width:100%;border-radius:8px;margin:16px 0;">\n`;
          } else {
            html += `<p><a href="${embedUrl}" style="color:#503666;">🔗 View Content</a></p>\n`;
          }
        }
        break;
    }
  }

  return { title, issueDate, highlights, contentHtml: html, collateralHtml };
}

/**
 * Extract rich text with formatting
 */
function getRichText(richText: any[]): string {
  if (!richText) return '';
  return richText.map((t: any) => {
    let text = t.plain_text || '';
    if (t.annotations?.bold) text = `<strong>${text}</strong>`;
    if (t.annotations?.italic) text = `<em>${text}</em>`;
    if (t.annotations?.code) text = `<code>${text}</code>`;
    if (t.href) text = `<a href="${t.href}">${text}</a>`;
    return text;
  }).join('');
}

/**
 * Get newsletter recipients
 *
 * TODO: In production, integrate with Loops mailing lists or a Notion subscribers database
 * For now, using hardcoded test recipients for initial testing
 */
async function getRecipients(): Promise<LoopsContact[]> {
  // Hardcoded test recipients for initial testing
  const testRecipients: LoopsContact[] = [
    { email: 'olivier@lilee.ai', firstName: 'Olivier' },
  ];

  console.log(`   📧 Using ${testRecipients.length} test recipient(s)`);
  return testRecipients;
}

/**
 * Send newsletter via Loops transactional email
 */
async function sendViaLoops(
  newsletter: { title: string; issueDate: string; highlights: string; contentHtml: string; collateralHtml: string },
  recipients: LoopsContact[]
): Promise<{ sent: number; failed: number }> {
  if (!LOOPS_API_KEY || !LOOPS_TRANSACTIONAL_ID) {
    console.log('   ⚠️  Loops not configured. Skipping email send.');
    return { sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;

  for (const recipient of recipients) {
    try {
      const response = await fetch('https://app.loops.so/api/v1/transactional', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOOPS_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transactionalId: LOOPS_TRANSACTIONAL_ID,
          email: recipient.email,
          dataVariables: {
            issueTitle: newsletter.title,
            issueDate: newsletter.issueDate,
            highlights: newsletter.highlights,
            contentHtml: newsletter.contentHtml,
            collateralHtml: newsletter.collateralHtml,
            firstName: recipient.firstName || 'there',
          },
        }),
      });

      if (response.ok) {
        sent++;
      } else {
        const errorText = await response.text();
        console.log(`   ❌ Failed to send to ${recipient.email}: ${errorText}`);
        failed++;
      }
    } catch (error) {
      console.log(`   ❌ Error sending to ${recipient.email}: ${error}`);
      failed++;
    }

    // Rate limiting - 100ms between sends
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return { sent, failed };
}

/**
 * Update newsletter status to "Done" in Notion
 * Note: The Newsletter database uses "Done" (not "Sent") as the completed status
 */
async function markAsSent(notion: Client, pageId: string): Promise<void> {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      Status: {
        status: { name: 'Done' },
      },
    },
  });
}

/**
 * Check if newsletter is already sent (idempotency check)
 * Note: The Newsletter database uses "Done" (not "Sent") as the completed status
 */
async function isAlreadySent(notion: Client, pageId: string): Promise<boolean> {
  const page = await notion.pages.retrieve({ page_id: pageId }) as any;
  const status = page.properties.Status?.status?.name;
  return status === 'Done';
}

/**
 * Main webhook handler
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  console.log('📨 Newsletter status webhook received:', new Date().toISOString());

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-webhook-secret');
    return res.status(200).end();
  }

  // Validate request
  const validation = validateRequest(req);
  if (!validation.valid) {
    console.error('❌ Validation failed:', validation.error);
    return res.status(400).json({
      success: false,
      error: validation.error,
    });
  }

  // Use extracted values from validation
  const pageId = validation.pageId!;
  const status = validation.status!;

  console.log('📋 Status change received:', { pageId, status });

  // Only process "Ready" status
  if (status !== 'Ready') {
    console.log('   ℹ️  Status is not "Ready", skipping');
    return res.status(200).json({
      success: true,
      message: `Status "${status}" does not trigger send. Only "Ready" triggers send.`,
    });
  }

  try {
    const notion = new Client({ auth: NOTION_API_KEY });

    // Idempotency check - don't send twice
    const alreadySent = await isAlreadySent(notion, pageId);
    if (alreadySent) {
      console.log('   ℹ️  Newsletter already sent, skipping');
      return res.status(200).json({
        success: true,
        message: 'Newsletter already sent',
      });
    }

    // Fetch newsletter content
    console.log('📄 Fetching newsletter content...');
    const newsletter = await fetchNewsletterContent(notion, pageId);
    console.log(`   Title: ${newsletter.title}`);

    // Get recipients
    console.log('📬 Getting email recipients...');
    const recipients = await getRecipients();
    console.log(`   Found ${recipients.length} recipients`);

    if (recipients.length === 0) {
      console.log('   ⚠️  No recipients found.');
      // Note: Notion automation handles status change to "Done" automatically
      return res.status(200).json({
        success: true,
        message: 'No recipients configured.',
        sent: 0,
        failed: 0,
      });
    }

    // Send via Loops
    console.log('📤 Sending via Loops...');
    const result = await sendViaLoops(newsletter, recipients);
    console.log(`   Sent: ${result.sent}, Failed: ${result.failed}`);

    // Note: Notion automation handles status change to "Done" automatically
    console.log('✅ Newsletter sent! Notion automation will update status.');

    return res.status(200).json({
      success: true,
      message: 'Newsletter sent successfully',
      sent: result.sent,
      failed: result.failed,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Webhook handler error:', errorMessage);
    return res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
}

/**
 * Vercel configuration for this function
 */
export const config = {
  maxDuration: 300, // 5 minutes max for email sending
};
