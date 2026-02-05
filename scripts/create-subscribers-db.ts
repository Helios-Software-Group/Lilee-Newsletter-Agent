/**
 * Create Subscribers Database in Notion
 * 
 * This script creates a subscribers database with:
 * - Email (email)
 * - First Name (text)
 * - Last Name (text)
 * - Company (text)
 * - Audience (multi-select) - matches Newsletter Audience options
 * - Subscribed (checkbox)
 */

import { Client } from '@notionhq/client';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load .env
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

async function main() {
  console.log('🔍 Fetching Newsletter database to get Audience options...\n');
  
  // Get Newsletter database schema
  const newsletterDb = await notion.databases.retrieve({ 
    database_id: NEWSLETTER_DB_ID 
  });
  
  // Get Audience options
  const audienceProperty = (newsletterDb as any).properties.Audience;
  console.log('📋 Audience property type:', audienceProperty?.type);
  
  let audienceOptions: { name: string; color: string }[] = [];
  
  if (audienceProperty?.type === 'select') {
    audienceOptions = audienceProperty.select.options;
  } else if (audienceProperty?.type === 'multi_select') {
    audienceOptions = audienceProperty.multi_select.options;
  }
  
  console.log('📋 Audience options found:', audienceOptions.map(o => o.name));
  
  // Use the specified page as parent
  const parentPageId = '2fe09b01-2a5f-8092-b909-d7a91c8e9abc';
  console.log('\n📍 Parent page ID:', parentPageId);
  
  // Create Subscribers database
  console.log('\n🔨 Creating Subscribers database...');
  
  const subscribersDb = await notion.databases.create({
    parent: { type: 'page_id', page_id: parentPageId },
    title: [{ type: 'text', text: { content: 'Contacts' } }],
    properties: {
      'Name': {
        title: {},
      },
      'Email': {
        email: {},
      },
      'First Name': {
        rich_text: {},
      },
      'Last Name': {
        rich_text: {},
      },
      'Company': {
        rich_text: {},
      },
      'Audience': {
        multi_select: {
          options: audienceOptions.map(o => ({ name: o.name, color: o.color as any })),
        },
      },
      'Subscribed': {
        checkbox: {},
      },
    },
  });
  
  console.log('\n✅ Subscribers database created!');
  console.log('📄 Database ID:', subscribersDb.id);
  console.log('🔗 URL:', (subscribersDb as any).url);
  
  console.log('\n📝 Add this to your .env and Vercel:');
  console.log(`NOTION_SUBSCRIBERS_DB_ID=${subscribersDb.id}`);
  
  console.log('\n📋 Database properties:');
  console.log('  - Name (title) - Full name for display');
  console.log('  - Email (email) - Required for sending');
  console.log('  - First Name (text) - For personalization');
  console.log('  - Last Name (text) - Optional');
  console.log('  - Company (text) - Optional');
  console.log('  - Audience (multi-select) - Which audiences they belong to');
  console.log('  - Subscribed (checkbox) - Must be checked to receive emails');
}

main().catch(console.error);
