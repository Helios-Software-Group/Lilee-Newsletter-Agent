import { Client } from '@notionhq/client';
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

const notion = new Client({ auth: process.env.NOTION_API_KEY });

const NEWSLETTER_DB_ID = process.env.NOTION_NEWSLETTER_DB_ID!;
const LOOPS_API_KEY = process.env.LOOPS_API_KEY!;
const LOOPS_TRANSACTIONAL_ID = process.env.LOOPS_TRANSACTIONAL_ID!;

interface NewsletterToSend {
  id: string;
  url: string;
  title: string;
  issueDate: string;
  highlights: string;
  primaryCustomer: string;
  content: string;
  collateral: string; // HTML for embedded GIFs, images, videos
}

interface LoopsContact {
  email: string;
  firstName?: string;
  lastName?: string;
}

/**
 * Find newsletters with Status = "Ready to Send"
 */
async function getReadyNewsletters(): Promise<NewsletterToSend[]> {
  const response = await notion.databases.query({
    database_id: NEWSLETTER_DB_ID,
    filter: {
      property: 'Status',
      status: { equals: 'Ready' },
    },
  });

  const newsletters: NewsletterToSend[] = [];

  for (const page of response.results) {
    const p = page as any;

    // Get page content
    const content = await getPageContent(p.id);

    newsletters.push({
      id: p.id,
      url: p.url,
      title: p.properties.Issue?.title?.[0]?.plain_text || 'Newsletter',
      issueDate: p.properties['Issue date']?.date?.start || new Date().toISOString().split('T')[0],
      highlights: formatHighlights(getRichText(p.properties.Highlights?.rich_text)),
      primaryCustomer: getRichText(p.properties['Primary customer']?.rich_text),
      content,
      // Collateral: HTML for GIFs/images - stored in Notion "Collateral" rich_text property
      // Example: <img src="https://your-cdn.com/demo.gif" alt="Demo" style="max-width:100%;border-radius:8px;">
      collateral: p.properties.Collateral?.rich_text?.[0]?.plain_text || '',
    });
  }

  return newsletters;
}

/**
 * Get the content of a newsletter page as HTML
 */
async function getPageContent(pageId: string): Promise<string> {
  const blocks = await notion.blocks.children.list({
    block_id: pageId,
    page_size: 100,
  });

  let html = '';
  const blockList = blocks.results as any[];

  for (let i = 0; i < blockList.length; i++) {
    const b = blockList[i];
    const type = b.type;
    
    // Look ahead for image + link pattern (for mobile video fallback)
    const nextBlock = blockList[i + 1];
    
    // Debug: log block types to understand structure
    if (type === 'image' && nextBlock) {
      console.log(`🖼️ Image block found, next block type: ${nextBlock.type}`);
      if (nextBlock.type === 'paragraph') {
        console.log(`   Paragraph content:`, JSON.stringify(nextBlock.paragraph?.rich_text?.slice(0, 2)));
      }
    }

    switch (type) {
      case 'heading_1':
        html += `<h1>${getRichText(b.heading_1?.rich_text)}</h1>\n`;
        break;
      case 'heading_2':
        // Coral divider before each major section
        const dividerStyle = `
          height: 3px;
          background: linear-gradient(90deg, #FE8383 0%, #FFB8B8 50%, transparent 100%);
          border: none;
          margin: 36px 0 24px 0;
          border-radius: 2px;
        `.replace(/\s+/g, ' ').trim();
        html += `<hr style="${dividerStyle}">\n`;
        
        const h2Style = `
          font-family: 'Space Grotesk', 'Helvetica Neue', Arial, sans-serif;
          color: #503666;
          margin: 0 0 16px 0;
          font-size: 22px;
          font-weight: 600;
          border-bottom: 3px solid #503666;
          padding-bottom: 12px;
        `.replace(/\s+/g, ' ').trim();
        html += `<h2 style="${h2Style}">${getRichText(b.heading_2?.rich_text)}</h2>\n`;
        break;
      case 'heading_3':
        const h3Text = getRichText(b.heading_3?.rich_text);
        const plainText = getPlainText(b.heading_3?.rich_text);
        // Subsection labels (end with ":") → render as h4 pill with inline styles
        // Feature titles (typically have emojis or no colon) → render as h3
        if (plainText.trim().endsWith(':')) {
          // Inline styles for email compatibility (email clients strip <style> tags)
          const h4Style = `
            font-family: 'Space Grotesk', 'Helvetica Neue', Arial, sans-serif;
            color: #503666;
            font-size: 11px;
            font-weight: 700;
            margin: 24px 0 12px 0;
            text-transform: uppercase;
            letter-spacing: 1.5px;
            display: inline-block;
            background: #f0ebf4;
            padding: 8px 14px;
            border-radius: 4px;
            border-left: 3px solid #503666;
          `.replace(/\s+/g, ' ').trim();
          html += `<h4 style="${h4Style}">${h3Text}</h4>\n`;
        } else {
          // Feature titles (h3) with inline styles
          const h3Style = `
            font-family: 'Space Grotesk', 'Helvetica Neue', Arial, sans-serif;
            color: #503666;
            margin: 28px 0 14px 0;
            font-size: 19px;
            font-weight: 600;
            padding-bottom: 10px;
            border-bottom: 2px solid #f0ebf4;
          `.replace(/\s+/g, ' ').trim();
          html += `<h3 style="${h3Style}">${h3Text}</h3>\n`;
        }
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
        const quoteStyle = `
          border-left: 5px solid #503666;
          margin: 24px 0;
          padding: 20px 24px;
          background: linear-gradient(135deg, #faf8fb 0%, #f5f0f8 100%);
          font-style: italic;
          border-radius: 0 8px 8px 0;
        `.replace(/\s+/g, ' ').trim();
        html += `<blockquote style="${quoteStyle}">${getRichText(b.quote?.rich_text)}</blockquote>\n`;
        break;
      case 'divider':
        const hrStyle = `
          border: none;
          height: 2px;
          background: linear-gradient(90deg, #503666 0%, #8b6b9e 30%, #e8e0ed 70%, transparent 100%);
          margin: 36px 0;
          border-radius: 2px;
        `.replace(/\s+/g, ' ').trim();
        html += `<hr style="${hrStyle}">\n`;
        break;
      case 'callout':
        html += `<div style="background:#f5f5f5;padding:12px;border-radius:4px;margin:16px 0;">${getRichText(b.callout?.rich_text)}</div>\n`;
        break;
      case 'image':
        const imageUrl = b.image?.file?.url || b.image?.external?.url || '';
        const imageCaption = b.image?.caption?.[0]?.plain_text || '';
        
        if (imageUrl) {
          // Check if next block contains a video link (paragraph or bookmark)
          let videoLink = '';
          let skipNext = false;
          
          if (nextBlock) {
            // Get all text/links from the next block
            let nextContent = '';
            let nextHref = '';
            
            if (nextBlock.type === 'paragraph') {
              const richText = nextBlock.paragraph?.rich_text || [];
              nextContent = richText.map((t: any) => t.plain_text || '').join('');
              nextHref = richText[0]?.href || '';
            } else if (nextBlock.type === 'bookmark') {
              nextContent = nextBlock.bookmark?.url || '';
              nextHref = nextContent;
            }
            
            // Check if it's a video link (any URL with video platforms)
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
            }
          }
          
          const imgStyle = `
            max-width: 100%;
            border-radius: 8px;
            display: block;
            margin: 16px 0;
          `.replace(/\s+/g, ' ').trim();
          
          if (videoLink) {
            // Wrap image in link for mobile users
            html += `<a href="${videoLink}" target="_blank" style="display:block;text-decoration:none;">`;
            html += `<img src="${imageUrl}" alt="${imageCaption}" style="${imgStyle}">`;
            html += `</a>\n`;
            // Add discrete mobile message
            html += `<p style="font-size:12px;color:#8b6b9e;margin:4px 0 16px 0;font-style:italic;">📱 Tap image to view video</p>\n`;
            if (skipNext) i++; // Skip the link block
          } else {
            html += `<img src="${imageUrl}" alt="${imageCaption}" style="${imgStyle}">\n`;
          }
        }
        break;
    }
  }

  return html;
}

/**
 * Extract plain text from Notion rich text array (no HTML formatting)
 */
function getPlainText(richText: any[]): string {
  if (!richText) return '';
  return richText.map((t: any) => t.plain_text || '').join('');
}

/**
 * Extract rich text from Notion rich text array with HTML formatting
 */
function getRichText(richText: any[]): string {
  if (!richText) return '';
  return richText.map((t: any) => {
    let text = t.plain_text || '';
    
    // Underline becomes coral highlight - process FIRST so other formatting wraps it
    if (t.annotations?.underline) {
      text = `<span style="background-color:#FE8383;color:#ffffff;padding:3px 6px;font-weight:bold;text-decoration:none;border-radius:3px;">${text}</span>`;
    }
    
    if (t.annotations?.bold) text = `<strong>${text}</strong>`;
    if (t.annotations?.italic) text = `<em>${text}</em>`;
    if (t.annotations?.code) text = `<code>${text}</code>`;
    if (t.href) text = `<a href="${t.href}">${text}</a>`;
    return text;
  }).join('');
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
 * Get email recipients
 * Currently hardcoded for testing - can be expanded to pull from Loops audience or Notion
 */
async function getEmailRecipients(): Promise<LoopsContact[]> {
  // Hardcoded recipients for testing
  // TODO: Expand to pull from Loops audience or Notion database
  const recipients: LoopsContact[] = [
    { email: 'olivier@lilee.ai', firstName: 'Olivier' },
  ];

  console.log(`   📧 Found ${recipients.length} recipient(s)`);
  return recipients;
}

/**
 * Send newsletter via Loops transactional email
 */
async function sendViaLoops(
  newsletter: NewsletterToSend,
  recipients: LoopsContact[]
): Promise<{ sent: number; failed: number }> {
  if (!LOOPS_API_KEY || LOOPS_API_KEY === 'your-loops-api-key') {
    console.log('   ⚠️  Loops API key not configured. Skipping email send.');
    return { sent: 0, failed: 0 };
  }

  if (!LOOPS_TRANSACTIONAL_ID || LOOPS_TRANSACTIONAL_ID === 'your-transactional-email-id') {
    console.log('   ⚠️  Loops transactional ID not configured. Skipping email send.');
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
            contentHtml: newsletter.content,
            collateralHtml: newsletter.collateral,
            firstName: recipient.firstName || 'there',
          },
        }),
      });

      if (response.ok) {
        sent++;
      } else {
        console.log(`   ❌ Failed to send to ${recipient.email}: ${response.statusText}`);
        failed++;
      }
    } catch (error) {
      console.log(`   ❌ Error sending to ${recipient.email}: ${error}`);
      failed++;
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return { sent, failed };
}

/**
 * Update newsletter status to "Sent" in Notion
 */
async function markAsSent(pageId: string): Promise<void> {
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
 * Main function to send ready newsletters
 */
async function sendNewsletters() {
  console.log('📧 Newsletter Send Agent\n');
  console.log('='.repeat(50));

  // Step 1: Find newsletters ready to send
  console.log('\n📋 Step 1: Finding newsletters with Status = "Ready"...');
  const newsletters = await getReadyNewsletters();

  if (newsletters.length === 0) {
    console.log('   No newsletters ready to send.');
    console.log('   Set Status to "Ready" in Notion to trigger email send.');
    return;
  }

  console.log(`   Found ${newsletters.length} newsletter(s) ready to send:`);
  for (const n of newsletters) {
    console.log(`   - ${n.title}`);
  }

  // Step 2: Get recipients
  console.log('\n📬 Step 2: Getting email recipients...');
  const recipients = await getEmailRecipients();

  if (recipients.length === 0) {
    console.log('   No recipients configured. Skipping email send.');
    console.log('   Configure recipients in Loops or update getEmailRecipients().');

    // Still mark as sent for demo purposes
    for (const newsletter of newsletters) {
      console.log(`\n📝 Marking "${newsletter.title}" as Sent (no emails sent)...`);
      await markAsSent(newsletter.id);
    }
    return;
  }

  console.log(`   Found ${recipients.length} recipient(s)`);

  // Step 3: Send each newsletter
  for (const newsletter of newsletters) {
    console.log(`\n📤 Step 3: Sending "${newsletter.title}"...`);
    const result = await sendViaLoops(newsletter, recipients);

    console.log(`   Sent: ${result.sent}, Failed: ${result.failed}`);

    // Step 4: Update status to Sent
    if (result.sent > 0 || recipients.length === 0) {
      console.log('\n✅ Step 4: Updating status to "Sent"...');
      await markAsSent(newsletter.id);
      console.log(`   Updated: ${newsletter.url}`);
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('✅ Newsletter send complete!');
}

/**
 * Send a single newsletter by page ID
 * Used by the webhook endpoint for auto-send on status change
 */
async function sendSingleNewsletter(pageId: string): Promise<{
  success: boolean;
  sent: number;
  failed: number;
  error?: string;
}> {
  console.log('📧 Sending single newsletter\n');
  console.log('='.repeat(50));
  console.log(`Page ID: ${pageId}`);

  try {
    // Get the newsletter page
    const page = await notion.pages.retrieve({ page_id: pageId }) as any;
    const status = page.properties.Status?.status?.name;

    // Verify status is Ready (not already Sent)
    if (status === 'Sent') {
      console.log('   ℹ️  Newsletter already sent, skipping');
      return { success: true, sent: 0, failed: 0 };
    }

    if (status !== 'Ready') {
      console.log(`   ⚠️  Status is "${status}", not "Ready". Skipping.`);
      return { success: false, sent: 0, failed: 0, error: `Status is "${status}", expected "Ready"` };
    }

    // Get content
    const content = await getPageContent(pageId);

    const newsletter: NewsletterToSend = {
      id: pageId,
      url: page.url,
      title: page.properties.Issue?.title?.[0]?.plain_text || 'Newsletter',
      issueDate: page.properties['Issue date']?.date?.start || new Date().toISOString().split('T')[0],
      highlights: formatHighlights(getRichText(page.properties.Highlights?.rich_text)),
      primaryCustomer: getRichText(page.properties['Primary customer']?.rich_text),
      content,
      collateral: page.properties.Collateral?.rich_text?.[0]?.plain_text || '',
    };

    console.log(`\n📰 Sending: ${newsletter.title}`);

    // Get recipients
    const recipients = await getEmailRecipients();
    console.log(`   Recipients: ${recipients.length}`);

    if (recipients.length === 0) {
      console.log('   ⚠️  No recipients. Marking as sent.');
      await markAsSent(pageId);
      return { success: true, sent: 0, failed: 0 };
    }

    // Send
    const result = await sendViaLoops(newsletter, recipients);
    console.log(`   Sent: ${result.sent}, Failed: ${result.failed}`);

    // Mark as sent
    await markAsSent(pageId);
    console.log('   ✅ Marked as Sent');

    return { success: true, sent: result.sent, failed: result.failed };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`   ❌ Error: ${errorMessage}`);
    return { success: false, sent: 0, failed: 0, error: errorMessage };
  }
}

// Run if called directly
sendNewsletters().catch(console.error);

export { sendNewsletters, sendSingleNewsletter };
