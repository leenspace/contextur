# Contextur

Contextur helps you run consistent, high-signal AI code reviews in agentic development tools like Cursor, Claude Code, and Codex.

The workflow is two-layered:

1. **Shell CLI** (`contextur`) — scans your repo, generates reviewer prompts, builds context bundles, and runs reviews. Install once, use anywhere.
2. **AI tool commands** (`/project:contextur-init`, `$contextur-review`, etc.) — generated into your repo by `contextur init` so your AI tool can invoke the CLI on your behalf.

## Install

```bash
npm install -g contextur
```

Status: early MVP. Until published to npm, install from source:

```bash
git clone https://github.com/leenspace/contextur
cd contextur
npm install
npm run build -w contextur
npm link -w contextur
```

## Recommended Workflow

### 1) Initialize once

In the target repository, run the shell CLI to generate reviewer prompts and AI tool integrations:

```bash
# In the target project repository
contextur init
```

Then, inside your AI tool, run the generated agent command to personalize the reviewers for your specific codebase:

- **Claude Code:** `/project:contextur-init`
- **Cursor:** ask "initialize contextur for this repo"
- **Codex / shared skills:** `$contextur-init`

What this does:

- Sets up `.contextur/` with editable reviewer prompts and config
- Generates `AGENTS.md` at the repo root for agent context
- Installs AI tool integrations (Claude Code slash commands, Cursor rules, shared skills)
- Establishes your baseline review workflow

### 2) Review your current change

Run the interactive intake to configure and launch a review:

```bash
contextur review-intake
```

This guides you through selecting files, reviewers, and focus, then prints the exact `contextur review` command to run — or pass it directly to your AI tool:

- **Claude Code:** `/project:contextur-review`
- **Cursor:** ask "review this PR"
- **Codex / shared skills:** `$contextur-review`

For non-interactive use (CI, scripts):

```bash
contextur review --base main --no-interactive
```

### 3) Update when architecture or standards evolve

If your system architecture changes, or you want to improve reviewer behavior, run:

```bash
contextur init --force
```

Then re-run the personalize step in your AI tool (`/project:contextur-init`).

## Practical Day-to-Day Flow

```bash
# In your project repo — shell CLI only
contextur init

# ...make code changes...
git add .
git commit -m "your change"

# Run interactive review intake (prints a review command or hands off to your AI tool)
contextur review-intake

# Or run a review directly
contextur review --base main
```

Inside your AI tool (after `contextur init` has run):

| Tool | Init | Review | Update |
|---|---|---|---|
| Claude Code | `/project:contextur-init` | `/project:contextur-review` | `/project:contextur-update` |
| Cursor | "initialize contextur" | "review this PR" | "update contextur" |
| Codex / skills | `$contextur-init` | `$contextur-review` | `$contextur-update` |

## Shell CLI Reference

All shell commands are subcommands of `contextur`:

```bash
contextur init [--force] [--yes]
contextur review [--base <ref>] [--focus <text>] [--paths <filters>] [--reviewers <ids>] [--no-interactive] [--dry-run]
contextur review-intake [--base <ref>] [--focus <text>] [--paths <filters>] [--reviewers <ids>]
```

Common `contextur review` flags:

- `--base <ref>`: compare against a specific base branch
- `--no-interactive`: deterministic mode for CI/scripts
- `--paths "src/**,docs/**"`: limit review scope
- `--reviewers "correctness,security,performance"`: force reviewer selection
- `--focus "auth and permission regressions"`: set explicit review intent

`contextur review-intake` interactively collects the same options and prints the equivalent `contextur review` command, useful for handing off to an AI tool.

## AI Tool Commands

These are **not** shell binaries. They are files generated into your repository by `contextur init`:

- **Claude Code** — `.claude/commands/contextur-*.md` → invoked as `/project:contextur-review`
- **Cursor** — `.cursor/rules/contextur.mdc` → invoke by asking Cursor naturally
- **Shared skills** — `.agents/skills/contextur-*/SKILL.md` → invoked as `$contextur-review`
- **Codex / AGENTS.md** — `AGENTS.md` at the repo root → read automatically by Codex

## Security Model

- Contextur wraps user-sourced payloads (diffs, file content, commit metadata) with safety boundaries so prompts treat them as data, not instructions.
- Contextur does not call an LLM API directly.
- Data stays local to your machine and repository; your AI IDE/agent performs reasoning.

## Reference

See [docs/reference/](docs/reference/) for deeper background and source material.

## License

MIT
