import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanRepo } from "../src/core/repo-scan.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "contextur-scan-"));
});

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("scanRepo", () => {
  it("detects typescript and react from package.json", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "x",
        dependencies: { react: "^19" },
        devDependencies: { typescript: "^5" },
      }),
    );
    const signals = await scanRepo(dir);
    expect(signals.languages).toContain("typescript/javascript");
    expect(signals.inferredRules.some((r) => r.includes("React"))).toBe(true);
    expect(signals.inferredRules.some((r) => r.includes("TypeScript"))).toBe(true);
  });

  it("detects npm workspaces monorepo", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "x", workspaces: ["cli"] }),
    );
    const signals = await scanRepo(dir);
    expect(signals.monorepo).toBe(true);
    expect(signals.monorepoTool).toBe("npm-workspaces");
  });

  it("flags src/ layer dirs", async () => {
    await mkdir(join(dir, "src", "api"), { recursive: true });
    await mkdir(join(dir, "src", "services"), { recursive: true });
    const signals = await scanRepo(dir);
    expect(signals.inferredRules.some((r) => r.includes("src/api"))).toBe(true);
    expect(signals.inferredRules.some((r) => r.includes("src/services"))).toBe(true);
  });

  it("lists existing context files", async () => {
    await writeFile(join(dir, "README.md"), "hi");
    await writeFile(join(dir, ".cursorrules"), "rules");
    const signals = await scanRepo(dir);
    expect(signals.existingContextFiles.sort()).toEqual([".cursorrules", "README.md"]);
  });
});
