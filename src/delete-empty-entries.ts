import { Client } from '@notionhq/client';
import 'dotenv/config';

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const MEETINGS_DB_ID = process.env.NOTION_MEETINGS_DB_ID!;

async function deleteAllEntries() {
  console.log('Querying all entries in Meetings DB...');

  const response = await notion.databases.query({
    database_id: MEETINGS_DB_ID,
    page_size: 100,
  });

  console.log(`Found ${response.results.length} entries to delete\n`);

  for (const page of response.results) {
    const title = (page as any).properties?.Name?.title?.[0]?.plain_text || 'Untitled';
    console.log(`  Deleting: ${title}`);

    await notion.pages.update({
      page_id: page.id,
      archived: true,
    });

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  console.log('\nAll entries deleted (archived).');
}

deleteAllEntries().catch(console.error);
