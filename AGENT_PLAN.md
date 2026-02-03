# Lilee Newsletter Agent - Implementation Plan

## Overview

Build a Claude Agent SDK-powered serverless agent that automatically enriches Notion meeting notes with attendee emails using **Notion AI Search** (which searches connected Microsoft Teams/Outlook).

---

## Problem Statement

When Notion AI Meeting Notes creates a new meeting page:
- It captures the transcript and summary
- But it **doesn't** auto-populate the `Email` column with attendee info
- We need to populate `Email` and `Company` columns for CRM linking

---

## Solution Architecture (No Microsoft Azure Required!)

```
┌─────────────────────────────────────────────────────────────────┐
│                         FLOW                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Notion AI Meeting Notes                                        │
│            │                                                     │
│            ▼                                                     │
│   New Meeting Page Created ──────► Notion Webhook Automation     │
│            │                                                     │
│            ▼                                                     │
│   POST /api/webhook ─────────────► Vercel Serverless Function    │
│            │                                                     │
│            ▼                                                     │
│   Claude Agent SDK                                               │
│            │                                                     │
│            ▼                                                     │
│   Notion MCP (AI Search)                                         │
│   ├─► Search Teams for meeting attendees                         │
│   ├─► Search Outlook for calendar invite                         │
│   └─► Update meeting page with Email/Company                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Key Insight**: Notion's AI connectors already index:
- Microsoft Teams conversations and meetings
- Outlook calendar invites (if connected)
- We can search these via `notion-search` with `ai_search` mode!

---

## Components

### 1. Notion MCP Server
**Package**: Already available via Claude Code's Notion plugin

**Capabilities Used**:
- `notion-search` with `content_search_mode: "ai_search"` - Search connected sources (Teams, Outlook)
- `notion-update-page` - Update Email/Company fields

**No Azure setup required!**

### 2. Claude Agent SDK Application
**Location**: `src/agent/index.ts`

**Responsibilities**:
1. Receive webhook payload with meeting ID, date, name
2. Use Notion AI Search to find:
   - Calendar invite with attendees
   - Teams chat about the meeting
3. Extract external attendee email (filter internal domains)
4. Extract company name from email domain
5. Update Notion meeting page

**System Prompt**:
```
You are the Lilee Newsletter Agent responsible for enriching meeting notes.

When called with a meeting, search for attendee information:
1. Use Notion AI Search to find the calendar invite or Teams meeting
2. Look for attendee email addresses in the search results
3. Filter out internal domains: lilee, helios, lily, chordline, cordline, valsoft...
4. Update the Notion meeting page with the external attendee's email
5. Set Company field from the email domain

Be concise. If no external attendees found, report that clearly.
```

### 3. Vercel Serverless Function
**Location**: `api/webhook.ts`

**Endpoint**: `POST /api/webhook`

**Request Body**:
```json
{
  "meetingId": "notion-page-id",
  "meetingDate": "2026-02-03T14:00:00Z",
  "meetingName": "ACV Weekly Call"
}
```

### 4. Notion Webhook Automation
**Trigger**: Database → Meetings DB → When page is added
**Action**: Send webhook to Vercel endpoint

---

## File Structure

```
Lilee-Newsletter-Repo/
├── api/
│   └── webhook.ts           # Vercel serverless endpoint
├── src/
│   ├── agent/
│   │   └── index.ts         # Claude Agent SDK implementation
│   └── ...existing files...
├── vercel.json              # Vercel configuration
├── .env                     # Environment variables
└── AGENT_PLAN.md           # This plan
```

---

## Environment Variables (Simplified!)

```env
# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Notion
NOTION_API_KEY=ntn_...
NOTION_MEETINGS_DB_ID=...

# Vercel (auto-set)
VERCEL_URL=https://your-project.vercel.app
```

**No Microsoft/Azure credentials needed!**

---

## Implementation Checklist

- [ ] **Phase 1: Agent Development**
  - [ ] Update `src/agent/index.ts` to use Notion AI Search
  - [ ] Test locally with sample meeting
  - [ ] Verify it finds attendees via Teams/Outlook connector

- [ ] **Phase 2: Vercel Deployment**
  - [ ] Create `api/webhook.ts`
  - [ ] Create `vercel.json`
  - [ ] Deploy to Vercel
  - [ ] Configure environment variables in Vercel

- [ ] **Phase 3: Notion Webhook**
  - [ ] Create database automation in Notion
  - [ ] Point to Vercel webhook URL
  - [ ] Test end-to-end

---

## How Notion AI Search Works

When you search with `content_search_mode: "ai_search"`, Notion searches across:
- Your Notion workspace
- **Connected sources** (if enabled):
  - Microsoft Teams
  - Outlook/SharePoint
  - Google Drive
  - Slack
  - GitHub
  - Jira
  - Linear

Since you already have Teams/Outlook connected, we can search for:
- `"ACV meeting attendees"` → Returns Teams meeting info
- `"calendar invite January 30 2026"` → Returns Outlook event

---

## Testing

### Local Testing
```bash
# Test agent directly
npx tsx src/agent/index.ts <meeting-id> <meeting-date> <meeting-name>

# Example
npx tsx src/agent/index.ts "2fc09b01-..." "2026-02-03T14:00:00Z" "ACV Weekly"
```

### Vercel Testing
```bash
# Test webhook endpoint
curl -X POST https://your-project.vercel.app/api/webhook \
  -H "Content-Type: application/json" \
  -d '{"meetingId":"...", "meetingDate":"...", "meetingName":"..."}'
```

---

## Limitations

1. **Depends on Notion AI Connectors**: Teams/Outlook must be connected in Notion settings
2. **Search Quality**: AI search may not always find exact attendee emails
3. **Rate Limits**: Notion API has rate limits for search operations

## Fallback Strategy

If Notion AI Search doesn't find attendee emails:
1. Agent will check if email is mentioned in meeting transcript
2. If still not found, leave Email field empty (manual entry needed)
3. Log the meeting for manual review
