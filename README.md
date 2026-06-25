# Contextur

Contextur helps you run consistent, high-signal AI code reviews in agentic development tools like Cursor, Claude Code, and Codex.

The workflow has two distinct layers:

1. **Shell CLI** (`contextur`) — scans your repo and generates reviewer prompts and AI tool integrations. No AI involved.
2. **Agent tool commands** (`/project:contextur-init`, `/project:contextur-review`, etc.) — generated into your repo by the CLI, and invoked inside your AI tool to run the actual reviews.

## Install

Status: early MVP, not yet published to npm.

For local development:

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

## Workflow

### 1) Install and scaffold (CLI only, no AI)

In the target repository, run the shell CLI to generate reviewer prompts and agent tool integrations:

```bash
# In the target project repository
contextur init
```

This is a pure CLI operation — no AI is called. It:

- Sets up `.contextur/` with editable reviewer prompts and config
- Generates `AGENTS.md` at the repo root for agent context
- Installs agent tool integrations (Claude Code slash commands, Cursor rules, shared skills)

### 2) Generate your reviewers (from your agent tool)

Once `contextur init` has run, open your AI tool in the same repo and run the init command. This is where AI is first involved — the agent reads your codebase and personalizes the reviewer prompts.

| Tool | Command |
|---|---|
| Claude Code | `/project:contextur-init` |
| Cursor | ask "initialize contextur for this repo" |
| Codex / skills | `$contextur-init` |

### 3) Review your changes (from your agent tool)

Make your code changes, then trigger a review from your agent tool:

| Tool | Command |
|---|---|
| Claude Code | `/project:contextur-review` |
| Cursor | ask "review this PR" |
| Codex / skills | `$contextur-review` |

Reviews are run by your agent tool, not the CLI.

### 4) Update when architecture or standards evolve

If your system architecture changes or you want to refresh reviewer behavior, re-run the CLI scaffold step and then re-run the agent init:

```bash
contextur init --force
```

Then run the agent init command again (`/project:contextur-init`).

## Shell CLI Reference

The CLI handles scaffolding only. It does not run reviews.

```bash
contextur init [--force] [--yes]
```

## AI Tool Commands

These are **not** shell binaries. They are files generated into your repository by `contextur init` and invoked inside your AI tool:

- **Claude Code** → `/project:contextur-init`, `/project:contextur-review`, `/project:contextur-update`
- **Cursor** → invoke by describing the action naturally in chat
- **Codex / shared skills** → `$contextur-init`, `$contextur-review`, `$contextur-update`

## Security Model

- Contextur wraps user-sourced payloads (diffs, file content, commit metadata) with safety boundaries so prompts treat them as data, not instructions.
- Contextur does not call an LLM API directly.
- Data stays local to your machine and repository; your AI IDE/agent performs reasoning.

## Reference

See [docs/reference/](docs/reference/) for deeper background and source material.

## License

MIT
