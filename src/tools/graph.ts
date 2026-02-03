import { ConfidentialClientApplication } from '@azure/msal-node';
import { Client } from '@microsoft/microsoft-graph-client';

// Lazy initialization
let _graphClient: Client | null = null;
let _msalClient: ConfidentialClientApplication | null = null;

// Internal email domains to filter out
const INTERNAL_DOMAINS = [
  'lilee', 'helios', 'lily', 'chordline', 'cordline', 'valsoft',
  'gmail', 'yahoo', 'hotmail', 'outlook', 'icloud', 'me',
  'proton', 'protonmail', 'live', 'msn', 'aol'
];

function getMsalClient(): ConfidentialClientApplication {
  if (!_msalClient) {
    _msalClient = new ConfidentialClientApplication({
      auth: {
        clientId: process.env.AZURE_CLIENT_ID!,
        clientSecret: process.env.AZURE_CLIENT_SECRET!,
        authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
      },
    });
  }
  return _msalClient;
}

async function getGraphClient(): Promise<Client> {
  if (!_graphClient) {
    const msalClient = getMsalClient();

    _graphClient = Client.init({
      authProvider: async (done) => {
        try {
          const result = await msalClient.acquireTokenByClientCredential({
            scopes: ['https://graph.microsoft.com/.default'],
          });
          done(null, result?.accessToken || '');
        } catch (error) {
          done(error as Error, '');
        }
      },
    });
  }
  return _graphClient;
}

export interface CalendarAttendee {
  name: string;
  email: string;
  type: 'required' | 'optional' | 'resource';
  isExternal: boolean;
}

export interface CalendarEvent {
  id: string;
  subject: string;
  start: Date;
  end: Date;
  attendees: CalendarAttendee[];
  organizerEmail: string;
}

/**
 * Check if an email is external (not from internal domains)
 */
function isExternalEmail(email: string): boolean {
  const domain = email.split('@')[1]?.split('.')[0]?.toLowerCase();
  return domain ? !INTERNAL_DOMAINS.includes(domain) : false;
}

/**
 * Extract company name from email domain
 */
export function extractCompanyFromEmail(email: string): string | null {
  if (!email || !email.includes('@')) return null;

  const domain = email.split('@')[1];
  if (!domain) return null;

  const parts = domain.split('.');
  const companyPart = parts[0];

  if (INTERNAL_DOMAINS.includes(companyPart.toLowerCase())) {
    return null;
  }

  return companyPart.charAt(0).toUpperCase() + companyPart.slice(1);
}

/**
 * Get calendar events for a specific user within a date range
 */
export async function getCalendarEvents(
  userEmail: string,
  startDate: Date,
  endDate: Date
): Promise<CalendarEvent[]> {
  const client = await getGraphClient();

  const response = await client
    .api(`/users/${userEmail}/calendar/calendarView`)
    .query({
      startDateTime: startDate.toISOString(),
      endDateTime: endDate.toISOString(),
    })
    .select('id,subject,start,end,attendees,organizer')
    .orderby('start/dateTime')
    .top(100)
    .get();

  return (response.value || []).map((event: any) => ({
    id: event.id,
    subject: event.subject || 'Untitled',
    start: new Date(event.start.dateTime + 'Z'),
    end: new Date(event.end.dateTime + 'Z'),
    organizerEmail: event.organizer?.emailAddress?.address || '',
    attendees: (event.attendees || []).map((att: any) => ({
      name: att.emailAddress?.name || '',
      email: att.emailAddress?.address || '',
      type: att.type || 'required',
      isExternal: isExternalEmail(att.emailAddress?.address || ''),
    })),
  }));
}

/**
 * Find a calendar event by subject and approximate time
 */
export async function findCalendarEvent(
  userEmail: string,
  subject: string,
  approximateDate: Date
): Promise<CalendarEvent | null> {
  // Search within 1 hour window around the date
  const startDate = new Date(approximateDate.getTime() - 60 * 60 * 1000);
  const endDate = new Date(approximateDate.getTime() + 60 * 60 * 1000);

  const events = await getCalendarEvents(userEmail, startDate, endDate);

  // Find best match by subject
  const normalizedSubject = subject.toLowerCase();
  return events.find(e =>
    e.subject.toLowerCase().includes(normalizedSubject) ||
    normalizedSubject.includes(e.subject.toLowerCase())
  ) || events[0] || null;
}

/**
 * Get external attendees from a calendar event
 */
export function getExternalAttendees(event: CalendarEvent): CalendarAttendee[] {
  return event.attendees.filter(att => att.isExternal);
}

/**
 * Get the primary external contact from a meeting
 * (first required external attendee, or first optional external attendee)
 */
export function getPrimaryExternalContact(event: CalendarEvent): CalendarAttendee | null {
  const external = getExternalAttendees(event);

  // Prefer required attendees
  const required = external.find(a => a.type === 'required');
  if (required) return required;

  // Fall back to optional
  return external[0] || null;
}
