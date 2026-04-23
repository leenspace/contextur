import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execa } from "execa";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractDiff } from "../src/core/git.js";

let repo: string;

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), "contextur-git-"));
  await run(["init", "-b", "main"]);
  await run(["config", "user.email", "t@t"]);
  await run(["config", "user.name", "t"]);
  await mkdir(join(repo, "src"), { recursive: true });
  await writeFile(join(repo, "README.md"), "hello\n");
  await writeFile(join(repo, "src/a.ts"), "export const a = 1;\n");
  await run(["add", "."]);
  await run(["commit", "-m", "base"]);

  await run(["checkout", "-b", "feature"]);
  await writeFile(join(repo, "src/a.ts"), "export const a = 2;\n");
  await writeFile(join(repo, "src/b.ts"), "export const b = 3;\n");
  await run(["add", "."]);
  await run(["commit", "-m", "feat: add b and bump a"]);
});

afterAll(async () => {
  if (repo) await rm(repo, { recursive: true, force: true });
});

function run(args: string[]) {
  return execa("git", args, { cwd: repo });
}

describe("extractDiff", () => {
  it("returns changed files and unified diff against main", async () => {
    const res = await extractDiff("main", { cwd: repo });

    expect(res.changedFiles.sort()).toEqual(["src/a.ts", "src/b.ts"]);
    expect(res.unifiedDiff).toContain("+export const a = 2;");
    expect(res.unifiedDiff).toContain("+export const b = 3;");
    expect(res.commitLog).toContain("feat: add b and bump a");
    expect(res.diffStat).toContain("src/a.ts");
    expect(res.diffStat).toContain("src/b.ts");
    expect(res.headSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("returns empty arrays when there is no diff", async () => {
    const res = await extractDiff("feature", { cwd: repo });
    expect(res.changedFiles).toEqual([]);
    expect(res.unifiedDiff).toBe("");
  });
});
