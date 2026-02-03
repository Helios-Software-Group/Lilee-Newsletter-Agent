# Lilee Newsletter Agent

## Overview

Automated newsletter management system that generates, reviews, and sends weekly product updates to health plan stakeholders.

## Architecture

```
TUESDAY 9 AM (GitHub Actions)
├── Fetch Meetings + Tasks from Notion
├── Generate Draft with Claude
├── AI Review & Edit (payer-focused language)
├── Add Collateral Checklist
├── Create in Notion (Status: Draft)
└── Slack Notification

HUMAN REVIEW (Notion)
├── Review AI-edited draft
├── Add screenshots/videos
├── Complete collateral checklist
└── Set Status → "Ready"

AUTO-SEND (Notion Webhook → Vercel)
├── Receive status change webhook
├── Validate Status = "Ready"
├── Send via Loops API
└── Update Status → "Sent"
```

## Key Commands

```bash
npm run weekly          # Full workflow: draft + review + notify
npm run draft           # Generate newsletter draft only
npm run send            # Send newsletters with Status="Ready"
npm run categorize      # Categorize uncategorized meetings
npm run notify          # Send test Slack notification
```

## Environment Variables

```env
# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Notion
NOTION_API_KEY=ntn_...
NOTION_MEETINGS_DB_ID=...
NOTION_TASKS_DB_ID=...
NOTION_NEWSLETTER_DB_ID=...
NOTION_WEBHOOK_SECRET=...

# Slack
SLACK_WEBHOOK_URL=https://hooks.slack.com/...

# Loops (Email)
LOOPS_API_KEY=...
LOOPS_TRANSACTIONAL_ID=...
```

## Notion Database Schema

### Newsletter DB
- `Issue` (title) - Newsletter title
- `Issue date` (date) - Publication date
- `Status` (status) - Draft | Ready | Sent
- `Audience` (select) - Customers | Internal
- `Highlights` (rich_text) - Brief summary
- `Primary customer` (rich_text) - Featured customer

### Meetings DB
- `Name` (title) - Meeting name
- `Date` (date) - Meeting date
- `Bucket` (select) - Customer | Pipeline | Internal
- `Summary` (rich_text) - AI-generated summary
- `Topics` (multi_select) - Discussion topics
- `Action Items` (rich_text) - Action items

## Content Guidelines

### Target Audience
- VPs of Operations at health plans
- CMOs / Medical Directors
- UM Directors
- Compliance Officers

### Payer Language (REQUIRED)

| Avoid | Use Instead |
|-------|-------------|
| "fast" | "reduced TAT by X%" |
| "compliant" | "CMS-0057-F compliant" |
| "easier to use" | "Y fewer clicks per auth" |
| "AI feature" | "consistent LCD/NCD criteria application" |
| "documented" | "audit-ready determination letters" |
| "decision support" | "reviewer confidence" |

### Compliance References
When relevant, cite specific regulations:
- **CMS-0057-F** - Prior auth interoperability rule
- **NCQA** - Accreditation standards for UM
- **URAC** - Health utilization management standards
- **CMS 72hr/7-day** - Prior auth timeline requirements

### Impact Quantification
Always quantify operational impact:
- "Reduces TAT by 40%"
- "Saves 5 min per auth × 50 auths/day = 4+ hours"
- "Achieves 95% first-pass accuracy"

## File Structure

```
Lilee-Newsletter-Repo/
├── api/
│   ├── webhook.ts              # Meeting enrichment webhook
│   └── newsletter-status.ts    # Status change webhook (auto-send)
├── src/
│   ├── index.ts                # Main orchestrator
│   ├── draft-newsletter.ts     # Draft generation
│   ├── review-newsletter.ts    # AI review & edit
│   ├── send-newsletter.ts      # Email sending via Loops
│   ├── notify-slack.ts         # Slack notifications
│   ├── categorize-meetings.ts  # Meeting categorization
│   └── types/
│       └── index.ts            # TypeScript interfaces
├── .github/workflows/
│   └── newsletter.yml          # Scheduled Tuesday runs
└── CLAUDE.md                   # This file
```

## Webhook Endpoints

### POST /api/webhook
Meeting enrichment - called by Notion when new meeting created.

### POST /api/newsletter-status
Auto-send trigger - called by Notion when Status changes to "Ready".

**Headers:** `x-webhook-secret: [NOTION_WEBHOOK_SECRET]`

**Body:** `{ "pageId": "...", "status": "Ready" }`

## Troubleshooting

### No meetings found
- Verify `NOTION_MEETINGS_DB_ID` is correct
- Check meetings have dates within past 7 days
- Ensure meetings have `Bucket` property set

### Loops email not sending
- Verify `LOOPS_API_KEY` is valid
- Check `LOOPS_TRANSACTIONAL_ID` matches template
- Ensure contacts have `newsletter: true` property

### Webhook not triggering
- Verify Notion automation is enabled
- Check `NOTION_WEBHOOK_SECRET` matches
- Review Vercel function logs at vercel.com

### AI review not improving content
- Check Anthropic API key is valid
- Review Claude response in logs
- Verify draft content was fetched correctly

## Deployment

### GitHub Actions
- Runs `weekly` command every Tuesday at 9 AM EST (14:00 UTC)
- Manual trigger available via workflow_dispatch
- Secrets configured in repository settings

### Vercel
- Webhook endpoints deployed automatically
- Function timeout: 300s (5 min)
- Environment variables in Vercel dashboard

### Notion Automation Setup

**Step-by-step to configure auto-send on status change:**

1. Open the Newsletter database in Notion
2. Click the "..." menu in the top-right corner
3. Select "Automations"
4. Click "+ New automation"
5. Configure the trigger:
   - "When" → "Status property changes"
   - "to" → "Ready"
6. Configure the action:
   - "Then" → "Send webhook"
   - URL: `https://your-vercel-app.vercel.app/api/newsletter-status`
   - Method: POST
   - Headers: Add `x-webhook-secret` with your `NOTION_WEBHOOK_SECRET` value
   - Body (JSON):
     ```json
     {
       "pageId": "{{page.id}}",
       "status": "{{page.Status}}"
     }
     ```
7. Save the automation

**Testing the webhook:**
```bash
curl -X POST https://your-vercel-app.vercel.app/api/newsletter-status \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: your-secret" \
  -d '{"pageId": "your-test-page-id", "status": "Ready"}'
```

### Loops Email Template Setup

**Create a transactional email template in Loops:**

1. Log in to Loops dashboard
2. Go to "Transactional" → "Create template"
3. Name it `lilee-product-update`
4. Set up the template with these variables:
   - `{{first_name}}` - Recipient's first name
   - `{{issue_title}}` - Newsletter title
   - `{{issue_date}}` - Publication date
   - `{{highlights}}` - Brief summary
   - `{{content_html}}` - Full HTML content
5. Design with Lilee branding (logo, colors)
6. Copy the transactional ID to `LOOPS_TRANSACTIONAL_ID`

**Contact properties required:**
- `email` (string) - Recipient email
- `firstName` (string) - For personalization
- `newsletter` or `subscribed` (boolean) - Filter recipients
