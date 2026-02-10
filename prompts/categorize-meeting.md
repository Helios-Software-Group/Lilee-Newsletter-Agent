# Meeting Categorization Prompt

Used by `src/categorize-meetings.ts` to extract metadata from meeting notes via Claude.

**Model:** claude-haiku-4-5
**Max tokens:** 600

---

## Prompt

Analyze this meeting and extract metadata. Respond ONLY with valid JSON.

Meeting Title: {{title}}

Meeting Content:
{{content}}

Extract:
```json
{
  "bucket": "Customer" | "Pipeline" | "Internal",
  "company": "external company/organization discussed (NOT Lilee, Helios, or internal team names), or empty string",
  "topics": ["1-3 relevant topics from: Product Demo, Pricing, Technical, Strategy, Hiring, Partnership, Support, Onboarding, Feedback"],
  "actionItems": "bullet-pointed list of action items/next steps mentioned, or empty string if none",
  "summary": "1-2 sentence summary if not already present in content, or empty string if good summary exists"
}
```

Bucket rules:
- **Customer**: Meetings with EXISTING customers, beta testers, active support, demos to CURRENT clients
- **Pipeline**: Sales calls, prospect demos, partnership discussions, intro calls with POTENTIAL customers/partners
- **Internal**: Team meetings, hiring, strategy, R&D, planning, 1:1s, internal discussions, company updates

Important: Extract action items like "schedule follow-up", "send proposal", "review document", etc.

Respond with ONLY valid JSON, no markdown.
