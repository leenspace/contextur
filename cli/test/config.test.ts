import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError, loadProject } from "../src/config/loader.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "contextur-config-"));
  await mkdir(join(root, ".contextur", "reviewers"), { recursive: true });
  await writeFile(
    join(root, ".contextur", "config.yaml"),
    `version: "1"\nbase_branch: main\n`,
  );
  await writeFile(
    join(root, ".contextur", "manifest.yaml"),
    `reviewers:\n  - id: correctness\n    path: reviewers/correctness.md\n    trigger: "**/*"\n    mandatory: true\n`,
  );
  await writeFile(
    join(root, ".contextur", "reviewers", "correctness.md"),
    "CORRECTNESS PROMPT",
  );
  await writeFile(join(root, ".contextur", "challenger.md"), "CHALLENGER");
  await writeFile(join(root, ".contextur", "synthesizer.md"), "SYNTHESIZER");
});

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("loadProject", () => {
  it("loads config, manifest, and reviewer prompts", async () => {
    const project = await loadProject(root);
    expect(project.config.base_branch).toBe("main");
    expect(project.reviewers).toHaveLength(1);
    expect(project.reviewers[0]?.entry.id).toBe("correctness");
    expect(project.reviewers[0]?.prompt).toBe("CORRECTNESS PROMPT");
    expect(project.challengerPrompt).toBe("CHALLENGER");
    expect(project.synthesizerPrompt).toBe("SYNTHESIZER");
  });

  it("walks up from subdirectory to find .contextur/", async () => {
    const sub = join(root, "deep", "nested");
    await mkdir(sub, { recursive: true });
    const project = await loadProject(sub);
    expect(project.root).toBe(root);
  });

  it("throws ConfigError when .contextur/ does not exist", async () => {
    await rm(join(root, ".contextur"), { recursive: true });
    await expect(loadProject(root)).rejects.toBeInstanceOf(ConfigError);
  });

  it("throws ConfigError with key path on bad config", async () => {
    await writeFile(
      join(root, ".contextur", "config.yaml"),
      `version: "2"\nbase_branch: main\n`,
    );
    await expect(loadProject(root)).rejects.toThrow(/version/);
  });

  it("throws ConfigError on bad reviewer id", async () => {
    await writeFile(
      join(root, ".contextur", "manifest.yaml"),
      `reviewers:\n  - id: BadID\n    path: reviewers/correctness.md\n    trigger: "**/*"\n`,
    );
    await expect(loadProject(root)).rejects.toThrow(/kebab-case/);
  });

  it("throws when reviewer prompt file is missing", async () => {
    await writeFile(
      join(root, ".contextur", "manifest.yaml"),
      `reviewers:\n  - id: missing-one\n    path: reviewers/missing.md\n    trigger: "**/*"\n`,
    );
    await expect(loadProject(root)).rejects.toThrow(/missing-one/);
  });

  it("loads legacy core-logic id by falling back to correctness prompt path", async () => {
    await writeFile(
      join(root, ".contextur", "manifest.yaml"),
      `reviewers:\n  - id: core-logic\n    path: reviewers/core-logic.md\n    trigger: "**/*"\n    mandatory: true\n`,
    );
    await writeFile(
      join(root, ".contextur", "reviewers", "correctness.md"),
      "CORRECTNESS PROMPT",
    );

    const project = await loadProject(root);
    expect(project.reviewers[0]?.entry.id).toBe("core-logic");
    expect(project.reviewers[0]?.prompt).toBe("CORRECTNESS PROMPT");
  });
});
