import type { Command } from "commander";
import { buildBundle } from "../core/context-bundle.js";
import { extractDiff } from "../core/git.js";
import { excludeIgnored, filterFiles } from "../core/path-routing.js";
import { formatContext } from "../orchestration/format.js";
import { ConfigError, loadProject, type LoadedProject, type LoadedReviewer } from "../config/loader.js";

interface ReviewOptions {
  base?: string;
  focus?: string;
  paths?: string;
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

      const baseRef = opts.base ?? project?.config.base_branch ?? "main";
      const ignored = project?.config.ignored_paths ?? FALLBACK_IGNORED;
      const highRisk = project?.config.high_risk_patterns ?? FALLBACK_HIGH_RISK;
      const maxFileBytes = project?.config.max_file_bytes ?? 200_000;

      const diff = await extractDiff(baseRef, { cwd, fetch: false });
      if (diff.changedFiles.length === 0) {
        process.stdout.write(`No changes between ${baseRef} and HEAD.\n`);
        return;
      }

      const kept = excludeIgnored(diff.changedFiles, ignored);
      const scopedFiles = opts.paths
        ? kept.filter((f) =>
            opts.paths!.split(",").some((p) => f.startsWith(p.trim())),
          )
        : kept;

      const scopedDiff = { ...diff, changedFiles: scopedFiles };
      const bundle = await buildBundle(scopedDiff, {
        cwd,
        maxFileBytes,
        highRiskPatterns: highRisk,
      });

      const triggeredReviewers = project ? pickReviewers(project, scopedFiles) : null;
      const reviewerNames = triggeredReviewers
        ? triggeredReviewers.map((r) => r.entry.id).join(", ")
        : "core-logic, security, architecture (built-in defaults)";

      if (opts.dryRun) {
        process.stdout.write(
          `Base: ${diff.baseRef}\n` +
            `HEAD: ${diff.headSha}\n` +
            `Project root: ${project?.root ?? "(none — no .contextur/)"}\n` +
            `Reviewers triggered: ${reviewerNames}\n` +
            `Changed files (${diff.changedFiles.length}): ${diff.changedFiles.join(", ")}\n` +
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
        bundle,
        focus: opts.focus,
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
  bundle: import("../core/context-bundle.js").ContextBundle;
  focus?: string | undefined;
}

export function buildReviewRequest(opts: ReviewRequestOpts): string {
  const date = new Date().toISOString().slice(0, 10);
  const parts: string[] = [];

  parts.push(`# Contextur Review Request — ${date}`);
  parts.push("");
  parts.push(`**Base**: ${opts.baseRef}..HEAD (${opts.headSha})`);
  parts.push(`**Changed files**: ${opts.changedFiles.length}`);
  parts.push(`**Triggered reviewers**: ${opts.reviewerNames}`);
  if (opts.focus) {
    parts.push(`**Focus**: ${opts.focus}`);
  }
  parts.push("");
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
