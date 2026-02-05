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
    console.log('🔐 Secret validation:', {
      hasProvidedSecret: !!providedSecret,
      providedSecretLength: providedSecret?.length || 0,
      expectedSecretLength: WEBHOOK_SECRET.length,
      secretsMatch: providedSecret === WEBHOOK_SECRET,
    });
    if (providedSecret !== WEBHOOK_SECRET) {
      return { valid: false, error: 'Invalid webhook secret' };
    }
  } else {
    console.log('⚠️ No NOTION_WEBHOOK_SECRET configured - skipping validation');
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
 * Format highlights for visual impact
 * - Converts line breaks to <br> tags
 * - Converts bold text to coral color
 */
function formatHighlights(html: string): string {
  return html
    // Convert newlines to <br> tags
    .replace(/\n/g, '<br>')
    // Convert bold to coral colored text
    .replace(
      /<strong>([^<]+)<\/strong>/g,
      '<strong style="color:#FE8383;font-weight:700;">$1</strong>'
    );
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
  console.log('   📝 Fetching page properties...');
  // Get page properties
  const page = await notion.pages.retrieve({ page_id: pageId }) as any;
  console.log('   ✅ Page properties fetched');

  const title = page.properties.Issue?.title?.[0]?.plain_text || 'Newsletter';
  const issueDate = page.properties['Issue date']?.date?.start || new Date().toISOString().split('T')[0];
  // Get highlights with visual formatting (line breaks + pills)
  const highlightsRaw = getRichText(page.properties.Highlights?.rich_text);
  const highlights = formatHighlights(highlightsRaw);
  // Collateral: raw HTML for GIFs/images stored in Notion "Collateral" rich_text property
  const collateralHtml = page.properties.Collateral?.rich_text?.[0]?.plain_text || '';

  console.log('   📝 Fetching page blocks...');
  // Get page content blocks
  const blocks = await notion.blocks.children.list({
    block_id: pageId,
    page_size: 100,
  });
  console.log(`   ✅ Fetched ${blocks.results.length} blocks`);

  let html = '';
  let inBulletedList = false;
  let inNumberedList = false;

  // Helper to close any open list
  const closeOpenLists = () => {
    if (inBulletedList) {
      html += '</ul>\n';
      inBulletedList = false;
    }
    if (inNumberedList) {
      html += '</ol>\n';
      inNumberedList = false;
    }
  };

  const blockList = blocks.results as any[];
  
  for (let i = 0; i < blockList.length; i++) {
    const b = blockList[i];
    const type = b.type;
    const nextBlock = blockList[i + 1];

    // Skip collateral checklist and review questions sections
    if (type === 'heading_2') {
      const headingText = b.heading_2?.rich_text?.[0]?.plain_text || '';
      if (headingText === 'Collateral Checklist' || headingText === 'Review Questions') {
        closeOpenLists();
        break; // Stop processing after these sections
      }
    }

    // Close lists if we hit a non-list item
    if (type !== 'bulleted_list_item' && type !== 'numbered_list_item') {
      closeOpenLists();
    }

    switch (type) {
      case 'heading_1':
        html += `<h1>${getRichText(b.heading_1?.rich_text)}</h1>\n`;
        break;
      case 'heading_2':
        // Add divider before h2 (except first one) for section separation
        if (html.includes('<h2>')) {
          html += '<hr>\n';
        }
        html += `<h2>${getRichText(b.heading_2?.rich_text)}</h2>\n`;
        break;
      case 'heading_3':
        // Check if this looks like a subsection label (ends with colon)
        const h3Text = getRichText(b.heading_3?.rich_text);
        if (h3Text.endsWith(':')) {
          // Render as h4 (uppercase subsection label)
          html += `<h4>${h3Text}</h4>\n`;
        } else {
          html += `<h3>${h3Text}</h3>\n`;
        }
        break;
      case 'paragraph':
        const paraText = getRichText(b.paragraph?.rich_text);
        if (paraText) html += `<p>${paraText}</p>\n`;
        break;
      case 'bulleted_list_item':
        // Open <ul> if not already in a bulleted list
        if (!inBulletedList) {
          if (inNumberedList) {
            html += '</ol>\n';
            inNumberedList = false;
          }
          html += '<ul>\n';
          inBulletedList = true;
        }
        html += `  <li>${getRichText(b.bulleted_list_item?.rich_text)}</li>\n`;
        break;
      case 'numbered_list_item':
        // Open <ol> if not already in a numbered list
        if (!inNumberedList) {
          if (inBulletedList) {
            html += '</ul>\n';
            inBulletedList = false;
          }
          html += '<ol>\n';
          inNumberedList = true;
        }
        html += `  <li>${getRichText(b.numbered_list_item?.rich_text)}</li>\n`;
        break;
      case 'quote':
        html += `<blockquote>${getRichText(b.quote?.rich_text)}</blockquote>\n`;
        break;
      case 'divider':
        html += '<hr>\n';
        break;
      case 'callout':
        html += `<div style="background:#f8f5fa;padding:16px 20px;border-radius:8px;margin:16px 0;border-left:4px solid #503666;">${getRichText(b.callout?.rich_text)}</div>\n`;
        break;
      case 'image':
        // Handle images and GIFs from Notion
        const imageUrl = b.image?.file?.url || b.image?.external?.url;
        const imageCaption = b.image?.caption?.[0]?.plain_text || '';
        
        if (imageUrl) {
          // Check if next block contains a video link
          let videoLink = '';
          let skipNext = false;
          
          if (nextBlock?.type === 'paragraph') {
            const richText = nextBlock.paragraph?.rich_text || [];
            const nextContent = richText.map((t: any) => t.plain_text || '').join('');
            const nextHref = richText[0]?.href || '';
            
            // Check if it's a video link
            const checkUrl = nextHref || nextContent;
            const isVideo = checkUrl && (
              checkUrl.includes('loom.com') || 
              checkUrl.includes('screen.studio') || 
              checkUrl.includes('youtube.com') || 
              checkUrl.includes('youtu.be') ||
              checkUrl.includes('vimeo.com') ||
              checkUrl.includes('screencast')
            );
            
            if (isVideo) {
              videoLink = nextHref || nextContent;
              skipNext = true;
              console.log(`   🎬 Detected video link: ${videoLink}`);
            }
          }
          
          if (videoLink) {
            // Wrap image in link for mobile users
            html += `<a href="${videoLink}" target="_blank" style="display:block;text-decoration:none;">`;
            html += `<img src="${imageUrl}" alt="${imageCaption}" style="max-width:100%;border-radius:8px;margin:16px 0;">`;
            html += `</a>\n`;
            html += `<p style="font-size:12px;color:#8b6b9e;margin:4px 0 16px 0;font-style:italic;">📱 Tap image to view video</p>\n`;
            if (skipNext) i++; // Skip the link paragraph
          } else {
            html += `<img src="${imageUrl}" alt="${imageCaption}" style="max-width:100%;border-radius:8px;margin:16px 0;">\n`;
            if (imageCaption) {
              html += `<p style="text-align:center;font-size:14px;color:#666;margin-top:8px;">${imageCaption}</p>\n`;
            }
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

  // Close any remaining open lists
  closeOpenLists();

  return { title, issueDate, highlights, contentHtml: html, collateralHtml };
}

/**
 * Extract rich text with formatting
 */
function getRichText(richText: any[]): string {
  if (!richText) return '';
  return richText.map((t: any) => {
    let text = t.plain_text || '';
    
    // Underline stays as underline with coral color
    if (t.annotations?.underline) {
      text = `<span style="text-decoration:underline;text-decoration-color:#FE8383;">${text}</span>`;
    }
    
    if (t.annotations?.bold) text = `<strong>${text}</strong>`;
    if (t.annotations?.italic) text = `<em>${text}</em>`;
    if (t.annotations?.code) text = `<code>${text}</code>`;
    if (t.href) text = `<a href="${t.href}">${text}</a>`;
    return text;
  }).join('');
}

const CONTACTS_DB_ID = process.env.NOTION_CONTACTS_DB_ID || '2fe09b01-2a5f-8092-b909-d7a91c8e9abc';

/**
 * Get contacts from Notion filtered by audience
 */
async function getContactsByAudience(notion: Client, audiences: string[]): Promise<LoopsContact[]> {
  try {
    console.log(`   🎯 Filtering contacts by audience: ${audiences.join(', ')}`);
    
    // Build filter for audience multi-select (OR condition)
    const audienceFilters = audiences.map(audience => ({
      property: 'Audience',
      multi_select: { contains: audience },
    }));
    
    const response = await notion.databases.query({
      database_id: CONTACTS_DB_ID,
      filter: audienceFilters.length === 1 
        ? audienceFilters[0]
        : { or: audienceFilters },
    });

    const contacts: LoopsContact[] = [];
    
    for (const page of response.results) {
      const p = page as any;
      // Use E-Mail (with hyphen) as per the database schema
      const email = p.properties['E-Mail']?.email;
      const fullName = p.properties.Name?.title?.[0]?.plain_text || '';
      const firstName = fullName.split(' ')[0] || '';
      
      if (email) {
        contacts.push({ email, firstName });
        console.log(`      ✓ ${firstName} <${email}>`);
      }
    }

    console.log(`   📋 Found ${contacts.length} contacts matching audience`);
    return contacts;
  } catch (error) {
    console.error('   ❌ Error querying contacts database:', error);
    return [];
  }
}

/**
 * Get newsletter's audience from page properties
 */
async function getNewsletterAudience(notion: Client, pageId: string): Promise<string[]> {
  try {
    const page = await notion.pages.retrieve({ page_id: pageId }) as any;
    const audienceProp = page.properties.Audience;
    
    if (audienceProp?.type === 'multi_select') {
      return audienceProp.multi_select.map((o: any) => o.name);
    } else if (audienceProp?.type === 'select' && audienceProp.select) {
      return [audienceProp.select.name];
    }
    
    return [];
  } catch (error) {
    console.error('   ❌ Error fetching newsletter audience:', error);
    return [];
  }
}

/**
 * Get newsletter recipients
 * - Test send: only olivier@lilee.ai
 * - Full send: contacts matching newsletter's audience
 */
async function getRecipients(notion: Client, pageId: string, isTestSend: boolean): Promise<LoopsContact[]> {
  if (isTestSend) {
    const testRecipients: LoopsContact[] = [
      { email: 'olivier@lilee.ai', firstName: 'Olivier' },
    ];
    console.log(`   🧪 Test send: using ${testRecipients.length} test recipient(s)`);
    return testRecipients;
  }

  // Get newsletter's audience
  const audiences = await getNewsletterAudience(notion, pageId);
  
  if (audiences.length === 0) {
    console.log('   ⚠️  No audience set on newsletter, falling back to test recipient');
    return [{ email: 'olivier@lilee.ai', firstName: 'Olivier' }];
  }

  // Get contacts matching the audience
  const contacts = await getContactsByAudience(notion, audiences);
  
  if (contacts.length === 0) {
    console.log('   ⚠️  No contacts found for audience, falling back to test recipient');
    return [{ email: 'olivier@lilee.ai', firstName: 'Olivier' }];
  }

  return contacts;
}

/**
 * Send newsletter via Loops transactional email
 */
async function sendViaLoops(
  newsletter: { title: string; issueDate: string; highlights: string; contentHtml: string; collateralHtml: string },
  recipients: LoopsContact[]
): Promise<{ sent: number; failed: number }> {
  console.log('🔧 Loops config check:', {
    hasApiKey: !!LOOPS_API_KEY,
    apiKeyLength: LOOPS_API_KEY?.length || 0,
    hasTransactionalId: !!LOOPS_TRANSACTIONAL_ID,
    transactionalId: LOOPS_TRANSACTIONAL_ID?.substring(0, 10) + '...',
  });

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
            // Required camelCase variables for Loops template
            issueTitle: newsletter.title,
            issueDate: newsletter.issueDate,
            highlights: newsletter.highlights,
            contentHtml: newsletter.contentHtml,
            collateralHtml: newsletter.collateralHtml,
            // Also include snake_case for MJML template compatibility
            issue_title: newsletter.title,
            issue_date: newsletter.issueDate,
            content_html: newsletter.contentHtml,
            collateral_html: newsletter.collateralHtml,
            first_name: recipient.firstName || 'there',
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
 * Update newsletter status to "Sent" in Notion
 */
async function markAsSent(notion: Client, pageId: string): Promise<void> {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      Status: {
        status: { name: 'Sent' },
      },
    },
  });
}

/**
 * Check if newsletter is already sent (idempotency check)
 */
async function isAlreadySent(notion: Client, pageId: string): Promise<boolean> {
  const page = await notion.pages.retrieve({ page_id: pageId }) as any;
  const status = page.properties.Status?.status?.name;
  return status === 'Sent';
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

  // Only process "Ready" or "Test Sent" status
  const isTestSend = status === 'Test Sent';
  const isFullSend = status === 'Ready';
  
  if (!isTestSend && !isFullSend) {
    console.log(`   ℹ️  Status "${status}" does not trigger send`);
    return res.status(200).json({
      success: true,
      message: `Status "${status}" does not trigger send. Only "Ready" or "Test Sent" triggers send.`,
    });
  }
  
  console.log(`   📧 Send type: ${isTestSend ? 'TEST (single recipient)' : 'FULL (all subscribers)'}`);
  

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
    let newsletter;
    try {
      newsletter = await fetchNewsletterContent(notion, pageId);
      console.log(`   Title: ${newsletter.title}`);
    } catch (fetchError) {
      console.error('❌ Error fetching content:', fetchError);
      throw fetchError;
    }

    // Get recipients
    console.log('📬 Getting email recipients...');
    const recipients = await getRecipients(notion, pageId, isTestSend);
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
