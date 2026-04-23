---
name: code-review-files
description: Analyzes files the developer attaches as an expert Flutter and SuperApp Retail reviewer. Reviews for bugs, errors, bad practices, architecture violations, and project compliance. Use when the user attaches files for review, asks to analyze code, check for bugs, or review attached code.
---

# Expert Code Review (Attached Files)

When the user attaches one or more files (or pastes code) and asks for review, analysis, or feedback on bugs/practices/architecture, **delegate to the code-quality-reviewer subagent** (`.cursor/agents/code-quality-reviewer.md`).

## What to do

1. **Identify the code to review:** Use the file(s) the user attached or the code they pasted. If they asked for review but did not attach or paste anything, ask them to attach the specific file(s) they want reviewed.
2. **Delegate to the subagent:** Invoke the **code-quality-reviewer** subagent and pass the contents of the attached/pasted file(s) as the input. The subagent applies the full Flutter and SuperApp Retail review (bugs, architecture, best practices) and returns the structured report (Summary, Critical, Suggestions, Nice to have, Project compliance, Positive notes).
3. **Present the result:** Show the user the subagent’s review output as-is.

## Why delegate

The same review logic and output format live in the **code-quality-reviewer** subagent. That subagent is also used by the [agent-review](../agent-review/SKILL.md) flow (git diff vs develop). Keeping one implementation in the subagent means:

- Attached-file reviews and PR-style (diff) reviews use the same standard.
- Updates to the review methodology are done in one place (the subagent).

## Reference

- **Review logic and output format:** [.cursor/agents/code-quality-reviewer.md](../../agents/code-quality-reviewer.md)
- **Project rules:** [docs/rules.md](../../../docs/rules.md)
- **Quick checklist:** [CHECKLIST.md](CHECKLIST.md)
