Deep-scan this repository and personalize the Contextur reviewers so code review catches repo-specific violations, not just generic ones.

## Step 1 — Ingest existing AI-friendly documentation FIRST

Before inferring anything new, read any of these files that exist. They often contain institutional knowledge the team has already written down — treat them as authoritative.

- `AGENTS.md` (any AI assistant)
- `.cursorrules`, `.cursor/rules/*.mdc` (Cursor)
- `CLAUDE.md`, `.claude/commands/*.md` (Claude Code)
- `.github/copilot-instructions.md`, `copilot-instructions.md` (Copilot)
- `.aider.conf.yml`, `.windsurfrules` (other AI editors)
- `ARCHITECTURE.md`, `CONTRIBUTING.md`, `docs/architecture/**`, `docs/**/ARCHITECTURE.md`
- `README.md` and the top-level `docs/` tree

Do not duplicate or rewrite rules that already exist in these files. Reference them by path and section heading when you cite them in the reviewer rules below.

## Step 2 — Read the code

- All package manifests: `package.json`, `pyproject.toml`, `requirements.txt`, `go.mod`, `Cargo.toml`, `pubspec.yaml`, `Gemfile`
- Top-level directory tree (1–2 levels deep)
- 5–10 representative source files across different layers (entry points, API/routes, services/domain, data access, one or two tests)

## Step 3 — Identify

- Primary languages and frameworks (with versions)
- Architectural pattern (layered, hexagonal, clean, microservices, monorepo, feature-first, etc.)
- State management (if applicable)
- API / data-access pattern (REST, GraphQL, RPC, direct ORM, repository pattern, etc.)
- Testing conventions (framework, colocation, coverage norms)
- Auth / session / authz pattern
- Third-party services (payments, analytics, feature flags, etc.)
- Naming and file-layout conventions

## Step 4 — Append repo-specific rules to each base reviewer

For **each** of these files:
- `.contextur/reviewers/core-logic.md`
- `.contextur/reviewers/security.md`
- `.contextur/reviewers/architecture.md`

Append (at the end of the file) a section like this:

```markdown
## Repo-specific rules

<!-- contextur:repo-specific-start -->
- <concrete rule>. Example: "All database queries go through `src/db/client.ts` — direct imports of `@prisma/client` outside that file are a violation."
- <concrete rule>. Every rule MUST cite a concrete path or identifier in this repo.
- <concrete rule>. If the rule is already documented elsewhere, reference the source (e.g., "See `docs/ARCHITECTURE.md §State Management`").
<!-- contextur:repo-specific-end -->
```

The `<!-- contextur:repo-specific-start -->` and `<!-- contextur:repo-specific-end -->` markers let `/project:contextur-update` find and replace this block later without touching the rest of the file.

If the section already exists (from a prior run), replace the block between the markers instead of appending a duplicate.

## Step 5 — Optionally add specialized reviewers

If the repo has a specialized area not covered by the base three reviewers, create a new reviewer. Examples:

- A Flutter app with BLoC → `.contextur/reviewers/flutter-bloc.md`
- A GraphQL schema → `.contextur/reviewers/graphql-schema.md`
- Terraform infra → `.contextur/reviewers/terraform.md`
- A specific API auth flow → `.contextur/reviewers/api-auth.md`

Use the same structure as the existing base reviewers (read one first to mirror its format). Then add a corresponding entry to `.contextur/manifest.yaml` with an appropriate `trigger` glob and `mandatory: false`:

```yaml
  - id: flutter-bloc
    path: reviewers/flutter-bloc.md
    trigger: "**/*_bloc.dart"
    mandatory: false
```

## Step 6 — Update AGENTS.md

Read the existing `AGENTS.md` first. Preserve any hand-written sections. Replace ONLY the `<!-- contextur:inferred -->` block with a concrete `## Architecture` section covering:

- Tech stack (languages, major frameworks, versions)
- Architectural pattern and directory layout
- Key conventions (naming, testing, where to find things)

## Step 7 — Summarize

At the end, tell the user:
1. Which existing AI-friendly docs you found and leveraged.
2. Which files you modified, one-line summary each.
3. Any new reviewer files you created.
4. Anything you were UNSURE about — list it so the user can decide whether to keep, refine, or delete.
