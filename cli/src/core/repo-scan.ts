import { readFile, stat, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface RepoSignals {
  languages: string[];
  monorepo: boolean;
  monorepoTool: string | null;
  baseBranchGuess: string;
  inferredRules: string[];
  existingContextFiles: string[];
}

const MANIFEST_LANGUAGE: Array<{ file: string; language: string }> = [
  { file: "package.json", language: "typescript/javascript" },
  { file: "pyproject.toml", language: "python" },
  { file: "requirements.txt", language: "python" },
  { file: "go.mod", language: "go" },
  { file: "Cargo.toml", language: "rust" },
  { file: "pubspec.yaml", language: "dart/flutter" },
  { file: "Gemfile", language: "ruby" },
  { file: "composer.json", language: "php" },
  { file: "pom.xml", language: "java" },
  { file: "build.gradle", language: "java/kotlin" },
  { file: "build.gradle.kts", language: "java/kotlin" },
];

const CONTEXT_FILES = [
  "README.md",
  "CONTRIBUTING.md",
  "AGENTS.md",
  ".cursorrules",
  ".github/copilot-instructions.md",
];

export async function scanRepo(cwd: string): Promise<RepoSignals> {
  const languages: string[] = [];
  for (const { file, language } of MANIFEST_LANGUAGE) {
    if (existsSync(join(cwd, file))) {
      languages.push(language);
    }
  }

  const monorepoTool = await detectMonorepo(cwd);
  const monorepo = monorepoTool !== null;

  const baseBranchGuess = "main";

  const inferredRules: string[] = [];
  const existingContextFiles: string[] = [];
  for (const rel of CONTEXT_FILES) {
    if (existsSync(join(cwd, rel))) existingContextFiles.push(rel);
  }

  if (languages.includes("typescript/javascript")) {
    const pkgPath = join(cwd, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as {
          devDependencies?: Record<string, string>;
          dependencies?: Record<string, string>;
        };
        const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
        if ("typescript" in all) inferredRules.push("TypeScript is in use — respect strict types if tsconfig.json has strict:true.");
        if ("next" in all) inferredRules.push("Next.js detected — watch for NEXT_PUBLIC_* secret leakage.");
        if ("react" in all) inferredRules.push("React detected — flag server/client component boundary mixups.");
        if ("express" in all || "fastify" in all || "hono" in all) inferredRules.push("Node web framework detected — every route handler must validate input and handle errors.");
      } catch {
        // tolerate malformed package.json
      }
    }
  }

  if (languages.includes("python")) {
    if (existsSync(join(cwd, "alembic.ini")) || existsSync(join(cwd, "migrations"))) {
      inferredRules.push("DB migrations present — flag destructive operations (DROP, NOT NULL without default).");
    }
  }

  if (monorepo) {
    inferredRules.push(
      `Monorepo (${monorepoTool}) — cross-package imports should respect declared package boundaries.`,
    );
  }

  const layers = await detectLayerConventions(cwd);
  inferredRules.push(...layers);

  return {
    languages,
    monorepo,
    monorepoTool,
    baseBranchGuess,
    inferredRules,
    existingContextFiles,
  };
}

async function detectMonorepo(cwd: string): Promise<string | null> {
  if (existsSync(join(cwd, "pnpm-workspace.yaml"))) return "pnpm";
  if (existsSync(join(cwd, "turbo.json"))) return "turborepo";
  if (existsSync(join(cwd, "nx.json"))) return "nx";
  if (existsSync(join(cwd, "lerna.json"))) return "lerna";
  if (existsSync(join(cwd, "melos.yaml"))) return "melos";
  const pkgPath = join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { workspaces?: unknown };
      if (pkg.workspaces) return "npm-workspaces";
    } catch {
      // tolerate
    }
  }
  return null;
}

async function detectLayerConventions(cwd: string): Promise<string[]> {
  const out: string[] = [];
  const dirs = await listTopLevel(cwd);
  if (dirs.includes("src")) {
    const srcDirs = await listTopLevel(join(cwd, "src"));
    for (const d of ["api", "routes", "controllers", "services", "domain", "data", "presentation"]) {
      if (srcDirs.includes(d)) {
        out.push(`src/${d}/ directory present — treat it as a layer boundary in architecture checks.`);
      }
    }
  }
  return out;
}

async function listTopLevel(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

export async function readSafe(path: string): Promise<string | null> {
  try {
    const st = await stat(path);
    if (!st.isFile() || st.size > 200_000) return null;
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}
