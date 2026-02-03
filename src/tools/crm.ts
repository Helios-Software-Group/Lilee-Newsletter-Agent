import { Client } from '@notionhq/client';
import type { CRMEntry, CRMStatus, MeetingBucket } from '../types/index.js';

// Lazy initialization - client is created on first use after env is loaded
let _notion: Client | null = null;

function getNotion(): Client {
  if (!_notion) {
    _notion = new Client({ auth: process.env.NOTION_API_KEY });
  }
  return _notion;
}

function getCustomerDbId(): string {
  return process.env.NOTION_CUSTOMER_DB_ID!;
}

function getMeetingsDbId(): string {
  return process.env.NOTION_MEETINGS_DB_ID!;
}

/**
 * Search for CRM entry by company name (fuzzy match)
 */
export async function findCRMEntryByCompany(company: string): Promise<CRMEntry | null> {
  if (!company || company.trim().length === 0) return null;

  const normalizedSearch = company.toLowerCase().trim();

  // First try exact match
  const exactResponse = await getNotion().databases.query({
    database_id: getCustomerDbId(),
    filter: {
      property: 'Company',
      rich_text: { equals: company },
    },
    page_size: 1,
  });

  if (exactResponse.results.length > 0) {
    return pageToEntry(exactResponse.results[0]);
  }

  // If no exact match, search with contains
  const containsResponse = await getNotion().databases.query({
    database_id: getCustomerDbId(),
    filter: {
      property: 'Company',
      rich_text: { contains: normalizedSearch },
    },
    page_size: 10,
  });

  // Find best fuzzy match
  for (const page of containsResponse.results) {
    const entry = pageToEntry(page);
    const entryCompany = entry.company.toLowerCase();

    // Check if it's a close match
    if (entryCompany.includes(normalizedSearch) || normalizedSearch.includes(entryCompany)) {
      return entry;
    }
  }

  return null;
}

/**
 * Search for CRM entry by email
 */
export async function findCRMEntryByEmail(email: string): Promise<CRMEntry | null> {
  if (!email || !email.includes('@')) return null;

  const response = await getNotion().databases.query({
    database_id: getCustomerDbId(),
    filter: {
      property: 'Email',
      email: { equals: email },
    },
    page_size: 1,
  });

  if (response.results.length > 0) {
    return pageToEntry(response.results[0]);
  }

  return null;
}

/**
 * Create a new CRM entry
 */
export async function createCRMEntry(data: {
  name: string;
  company: string;
  email?: string;
  status: CRMStatus;
  sourceMeetingBucket?: MeetingBucket;
}): Promise<CRMEntry> {
  // Determine initial status based on meeting bucket
  const status = data.status || (data.sourceMeetingBucket === 'Customer' ? 'In progress' : 'Lead');

  const response = await getNotion().pages.create({
    parent: { database_id: getCustomerDbId() },
    properties: {
      Name: {
        title: [{ text: { content: data.name } }],
      },
      Company: {
        rich_text: [{ text: { content: data.company } }],
      },
      Status: {
        status: { name: status },
      },
      ...(data.email && {
        Email: {
          email: data.email,
        },
      }),
      'Last Contact': {
        date: { start: new Date().toISOString().split('T')[0] },
      },
    },
  });

  return pageToEntry(response);
}

/**
 * Link a meeting to a CRM entry via relation
 */
export async function linkMeetingToCRM(meetingId: string, crmEntryId: string): Promise<void> {
  await getNotion().pages.update({
    page_id: meetingId,
    properties: {
      'CRM Entry': {
        relation: [{ id: crmEntryId }],
      },
    },
  });
}

/**
 * Get all CRM entries (for bulk operations)
 */
export async function getAllCRMEntries(): Promise<CRMEntry[]> {
  const entries: CRMEntry[] = [];
  let cursor: string | undefined;

  do {
    const response = await getNotion().databases.query({
      database_id: getCustomerDbId(),
      start_cursor: cursor,
      page_size: 100,
    });

    for (const page of response.results) {
      entries.push(pageToEntry(page));
    }

    cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (cursor);

  return entries;
}

/**
 * Get a CRM entry by its page ID
 */
export async function getCRMEntryById(pageId: string): Promise<CRMEntry | null> {
  try {
    const response = await getNotion().pages.retrieve({ page_id: pageId });
    return pageToEntry(response);
  } catch {
    return null;
  }
}

/**
 * Convert Notion page to CRMEntry
 */
function pageToEntry(page: any): CRMEntry {
  const props = page.properties;

  return {
    id: page.id,
    url: page.url,
    name: props.Name?.title?.[0]?.plain_text || 'Unknown',
    company: props.Company?.rich_text?.[0]?.plain_text || '',
    email: props.Email?.email || undefined,
    phone: props.Phone?.phone_number || undefined,
    status: props.Status?.status?.name || 'Lead',
    priority: props.Priority?.select?.name || undefined,
    estimatedValue: props['Estimated Value']?.number || undefined,
    accountOwner: props['Account Owner']?.people?.[0]?.name || undefined,
    lastContact: props['Last Contact']?.date?.start || undefined,
    expectedClose: props['Expected Close']?.date?.start || undefined,
  };
}

/**
 * Update CRM entry's last contact date
 */
export async function updateLastContact(crmEntryId: string): Promise<void> {
  await getNotion().pages.update({
    page_id: crmEntryId,
    properties: {
      'Last Contact': {
        date: { start: new Date().toISOString().split('T')[0] },
      },
    },
  });
}
