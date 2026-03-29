---
name: home-recommend
description: "Analyze home event history and generate proactive recommendations"
argument-hint: "[optional: specific area like 'hvac' or 'plumbing']"
---

# Home Recommendations

Analyze the home's event history and generate actionable recommendations:

1. Search all home events (tag: type/home-event), optionally filtered by area
2. Look for patterns:
   - Recurring issues with the same device or location
   - Increasing frequency of a particular event type
   - Maintenance items that are overdue (next_due in the past)
   - Battery replacements — predict when next ones are due based on intervals
   - Seasonal patterns (HVAC issues in summer/winter, etc.)
3. Check device notes for warranty expirations
4. Review cost trends — are maintenance costs increasing for any device?
5. Create a recommendation note in `home/recommendations/` with:
   - Date and scope of analysis
   - Prioritized list of recommendations (urgent first)
   - Estimated costs or savings where applicable
   - Suggested timeline for each action
6. Append a summary to today's daily note

Be practical and specific. Don't recommend things that are already done.
Only flag genuinely useful insights.
