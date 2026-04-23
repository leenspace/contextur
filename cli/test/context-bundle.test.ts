import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBundle } from "../src/core/context-bundle.js";
import type { DiffExtract } from "../src/core/git.js";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "contextur-bundle-"));
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(join(dir, "src/small.ts"), "export const x = 1;\n");
  await writeFile(join(dir, "src/big.ts"), "x\n".repeat(100_000));
  await writeFile(join(dir, "src/api.ts"), "export function api() {}\n");
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

function fakeDiff(changed: string[], unified = ""): DiffExtract {
  return {
    baseRef: "main",
    headSha: "deadbeef",
    commitLog: "",
    diffStat: "",
    changedFiles: changed,
    unifiedDiff: unified,
  };
}

describe("buildBundle", () => {
  it("preloads small files and skips files over maxFileBytes", async () => {
    const bundle = await buildBundle(
      fakeDiff(["src/small.ts", "src/big.ts", "missing.ts"]),
      { cwd: dir, maxFileBytes: 1000 },
    );

    const paths = bundle.preloaded.map((p) => p.path);
    expect(paths).toContain("src/small.ts");
    expect(paths).not.toContain("src/big.ts");
    expect(bundle.summarised).toContain("src/big.ts");
    expect(bundle.summarised).toContain("missing.ts");
    expect(bundle.large).toBe(false);
  });

  it("marks large diffs when file count exceeds threshold", async () => {
    const many = Array.from({ length: 30 }, (_, i) => `src/small.ts`);
    const bundle = await buildBundle(fakeDiff(many), {
      cwd: dir,
      maxFileBytes: 10_000,
    });
    expect(bundle.large).toBe(true);
  });

  it("prioritises high-risk patterns first", async () => {
    const bundle = await buildBundle(
      fakeDiff(["src/small.ts", "src/api.ts"]),
      {
        cwd: dir,
        maxFileBytes: 10_000,
        highRiskPatterns: ["**/api.ts"],
      },
    );
    expect(bundle.preloaded[0]?.path).toBe("src/api.ts");
  });
});
