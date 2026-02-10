# Newsletter Draft Prompt

Used by `src/newsletter/draft.ts` to generate weekly newsletter content via Claude.

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

**COMPLETED ENGINEERING TASKS:**
{{tasksContext}}

---

**IN-PROGRESS ENGINEERING TASKS:**
{{inProgressTasks}}

---

**MEETING NOTES FROM THIS WEEK:**
{{meetingsContext}}

---

**PREVIOUS NEWSLETTER (for continuity):**
{{previousNewsletter}}

---

**Instructions:**

Generate a newsletter with EXACTLY 4 sections in this order:

### Section 1: What Shipped This Week
- Cross-reference completed tasks + meetings to determine what actually shipped
- If the previous newsletter listed something under "What's Coming" and it's now Done → feature it here
- **Select the TOP 2-3 most impactful features — do NOT list every completed task**
- Prioritize features with: customer evidence from meetings, quantifiable metrics, compliance angle
- Remaining completed items can be mentioned as single bullets in "What's Coming" if still evolving, or omitted
- Each feature gets a ## heading with emoji and status: `## 🚀 Feature Name — ✅ Live`
- Structure each feature with **### subheadings + bullets** — NOT just a wall of bullets:
  - Use ### subheadings to break up content (e.g., `### What changed`, `### Operational impact`, `### By the numbers`)
  - 2-3 bullets per subheading — short and scannable
  - Each feature should have 2-3 subheadings total
- Use **bold** for metrics and key terms (e.g., **40% reduction in TAT**)
- Use *italic* for regulation references only (e.g., *CMS-0057-F*)
- Add --- divider between features

**After all features, add a ### subsection:**
```
### Why This Matters
```
- 2-4 bullets summarizing the combined operational impact of this week's shipped features
- State the impact directly — do NOT label by role (no "VPs of Operations:", "Compliance Officers:", etc.)
- Good: `- Cuts average determination TAT from 48 hours to under 24, keeping you ahead of *CMS-0057-F* deadlines`
- Good: `- Reduces manual review touches by 3 per auth, freeing reviewer capacity for complex cases`
- Bad: `- **VPs of Operations:** TAT reduction and SLA compliance improvements`
- Reference specific features and metrics from above — no generic platitudes

### Section 2: What's Coming Next Week
- Cross-reference in-progress tasks + meeting discussions + sprint plans
- Do NOT repeat items already covered in "What Shipped"
- Format: `- **Feature Name** — 🧪 *In Testing*` or `- **Feature** — 🔜 *Sprint Planning*`
- Include 1-line context for each item (what it does or why it matters)

### Section 3: Customer Feedback
- Pull quotes from customer/pipeline meetings
- Format each quote as a single blockquote block — quote text and attribution on ONE `>` line:
  ```
  > "Quote text here." — Name, Title at Company
  ```
- Do NOT split the quote and attribution across separate `>` lines (that breaks rendering)
- After each quote, add 1-2 bullet points on what resonated and operational significance

### Section 4: One Ask
- 1-2 sentences framing the main value from this week
- End with: `👉 [Book a discovery call](https://calendly.com/lilee-ai/discovery-call-lilee-ai)`

---

**CONTINUITY RULES (CRITICAL):**
- If the previous newsletter mentioned something as "Coming Next Week" and it's now Done → it MUST appear in "What Shipped"
- Never repeat a feature that was already covered in detail in the previous issue
- Track feature evolution across issues: planning → testing → shipped
- Use the previous newsletter to understand what's already been communicated to readers

---

**TITLE GUIDELINES:**
- DO NOT use "Lilee Product Update — [date]" — the date is shown separately
- Create an ORIGINAL, compelling title highlighting the main feature
- Examples: "Faster Determinations, Better Audit Trails" / "From 20 Clicks to 2: Streamlined Auth Workflows"

**FORMATTING RULES (CRITICAL — NO HTML):**
- Use # for the 4 section headers (What Shipped, What's Coming, Customer Feedback, One Ask)
- Use ## with emoji for feature titles in What Shipped
- Use ### for subheadings within features (What changed, Operational impact, etc.)
- Only 3 heading levels: #, ##, ### — NEVER use #### or deeper
- Status indicators are emoji ONLY: ✅ Live, 🧪 In Testing, 🔜 Coming Soon
- NO `<span>`, `<h4>`, `<table>`, or any other HTML tags — they render as raw text
- NO tables of any kind — use bullet lists instead
- NO paragraph-style descriptions — ALL content must be bullets under headings
- **Bold** for product names, metrics, and key terms
- *Italic* for regulation names only
- Use payer language: TAT, LCD/NCD criteria, medical necessity, audit-ready, reviewer confidence

**Response Format (JSON):**
```json
{
  "title": "Creative, compelling title highlighting the main feature",
  "highlights": "Brief 1-2 sentence summary of key updates",
  "primaryCustomer": "Name of primary customer mentioned, or empty string",
  "content": "Full newsletter content in Markdown (NO HTML)",
  "suggestedCollateral": ["List of screenshots, videos, or attachments that would enhance this newsletter"],
  "reviewQuestions": ["Questions the team should answer before sending"]
}
```

Respond with ONLY valid JSON.
