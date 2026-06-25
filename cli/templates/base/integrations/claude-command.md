---
description: Run Contextur review with structured intake and 3-stage synthesis.
allowed-tools: AskUserQuestion Bash Read
---

Use `$ARGUMENTS` as the base branch, or `{{base_branch}}` if no argument is provided.

Before generating the review request, gather the user's review configuration:

1. Run `git diff --name-only <base>...HEAD` and `contextur review --dry-run --base <base>` to inspect changed files, auto-triggered reviewers, and bundle size.
2. Read `.contextur/manifest.yaml` when present so you know which reviewers are mandatory and which optional reviewers are available.
3. Use `AskUserQuestion` to gather:
   - optional reviewers to include (mandatory reviewers always run);
   - changed files or path areas to include;
   - review focus (`no_focus`, domain focus, or custom text).
   Default to auto-triggered optional reviewers and all changed files/areas.

Then run `contextur review` non-interactively with the selected configuration:

```bash
contextur review --no-interactive --base <base> --reviewers "<mandatory-and-selected-reviewers>" --paths "<selected-files-or-prefixes>" [--focus "<focus>"]
```

Omit `--paths` when every changed file or area is selected. Omit `--focus` when the user chooses a general review.

Follow the 3-stage pipeline described in the output:

1. **Stage 1 — Specialists**: Run each triggered reviewer independently against the context bundle at the bottom of the output. Produce a findings block per reviewer.
2. **Stage 2 — Challenger**: Validate all findings using the Challenger prompt. Mark each as CONFIRMED, DOWNGRADED, or REJECTED with a brief justification.
3. **Stage 3 — Synthesizer**: Produce the final developer-facing report using the Synthesizer prompt.

Present only the final synthesized report to the user. Do not show intermediate specialist output unless the user asks.
