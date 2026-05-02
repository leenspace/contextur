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

- `contextur init` scaffolds editable prompts and config in `.contextur/`, writes `AGENTS.md`, and can add optional IDE integration files for Claude Code, Cursor, and shared cross-tool skills.
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

- Claude Code: `.claude/commands/contextur-review.md`, `.claude/commands/contextur-init.md`, `.claude/commands/contextur-update.md`
- Cursor: `.cursor/rules/contextur.mdc`
- Shared skills (Claude/Cursor/Codex-compatible): `.agents/skills/contextur-init/SKILL.md`, `.agents/skills/contextur-update/SKILL.md`, `.agents/skills/contextur-review/SKILL.md`
- Codex/OpenAI agents: `AGENTS.md` + optional `.agents/skills/*` (recommended for explicit command-like workflows)

All generated Markdown files are meant to be edited.

### Command availability by tool

Contextur uses a dual-layer approach:

- Tool-specific wrappers:
  - Claude Code project commands (`/project:contextur-init`, `/project:contextur-update`, `/project:contextur-review`)
  - Cursor project rules (`.cursor/rules/contextur.mdc`) that instruct agent behavior
- Shared skills:
  - `contextur-init`, `contextur-update`, `contextur-review` in `.agents/skills/`
  - Designed to work across Claude, Cursor, and Codex-style agentic tools

Invocation UX differs slightly by tool:

- Claude/Cursor typically expose skills in slash menus.
- Codex supports explicit skill invocation via `$skill-name` (for example `$contextur-review`) and also uses `AGENTS.md` for persistent repo guidance.
- Codex has a built-in `/review` command, so use Contextur via `$contextur-review` to run the Contextur pipeline.
- The generated `/contextur-review` skill asks for optional reviewers, files or path areas, and review focus through the agent UI, then passes those choices to `contextur review --no-interactive`.

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
contextur review [--base <ref>] [--focus <text>] [--paths <filters>] [--reviewers <ids>] [--no-interactive] [--dry-run]
contextur review-intake [--base <ref>] [--focus <text>] [--paths <filters>] [--reviewers <ids>]
```

Notes:

- In a TTY, `contextur review` starts an interactive intake by default (reviewers, file selection, and focus).
- In agent-driven `/contextur-review` workflows, the generated skill asks those same intake questions in the agent UI and forwards the selected values with `--reviewers`, `--paths`, and `--focus`.
- `contextur review-intake` is an intake helper: it collects reviewer/path/focus choices and prints the equivalent `contextur review --no-interactive ...` command plus a machine-readable config block.
- Use `--no-interactive` for CI/scripts or deterministic non-interactive runs.
- `--paths` scopes files by comma-separated filters (supports globs like `src/**` and simple prefixes like `src`).
- `--reviewers` sets reviewer ids explicitly (comma-separated). Mandatory reviewers are always included.
- `--dry-run` prints routing decisions and bundle stats without reviewer prompts.
- `max_file_bytes` is configurable in `.contextur/config.yaml`; large-diff bundle heuristics (preload budgets and thresholds) currently use internal defaults.

Examples:

```bash
# Interactive intake (default in terminals)
contextur review

# Non-interactive run for CI
contextur review --no-interactive --base main --paths "src/**,docs/**"

# Intake helper for agent workflows (prints runnable command)
contextur review-intake --base main

# Explicit reviewers + focused scope
contextur review --reviewers "correctness,security,performance" --paths "src/api/**" --focus "auth and permission regressions"
```

## Design

See [docs/reference/](docs/reference/) for the original research report and the Flutter reference workflow that the base templates were generalized from.

## License

MIT
