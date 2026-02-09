# Setup Guide

Step-by-step instructions to get the Lilee Newsletter Agent running from scratch.

## Prerequisites

- **Node.js 20+** and npm
- **Accounts needed:**
  - Notion (databases + integration)
  - Anthropic (Claude API)
  - Loops (transactional email)
  - Slack (optional — for notifications)
  - Vercel (optional — for auto-send webhook)
  - Supabase (optional — for permanent image hosting)

## Step 1: Clone and Install

```bash
git clone <repo-url>
cd Lilee-Newsletter-Repo
npm install
cp .env.example .env
```

Open `.env` and fill in each value as you complete the steps below.

## Step 2: Notion Setup

### 2a. Create a Notion Integration

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click "New integration"
3. Name it "Lilee Newsletter Agent"
4. Select your workspace
5. Under Capabilities, enable: Read content, Update content, Insert content
6. Copy the "Internal Integration Secret" → paste as `NOTION_API_KEY` in `.env`

### 2b. Create the Databases

You need 4 databases. Create them in Notion with these exact properties:

**Newsletter DB**
| Property | Type | Configuration |
|----------|------|---------------|
| Issue | title | (default) |
| Issue date | date | |
| Status | status | Groups: Draft, Ready, Sent |
| Audience | select | Options: Customers, Internal |
| Highlights | rich_text | |
| Primary customer | rich_text | |

**Meetings DB**
| Property | Type | Configuration |
|----------|------|---------------|
| Name | title | (default) |
| Date | date | |
| Bucket | select | Options: Customer, Pipeline, Internal |
| Summary | rich_text | |
| Company | rich_text | |
| Topics | multi_select | Options: Product Demo, Pricing, Technical, Strategy, Hiring, Partnership, Support, Onboarding, Feedback |
| Action Items | rich_text | |

**Tasks DB**
| Property | Type | Configuration |
|----------|------|---------------|
| Name | title | (default) |
| Status | status | Must include a "Done" or "Complete" option |
| Sprint | relation | Link to a Sprints database (optional) |

**Subscribers DB** — you can auto-create this:
```bash
npx tsx scripts/create-subscribers-db.ts
```
Or manually create with: Email (email), First Name (rich_text), Subscribed (checkbox).

### 2c. Connect the Integration

For **each** database:
1. Open the database page in Notion
2. Click the "..." menu in the top-right
3. Click "Connections" → find and add your "Lilee Newsletter Agent" integration

### 2d. Copy Database IDs

Each database URL looks like: `https://notion.so/<workspace>/<DATABASE_ID>?v=...`

Copy the ID (the long string before `?v=`) for each database into `.env`:
```
NOTION_MEETINGS_DB_ID=<meetings-db-id>
NOTION_TASKS_DB_ID=<tasks-db-id>
NOTION_NEWSLETTER_DB_ID=<newsletter-db-id>
NOTION_SUBSCRIBERS_DB_ID=<subscribers-db-id>
```

## Step 3: Anthropic API

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create an API key
3. Set `ANTHROPIC_API_KEY=sk-ant-...` in `.env`

The system uses two models:
- **Draft generation:** Claude Opus 4.5 (`claude-opus-4-5-20251101`) — creative, long-form writing
- **Review & categorization:** Claude Sonnet 4 (`claude-sonnet-4-20250514`) — fast, precise editing

## Step 4: Loops Email Setup

### 4a. Get API Key

1. Sign up at [loops.so](https://loops.so)
2. Go to Settings → API Keys
3. Copy the API key → `LOOPS_API_KEY` in `.env`

### 4b. Upload the Email Template

1. Go to Transactional → Create template
2. Name it something like "Lilee Product Update"
3. In the template editor, paste the contents of `email-template/index.html`
4. The template expects these data variables (used in the HTML):

| Variable | Description |
|----------|-------------|
| `first_name` | Recipient's first name |
| `issue_title` | Newsletter title |
| `issue_date` | Formatted publication date |
| `highlights` | Brief summary (email preview text) |
| `content_html` | Full newsletter HTML content |

5. Send a test email to verify it renders correctly
6. Copy the Transactional ID → `LOOPS_TRANSACTIONAL_ID` in `.env`

### 4c. Add Contacts

Add your recipients in Loops with these properties:
- `email` (string) — their email address
- `firstName` (string) — for personalization
- `subscribed` (boolean) — set to `true` for newsletter recipients

## Step 5: Slack Notifications (Optional)

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → Create New App
2. Enable "Incoming Webhooks"
3. Add a webhook to your target channel
4. Copy the webhook URL → `SLACK_WEBHOOK_URL` in `.env`

The system sends a Slack message with a preview link whenever a new draft is created.

## Step 6: Supabase Image Hosting (Optional)

Notion image URLs expire after about 1 hour. For permanent image hosting in emails:

1. Create a project at [supabase.com](https://supabase.com)
2. Go to Storage → Create a new bucket named `newsletter-images`
3. Set the bucket to **Public**
4. Go to Project Settings → API → copy the service role key
5. Set in `.env`:
   ```
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_KEY=your-service-role-key
   SUPABASE_BUCKET=newsletter-images
   ```

## Step 7: Vercel Deployment (Optional — For Auto-Send)

If you want newsletters to auto-send when you set Status to "Ready" in Notion:

### 7a. Deploy to Vercel

```bash
npx vercel          # Follow the prompts to link/create a project
npx vercel --prod   # Deploy to production
```

### 7b. Add Environment Variables

In the Vercel dashboard → your project → Settings → Environment Variables, add:
- `NOTION_API_KEY`
- `NOTION_NEWSLETTER_DB_ID`
- `NOTION_WEBHOOK_SECRET` (generate one: `openssl rand -hex 32`)
- `LOOPS_API_KEY`
- `LOOPS_TRANSACTIONAL_ID`
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_BUCKET` (if using image hosting)

### 7c. Set Up Notion Automation

1. Open your **Newsletter database** in Notion
2. Click "..." → "Automations" → "+ New automation"
3. **Trigger:** "When Status property changes" → "to Ready"
4. **Action:** "Send webhook"
   - **URL:** `https://your-app.vercel.app/api/newsletter-status`
   - **Method:** POST
   - **Headers:** add `x-webhook-secret` with your `NOTION_WEBHOOK_SECRET` value
   - **Body:**
     ```json
     {
       "pageId": "{{page.id}}",
       "status": "{{page.Status}}"
     }
     ```
5. Save the automation

### 7d. Test the Webhook

```bash
curl -X POST https://your-app.vercel.app/api/newsletter-status \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: your-secret-here" \
  -d '{"pageId": "test-page-id", "status": "Ready"}'
```

## Step 8: GitHub Actions (Optional — For Scheduled Runs)

### 8a. Add Repository Secrets

Go to your repo → Settings → Secrets and variables → Actions, and add:
- `ANTHROPIC_API_KEY`
- `NOTION_API_KEY`
- `NOTION_MEETINGS_DB_ID`
- `NOTION_TASKS_DB_ID`
- `NOTION_NEWSLETTER_DB_ID`
- `NOTION_NEWSLETTER_COLLECTION_ID`
- `SLACK_WEBHOOK_URL`
- `LOOPS_API_KEY`
- `LOOPS_TRANSACTIONAL_ID`

### 8b. Enable Scheduled Runs (Optional)

The workflow at `.github/workflows/newsletter.yml` is set to **manual trigger only** by default. To enable automatic weekly runs:

1. Open `.github/workflows/newsletter.yml`
2. Uncomment the schedule block:
   ```yaml
   schedule:
     - cron: '45 19 * * 3'  # Wednesday 2:45 PM EST (19:45 UTC)
   ```
3. Adjust the cron expression to your preferred day/time
4. Commit and push

### 8c. Manual Trigger

You can always trigger a run manually:
1. Go to Actions → "Weekly Newsletter" workflow
2. Click "Run workflow"
3. Choose a command: `weekly`, `draft`, `categorize`, or `send`

## Test the Full Pipeline

Once everything is configured:

```bash
# 1. Categorize any existing uncategorized meetings
npm run categorize

# 2. Generate a newsletter draft
#    This creates a new page in Notion with Status: Draft
npm run draft

# 3. Review the draft in Notion
#    - Edit the content
#    - Add screenshots or videos
#    - Set Status → "Ready"

# 4a. If webhook is set up: the newsletter sends automatically
# 4b. If no webhook: send manually
npm run send
```

## Updating the Email Template

The email template is built with MJML for cross-client compatibility:

1. Edit `email-template/index.mjml`
2. Compile to HTML:
   - Online: paste into [mjml.io/try-it-live](https://mjml.io/try-it-live)
   - CLI: `npx mjml email-template/index.mjml -o email-template/index.html`
3. After compilation, check the `<!--[if mso]>` block for Outlook overrides
4. Re-upload the compiled HTML to your Loops transactional template

## Editing AI Prompts

All AI prompts live in `prompts/` as editable Markdown files:

| File | Purpose | Template Variables |
|------|---------|-------------------|
| `draft-newsletter.md` | Generates newsletter from meetings + tasks | `{{tasksContext}}`, `{{meetingsContext}}` |
| `review-newsletter.md` | Reviews draft for payer language | (none) |
| `categorize-meeting.md` | Categorizes meetings into buckets | `{{title}}`, `{{content}}` |

To modify a prompt, edit the Markdown file directly — no code changes needed. The prompt text starts after the `## Prompt` or `## System Prompt` heading.
