# Setup Guide

Step-by-step instructions to get the Newsletter Agent running from scratch.

## Prerequisites

- **Node.js 20+** and npm
- **Accounts needed:**
  - [Notion](https://notion.so) — databases, meeting notes, newsletter content
  - [Anthropic](https://console.anthropic.com) — Claude API for AI drafting, review, and categorization
  - [Loops](https://loops.so) — transactional email delivery
  - [Slack](https://api.slack.com/apps) *(optional)* — notifications and `/newsletter` slash commands
  - [Vercel](https://vercel.com) *(optional)* — serverless webhooks for auto-send and Slack bot
  - [Supabase](https://supabase.com) *(optional)* — permanent image hosting (Notion URLs expire after ~1 hour)
  - [GitHub](https://github.com) *(optional)* — scheduled weekly runs via Actions

---

## Step 1: Fork, Clone, and Install

1. Go to the [Newsletter Agent repo](https://github.com/Helios-Software-Group/Lilee-Newsletter-Agent) on GitHub
2. Click **Fork** (top-right) to create your own copy
3. Clone **your fork** (not the original):

```bash
git clone https://github.com/<your-username>/Lilee-Newsletter-Agent.git
cd Lilee-Newsletter-Agent
npm install
cp .env.example .env
```

> **Why fork?** Forking gives you your own copy to customize freely — prompts, branding, templates — while still being able to pull upstream improvements later with `git pull upstream main`.

Open `.env` in your editor — you'll fill it in as you complete each step.

Set your Anthropic key now (you'll need it for AI features later):

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create an API key
3. Set in `.env`:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```

All AI features use **Claude Opus 4.6** — drafting, review, categorization, and meeting enrichment.

---

## Step 2: Notion Integration

Create an API integration so the pipeline can read and write to your Notion workspace.

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click "New integration"
3. Name it "Newsletter Agent" (or your preference)
4. Select your workspace
5. Under Capabilities, enable: **Read content**, **Update content**, **Insert content**
6. Click "Submit"
7. Copy the "Internal Integration Secret" → paste as `NOTION_API_KEY` in `.env`

> **Keep this page open** — you'll need to connect this integration to each database you create.

**Env vars set:** `NOTION_API_KEY`

---

## Step 3: Notion AI Meeting Notes

Configure Notion to auto-capture meeting notes that feed into your newsletter.

### 3a. Connect Your Calendar

1. In Notion, go to **Settings & Members** → **Connections**
2. Find your calendar provider (Google Calendar, Outlook, etc.)
3. Connect it and grant access to your calendar events
4. Notion will start creating pages for your upcoming meetings

### 3b. Set the Meeting Notes Database

1. When Notion creates meeting note pages, it places them in a default location
2. Configure Notion to create meeting notes inside your **Meetings database** (created in Step 4)
3. In Notion Calendar settings, set the "Database for notes" to point at your Meetings DB

### 3c. AI Summaries

Notion AI can auto-summarize meeting notes:
- After a meeting, open the meeting page in Notion
- Use Notion AI to summarize: type `/ai` → "Summarize this page"
- The newsletter pipeline also generates its own summaries via `npm run categorize`

> **Note:** Notion AI features require a paid Notion plan. If unavailable, the categorization script (`npm run categorize`) will still extract summaries from whatever content is in the meeting pages.

If your meeting notes live in a **separate database** from your Meetings database, set in `.env`:
```
NOTION_MEETING_NOTES_DB_ID=<meeting-notes-db-id>
```

---

## Step 4: Notion Databases — Core Setup

You need 3 core databases. Create them in Notion with these properties:

### 4a. Newsletter DB

| Property | Type | Configuration |
|----------|------|---------------|
| Issue | title | (default) |
| Issue date | date | |
| Status | status | Options: **Draft**, **Test Sent**, **Ready**, **Sent**, **Done** |
| Audience | multi_select | Options: Customers, Internal (add more for your audiences) |
| Highlights | rich_text | Brief summary for email preview text |
| Primary customer | rich_text | Featured customer name |
| Collateral | rich_text | For embedded media HTML |

> **Important:** Make sure "Test Sent" is a Status option — this triggers test emails to your address only (set up in Step 10).

### 4b. Meetings DB

| Property | Type | Configuration |
|----------|------|---------------|
| Name | title | (default) |
| Date | date | |
| Bucket | select | Options: **Customer**, **Pipeline**, **Internal** |
| Summary | rich_text | |
| Company | rich_text | |
| Topics | multi_select | Options: Product Demo, Pricing, Technical, Strategy, Hiring, Partnership, Support, Onboarding, Feedback |
| Action Items | rich_text | |

**What the Buckets mean:**
- **Customer** — Meetings with existing customers (demos, support, onboarding, feedback)
- **Pipeline** — Sales/prospect meetings (discovery calls, proposals, negotiations)
- **Internal** — Team meetings (standups, planning, strategy, hiring)

The AI categorization (`npm run categorize`) auto-fills Bucket, Company, Topics, and Summary for each meeting.

### 4c. Tasks DB

| Property | Type | Configuration |
|----------|------|---------------|
| Name | title | (default) |
| Status | status | Must include a "Done" or "Complete" option |
| Sprint | relation | Link to Sprints database (see Step 5) |

### 4d. Connect the Integration

For **each** database you created:
1. Open the database page in Notion
2. Click the "..." menu in the top-right
3. Click **Connections** → find and add your "Newsletter Agent" integration

### 4e. Copy Database IDs

Each database URL looks like: `https://notion.so/<workspace>/<DATABASE_ID>?v=...`

Copy the ID (the long string before `?v=`) for each database into `.env`:
```
NOTION_MEETINGS_DB_ID=<meetings-db-id>
NOTION_TASKS_DB_ID=<tasks-db-id>
NOTION_NEWSLETTER_DB_ID=<newsletter-db-id>
```

### 4f. Copy Collection IDs (for SQL queries)

Some features use Notion's SQL query API, which requires **Collection IDs** (different from Database IDs):

1. Open a database in Notion
2. The Collection ID is the same as the Database ID for most databases
3. Set in `.env`:
   ```
   NOTION_MEETINGS_COLLECTION_ID=<meetings-collection-id>
   NOTION_NEWSLETTER_COLLECTION_ID=<newsletter-collection-id>
   ```

> **Tip:** If you're unsure, use the same value as the Database ID — they're often identical.

**Env vars set:** `NOTION_MEETINGS_DB_ID`, `NOTION_TASKS_DB_ID`, `NOTION_NEWSLETTER_DB_ID`, `NOTION_MEETINGS_COLLECTION_ID`, `NOTION_NEWSLETTER_COLLECTION_ID`

---

## Step 5: Sprints in Notion

The newsletter pipeline pulls completed tasks from your current sprint. You need a Sprints database to track sprint cycles.

### Option A: Use the Notion Agile PM Template (Recommended)

1. Go to the [Agile Project Management template](https://www.notion.so/marketplace/templates/agile-project-management-notion?cr=pro%253Anotion)
2. Click "Get template" → Duplicate to your workspace
3. Find the **Sprints** database in the duplicated page
4. Connect your "Newsletter Agent" integration to the Sprints database
5. Copy the Sprints database ID → set in `.env`:
   ```
   NOTION_SPRINTS_DB_ID=<sprints-db-id>
   ```

### Option B: Create a Minimal Sprints DB

Create a database with:

| Property | Type | Configuration |
|----------|------|---------------|
| Name | title | Sprint name (e.g., "Sprint 24") |
| Start Date | date | |
| End Date | date | |
| Status | status | Options: Planning, Active, Complete |

Connect integration and copy ID to `NOTION_SPRINTS_DB_ID`.

### Link Tasks to Sprints

In your Tasks DB, the `Sprint` relation property should link to your Sprints database. When tasks are marked "Done" in the active sprint, they appear in the newsletter's "What Shipped" section.

**Env vars set:** `NOTION_SPRINTS_DB_ID`

---

## Step 6: Import Contacts and Set Audience Strategy

The Contacts (Subscribers) database controls who receives your newsletters.

### 6a. Create the Contacts Database

Run the auto-create script:
```bash
npx tsx scripts/create-subscribers-db.ts
```

This creates a database with:
- **Name** (title) — Full name
- **Email** (email) — Required for sending
- **First Name** (rich_text) — For personalization ("Hi {{first_name}}")
- **Last Name** (rich_text) — Optional
- **Company** (rich_text) — Optional
- **Audience** (multi_select) — Matches Newsletter Audience options
- **Subscribed** (checkbox) — Must be checked to receive emails

Copy the database ID from the script output → set in `.env`:
```
NOTION_CONTACTS_DB_ID=<contacts-db-id>
```

Don't forget to connect the Newsletter Agent integration to this database too.

### 6b. Import Your Contacts

**Option A — CSV Import:**
1. Prepare a CSV with columns: Name, Email, First Name, Company, Audience
2. In Notion, click "..." on the Contacts database → **Merge with CSV**
3. Upload and map columns
4. After import, check the **Subscribed** checkbox for active recipients

**Option B — Manual Entry:**
Add contacts one by one directly in the Notion database.

### 6c. Audience Segmentation Strategy

Think strategically about your audience segments. Set these as **multi_select** options in both the Newsletter DB (Audience property) and the Contacts DB (Audience property):

| Audience | Who They Are | What They Get |
|----------|-------------|---------------|
| **Customers** | Current paying customers | Product updates, new features, tips |
| **Internal** | Your team | Everything including internal changes |
| **Prospects** | Sales pipeline | Marketing-focused content, ROI stories |
| **Partners** | Integration partners | API updates, partnership news |
| **Beta** | Early access users | Experimental features, feedback requests |

When you create a newsletter, set its **Audience** to match the intended recipients. The webhook auto-send (Step 10) will only send to contacts whose Audience matches.

**Env vars set:** `NOTION_CONTACTS_DB_ID`

---

## Step 7: Loops Email Setup

Loops handles the actual email delivery.

### 7a. Get API Key

1. Sign up at [loops.so](https://loops.so)
2. Go to **Settings** → **API Keys**
3. Copy the API key → set in `.env`:
   ```
   LOOPS_API_KEY=<your-loops-api-key>
   ```

### 7b. Upload the Email Template

1. Go to **Transactional** → **Create template**
2. Name it "Product Update" (or your preferred name)
3. In the template editor, paste the contents of `email-template/index.html`
4. The template expects these data variables:

| Variable | Description |
|----------|-------------|
| `first_name` | Recipient's first name |
| `issue_title` | Newsletter title |
| `issue_date` | Formatted publication date |
| `highlights` | Brief summary (email preview text) |
| `content_html` | Full newsletter HTML content |
| `collateral_html` | Optional embedded media HTML |

5. **Send a test email** to verify it renders correctly
6. Copy the Transactional ID → set in `.env`:
   ```
   LOOPS_TRANSACTIONAL_ID=<transactional-id>
   ```

### 7c. Set Your Test Email

This is the email address that receives test sends (when you set Status to "Test Sent" in Notion):

```
TEST_EMAIL=your-email@example.com
TEST_EMAIL_NAME=Your Name
```

> **Swap this for your own email.** This is what receives test newsletters before they go to your full audience.

**Env vars set:** `LOOPS_API_KEY`, `LOOPS_TRANSACTIONAL_ID`, `TEST_EMAIL`, `TEST_EMAIL_NAME`

---

## Step 8: Slack Setup (Optional)

### 8a. Webhook — Draft Notifications

Get notified in Slack when new drafts are created:

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → "From scratch"
2. Name it "Newsletter Agent", select your workspace
3. Go to **Incoming Webhooks** → Toggle on
4. Click **Add New Webhook to Workspace**
5. Choose your target channel (e.g., `#product-updates`)
6. Copy the webhook URL → set in `.env`:
   ```
   SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
   ```

Test it:
```bash
npm run notify
```

### 8b. Slash Command Bot — `/newsletter` Commands

Control the full pipeline from Slack with `/newsletter status`, `/newsletter run`, `/newsletter draft`, `/newsletter send`, and `/newsletter help`.

**1. Add Bot Token Scopes:**
- In your Slack app, go to **OAuth & Permissions** → **Scopes** → **Bot Token Scopes**
- Add: `chat:write`, `commands`, `incoming-webhook`

**2. Install to Workspace:**
- Click **Install to Workspace** → Authorize
- Copy the **Bot User OAuth Token** → set in `.env`:
  ```
  SLACK_BOT_TOKEN=xoxb-...
  ```

**3. Get Signing Secret:**
- Go to **Basic Information** → **App Credentials**
- Copy **Signing Secret** → set in `.env`:
  ```
  SLACK_SIGNING_SECRET=<your-signing-secret>
  ```

**4. Create the Slash Command:**
- Go to **Slash Commands** → **Create New Command**
- **Command:** `/newsletter`
- **Request URL:** `https://your-app.vercel.app/api/slack-agent` *(you'll get this URL in Step 9 — come back and update it)*
- **Short Description:** "Newsletter pipeline controls"
- **Usage Hint:** `status | run | draft | send | help`
- Click **Save**

**5. Reinstall App:**
- Go to **Settings** → **Install App** → **Reinstall to Workspace**

**Available commands:**
| Command | What It Does |
|---------|-------------|
| `/newsletter status` | Show newsletter counts by status |
| `/newsletter run` | Full pipeline: categorize → draft → review → notify |
| `/newsletter draft` | Draft only (faster, for iteration) |
| `/newsletter send` | Send all newsletters with Status = "Ready" |
| `/newsletter help` | Show available commands |

**Env vars set:** `SLACK_WEBHOOK_URL`, `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`

---

## Step 9: Vercel Deployment

Deploy serverless functions for auto-send webhooks and the Slack bot.

### 9a. Deploy

```bash
npm install -g vercel  # if not already installed
vercel                  # follow prompts to link/create project
vercel --prod          # deploy to production
```

Copy your production URL (e.g., `https://your-app.vercel.app`).

### 9b. Add Environment Variables

In the Vercel dashboard → your project → **Settings** → **Environment Variables**, add:

| Variable | Required? | Notes |
|----------|-----------|-------|
| `ANTHROPIC_API_KEY` | Yes | |
| `NOTION_API_KEY` | Yes | |
| `NOTION_MEETINGS_DB_ID` | Yes | |
| `NOTION_TASKS_DB_ID` | Yes | |
| `NOTION_NEWSLETTER_DB_ID` | Yes | |
| `NOTION_CONTACTS_DB_ID` | Yes | For audience-based sending |
| `NOTION_SPRINTS_DB_ID` | Yes | |
| `NOTION_MEETINGS_COLLECTION_ID` | Yes | |
| `NOTION_NEWSLETTER_COLLECTION_ID` | Yes | |
| `LOOPS_API_KEY` | Yes | |
| `LOOPS_TRANSACTIONAL_ID` | Yes | |
| `TEST_EMAIL` | Yes | Your test recipient |
| `TEST_EMAIL_NAME` | Yes | |
| `NOTION_WEBHOOK_SECRET` | Yes | Generate: `openssl rand -hex 32` |
| `SLACK_WEBHOOK_URL` | If using Slack | |
| `SLACK_BOT_TOKEN` | If using slash commands | |
| `SLACK_SIGNING_SECRET` | If using slash commands | |
| `SUPABASE_URL` | If using image hosting | |
| `SUPABASE_SERVICE_KEY` | If using image hosting | |
| `SUPABASE_BUCKET` | If using image hosting | Default: `newsletter-images` |

Set environment to **Production, Preview, Development** for each variable.

Also add `NOTION_WEBHOOK_SECRET` to your local `.env` (use the same value).

### 9c. Update Slack Slash Command URL

Now that you have your Vercel URL, go back to your Slack app settings:
1. **Slash Commands** → `/newsletter`
2. Update **Request URL** to: `https://your-app.vercel.app/api/slack-agent`
3. Save

### 9d. Test the Deployment

```bash
curl -X POST https://your-app.vercel.app/api/newsletter-status \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: <your-webhook-secret>" \
  -d '{"pageId": "test-page-id", "status": "Test Sent"}'
```

Should return a JSON response (may error on the fake pageId, but confirms the endpoint is live).

Redeploy after adding env vars:
```bash
vercel --prod
```

**Env vars set:** `NOTION_WEBHOOK_SECRET` (local + Vercel)

---

## Step 10: Newsletter DB Automations

Set up two automations in your Newsletter database — one for test sends (just you) and one for production sends (all subscribers).

### Automation 1: "Test Sent" — Send to Your Email Only

Use this to preview every draft before sending to your real audience.

1. Open your **Newsletter database** in Notion
2. Click "..." → **Automations** → **+ New automation**
3. Configure:
   - **Trigger:** "When Status property changes" → "to **Test Sent**"
   - **Action 1:** "Send webhook"
     - **URL:** `https://your-app.vercel.app/api/newsletter-status`
     - **Method:** POST
     - **Headers:** Add header:
       - Key: `x-webhook-secret`
       - Value: `<your NOTION_WEBHOOK_SECRET>`
     - **Body:**
       ```json
       {
         "pageId": "{{page.id}}",
         "status": "{{page.Status}}"
       }
       ```
4. Save the automation

> **What happens:** When you set Status to "Test Sent", the webhook fires, and the newsletter is sent ONLY to your `TEST_EMAIL` address. Check your inbox, review the email, then iterate.

### Automation 2: "Ready" — Send to All Subscribers

This is the production send — goes to everyone matching the newsletter's Audience.

1. Create a **second automation** in the Newsletter database
2. Configure:
   - **Trigger:** "When Status property changes" → "to **Ready**"
   - **Action 1:** "Send webhook"
     - **URL:** `https://your-app.vercel.app/api/newsletter-status`
     - **Method:** POST
     - **Headers:** Add header:
       - Key: `x-webhook-secret`
       - Value: `<your NOTION_WEBHOOK_SECRET>`
     - **Body:**
       ```json
       {
         "pageId": "{{page.id}}",
         "status": "{{page.Status}}"
       }
       ```
   - **Action 2 (optional):** "Send a Slack notification"
     - Channel: Your notifications channel
     - Message: `Newsletter "{{page.Issue}}" sent to {{page.Audience}}`
3. Save the automation

> **What happens:** When you set Status to "Ready", the newsletter is sent to ALL contacts whose Audience matches the newsletter's Audience property. The webhook also updates Status to "Sent" after successful delivery.

**Typical workflow:**
1. Generate draft (`/newsletter draft` or `npm run draft`)
2. Edit content in Notion
3. Set Status → **Test Sent** → check your inbox
4. Iterate until happy
5. Set Status → **Ready** → sent to everyone

---

## Step 11: Customize AI Prompts for Your Company

The included prompts are example templates. Rewrite them for your company, product, and audience.

### Using Claude Code or Cursor (Recommended)

Open Claude Code or Cursor in the project directory and provide context:

```
I need to customize the newsletter prompts for my company.

Company: [Your Company Name]
Product: [Brief description of what you build]
Audience: [Who reads the newsletter — titles, roles]
Industry: [Your vertical — healthcare, fintech, SaaS, etc.]
Tone: [Professional / Casual / Technical / etc.]
Key terminology: [Important terms your audience uses]
Compliance standards: [SOC 2, HIPAA, GDPR, PCI-DSS, etc. — if applicable]

Please rewrite the three prompt files in prompts/ for my company.
```

### Files to Customize

**`prompts/draft-newsletter.md`** — Controls newsletter generation.

Replace:
- Product description and company name
- Audience definition (who reads it, what they care about)
- Language/terminology section (industry-specific terms)
- CTA / "One Ask" section (your Calendly, booking link, or call-to-action)
- Title guidelines and examples
- Compliance/standards references

Keep (don't delete these — the code needs them):
- `{{tasksContext}}` and `{{meetingsContext}}` template variables
- The JSON response format at the bottom
- Formatting rules (heading levels, bullet points)

**`prompts/review-newsletter.md`** — Controls how the AI reviews drafts.

Replace:
- Editor persona (change "healthcare SaaS" to your vertical)
- Target audience section
- Industry terminology review criteria
- Compliance references

Keep:
- Output instructions (return improved markdown, add review summary)

**`prompts/categorize-meeting.md`** — Controls meeting categorization.

Replace:
- Company names in the exclusion list (so your own company isn't listed as an external company)
- Topic options if you want different tags

Keep:
- Bucket structure (Customer / Pipeline / Internal) — the code uses these values
- JSON response format
- `{{title}}` and `{{content}}` template variables

### Also Update CLAUDE.md Content Guidelines

In `CLAUDE.md`, scroll to the **Content Guidelines** section and replace with your own:
1. **Target Audience** — List your reader personas and titles
2. **Industry Language** — Create an "avoid → use instead" table with your vertical's terminology
3. **Compliance / Standards** — List regulations that matter to your audience
4. **Impact Quantification** — Provide example metrics

---

## Step 12: Email Template Branding

The included template uses example branding. Rebrand it for your company.

### 12a. Replace Logo Images

- `email-template/img/lilee-logo.png` → Your company logo
- `email-template/img/lilee-logo-white.png` → White version (for dark header/footer)
- Optionally replace `linkedin-icon-white.png` and `website-icon-white.png`

### 12b. Edit `email-template/index.mjml`

**Brand color** — Search for `#503666` (example purple) and replace with your primary brand color everywhere:
- Headings (`h1`, `h2`, `h3`, `h4` color)
- Strong text and links
- Borders and accents
- Header/footer backgrounds
- CTA button

**Secondary colors** — Generate light tints to match your brand and replace:
- `#f0ebf4`, `#f8f5fa`, `#faf8fb`, `#f5f0f8` — light tints (backgrounds, callouts)
- `#8b6b9e` — medium tint (gradients, captions)
- `#e8e0ed` — very light tint (hr gradient)

**Footer content:**
- Company name and tagline
- Social media links (LinkedIn URL, website URL)
- Logo image references
- Legal/unsubscribe text

**CTA links** — Update these to YOUR resources:
- **Scheduling link** (Calendly, Cal.com, etc.) — replace the discovery call URL
- **Website** — your company URL
- **LinkedIn** — your company LinkedIn page

**Font** (optional) — Replace `'Space Grotesk'` throughout the MJML and update the Google Fonts `<link>` in `<mj-head>`.

### 12c. Recompile and Upload

```bash
# Compile MJML to HTML
npx mjml email-template/index.mjml -o email-template/index.html
```

Or paste into [mjml.io/try-it-live](https://mjml.io/try-it-live) and copy the output.

After compiling, check the `<!--[if mso]>` blocks in `index.html` — these are Outlook overrides and should still reference your updated colors.

Re-upload the compiled `index.html` to your **Loops transactional template**.

### 12d. Test Your Template — THIS IS CRITICAL

Do **not** skip this. Send test emails and verify:

- [ ] Email renders correctly in **Gmail** (web + mobile)
- [ ] Email renders correctly in **Outlook** (desktop + web)
- [ ] Email renders correctly in **Apple Mail**
- [ ] All images load (logos, icons)
- [ ] **All links work** — click every one:
  - [ ] Scheduling/Calendly link
  - [ ] Website link
  - [ ] LinkedIn link
  - [ ] Unsubscribe link
- [ ] Personalization works (`{{first_name}}` shows your name)
- [ ] Colors match your brand
- [ ] Dark mode looks acceptable
- [ ] Email preview text shows Highlights, not HTML

> **To test:** Create a newsletter in Notion, add some content, set Status to "Test Sent" (requires Step 10 automation). Check your inbox.

---

## Step 13: Test the Full Pipeline

Run through the entire workflow end-to-end before going live.

### 13a. Test Categorization

```bash
npm run categorize
```
- Add a test meeting to your Meetings DB (leave Bucket empty)
- After running, check: Bucket, Company, Topics, and Summary should be filled in

### 13b. Test Draft Generation

**Via CLI:**
```bash
npm run draft
```

**Via Slack:**
```
/newsletter draft
```

**Check:**
- New page created in Newsletter DB with Status = "Draft"
- Content includes recent meetings and completed tasks
- Slack notification received (if configured)

### 13c. Test AI Review

```bash
npm run weekly
```

This runs the full pipeline: categorize → draft → review. Check that the draft is updated with review improvements (look for the "Review Summary" section at the bottom).

### 13d. Test Email Send

1. Open your draft in Notion
2. Edit the content — add your own touches
3. Set Status → **Test Sent**
4. Wait 1-2 minutes
5. Check your `TEST_EMAIL` inbox

**Verify in the received email:**
- [ ] Content matches what you see in Notion
- [ ] Images render
- [ ] Links work
- [ ] Formatting is correct (headings, bullets, blockquotes)
- [ ] Personalization works

### 13e. Test Slack Commands

```
/newsletter status     → Shows counts by status
/newsletter help       → Shows available commands
/newsletter draft      → Creates a new draft
```

### 13f. Test Production Send

When you're confident everything works:
1. Ensure Contacts DB has at least one real subscriber with Subscribed = true
2. Set the newsletter's Audience to match the subscriber's Audience
3. Set Status → **Ready**
4. Confirm the email arrives in the subscriber's inbox

---

## Step 14: Supabase Image Hosting (Optional)

Notion image URLs expire after about 1 hour. If your newsletter includes images (screenshots, diagrams), they'll break in the email after expiry.

Supabase provides permanent public URLs for your images.

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **Storage** → Create a new bucket named `newsletter-images`
3. Set the bucket to **Public**
4. Go to **Project Settings** → **API** → copy the service role key
5. Set in `.env`:
   ```
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_KEY=your-service-role-key
   SUPABASE_BUCKET=newsletter-images
   ```
6. Add the same variables in **Vercel** environment settings
7. Redeploy: `vercel --prod`

After setup, the pipeline automatically downloads images from Notion and uploads them to Supabase before sending emails.

---

## Step 15: GitHub Actions (Optional — Scheduled Runs)

Automate weekly draft generation with GitHub Actions.

### 15a. Add Repository Secrets

Go to your repo → **Settings** → **Secrets and variables** → **Actions**, and add:

- `ANTHROPIC_API_KEY`
- `NOTION_API_KEY`
- `NOTION_MEETINGS_DB_ID`
- `NOTION_TASKS_DB_ID`
- `NOTION_NEWSLETTER_DB_ID`
- `NOTION_SPRINTS_DB_ID`
- `NOTION_MEETINGS_COLLECTION_ID`
- `NOTION_NEWSLETTER_COLLECTION_ID`
- `SLACK_WEBHOOK_URL`
- `LOOPS_API_KEY`
- `LOOPS_TRANSACTIONAL_ID`

### 15b. Enable Scheduled Runs

The workflow at `.github/workflows/newsletter.yml` is set to **manual trigger only** by default. To enable automatic weekly runs:

1. Open `.github/workflows/newsletter.yml`
2. Uncomment the schedule block:
   ```yaml
   schedule:
     - cron: '45 19 * * 3'  # Wednesday 2:45 PM EST (19:45 UTC)
   ```
3. Adjust the cron expression to your preferred day/time
4. Commit and push

### 15c. Manual Trigger

You can always trigger a run manually:
1. Go to **Actions** → "Weekly Newsletter" workflow
2. Click **Run workflow**
3. Choose a command: `weekly`, `draft`, `categorize`, or `send`

---

## Appendix

### Environment Variables Summary

| Group | Variables | Purpose |
|-------|-----------|---------|
| Anthropic | `ANTHROPIC_API_KEY` | Claude API for drafting, review, categorization |
| Notion | `NOTION_API_KEY`, `*_DB_ID` | Database access for meetings, tasks, newsletters, contacts, sprints |
| Notion SQL | `*_COLLECTION_ID` | Collection IDs for Notion SQL queries |
| Loops | `LOOPS_API_KEY`, `LOOPS_TRANSACTIONAL_ID` | Transactional email delivery |
| Slack | `SLACK_WEBHOOK_URL` | Draft notifications (optional) |
| Slack Bot | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` | `/newsletter` slash commands (optional) |
| Supabase | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_BUCKET` | Permanent image hosting (optional) |
| Webhook | `NOTION_WEBHOOK_SECRET` | Auto-send webhook authentication |
| Testing | `TEST_EMAIL`, `TEST_EMAIL_NAME` | Test send recipient |

### Command Cheat Sheet

| Command | What It Does |
|---------|-------------|
| `npm run weekly` | Full pipeline: categorize → draft → review → notify |
| `npm run draft` | Generate draft only (fast iteration) |
| `npm run categorize` | AI-categorize uncategorized meetings |
| `npm run send` | Send all newsletters with Status = "Ready" |
| `npm run notify` | Test Slack notification |
| `/newsletter status` | Show newsletter counts by status |
| `/newsletter run` | Full pipeline via Slack |
| `/newsletter draft` | Draft-only via Slack |
| `/newsletter send` | Send ready newsletters via Slack |
| `/newsletter help` | Show available commands |

### Troubleshooting

**Draft is empty or has no meetings**
- Check: Do meetings from the past 7 days exist in your Meetings DB?
- Check: Are meetings categorized (Bucket field set)?
- Run `npm run categorize` to categorize meetings first

**Webhook not triggering**
- Verify: `NOTION_WEBHOOK_SECRET` matches in both Vercel and the Notion automation header
- Check Vercel logs for incoming requests (Vercel dashboard → Deployments → Functions)
- Test with the curl command from Step 9d

**Email not received**
- Check: `LOOPS_API_KEY` and `LOOPS_TRANSACTIONAL_ID` are correct
- Check: `TEST_EMAIL` is set correctly
- Check: For production sends, the subscriber has Subscribed = true and their Audience matches the newsletter's Audience
- Check Vercel logs for Loops API errors

**Images not loading in email**
- Without Supabase: Notion image URLs expire after ~1 hour. Set up Supabase (Step 14) for permanent URLs.
- With Supabase: Check that the bucket exists and is public, and Supabase env vars are set in Vercel.

**Slack slash command not responding**
- Check: Request URL in Slack app settings matches your Vercel URL (`/api/slack-agent`)
- Check: `SLACK_SIGNING_SECRET` is correct in Vercel
- Check: App was reinstalled after adding the slash command
- Check Vercel logs for signature validation errors

**Notion automation not firing**
- Check: The automation is enabled (not paused)
- Check: You're changing Status to the exact value configured (e.g., "Ready", not "ready")
- Check: The webhook URL and headers are correct in the automation settings

### Updating the Email Template

Whenever you edit the email template:

1. Edit `email-template/index.mjml`
2. Compile to HTML: `npx mjml email-template/index.mjml -o email-template/index.html`
3. Check `<!--[if mso]>` blocks for Outlook overrides
4. Re-upload the compiled HTML to your Loops transactional template
5. **Send a test email** to verify changes

### Editing AI Prompts

All AI prompts live in `prompts/` as editable Markdown files:

| File | Purpose | Template Variables |
|------|---------|-------------------|
| `draft-newsletter.md` | Generates newsletter from meetings + tasks | `{{tasksContext}}`, `{{meetingsContext}}`, `{{previousNewsletter}}`, `{{inProgressTasks}}` |
| `review-newsletter.md` | Reviews and edits draft content | (none — reads from system prompt) |
| `categorize-meeting.md` | Categorizes meetings into buckets | `{{title}}`, `{{content}}` |

To modify a prompt, edit the Markdown file directly — no code changes needed. The prompt text starts after the `## Prompt` or `## System Prompt` heading.
