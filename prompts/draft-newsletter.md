# Newsletter Draft Prompt

Used by `src/draft-newsletter.ts` to generate weekly newsletter content via Claude.

**Model:** claude-opus-4-5-20251101
**Max tokens:** 4000

---

## Prompt

You are drafting a weekly product newsletter for Lilee, an AI-powered healthcare workflow platform.

**Audience:** VPs of Operations, CMOs, UM Directors, Compliance Officers at health plans, TPAs, and ACOs.

**What they care about:**
- CMS compliance (prior auth timelines, interoperability)
- Operational efficiency (TAT, SLA, staffing costs)
- Clinical quality (consistent criteria, audit-ready docs)
- Provider/member experience

---

**ENGINEERING TASKS COMPLETED THIS WEEK:**
{{tasksContext}}

---

**MEETING NOTES FROM THIS WEEK:**
{{meetingsContext}}

---

**Instructions:**
1. Generate a newsletter with 2-3 Big Features based on the completed engineering tasks and meeting discussions
2. Focus on what was SHIPPED/COMPLETED this week (from the tasks)
3. Use customer feedback from meetings to add context and validate the features
4. For each feature, include:
   - What shipped (bullets from the actual tasks completed)
   - Why this matters for their operation (connect to CMS, TAT, staffing, care quality)
   - Operational impact (quantify where possible)
   - Compliance angle where relevant

5. Use payer language: TAT, LCD/NCD criteria, medical necessity, audit-ready, reviewer confidence
6. Include a Roadmap section with regulatory alignment
7. Include Customer Feedback section with quotes from meetings
8. ALWAYS end with a "One Ask" section that includes a CTA to book a discovery call: https://calendly.com/lilee-ai/discovery-call-lilee-ai
   - Frame the ask around the main feature (e.g., "Want to see Ellie in action? Book a quick call with our team.")
   - The CTA button is already in the email template, but the "One Ask" section should introduce it with context

**TITLE GUIDELINES (CRITICAL):**
- DO NOT use "Lilee Product Update — [date]" - the date is already shown separately
- Create an ORIGINAL, compelling title that highlights the main feature or theme
- Examples of GOOD titles:
  - "Introducing Lilee Chat: Your Clinical Review Copilot"
  - "Faster Determinations, Better Audit Trails"
  - "CMS-0057-F Ready: New Interoperability Features"
  - "From 20 Clicks to 2: Streamlined Auth Workflows"
- The title should make readers want to open the email

**Formatting Guidelines (IMPORTANT):**
- Use ## for main section headers (e.g., "## What Shipped This Week", "## Roadmap", "## Customer Feedback", "## One Ask")
- Use ### with emoji for feature titles (e.g., "### 🚀 Introducing Ellie: Your New Helpful Co-Pilot")
- Use `<h4>` tags for subsection labels - these render as purple pill badges in email:
  - `<h4>What's Live:</h4>`
  - `<h4>Why This Matters for Your Operation:</h4>`
  - `<h4>Operational Impact:</h4>`
  - `<h4>Compliance Angle:</h4>`
  - `<h4>What's In Progress:</h4>`
- Use bullet points (-) for lists
- **BOLD all new feature names, product names, and key terms** when first mentioned in a paragraph (e.g., "This week we're introducing **Lilee Chat**—a conversational interface...")
- Use **bold** for metric lead-ins (e.g., "**Reduced Review TAT**: 40% faster...")
- Add --- divider between major feature sections for visual separation
- Use > for customer quotes in blockquotes

**STATUS BADGES (use inline HTML spans):**
For feature titles, add status indicators using these classes:
- `<span class="status-live">Live</span>` - for features currently available
- `<span class="status-testing">In Testing</span>` - for features in beta/testing
- `<span class="status-coming">Coming Soon</span>` - for upcoming features

Example: `### 🚀 Introducing Ellie <span class="status-live">Live</span>`

**TABLE FORMATTING (CRITICAL):**
- DO NOT use markdown table syntax (| pipes) - it won't render in email
- Instead, format roadmap/comparison data as styled HTML tables

**Response Format (JSON):**
```json
{
  "title": "Creative, compelling title highlighting the main feature (NOT 'Lilee Product Update — date')",
  "highlights": "Brief 1-2 sentence summary of key updates",
  "primaryCustomer": "Name of primary customer mentioned, or empty string",
  "content": "Full newsletter content in Markdown format with HTML tables",
  "suggestedCollateral": ["List of screenshots, videos, or attachments that would enhance this newsletter"],
  "reviewQuestions": ["Questions the team should answer before sending", "e.g., 'Should we include the TAT metrics from ACV?'"]
}
```

Respond with ONLY valid JSON.
