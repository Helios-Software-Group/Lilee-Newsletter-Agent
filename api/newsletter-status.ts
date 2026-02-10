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
import { createClient } from '@supabase/supabase-js';
import { generateContentHtml, getRichText, formatHighlights } from '../src/lib/html-generator.js';

const WEBHOOK_SECRET = process.env.NOTION_WEBHOOK_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'newsletter-images';
const NOTION_API_KEY = process.env.NOTION_API_KEY;
const LOOPS_API_KEY = process.env.LOOPS_API_KEY;
const LOOPS_TRANSACTIONAL_ID = process.env.LOOPS_TRANSACTIONAL_ID;
const TEST_EMAIL = process.env.TEST_EMAIL || 'your-email@example.com';
const TEST_EMAIL_NAME = process.env.TEST_EMAIL_NAME || 'Test';

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
 * Upload an image from URL to Supabase Storage
 * Returns the permanent public URL
 */
async function uploadImageToSupabase(imageUrl: string, pageId: string): Promise<string | null> {
  console.log(`   🔍 Supabase config check: URL=${SUPABASE_URL ? 'SET' : 'NOT SET'}, KEY=${SUPABASE_SERVICE_KEY ? 'SET' : 'NOT SET'}, BUCKET=${SUPABASE_BUCKET}`);
  
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.log('   ⚠️  Supabase not configured, using original URL');
    return null;
  }

  try {
    console.log(`   🔗 Creating Supabase client for ${SUPABASE_URL}`);
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    
    // Download image from Notion
    console.log(`   📥 Downloading image from Notion...`);
    const response = await fetch(imageUrl);
    if (!response.ok) {
      console.log(`   ❌ Failed to download image: ${response.status}`);
      return null;
    }
    
    const imageBuffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'image/png';
    
    // Determine file extension from content type
    let ext = 'png';
    if (contentType.includes('gif')) ext = 'gif';
    else if (contentType.includes('jpeg') || contentType.includes('jpg')) ext = 'jpg';
    else if (contentType.includes('webp')) ext = 'webp';
    
    // Generate unique filename
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(7);
    const filename = `${pageId}/${timestamp}-${randomId}.${ext}`;
    
    // Upload to Supabase
    console.log(`   📤 Uploading to Supabase: ${filename}`);
    const { data, error } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .upload(filename, imageBuffer, {
        contentType,
        upsert: true,
      });
    
    if (error) {
      console.log(`   ❌ Supabase upload error: ${error.message}`);
      return null;
    }
    
    // Get public URL
    const { data: publicUrlData } = supabase.storage
      .from(SUPABASE_BUCKET)
      .getPublicUrl(filename);
    
    console.log(`   ✅ Uploaded: ${publicUrlData.publicUrl}`);
    return publicUrlData.publicUrl;
  } catch (error) {
    console.log(`   ❌ Error uploading to Supabase: ${error}`);
    return null;
  }
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
  const page = await notion.pages.retrieve({ page_id: pageId }) as any;
  console.log('   ✅ Page properties fetched');

  const title = page.properties.Issue?.title?.[0]?.plain_text || 'Newsletter';
  const issueDate = page.properties['Issue date']?.date?.start || new Date().toISOString().split('T')[0];
  const highlights = formatHighlights(getRichText(page.properties.Highlights?.rich_text));
  const collateralHtml = page.properties.Collateral?.rich_text?.[0]?.plain_text || '';

  console.log('   📝 Fetching page blocks...');
  const blocks = await notion.blocks.children.list({ block_id: pageId, page_size: 100 });
  console.log(`   ✅ Fetched ${blocks.results.length} blocks`);

  const contentHtml = await generateContentHtml(blocks.results as any[], {
    includeToc: true,
    uploadImage: (url, pid) => uploadImageToSupabase(url, pid),
    pageId,
  });

  return { title, issueDate, highlights, contentHtml, collateralHtml };
}

const CONTACTS_DB_ID = process.env.NOTION_CONTACTS_DB_ID || '';

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
 * - Test send: uses TEST_EMAIL env var
 * - Full send: contacts matching newsletter's audience
 */
async function getRecipients(notion: Client, pageId: string, isTestSend: boolean): Promise<LoopsContact[]> {
  if (isTestSend) {
    const testRecipients: LoopsContact[] = [
      { email: TEST_EMAIL, firstName: TEST_EMAIL_NAME },
    ];
    console.log(`   🧪 Test send: using ${testRecipients.length} test recipient(s)`);
    return testRecipients;
  }

  // Get newsletter's audience
  const audiences = await getNewsletterAudience(notion, pageId);
  
  if (audiences.length === 0) {
    console.log('   ⚠️  No audience set on newsletter, falling back to test recipient');
    return [{ email: TEST_EMAIL, firstName: TEST_EMAIL_NAME }];
  }

  // Get contacts matching the audience
  const contacts = await getContactsByAudience(notion, audiences);
  
  if (contacts.length === 0) {
    console.log('   ⚠️  No contacts found for audience, falling back to test recipient');
    return [{ email: TEST_EMAIL, firstName: TEST_EMAIL_NAME }];
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
