import { describe, expect, it } from "vitest";
import { excludeIgnored, filterFiles, matchesAny } from "../src/core/path-routing.js";

describe("path-routing", () => {
  it("filterFiles matches multiple globs", () => {
    const files = ["src/a.ts", "src/b.js", "docs/readme.md"];
    expect(filterFiles(files, ["**/*.ts", "**/*.js"]).sort()).toEqual([
      "src/a.ts",
      "src/b.js",
    ]);
  });

  it("matchesAny is true when at least one file matches", () => {
    expect(matchesAny(["a.py", "b.go"], "**/*.py")).toBe(true);
    expect(matchesAny(["a.py", "b.go"], "**/*.rs")).toBe(false);
  });

  it("excludeIgnored drops ignored globs", () => {
    const files = ["src/a.ts", "node_modules/x.js", "dist/y.js"];
    expect(excludeIgnored(files, ["node_modules/**", "dist/**"])).toEqual(["src/a.ts"]);
  });
});
