import { readFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import {
  configSchema,
  manifestSchema,
  type Config,
  type Manifest,
  type ReviewerEntry,
} from "./schema.js";

export interface LoadedReviewer {
  entry: ReviewerEntry;
  prompt: string;
}

export interface LoadedProject {
  root: string;
  configPath: string;
  config: Config;
  manifest: Manifest;
  reviewers: LoadedReviewer[];
  challengerPrompt: string;
  synthesizerPrompt: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const LEGACY_REVIEWER_PATH_FALLBACKS: Record<string, string[]> = {
  correctness: ["reviewers/core-logic.md"],
  "core-logic": ["reviewers/correctness.md"],
};

export async function loadProject(cwd: string): Promise<LoadedProject> {
  const root = findConfigRoot(cwd);
  if (!root) {
    throw new ConfigError(
      ".contextur/ not found. Run `contextur init` to create it, or cd into a directory that has one.",
    );
  }

  const configPath = join(root, ".contextur", "config.yaml");
  const manifestPath = join(root, ".contextur", "manifest.yaml");

  const config = await parseFile(configPath, configSchema);
  const manifest = await parseFile(manifestPath, manifestSchema);

  const reviewers: LoadedReviewer[] = [];
  for (const entry of manifest.reviewers) {
    const promptPathCandidates = [
      resolve(root, ".contextur", entry.path),
      ...(LEGACY_REVIEWER_PATH_FALLBACKS[entry.id] ?? []).map((fallbackPath) =>
        resolve(root, ".contextur", fallbackPath),
      ),
    ];
    const prompt = await readFirstReadableFile(promptPathCandidates);
    if (prompt === null) {
      throw new ConfigError(
        `Reviewer prompt not found for "${entry.id}": ${promptPathCandidates[0]}`,
      );
    }
    reviewers.push({ entry, prompt });
  }

  const challengerPath = join(root, ".contextur", "challenger.md");
  const synthesizerPath = join(root, ".contextur", "synthesizer.md");

  const [challengerPrompt, synthesizerPrompt] = await Promise.all([
    readFile(challengerPath, "utf8").catch(() => null),
    readFile(synthesizerPath, "utf8").catch(() => null),
  ]);

  if (!challengerPrompt) {
    throw new ConfigError(`challenger.md not found at ${challengerPath}`);
  }
  if (!synthesizerPrompt) {
    throw new ConfigError(`synthesizer.md not found at ${synthesizerPath}`);
  }

  return {
    root,
    configPath,
    config,
    manifest,
    reviewers,
    challengerPrompt,
    synthesizerPrompt,
  };
}

async function parseFile<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
): Promise<z.output<S>> {
  const raw = await readFile(path, "utf8").catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") {
      throw new ConfigError(`Missing config file: ${path}`);
    }
    throw err;
  });

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new ConfigError(
      `Invalid YAML at ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new ConfigError(`Invalid config at ${path}:\n${issues}`);
  }
  return result.data;
}

async function readFirstReadableFile(paths: string[]): Promise<string | null> {
  for (const path of paths) {
    const content = await readFile(path, "utf8").catch(() => null);
    if (content !== null) return content;
  }
  return null;
}

function findConfigRoot(start: string): string | null {
  let dir = resolve(start);
  while (true) {
    if (existsSync(join(dir, ".contextur", "config.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
