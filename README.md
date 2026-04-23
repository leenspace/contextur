# Contextur

A transparent, locally-run framework that prepares structured code review context for your AI IDE.

Run `contextur review`, feed the output to Claude Code, Cursor, Codex, or any AI assistant — your AI follows the multi-stage review pipeline defined in `.contextur/`. No API keys. No vendor lock-in. The prompts live in your repo as plain Markdown.

> Status: early MVP, not yet published to npm.

## Install

Not on npm yet. For local development:

```bash
git clone <this repo>
cd contextur
npm install
npm run build -w contextur
# Option A: link into PATH
npm link -w contextur
# Option B: run the built binary directly
node $(pwd)/cli/dist/index.js --help
```

Once published:

```bash
npx contextur@latest init
npx contextur review
```

## Quickstart

```bash
# In your project
contextur init                         # scans repo, writes .contextur/ + AGENTS.md
git checkout -b my-change
# ... make changes and commit ...
contextur review --base main           # prints a structured review request to stdout
```

Then feed the output to your AI assistant:

```bash
# In Claude Code
contextur review --base main | cat     # the output is already in Claude's context

# Or write to a file for Cursor / Codex
contextur review --base main > review-request.md
```

Your AI reads the review request and follows the 3-stage pipeline: specialist reviewers → adversarial challenger → synthesizer.

## What gets generated

```
.contextur/
├── config.yaml           # base branch, ignore paths, size limits
├── manifest.yaml         # reviewer routing (which specialists trigger on which paths)
├── challenger.md         # adversarial validator prompt
├── synthesizer.md        # final-report synthesizer prompt
└── reviewers/
    ├── core-logic.md
    ├── security.md
    └── architecture.md
AGENTS.md                  # standard AI-assistant context file for your repo root
```

All Markdown files are meant to be edited. Rules Contextur inferred automatically are wrapped in `<!-- contextur:inferred -->` comments so you can audit and tune them.

## Pipeline

```
git diff <base>...HEAD
        │
        ▼
┌─────────────────────┐
│  contextur review   │  builds context bundle; routes to triggered reviewers
└─────────┬───────────┘
          │  (stdout → your AI IDE)
          ▼
 ┌────────┴────────┐
 │ Specialists     │  core-logic │ security │ architecture  (AI runs each)
 └────────┬────────┘
          ▼
 ┌─────────────────┐
 │  Challenger     │  CONFIRMED / DOWNGRADED / REJECTED per high-severity finding
 └────────┬────────┘
          ▼
 ┌─────────────────┐
 │  Synthesizer    │  single developer-facing report
 └─────────────────┘
```

The Challenger exists specifically to knock out false positives — the common failure mode of single-prompt review tools. Add/remove reviewers by editing `.contextur/manifest.yaml`; write custom reviewers by dropping new Markdown files into `.contextur/reviewers/` and adding a matching entry.

## Security model

- Every user-sourced payload (diff, file contents, commit log) is wrapped in `<user_*>` XML tags, and every reviewer prompt is primed with a standing instruction to ignore commands found inside those tags.
- Contextur never calls any LLM API. Your AI IDE provides the intelligence; Contextur provides the context.
- All data stays local. Nothing is routed through any third-party SaaS.

## Commands

```bash
contextur init [--force] [--yes]
contextur review [--base <ref>] [--focus <text>] [--paths <globs>] [--dry-run]
```

`--dry-run` prints routing decisions and bundle stats without reviewer prompts — use it to sanity-check what Contextur will send.

## Design

See [docs/reference/](docs/reference/) for the original research report and the Flutter reference workflow that the base templates were generalized from.

## License

MIT
