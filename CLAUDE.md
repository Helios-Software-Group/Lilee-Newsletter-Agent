# Newsletter Agent

Automated newsletter pipeline that drafts, reviews, and sends weekly product updates — powered by Claude, Notion, and Loops.

> **Customizing for your company?** See [Step 9 in GUIDE.md](GUIDE.md#step-9-customize-for-your-company) for instructions on replacing branding, prompts, and content guidelines.

## How It Works

```
WEEKLY (GitHub Actions or manual)
├── Fetch meetings + tasks from Notion (past 7 days)
├── Generate draft with Claude (Opus 4.5)
├── AI review & edit (Sonnet 4)
├── Create page in Notion (Status: Draft)
└── Slack notification with preview link

HUMAN REVIEW (in Notion)
├── Edit content, add screenshots/videos
├── Complete collateral checklist
└── Set Status → "Ready"

AUTO-SEND (Notion webhook → Vercel → Loops)
├── Webhook fires on status change
├── Converts Notion blocks → semantic HTML
├── Sends via Loops transactional email
└── Updates Status → "Sent"
```

## Quick Start

```bash
npm install
cp .env.example .env        # Fill in your keys (see GUIDE.md)
npm run weekly               # Full pipeline: draft → review → notify
```

## Commands

| Command | What it does |
|---------|-------------|
| `npm run weekly` | Full workflow: draft + review + Slack notify |
| `npm run draft` | Generate newsletter draft only |
| `npm run send` | Send all newsletters with Status = "Ready" |
| `npm run categorize` | AI-categorize uncategorized meetings |
| `npm run notify` | Send test Slack notification |
| `npm run sync-meetings` | Sync meetings from Microsoft Teams/Calendar |
| `npm run crm-link` | Link meetings to CRM entries |

## Project Structure

```
├── api/                          # Vercel serverless endpoints
│   ├── newsletter-status.ts      #   Auto-send webhook (Notion → Loops)
│   └── webhook.ts                #   Meeting enrichment webhook
│
├── src/
│   ├── index.ts                  # Main orchestrator (weekly/draft/send routing)
│   ├── draft-newsletter.ts       # Generate draft from meetings + tasks
│   ├── review-newsletter.ts      # AI review & edit
│   ├── send-newsletter.ts        # CLI email sender via Loops
│   ├── html-generator.ts         # Shared Notion → HTML converter
│   ├── load-prompt.ts            # Prompt template loader
│   ├── notify-slack.ts           # Slack webhook notifications
│   ├── categorize-meetings.ts    # AI meeting categorization
│   ├── sync-meetings.ts          # Microsoft Teams/Calendar sync
│   ├── crm-linker.ts             # Link meetings to CRM contacts
│   ├── agent/
│   │   └── index.ts              # Claude Agent SDK for meeting enrichment
│   ├── tools/
│   │   ├── crm.ts                # CRM tool (Notion client)
│   │   └── graph.ts              # Microsoft Graph API client
│   └── types/
│       └── index.ts              # TypeScript interfaces
│
├── prompts/                      # AI prompt templates (editable markdown)
│   ├── draft-newsletter.md       #   Newsletter generation prompt
│   ├── review-newsletter.md      #   Review/editing system prompt
│   └── categorize-meeting.md     #   Meeting categorization prompt
│
├── email-template/
│   ├── index.mjml                # MJML source (edit this)
│   ├── index.html                # Compiled HTML (upload to Loops)
│   └── img/                      # Logo and icon assets
│
├── scripts/
│   └── create-subscribers-db.ts  # One-time: create subscribers DB in Notion
│
├── .github/workflows/
│   └── newsletter.yml            # GitHub Actions (manual trigger)
│
└── .env.example                  # All required environment variables
```

## Architecture Details

### Modular Design

The codebase separates **code** (TypeScript orchestration) from **content** (what the AI writes about). You should never need to edit TypeScript files to customize your newsletter. All company-specific content lives in three places:

| Layer | Files | What to customize |
|-------|-------|-------------------|
| **AI Prompts** | `prompts/*.md` | Your product description, audience, terminology, tone |
| **Content Guidelines** | `CLAUDE.md` (this file) | Target audience, language rules, compliance references |
| **Email Branding** | `email-template/` | Logo, colors, fonts, footer links |

### HTML Generation Pipeline

Both the CLI (`src/send-newsletter.ts`) and webhook (`api/newsletter-status.ts`) use a shared HTML generator:

- **`src/html-generator.ts`** converts Notion blocks into bare semantic HTML (`<h1>`, `<h2>`, `<p>`, `<ul>`, `<blockquote>`, etc.)
- No inline styles on content — the compiled MJML template's `<style>` block handles all styling
- Only exception: `<img>` tags keep `style="max-width:100%"` (email clients need explicit image constraints)
- Supports optional Supabase image upload via callback for permanent hosting

### Prompt System

AI prompts live in `prompts/*.md` as editable Markdown files. The `src/load-prompt.ts` utility:
- Reads the `.md` file from the `prompts/` directory
- Strips the header (everything before `## Prompt` or `## System Prompt`)
- Interpolates `{{variableName}}` placeholders with provided values

To edit a prompt, just modify the markdown file — no code changes needed.

### Webhook Endpoints

**POST `/api/newsletter-status`** — Auto-send trigger
- Called by Notion automation when Status changes to "Ready"
- Header: `x-webhook-secret: [NOTION_WEBHOOK_SECRET]`
- Body: `{ "pageId": "...", "status": "Ready" }`

**POST `/api/webhook`** — Meeting enrichment
- Called by Notion when a new meeting is created

## Notion Database Schema

### Newsletter DB
| Property | Type | Values |
|----------|------|--------|
| Issue | title | Newsletter title |
| Issue date | date | Publication date |
| Status | status | Draft / Ready / Sent |
| Audience | select | Customers / Internal |
| Highlights | rich_text | Brief summary for email preview |
| Primary customer | rich_text | Featured customer name |

### Meetings DB
| Property | Type | Values |
|----------|------|--------|
| Name | title | Meeting name |
| Date | date | Meeting date |
| Bucket | select | Customer / Pipeline / Internal |
| Summary | rich_text | AI-generated summary |
| Company | rich_text | Associated company |
| Topics | multi_select | Product Demo, Pricing, Technical, Strategy, Hiring, Partnership, Support, Onboarding, Feedback |
| Action Items | rich_text | Action items from meeting |

### Tasks DB
| Property | Type | Notes |
|----------|------|-------|
| Name | title | Task description |
| Status | status | Must include "Done" or "Complete" |
| Sprint | relation | Links to Sprints DB |

### Subscribers DB
| Property | Type | Notes |
|----------|------|-------|
| Email | email | Recipient address |
| First Name | rich_text | For personalization |
| Subscribed | checkbox | Filter for active subscribers |

## Content Guidelines

> **Replace this section** with your own audience, language rules, and compliance references. See [GUIDE.md Step 9](GUIDE.md#step-9-customize-for-your-company) for instructions.

### Target Audience
<!-- Replace with YOUR audience personas -->
- [Role 1] — e.g., VPs of Operations, CTOs, Product Managers
- [Role 2] — e.g., CMOs, Marketing Directors
- [Role 3] — e.g., Compliance Officers, Engineering Leads

### Industry Language

<!-- Replace with terminology specific to YOUR vertical -->
| Avoid (generic) | Use Instead (industry-specific) |
|-------|-------------|
| "fast" | Your industry's preferred metric (e.g., "reduced TAT by X%", "cut cycle time by X%") |
| "compliant" | Cite specific regulations or standards that matter to your audience |
| "easier to use" | Quantify the improvement (e.g., "Y fewer clicks", "Z minutes saved") |
| "AI feature" | Frame in terms your audience cares about (e.g., "consistent criteria application") |

### Compliance / Standards References
<!-- Replace with regulations relevant to YOUR industry -->
- **[Standard 1]** — Description (e.g., CMS-0057-F, SOC 2, HIPAA, GDPR, PCI-DSS)
- **[Standard 2]** — Description
- **[Standard 3]** — Description

### Impact Quantification
Always quantify when possible:
- "[Metric] reduced by X%"
- "[Process] saves Y hours per [unit] per [period]"
- "Achieves Z% [quality metric]"

## Environment Variables

See `.env.example` for all required variables. Key groups:

| Group | Variables | Purpose |
|-------|-----------|---------|
| Anthropic | `ANTHROPIC_API_KEY` | Claude API for drafting, review, categorization |
| Notion | `NOTION_API_KEY`, `*_DB_ID` | Database access for meetings, tasks, newsletters, subscribers |
| Loops | `LOOPS_API_KEY`, `LOOPS_TRANSACTIONAL_ID` | Transactional email sending |
| Slack | `SLACK_WEBHOOK_URL` | Draft notifications (optional) |
| Supabase | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_BUCKET` | Permanent image hosting (optional) |
| Webhook | `NOTION_WEBHOOK_SECRET` | Auto-send authentication (optional) |

For full setup instructions, see **[GUIDE.md](GUIDE.md)**.
