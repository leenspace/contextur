---
name: review
description: Run Contextur review and execute the 3-stage specialist/challenger/synthesizer workflow.
---

Run `contextur review --base {{base_branch}}` in the terminal (or use the base branch requested by the user), then follow the 3-stage pipeline described in its output:

1. **Stage 1 — Specialists**: Run each triggered reviewer independently against the context bundle at the bottom of the output. Produce a findings block per reviewer.
2. **Stage 2 — Challenger**: Validate all findings using the Challenger prompt. Mark each as CONFIRMED, DOWNGRADED, or REJECTED with a brief justification.
3. **Stage 3 — Synthesizer**: Produce the final developer-facing report using the Synthesizer prompt.

Present only the final synthesized report to the user. Do not show intermediate specialist output unless the user asks.
