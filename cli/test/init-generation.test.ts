import { describe, expect, it } from "vitest";
import {
  buildManifestFromSignals,
  buildRepoSnapshot,
  buildReviewerTemplateValues,
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
});
