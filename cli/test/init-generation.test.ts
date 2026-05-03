import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  buildManifestFromSignals,
  buildRepoSnapshot,
  buildReviewerTemplateValues,
  SHARED_SKILL_DEFINITIONS,
} from "../src/commands/init.js";
import type { RepoSignals } from "../src/core/repo-scan.js";

function makeSignals(overrides?: Partial<RepoSignals>): RepoSignals {
  return {
    languages: ["typescript/javascript", "python"],
    monorepo: true,
    monorepoTool: "pnpm",
    packageManager: "pnpm",
    workspaceGlobs: ["packages/*"],
    baseBranchGuess: "main",
    testCommands: ["npm run test"],
    lintCommands: ["npm run lint"],
    buildCommands: ["npm run build"],
    architectureDocs: ["README.md", "docs/architecture/"],
    recentHotspots: ["src/app.ts", "src/api/user.ts"],
    hasApiContracts: true,
    hasDataMigrations: true,
    hasCiConfig: true,
    topLevelDirs: ["src", "docs", "migrations"],
    inferredRules: ["Rule A", "Rule B"],
    existingContextFiles: ["README.md"],
    ...overrides,
  };
}

async function readIntegrationTemplate(name: string): Promise<string> {
  return readFile(new URL(`../../templates/base/integrations/${name}`, import.meta.url), "utf8");
}

describe("init generation helpers", () => {
  it("builds a stable repo snapshot payload", () => {
    const snapshot = buildRepoSnapshot(makeSignals(), "trunk");
    expect(snapshot.base_branch).toBe("trunk");
    expect(snapshot.monorepo.enabled).toBe(true);
    expect(snapshot.monorepo.workspace_globs).toEqual(["packages/*"]);
    expect(snapshot.capabilities.data_migrations).toBe(true);
    expect(snapshot.command_hints.test).toEqual(["npm run test"]);
  });

  it("builds template values with inferred rules bullets", () => {
    const values = buildReviewerTemplateValues(buildRepoSnapshot(makeSignals(), "main"));
    expect(values.repo_languages).toContain("typescript/javascript");
    expect(values.repo_inferred_rules_bullets).toContain("- Rule A");
    expect(values.repo_monorepo).toContain("yes");
  });

  it("adapts manifest mandatory reviewers based on capabilities", () => {
    const manifest = buildManifestFromSignals(
      makeSignals({
        languages: ["python"],
        hasApiContracts: false,
        hasDataMigrations: true,
      }),
    );
    const api = manifest.reviewers.find((r) => r.id === "api-contract");
    const migration = manifest.reviewers.find((r) => r.id === "data-migration");
    const performance = manifest.reviewers.find((r) => r.id === "performance");
    expect(api?.mandatory).toBe(false);
    expect(migration?.mandatory).toBe(true);
    expect(performance?.trigger).toEqual(["**/*.py"]);
  });

  it("defines shared skill scaffolds for cross-tool command parity", () => {
    const ids = SHARED_SKILL_DEFINITIONS.map((s) => s.id);
    expect(ids).toEqual(["contextur-init", "contextur-update", "contextur-review"]);
    expect(SHARED_SKILL_DEFINITIONS.map((s) => s.outputPath)).toEqual([
      ".agents/skills/contextur-init/SKILL.md",
      ".agents/skills/contextur-update/SKILL.md",
      ".agents/skills/contextur-review/SKILL.md",
    ]);
    expect(SHARED_SKILL_DEFINITIONS.every((s) => s.templatePath.startsWith("base/integrations/"))).toBe(
      true,
    );
  });

  it("keeps mandatory baseline reviewers enabled for backward compatibility", () => {
    const manifest = buildManifestFromSignals(makeSignals());
    expect(manifest.reviewers.find((r) => r.id === "correctness")?.mandatory).toBe(true);
    expect(manifest.reviewers.find((r) => r.id === "security")?.mandatory).toBe(true);
    expect(manifest.reviewers.find((r) => r.id === "architecture")?.mandatory).toBe(true);
    expect(manifest.reviewers.find((r) => r.id === "testing")?.mandatory).toBe(true);
    expect(manifest.reviewers.find((r) => r.id === "operability")?.mandatory).toBe(true);
  });

  it("documents the subagent-driven init protocol in every init entry point", async () => {
    const claudeCommand = await readIntegrationTemplate("claude-init-command.md");
    const sharedSkill = await readIntegrationTemplate("skill-contextur-init.md");
    const requiredSections = [
      "## Step 3 - Launch reviewer research subagents in parallel",
      "## Reviewer-question matrix",
      "### correctness",
      "### security",
      "### architecture",
      "### testing",
      "### operability",
      "## Required subagent return format",
      "## candidate_rules",
      "## do_not_infer",
    ];

    for (const section of requiredSections) {
      expect(claudeCommand).toContain(section);
      expect(sharedSkill).toContain(section);
    }
  });

  it("keeps Claude command and shared skill init protocols aligned", async () => {
    const claudeCommand = await readIntegrationTemplate("claude-init-command.md");
    const sharedSkill = await readIntegrationTemplate("skill-contextur-init.md");
    const skillBody = sharedSkill.replace(/^---\n[\s\S]*?\n---\n\n/u, "");

    expect(skillBody).toBe(claudeCommand);
  });

  it("points Cursor personalization at the shared init skill before Claude fallback", async () => {
    const cursorRule = await readIntegrationTemplate("cursor-rule.mdc");

    expect(cursorRule).toContain("Prefer `.agents/skills/contextur-init/SKILL.md`");
    expect(cursorRule).toContain("If the shared skill is missing");
    expect(cursorRule).toContain("`.claude/commands/contextur-init.md`");
  });

  it("names the shared review workflow as contextur-review", async () => {
    const reviewSkill = await readIntegrationTemplate("skill-review.md");
    expect(reviewSkill).toContain("name: contextur-review");
  });

  it("documents AskUserQuestion for Claude review intake", async () => {
    const claudeReview = await readIntegrationTemplate("claude-command.md");
    expect(claudeReview).toContain("allowed-tools: AskUserQuestion Bash Read");
    expect(claudeReview).toContain("Use `AskUserQuestion` to gather");
  });

  it("documents Codex native intake with fallback in shared review skill", async () => {
    const reviewSkill = await readIntegrationTemplate("skill-review.md");
    expect(reviewSkill).toContain("native user-input tool");
    expect(reviewSkill).toContain("plain-text intake question");
    expect(reviewSkill).toContain("Codex note:");
  });
});
