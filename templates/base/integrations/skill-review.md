---
name: review
description: Run Contextur review and execute the 3-stage specialist/challenger/synthesizer workflow.
---

Run a Contextur review with an explicit pre-review intake before generating the review request.

## 1. Establish review inputs

Use the base branch requested by the user, or `{{base_branch}}` if none was provided.

Gather the current diff shape before asking the user:

1. Run `git diff --name-only <base>...HEAD` to list changed files.
2. Run `contextur review --dry-run --base <base>` to see Contextur's ignored/scoped file count, auto-triggered reviewers, and bundle summary.
3. Read `.contextur/manifest.yaml` when it exists so you can distinguish:
   - mandatory reviewers (`mandatory: true`), which always run;
   - optional reviewers (`mandatory: false`), which the user may enable or disable;
   - optional reviewers that Contextur auto-triggered for this diff.

If there are no changed files, stop and report that there is nothing to review.

## 2. Ask the user what to review

Use the structured question UI available to the agent (for example Cursor's `AskQuestion` tool) and ask these questions together when possible:

1. **Reviewers** (multi-select): list optional reviewers from `.contextur/manifest.yaml`; pre-select the optional reviewers that appeared in the dry-run's "Reviewers triggered" output when the UI supports defaults, otherwise label them as auto-triggered. Do not list mandatory reviewers as selectable options, but mention that they will always run. If there is no manifest or no optional reviewer, skip this question.
2. **Files or areas** (multi-select): ask which changed files or areas to include. If there are 30 or fewer changed files, use one option per file path and select all by default when supported. If there are more than 30, group files by the nearest useful repo-relative prefix (for example `packages/<name>`, `apps/<name>`, `src/<area>`, `.github`, or top-level directory) and select all groups by default when supported.
3. **Focus** (single-select): offer:
   - no_focus — No specific focus; full review
   - correctness — Correctness, regressions, and edge cases
   - architecture — Architecture and layer boundaries
   - security — Security and privacy risks
   - performance — Performance and memory
   - testing — Test coverage gaps
   - maintainability — Refactor opportunities and technical debt
   - custom — Custom focus requested by the user

If the user chooses `custom`, ask one short follow-up for the custom focus text. Otherwise use the selected focus label, except `no_focus`, which means omit `--focus`.

## 3. Generate the review request

Run `contextur review` non-interactively using the user's choices:

```bash
contextur review --no-interactive --base <base> --reviewers "<mandatory-and-selected-reviewers>" --paths "<selected-files-or-prefixes>" [--focus "<focus>"]
```

Rules:

- Include all mandatory reviewer ids plus the selected optional reviewer ids in `--reviewers`.
- If every file or area was selected, omit `--paths`; otherwise pass a comma-separated list of selected file paths or prefixes.
- Quote shell arguments safely.
- If the user skipped all optional reviewers, still run the mandatory reviewers.

Then follow the 3-stage pipeline described in the generated output:

1. **Stage 1 — Specialists**: Run each triggered reviewer independently against the context bundle at the bottom of the output. Produce a findings block per reviewer.
2. **Stage 2 — Challenger**: Validate all findings using the Challenger prompt. Mark each as CONFIRMED, DOWNGRADED, or REJECTED with a brief justification.
3. **Stage 3 — Synthesizer**: Produce the final developer-facing report using the Synthesizer prompt.

Present only the final synthesized report to the user. Do not show intermediate specialist output unless the user asks.
