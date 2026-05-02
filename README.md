# Contextur

Contextur prepares agent-ready code review prompts and context from your git diff.

Run `contextur review` and feed the output to Claude Code, Cursor, Codex, or any AI assistant. Contextur does not run the model itself: it generates one structured review request that your AI tool executes through your multi-stage pipeline in `.contextur/`.

No API keys. No vendor lock-in. Prompts live in your repo as plain Markdown.

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
npx contextur@latest review
```

## Quickstart

```bash
# In your target project repo
contextur init                         # writes .contextur/ and AGENTS.md
git checkout -b my-change
# ... make changes and commit ...
contextur review --base main           # prints one structured review request to stdout
```

Use the output in your AI tool:

```bash
# Save and paste into any AI IDE/agent workflow
contextur review --base main > review-request.md
```

The review request includes a 3-stage flow for your AI to run:

1. Specialist reviewers
2. Challenger
3. Synthesizer

## How it works

Contextur has two core commands:

- `contextur init` scaffolds editable prompts and config in `.contextur/`, writes `AGENTS.md`, and can add optional IDE integration files for Claude Code and Cursor.
- `contextur review` builds a context bundle from `git diff <base>...HEAD`, selects reviewers, applies safety wrapping, and emits a single Markdown review request.

The generated review document is intentionally tool-agnostic. Claude Code, Cursor, and Codex receive the same core request format; integration files are convenience glue for each IDE.

## What `init` generates

```text
.contextur/
├── config.yaml           # base branch, ignored paths, risk patterns, max_file_bytes
├── manifest.yaml         # reviewer entries (five mandatory baseline + optional specialists)
├── challenger.md         # adversarial validator prompt
├── synthesizer.md        # final-report synthesizer prompt
└── reviewers/
    ├── correctness.md
    ├── security.md
    ├── architecture.md
    ├── testing.md
    ├── operability.md
    └── ... (optional specialists)
AGENTS.md                  # repo-level assistant context (always generated)
```

Optional integration files:

- Claude Code: `.claude/commands/review.md`, `.claude/commands/contextur-init.md`, `.claude/commands/contextur-update.md`
- Cursor: `.cursor/rules/contextur.mdc`
- Codex/OpenAI agents: no extra file required beyond `AGENTS.md`

All generated Markdown files are meant to be edited.

## Review pipeline

```text
git diff <base>...HEAD
        │
        ▼
┌─────────────────────┐
│  contextur review   │  builds context bundle + review request
└─────────┬───────────┘
          │  (stdout)
          ▼
 ┌────────┴────────┐
 │ Specialists     │  Stage 1
 └────────┬────────┘
          ▼
 ┌─────────────────┐
 │  Challenger     │  Stage 2
 └────────┬────────┘
          ▼
 ┌─────────────────┐
 │  Synthesizer    │  Stage 3
 └─────────────────┘
```

Default templates include a stack-agnostic mandatory baseline (`correctness`, `security`, `architecture`, `testing`, `operability`) plus optional specialists (`performance`, `api-contract`, `data-migration`, `ci-release`, `maintainability`) that trigger by path patterns. You can customize `.contextur/manifest.yaml` freely and add custom reviewers by creating Markdown files in `.contextur/reviewers/` and adding matching manifest entries.
Legacy setups using `core-logic` remain supported for backward compatibility.

## Security model

- User-sourced payloads (diff, file contents, commit log) are wrapped in `<user_*>` XML tags, and review prompts include standing instructions to ignore commands found inside those tags.
- Contextur never calls an LLM API. Your AI IDE provides the reasoning; Contextur provides the structured context.
- Data stays local to your machine and repository.

## Commands

```bash
contextur init [--force] [--yes]
contextur review [--base <ref>] [--focus <text>] [--paths <prefixes>] [--dry-run]
```

Notes:

- `--paths` scopes files by comma-separated path prefixes.
- `--dry-run` prints routing decisions and bundle stats without reviewer prompts.
- `max_file_bytes` is configurable in `.contextur/config.yaml`; large-diff bundle heuristics (preload budgets and thresholds) currently use internal defaults.

## Design

See [docs/reference/](docs/reference/) for the original research report and the Flutter reference workflow that the base templates were generalized from.

## License

MIT
