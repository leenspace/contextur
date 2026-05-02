import { describe, expect, it } from "vitest";
import {
  buildNonInteractiveReviewCommand,
  buildReviewRequest,
  matchesPathFilter,
  parseCsv,
  scopeFilesByPaths,
} from "../src/commands/review.js";
import type { ContextBundle } from "../src/core/context-bundle.js";

function makeBundle(): ContextBundle {
  return {
    diff: {
      baseRef: "main",
      headSha: "abc1234",
      commitLog: "feat: add feature X",
      diffStat: " src/x.ts | 3 +++",
      changedFiles: ["src/x.ts"],
      unifiedDiff: "+export const x = 1;",
    },
    large: false,
    preloaded: [{ path: "src/x.ts", bytes: 20, content: "export const x = 1;\n", truncated: false }],
    summarised: [],
    totalChars: 20,
  };
}

function makeProject(overrides?: {
  reviewers?: { id: string; prompt: string; trigger?: string; mandatory?: boolean }[];
  challengerPrompt?: string;
  synthesizerPrompt?: string;
}) {
  const reviewers = (overrides?.reviewers ?? [
    { id: "correctness", prompt: "CORRECTNESS INSTRUCTIONS", trigger: "**/*", mandatory: true },
    { id: "security", prompt: "SECURITY INSTRUCTIONS", trigger: "**/*.ts", mandatory: false },
  ]).map((r) => ({
    entry: {
      id: r.id,
      path: `reviewers/${r.id}.md`,
      trigger: r.trigger ?? "**/*",
      mandatory: r.mandatory ?? false,
    },
    prompt: r.prompt,
  }));

  return {
    root: "/fake/root",
    configPath: "/fake/root/.contextur/config.yaml",
    config: { version: "1" as const, base_branch: "main", ignored_paths: [], high_risk_patterns: [], max_file_bytes: 200_000 },
    manifest: { reviewers: reviewers.map((r) => r.entry) },
    reviewers,
    challengerPrompt: overrides?.challengerPrompt ?? "CHALLENGER INSTRUCTIONS",
    synthesizerPrompt: overrides?.synthesizerPrompt ?? "SYNTHESIZER INSTRUCTIONS",
  };
}

describe("buildReviewRequest", () => {
  it("includes date header, base ref, changed file count, reviewer names", () => {
    const project = makeProject();
    const doc = buildReviewRequest({
      project,
      triggeredReviewers: project.reviewers,
      reviewerNames: "correctness, security",
      baseRef: "main",
      headSha: "abc1234",
      changedFiles: ["src/x.ts"],
      totalChangedFiles: 1,
      pathFilters: [],
      bundle: makeBundle(),
    });

    expect(doc).toMatch(/# Contextur Review Request — \d{4}-\d{2}-\d{2}/);
    expect(doc).toContain("## Review configuration");
    expect(doc).toContain("main..HEAD (abc1234)");
    expect(doc).toContain("📄 **Selected files**: 1 / 1");
    expect(doc).toContain("correctness, security");
  });

  it("embeds all triggered reviewer prompts in Stage 1", () => {
    const project = makeProject();
    const doc = buildReviewRequest({
      project,
      triggeredReviewers: project.reviewers,
      reviewerNames: "correctness, security",
      baseRef: "main",
      headSha: "abc1234",
      changedFiles: ["src/x.ts"],
      totalChangedFiles: 1,
      pathFilters: [],
      bundle: makeBundle(),
    });

    expect(doc).toContain("## Stage 1 — Specialist reviewers");
    expect(doc).toContain("### correctness");
    expect(doc).toContain("CORRECTNESS INSTRUCTIONS");
    expect(doc).toContain("### security");
    expect(doc).toContain("SECURITY INSTRUCTIONS");
  });

  it("embeds challenger and synthesizer prompts in Stage 2 and 3", () => {
    const project = makeProject();
    const doc = buildReviewRequest({
      project,
      triggeredReviewers: project.reviewers,
      reviewerNames: "correctness, security",
      baseRef: "main",
      headSha: "abc1234",
      changedFiles: ["src/x.ts"],
      totalChangedFiles: 1,
      pathFilters: [],
      bundle: makeBundle(),
    });

    expect(doc).toContain("## Stage 2 — Challenger");
    expect(doc).toContain("CHALLENGER INSTRUCTIONS");
    expect(doc).toContain("## Stage 3 — Synthesizer");
    expect(doc).toContain("SYNTHESIZER INSTRUCTIONS");
  });

  it("includes safety-tagged context bundle", () => {
    const project = makeProject();
    const doc = buildReviewRequest({
      project,
      triggeredReviewers: project.reviewers,
      reviewerNames: "correctness, security",
      baseRef: "main",
      headSha: "abc1234",
      changedFiles: ["src/x.ts"],
      totalChangedFiles: 1,
      pathFilters: [],
      bundle: makeBundle(),
    });

    expect(doc).toContain("## Context bundle");
    expect(doc).toContain("<user_diff>");
    expect(doc).toContain('<user_file path="src/x.ts"');
    expect(doc).toContain("UNTRUSTED DATA");
  });

  it("includes focus instruction when provided", () => {
    const project = makeProject();
    const doc = buildReviewRequest({
      project,
      triggeredReviewers: project.reviewers,
      reviewerNames: "correctness",
      baseRef: "main",
      headSha: "abc1234",
      changedFiles: ["src/x.ts"],
      totalChangedFiles: 1,
      pathFilters: [],
      bundle: makeBundle(),
      focus: "check for SQL injection",
    });

    expect(doc).toContain("Focus**: check for SQL injection");
  });

  it("shows fallback message when no project is loaded", () => {
    const doc = buildReviewRequest({
      project: null,
      triggeredReviewers: null,
      reviewerNames: "correctness, security, architecture, testing, operability (built-in defaults)",
      baseRef: "main",
      headSha: "abc1234",
      changedFiles: ["src/x.ts"],
      totalChangedFiles: 1,
      pathFilters: [],
      bundle: makeBundle(),
    });

    expect(doc).toContain("contextur init");
    expect(doc).toContain("built-in defaults");
  });

  it("shows selected files list when narrowed", () => {
    const project = makeProject();
    const doc = buildReviewRequest({
      project,
      triggeredReviewers: project.reviewers,
      reviewerNames: "correctness, security",
      baseRef: "main",
      headSha: "abc1234",
      changedFiles: ["src/x.ts"],
      totalChangedFiles: 3,
      pathFilters: ["src/**"],
      bundle: makeBundle(),
    });

    expect(doc).toContain("Selected files**: 1 / 3");
    expect(doc).toContain("Path filters**: src/**");
    expect(doc).toContain("### Selected files");
    expect(doc).toContain("- [`src/x.ts`](<src/x.ts>)");
  });
});

describe("review option helpers", () => {
  it("builds a shell-quoted non-interactive review command", () => {
    const command = buildNonInteractiveReviewCommand({
      baseRef: "develop",
      reviewers: ["correctness", "security"],
      pathFilters: ["src/**", "docs"],
      focus: "auth and permission checks",
    });

    expect(command).toContain("contextur review --no-interactive");
    expect(command).toContain("--base 'develop'");
    expect(command).toContain("--reviewers 'correctness,security'");
    expect(command).toContain("--paths 'src/**,docs'");
    expect(command).toContain("--focus 'auth and permission checks'");
  });

  it("omits optional flags when using defaults", () => {
    const command = buildNonInteractiveReviewCommand({
      baseRef: "main",
      reviewers: [],
      pathFilters: [],
    });

    expect(command).toBe("contextur review --no-interactive --base 'main'");
  });

  it("parses comma-separated lists and trims empty values", () => {
    expect(parseCsv(" correctness, security ,, testing ")).toEqual([
      "correctness",
      "security",
      "testing",
    ]);
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv(undefined)).toEqual([]);
  });

  it("matches globs and path prefixes", () => {
    expect(matchesPathFilter("src/foo.ts", "src/**")).toBe(true);
    expect(matchesPathFilter("src/foo.ts", "./src")).toBe(true);
    expect(matchesPathFilter("src/foo.ts", "test")).toBe(false);
  });

  it("scopes files with mixed filters", () => {
    const files = ["src/foo.ts", "src/bar.ts", "docs/readme.md", "test/foo.test.ts"];
    expect(scopeFilesByPaths(files, ["src", "**/*.md"])).toEqual([
      "src/foo.ts",
      "src/bar.ts",
      "docs/readme.md",
    ]);
  });
});
