import type { Command } from "commander";
import { checkbox, input, select } from "@inquirer/prompts";
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

interface ReviewIntakeOptions {
  base?: string;
  focus?: string;
  paths?: string;
  reviewers?: string;
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

const FOCUS_CHOICES = [
  { value: "no_focus", label: "No specific focus; full review" },
  { value: "correctness", label: "Correctness, regressions, and edge cases" },
  { value: "architecture", label: "Architecture and layer boundaries" },
  { value: "security", label: "Security and privacy risks" },
  { value: "performance", label: "Performance and memory" },
  { value: "testing", label: "Test coverage gaps" },
  { value: "maintainability", label: "Refactor opportunities and technical debt" },
  { value: "custom", label: "Custom focus text" },
] as const;

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

  program
    .command("review-intake")
    .description(
      "Collect review intake configuration and print the equivalent non-interactive contextur review command.",
    )
    .option("--base <ref>", "Git ref to diff against (overrides config)")
    .option("--focus <text>", "Free-form focus instruction included in the generated review command")
    .option(
      "--paths <filters>",
      "Comma-separated path globs/prefixes to pre-scope or override selected files",
    )
    .option("--reviewers <ids>", "Comma-separated reviewer ids to preselect or override")
    .action(async (opts: ReviewIntakeOptions) => {
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

      const interactive = process.stdin.isTTY && process.stdout.isTTY;
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
      const diff = await extractDiff(baseRef, { cwd, fetch: false });
      if (diff.changedFiles.length === 0) {
        process.stdout.write(`No changes between ${baseRef} and HEAD.\n`);
        return;
      }

      const kept = excludeIgnored(diff.changedFiles, ignored);
      if (kept.length === 0) {
        process.stdout.write("No files remain after ignore filters.\n");
        return;
      }

      const pathOverride = parseCsv(opts.paths);
      const scopedFromOverride =
        pathOverride.length > 0 ? scopeFilesByPaths(kept, pathOverride) : kept;
      if (scopedFromOverride.length === 0) {
        process.stdout.write("No files remain after applying provided --paths filters.\n");
        return;
      }

      const selectedPaths =
        pathOverride.length > 0
          ? pathOverride
          : interactive
            ? await selectPathsInteractively(scopedFromOverride)
            : [];

      const scopedFiles =
        selectedPaths.length > 0 ? scopeFilesByPaths(scopedFromOverride, selectedPaths) : scopedFromOverride;
      if (scopedFiles.length === 0) {
        process.stdout.write("No files remain after interactive path selection.\n");
        return;
      }

      const selectedReviewers = await selectReviewersForIntake({
        project,
        files: scopedFiles,
        override: parseCsv(opts.reviewers),
        interactive,
      });

      const focus = opts.focus
        ? opts.focus
        : interactive
          ? await selectFocusInteractively()
          : undefined;

      const command = buildNonInteractiveReviewCommand({
        baseRef,
        reviewers: selectedReviewers,
        pathFilters: selectedPaths,
        focus,
      });

      const reviewerLine =
        selectedReviewers.length > 0
          ? selectedReviewers.join(", ")
          : "built-in defaults (no .contextur/ manifest)";
      const pathLine = selectedPaths.length > 0 ? selectedPaths.join(", ") : "all";

      process.stdout.write(
        [
          `Base: ${baseRef}`,
          `Selected reviewers: ${reviewerLine}`,
          `Selected paths: ${pathLine}`,
          `Focus: ${focus ?? "(none)"}`,
          "",
          "Run this command:",
          command,
          "",
          "=== CONTEXTUR_REVIEW_INTAKE ===",
          `BASE: ${baseRef}`,
          `REVIEWERS: ${selectedReviewers.length > 0 ? selectedReviewers.join(",") : "default"}`,
          `PATHS: ${selectedPaths.length > 0 ? selectedPaths.join(",") : "all"}`,
          `FOCUS: ${focus ?? "none"}`,
          `COMMAND: ${command}`,
          "=== END_CONTEXTUR_REVIEW_INTAKE ===",
          "",
        ].join("\n"),
      );
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

export function buildNonInteractiveReviewCommand(opts: {
  baseRef: string;
  reviewers: string[];
  pathFilters: string[];
  focus?: string | undefined;
}): string {
  const args = ["contextur", "review", "--no-interactive", "--base", shellQuote(opts.baseRef)];
  if (opts.reviewers.length > 0) {
    args.push("--reviewers", shellQuote(opts.reviewers.join(",")));
  }
  if (opts.pathFilters.length > 0) {
    args.push("--paths", shellQuote(opts.pathFilters.join(",")));
  }
  if (opts.focus) {
    args.push("--focus", shellQuote(opts.focus));
  }
  return args.join(" ");
}

interface SelectReviewersForIntakeOpts {
  project: LoadedProject | null;
  files: string[];
  override: string[];
  interactive: boolean;
}

async function selectReviewersForIntake(opts: SelectReviewersForIntakeOpts): Promise<string[]> {
  if (!opts.project) return [];
  const all = opts.project.reviewers;
  const mandatory = all.filter((r) => r.entry.mandatory).map((r) => r.entry.id);
  const optional = all.filter((r) => !r.entry.mandatory);
  const autoOptional = pickReviewers(opts.project, opts.files)
    .filter((r) => !r.entry.mandatory)
    .map((r) => r.entry.id);

  if (opts.override.length > 0) {
    const known = new Set(all.map((r) => r.entry.id));
    const requested = new Set([...mandatory, ...opts.override]);
    const unknown = [...requested].filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new Error(`Unknown reviewer ids: ${unknown.join(", ")}`);
    }
    return [...requested];
  }

  if (!opts.interactive || optional.length === 0) {
    return [...new Set([...mandatory, ...autoOptional])];
  }

  const selectedOptional = await checkbox<string>({
    message: "Select optional reviewers to include",
    choices: optional.map((reviewer) => ({
      name: reviewer.entry.id,
      value: reviewer.entry.id,
      checked: autoOptional.includes(reviewer.entry.id),
    })),
  });
  return [...new Set([...mandatory, ...selectedOptional])];
}

async function selectPathsInteractively(files: string[]): Promise<string[]> {
  if (files.length <= 30) {
    const selectedFiles = await checkbox<string>({
      message: "Select files to include in this review intake",
      choices: files.map((path) => ({ name: path, value: path, checked: true })),
      validate: (values) => (values.length > 0 ? true : "Select at least one file."),
    });
    return selectedFiles.length === files.length ? [] : selectedFiles;
  }
  const groups = groupPaths(files);
  const selectedGroups = await checkbox<string>({
    message: "Select path groups to include in this review intake",
    choices: groups.map((group) => ({
      name: `${group.prefix} (${group.count} files)`,
      value: group.prefix,
      checked: true,
    })),
    validate: (values) => (values.length > 0 ? true : "Select at least one path group."),
  });
  return selectedGroups.length === groups.length ? [] : selectedGroups;
}

function groupPaths(files: string[]): Array<{ prefix: string; count: number }> {
  const map = new Map<string, number>();
  for (const file of files) {
    const prefix = preferredPathPrefix(file);
    map.set(prefix, (map.get(prefix) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([prefix, count]) => ({ prefix, count }))
    .sort((a, b) => a.prefix.localeCompare(b.prefix));
}

function preferredPathPrefix(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return path;
  if (parts[0] === ".github") return ".github";
  if (
    (parts[0] === "packages" || parts[0] === "apps" || parts[0] === "src") &&
    parts.length >= 2
  ) {
    return `${parts[0]}/${parts[1]}`;
  }
  return parts[0] ?? path;
}

async function selectFocusInteractively(): Promise<string | undefined> {
  const focusChoice = await select<string>({
    message: "Select review focus",
    choices: FOCUS_CHOICES.map((choice) => ({ name: choice.label, value: choice.value })),
    default: "no_focus",
  });
  if (focusChoice === "no_focus") return undefined;
  if (focusChoice === "custom") {
    const custom = (
      await input({
        message: "Enter custom focus text",
        default: "",
      })
    ).trim();
    return custom || undefined;
  }
  return FOCUS_CHOICES.find((choice) => choice.value === focusChoice)?.label;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
