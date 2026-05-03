# Contextur

Contextur helps you run consistent, high-signal AI code reviews in agentic development tools like Cursor, Claude, and Codex.

The recommended usage is command-driven:

1. Run `contextur-init` once per repository.
2. Run `contextur-review` whenever you want a review of your current branch changes.
3. Run `contextur-update` when your architecture, workflows, or review standards change.

Contextur prepares the right review context from your repository and guides the review flow through structured prompts.

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

## Recommended Workflow

Use this sequence for reliable reviews:

### 1) Initialize once (required)

Run the initializer in your target repository before doing reviews:

```bash
contextur-init
```

What this does:

- Sets up Contextur files and prompts in the repository
- Establishes your baseline review workflow
- Prepares agent tools to run review/update commands consistently

### 2) Review your current change

When you have a branch or commit to review, run:

```bash
contextur-review
```

The command is interactive and asks follow-up questions (for example, focus areas, reviewer mix, or scope). Then it runs the review pipeline against your changes and produces a structured review request/output for your agent workflow.

### 3) Update when architecture or standards evolve

If your system architecture changes, or you want to improve reviewer behavior/prompts, run:

```bash
contextur-update
```

Use this after major design shifts, new domain rules, or process changes so future reviews stay aligned with how your project actually works.

## Practical Day-to-Day Flow

```bash
# In your project repo
contextur-init

# ...make code changes...
git add .
git commit -m "your change"

# Run interactive review intake
contextur-review

# Later, when architecture/review logic changes
contextur-update
```

## Command Reference

Primary agent-facing commands:

```bash
contextur-init
contextur-review
contextur-update
```

CLI equivalents (for scripting/manual usage):

```bash
contextur init [--force] [--yes]
contextur review [--base <ref>] [--focus <text>] [--paths <filters>] [--reviewers <ids>] [--no-interactive] [--dry-run]
```

Common `contextur review` flags:

- `--base <ref>`: compare against a specific base branch
- `--no-interactive`: deterministic mode for CI/scripts
- `--paths "src/**,docs/**"`: limit review scope
- `--reviewers "correctness,security,performance"`: force reviewer selection
- `--focus "auth and permission regressions"`: set explicit review intent

## Cursor / Claude / Codex

Contextur is designed to work across major agentic development apps.

- Start with `contextur-init` in the repository.
- Use `contextur-review` as your default review entry point.
- Use `contextur-update` whenever your architecture or review expectations change.

Exact invocation UI differs by tool, but the workflow remains the same.

## Security Model

- Contextur wraps user-sourced payloads (diffs, file content, commit metadata) with safety boundaries so prompts treat them as data, not instructions.
- Contextur does not call an LLM API directly.
- Data stays local to your machine and repository; your AI IDE/agent performs reasoning.

## Reference

See [docs/reference/](docs/reference/) for deeper background and source material.

## License

MIT
