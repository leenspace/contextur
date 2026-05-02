import type { Command } from "commander";
import { checkbox, input } from "@inquirer/prompts";
import micromatch from "micromatch";
import { buildBundle } from "../core/context-bundle.js";
import { extractDiff } from "../core/git.js";
import { excludeIgnored, filterFiles } from "../core/path-routing.js";
import { formatContext } from "../orchestration/format.js";
import { ConfigError, loadProject, type LoadedProject, type LoadedReviewer } from "../config/loader.js";

interface ReviewOptions {
  base?: string;
  focus?: string;
  paths?: string;
  reviewers?: string;
  interactive: boolean;
  dryRun: boolean;
}

const FALLBACK_IGNORED = [
  "node_modules/**",
  "dist/**",
  "build/**",
  "**/*.lock",
  "**/*.min.js",
  "**/generated/**",
];

const FALLBACK_HIGH_RISK = [
  "**/api/**",
  "**/routes/**",
  "**/controllers/**",
  "**/migrations/**",
  "**/schemas/**",
  "**/auth/**",
];

export function registerReviewCommand(program: Command): void {
  program
    .command("review")
    .description(
      "Prepare a structured review request from the current branch's diff and print it to stdout.",
    )
    .option("--base <ref>", "Git ref to diff against (overrides config)")
    .option("--focus <text>", "Free-form focus instruction included in the review request")
    .option("--paths <globs>", "Comma-separated path globs to scope the diff")
    .option("--reviewers <ids>", "Comma-separated reviewer ids to run")
    .option("--no-interactive", "Disable interactive intake prompts in TTY")
    .option(
      "--dry-run",
      "Print routing decisions and bundle summary only — no reviewer prompts",
      false,
    )
    .action(async (opts: ReviewOptions) => {
      const cwd = process.cwd();

      let project: LoadedProject | null = null;
      try {
        project = await loadProject(cwd);
      } catch (err) {
        if (!(err instanceof ConfigError)) throw err;
        process.stderr.write(
          `[contextur] ${err.message}\n[contextur] Falling back to built-in defaults.\n`,
        );
      }

      const interactive =
        opts.interactive && !opts.dryRun && process.stdin.isTTY && process.stdout.isTTY;
      const defaultBaseRef = project?.config.base_branch ?? "main";
      const baseRef = opts.base
        ? opts.base
        : interactive
          ? (await input({
              message: "Base branch for this review",
              default: defaultBaseRef,
            })).trim() || defaultBaseRef
          : defaultBaseRef;
      const ignored = project?.config.ignored_paths ?? FALLBACK_IGNORED;
      const highRisk = project?.config.high_risk_patterns ?? FALLBACK_HIGH_RISK;
      const maxFileBytes = project?.config.max_file_bytes ?? 200_000;

      const diff = await extractDiff(baseRef, { cwd, fetch: false });
      if (diff.changedFiles.length === 0) {
        process.stdout.write(`No changes between ${baseRef} and HEAD.\n`);
        return;
      }

      const kept = excludeIgnored(diff.changedFiles, ignored);
      const pathFilters = opts.paths
        ? parseCsv(opts.paths)
        : interactive
          ? parseCsv(
              await input({
                message:
                  "Optional file scope (comma-separated globs or path prefixes, leave empty for all)",
                default: "",
              }),
            )
          : [];
      const scopedFilesInitial = scopeFilesByPaths(kept, pathFilters);
      const scopedFiles =
        interactive && !opts.paths && scopedFilesInitial.length > 0
          ? await pickFilesInteractively(scopedFilesInitial)
          : scopedFilesInitial;

      if (scopedFiles.length === 0) {
        process.stdout.write("No files remain after applying ignore/scope filters.\n");
        return;
      }

      const scopedDiff = { ...diff, changedFiles: scopedFiles };
      const bundle = await buildBundle(scopedDiff, {
        cwd,
        maxFileBytes,
        highRiskPatterns: highRisk,
      });

      const reviewerFilter = parseCsv(opts.reviewers);
      const triggeredReviewers = project
        ? await resolveReviewers({
            project,
            files: scopedFiles,
            reviewerFilter,
            interactive,
          })
        : null;
      const focus = opts.focus
        ? opts.focus
        : interactive
          ? (await input({
              message: "Optional review focus (leave empty for general review)",
              default: "",
            })).trim() || undefined
          : undefined;

      const reviewerNames = triggeredReviewers
        ? triggeredReviewers.map((r) => r.entry.id).join(", ")
        : "correctness, security, architecture, testing, operability (built-in defaults)";

      if (opts.dryRun) {
        process.stdout.write(
          `Base: ${diff.baseRef}\n` +
            `HEAD: ${diff.headSha}\n` +
            `Project root: ${project?.root ?? "(none — no .contextur/)"}\n` +
            `Reviewers triggered: ${reviewerNames}\n` +
            `Changed files (${diff.changedFiles.length}): ${diff.changedFiles.join(", ")}\n` +
            `Path filters: ${pathFilters.length > 0 ? pathFilters.join(", ") : "(none)"}\n` +
            `After ignore+scope (${scopedFiles.length}): ${scopedFiles.join(", ")}\n` +
            `Large diff: ${bundle.large}\n` +
            `Preloaded: ${bundle.preloaded.length} files (${bundle.totalChars} chars)\n` +
            `Summarised (diff-hunks-only): ${bundle.summarised.length}\n`,
        );
        return;
      }

      const doc = buildReviewRequest({
        project,
        triggeredReviewers,
        reviewerNames,
        baseRef,
        headSha: diff.headSha,
        changedFiles: scopedFiles,
        totalChangedFiles: kept.length,
        pathFilters,
        bundle,
        focus,
      });

      process.stdout.write(doc + "\n");
    });
}

interface ReviewRequestOpts {
  project: LoadedProject | null;
  triggeredReviewers: LoadedReviewer[] | null;
  reviewerNames: string;
  baseRef: string;
  headSha: string;
  changedFiles: string[];
  totalChangedFiles: number;
  pathFilters: string[];
  bundle: import("../core/context-bundle.js").ContextBundle;
  focus?: string | undefined;
}

export function buildReviewRequest(opts: ReviewRequestOpts): string {
  const date = new Date().toISOString().slice(0, 10);
  const parts: string[] = [];

  parts.push(`# Contextur Review Request — ${date}`);
  parts.push("");
  parts.push("## Review configuration");
  parts.push("");
  parts.push(`- 🧭 **Base**: ${opts.baseRef}..HEAD (${opts.headSha})`);
  parts.push(`- 📄 **Selected files**: ${opts.changedFiles.length} / ${opts.totalChangedFiles}`);
  parts.push(`- 🧑‍⚖️ **Selected reviewers**: ${opts.reviewerNames}`);
  if (opts.pathFilters.length > 0) {
    parts.push(`- 🔎 **Path filters**: ${opts.pathFilters.join(", ")}`);
  }
  if (opts.focus) {
    parts.push(`- 🎯 **Focus**: ${opts.focus}`);
  }
  parts.push("");
  if (opts.changedFiles.length < opts.totalChangedFiles && opts.changedFiles.length <= 30) {
    parts.push("### Selected files");
    parts.push("");
    for (const file of opts.changedFiles) {
      parts.push(`- ${markdownFileLink(file)}`);
    }
    parts.push("");
  }
  parts.push("---");
  parts.push("");
  parts.push("## How to use this document");
  parts.push("");
  parts.push(
    "You are an AI code reviewer. Read the reviewer instructions below, then follow the " +
      "3-stage pipeline against the context bundle at the bottom of this file.\n" +
      "Complete Stage 1 for all triggered reviewers before proceeding to Stage 2.",
  );
  parts.push("");
  parts.push("---");
  parts.push("");
  parts.push("## Stage 1 — Specialist reviewers");
  parts.push("");
  parts.push(
    "Run each reviewer independently against the context bundle. " +
      "Each reviewer should produce its own findings block.",
  );
  parts.push("");

  if (opts.triggeredReviewers && opts.triggeredReviewers.length > 0) {
    for (const r of opts.triggeredReviewers) {
      parts.push(`### ${r.entry.id}`);
      parts.push("");
      parts.push(r.prompt.trim());
      parts.push("");
    }
  } else {
    parts.push(
      "_No `.contextur/` found. Run `contextur init` to generate editable reviewer prompts._",
    );
    parts.push("");
  }

  parts.push("---");
  parts.push("");
  parts.push("## Stage 2 — Challenger");
  parts.push("");
  if (opts.project?.challengerPrompt) {
    parts.push(opts.project.challengerPrompt.trim());
  } else {
    parts.push(
      "_No challenger prompt found. Run `contextur init` to generate `.contextur/challenger.md`._",
    );
  }
  parts.push("");
  parts.push("---");
  parts.push("");
  parts.push("## Stage 3 — Synthesizer");
  parts.push("");
  if (opts.project?.synthesizerPrompt) {
    parts.push(opts.project.synthesizerPrompt.trim());
  } else {
    parts.push(
      "_No synthesizer prompt found. Run `contextur init` to generate `.contextur/synthesizer.md`._",
    );
  }
  parts.push("");
  parts.push("---");
  parts.push("");
  parts.push("## Context bundle");
  parts.push("");
  parts.push(formatContext(opts.bundle, opts.focus));

  return parts.join("\n");
}

function pickReviewers(project: LoadedProject, scopedFiles: string[]): LoadedReviewer[] {
  return project.reviewers.filter((r) => {
    if (r.entry.mandatory) return true;
    return filterFiles(scopedFiles, r.entry.trigger).length > 0;
  });
}

export function parseCsv(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function scopeFilesByPaths(files: string[], filters: string[]): string[] {
  if (filters.length === 0) return files;
  return files.filter((file) => filters.some((filter) => matchesPathFilter(file, filter)));
}

export function matchesPathFilter(file: string, filter: string): boolean {
  const normalized = filter.replace(/^[./]+/, "").trim();
  if (!normalized) return false;
  if (hasGlobMagic(normalized)) {
    return micromatch.isMatch(file, normalized, { dot: true });
  }
  return file === normalized || file.startsWith(`${normalized}/`);
}

function hasGlobMagic(value: string): boolean {
  return /[*?[\]{}()!+@]/.test(value);
}

function markdownFileLink(path: string): string {
  const label = path.replace(/`/g, "\\`");
  const target = encodeURI(path).replace(/>/g, "%3E");
  return `[\`${label}\`](<${target}>)`;
}

interface ResolveReviewersOpts {
  project: LoadedProject;
  files: string[];
  reviewerFilter: string[];
  interactive: boolean;
}

async function resolveReviewers(opts: ResolveReviewersOpts): Promise<LoadedReviewer[]> {
  const all = opts.project.reviewers;
  const reviewerIds = new Set(all.map((r) => r.entry.id));
  const mandatoryIds = new Set(all.filter((r) => r.entry.mandatory).map((r) => r.entry.id));
  const autoSelected = pickReviewers(opts.project, opts.files);
  const autoIds = new Set(autoSelected.map((r) => r.entry.id));

  if (opts.reviewerFilter.length > 0) {
    const requested = new Set<string>([...opts.reviewerFilter, ...mandatoryIds]);
    const unknown = [...requested].filter((id) => !reviewerIds.has(id));
    if (unknown.length > 0) {
      throw new Error(`Unknown reviewer ids: ${unknown.join(", ")}`);
    }
    return all.filter((reviewer) => requested.has(reviewer.entry.id));
  }

  if (!opts.interactive) return autoSelected;

  const selectedIds = await checkbox<string>({
    message: "Select reviewers to run for this review",
    choices: all.map((reviewer) => {
      const id = reviewer.entry.id;
      return {
        name: reviewer.entry.mandatory ? `${id} (mandatory)` : id,
        value: id,
        checked: autoIds.has(id),
        disabled: reviewer.entry.mandatory ? "required" : false,
      };
    }),
    validate: (values) => (values.length > 0 ? true : "Select at least one reviewer."),
  });
  const selectedSet = new Set(selectedIds);
  return all.filter((reviewer) => selectedSet.has(reviewer.entry.id));
}

async function pickFilesInteractively(files: string[]): Promise<string[]> {
  if (files.length > 80) {
    return files;
  }
  const selected = await checkbox<string>({
    message: "Select files to include in this review",
    choices: files.map((path) => ({ name: path, value: path, checked: true })),
    validate: (values) => (values.length > 0 ? true : "Select at least one file."),
  });
  return selected;
}
