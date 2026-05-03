import { readFile, stat, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execa } from "execa";

export interface RepoSignals {
  languages: string[];
  monorepo: boolean;
  monorepoTool: string | null;
  packageManager: string | null;
  workspaceGlobs: string[];
  baseBranchGuess: string;
  testCommands: string[];
  lintCommands: string[];
  buildCommands: string[];
  architectureDocs: string[];
  recentHotspots: string[];
  hasApiContracts: boolean;
  hasDataMigrations: boolean;
  hasCiConfig: boolean;
  topLevelDirs: string[];
  inferredRules: string[];
  existingContextFiles: string[];
}

interface PackageJson {
  packageManager?: string;
  workspaces?: unknown;
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
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

  const pkg = await readPackageJson(cwd);
  const monorepoTool = await detectMonorepo(cwd, pkg);
  const monorepo = monorepoTool !== null;
  const packageManager = detectPackageManager(cwd, pkg);
  const workspaceGlobs = detectWorkspaceGlobs(pkg);
  const baseBranchGuess = await detectBaseBranch(cwd);
  const topLevelDirs = await listTopLevel(cwd);
  const architectureDocs = await detectArchitectureDocs(cwd);
  const recentHotspots = await detectRecentHotspots(cwd);
  const hasApiContracts = detectApiContracts(cwd, topLevelDirs);
  const hasDataMigrations = detectDataMigrations(cwd, topLevelDirs);
  const hasCiConfig = detectCiConfig(cwd, topLevelDirs);
  const { testCommands, lintCommands, buildCommands } = detectCommandHints(cwd, languages, pkg);

  const inferredRules: string[] = [];
  const existingContextFiles: string[] = [];
  for (const rel of CONTEXT_FILES) {
    if (existsSync(join(cwd, rel))) existingContextFiles.push(rel);
  }

  if (languages.includes("typescript/javascript")) {
    if (pkg) {
      const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      if ("typescript" in all) inferredRules.push("TypeScript is in use — respect strict types if tsconfig.json has strict:true.");
      if ("next" in all) inferredRules.push("Next.js detected — watch for NEXT_PUBLIC_* secret leakage.");
      if ("react" in all) inferredRules.push("React detected — flag server/client component boundary mixups.");
      if ("express" in all || "fastify" in all || "hono" in all) inferredRules.push("Node web framework detected — every route handler must validate input and handle errors.");
    }
  }

  if (languages.includes("python") && hasDataMigrations) {
    inferredRules.push("DB migrations present — flag destructive operations (DROP, NOT NULL without default).");
  }

  if (monorepo) {
    inferredRules.push(
      `Monorepo (${monorepoTool}) — cross-package imports should respect declared package boundaries.`,
    );
  }

  if (testCommands.length > 0) {
    inferredRules.push(`Test commands discovered (${testCommands.join(" | ")}) — reviewers should ask for concrete evidence from these suites.`);
  }
  if (lintCommands.length > 0) {
    inferredRules.push(`Lint/static checks available (${lintCommands.join(" | ")}) — prefer fixes that satisfy configured checks.`);
  }
  if (architectureDocs.length > 0) {
    inferredRules.push(`Architecture docs found (${architectureDocs.join(", ")}) — treat documented boundaries as authoritative.`);
  }
  if (recentHotspots.length > 0) {
    inferredRules.push(`Recent change hotspots (${recentHotspots.join(", ")}) — watch for regressions around these areas.`);
  }

  const layers = await detectLayerConventions(cwd);
  inferredRules.push(...layers);

  return {
    languages,
    monorepo,
    monorepoTool,
    packageManager,
    workspaceGlobs,
    baseBranchGuess,
    testCommands,
    lintCommands,
    buildCommands,
    architectureDocs,
    recentHotspots,
    hasApiContracts,
    hasDataMigrations,
    hasCiConfig,
    topLevelDirs,
    inferredRules,
    existingContextFiles,
  };
}

async function detectMonorepo(cwd: string, pkg: PackageJson | null): Promise<string | null> {
  if (existsSync(join(cwd, "pnpm-workspace.yaml"))) return "pnpm";
  if (existsSync(join(cwd, "turbo.json"))) return "turborepo";
  if (existsSync(join(cwd, "nx.json"))) return "nx";
  if (existsSync(join(cwd, "lerna.json"))) return "lerna";
  if (existsSync(join(cwd, "melos.yaml"))) return "melos";
  if (pkg?.workspaces) {
    return "npm-workspaces";
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
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 20);
  } catch {
    return [];
  }
}

async function readPackageJson(cwd: string): Promise<PackageJson | null> {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return null;
  try {
    return JSON.parse(await readFile(pkgPath, "utf8")) as PackageJson;
  } catch {
    return null;
  }
}

function detectPackageManager(cwd: string, pkg: PackageJson | null): string | null {
  const raw = pkg?.packageManager?.split("@")[0]?.trim();
  if (raw && raw.length > 0) return raw;
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
  if (existsSync(join(cwd, "bun.lockb")) || existsSync(join(cwd, "bun.lock"))) return "bun";
  if (existsSync(join(cwd, "package-lock.json"))) return "npm";
  if (existsSync(join(cwd, "pubspec.yaml"))) return "pub";
  if (existsSync(join(cwd, "Cargo.toml"))) return "cargo";
  if (existsSync(join(cwd, "go.mod"))) return "go";
  if (existsSync(join(cwd, "pyproject.toml")) || existsSync(join(cwd, "requirements.txt"))) return "pip";
  return null;
}

function detectWorkspaceGlobs(pkg: PackageJson | null): string[] {
  const ws = pkg?.workspaces;
  if (!ws) return [];
  if (Array.isArray(ws)) return ws.filter((v): v is string => typeof v === "string").slice(0, 20);
  if (typeof ws === "object" && ws !== null && "packages" in ws) {
    const pkgs = (ws as { packages?: unknown }).packages;
    if (Array.isArray(pkgs)) return pkgs.filter((v): v is string => typeof v === "string").slice(0, 20);
  }
  return [];
}

function detectCommandHints(
  cwd: string,
  languages: string[],
  pkg: PackageJson | null,
): { testCommands: string[]; lintCommands: string[]; buildCommands: string[] } {
  const scripts = pkg?.scripts ?? {};
  const scriptEntries = Object.entries(scripts);
  const fromScripts = (prefixes: string[]): string[] =>
    scriptEntries
      .filter(([name]) => prefixes.some((prefix) => name === prefix || name.startsWith(`${prefix}:`)))
      .slice(0, 4)
      .map(([name]) => `npm run ${name}`);

  const testCommands = fromScripts(["test"]);
  const lintCommands = fromScripts(["lint", "typecheck", "check"]);
  const buildCommands = fromScripts(["build"]);

  if (testCommands.length === 0) {
    if (languages.includes("python")) testCommands.push("pytest");
    if (languages.includes("go")) testCommands.push("go test ./...");
    if (languages.includes("rust")) testCommands.push("cargo test");
    if (languages.includes("dart/flutter")) testCommands.push("flutter test");
  }
  if (lintCommands.length === 0) {
    if (existsSync(join(cwd, ".eslintrc")) || existsSync(join(cwd, "eslint.config.js"))) lintCommands.push("eslint .");
    if (languages.includes("python")) lintCommands.push("ruff check .");
  }
  if (buildCommands.length === 0) {
    if (languages.includes("go")) buildCommands.push("go build ./...");
    if (languages.includes("rust")) buildCommands.push("cargo build");
    if (languages.includes("dart/flutter")) buildCommands.push("flutter build <target>");
  }

  return {
    testCommands: dedupe(testCommands).slice(0, 5),
    lintCommands: dedupe(lintCommands).slice(0, 5),
    buildCommands: dedupe(buildCommands).slice(0, 5),
  };
}

async function detectArchitectureDocs(cwd: string): Promise<string[]> {
  const out: string[] = [];
  for (const candidate of ["ARCHITECTURE.md", "CONTRIBUTING.md", "README.md"]) {
    if (existsSync(join(cwd, candidate))) out.push(candidate);
  }
  if (existsSync(join(cwd, "docs", "architecture"))) out.push("docs/architecture/");
  if (existsSync(join(cwd, "docs"))) {
    const docsSubdirs = await listTopLevel(join(cwd, "docs"));
    for (const sub of docsSubdirs) {
      if (sub.toLowerCase().includes("arch")) {
        out.push(`docs/${sub}/`);
      }
      if (existsSync(join(cwd, "docs", sub, "ARCHITECTURE.md"))) {
        out.push(`docs/${sub}/ARCHITECTURE.md`);
      }
    }
  }
  return dedupe(out).slice(0, 12);
}

function detectApiContracts(cwd: string, topLevelDirs: string[]): boolean {
  const files = [
    "openapi.yaml",
    "openapi.yml",
    "openapi.json",
    "schema.graphql",
    "schema.gql",
    "buf.yaml",
  ];
  return files.some((f) => existsSync(join(cwd, f))) || topLevelDirs.includes("schema") || topLevelDirs.includes("contracts") || topLevelDirs.includes("proto");
}

function detectDataMigrations(cwd: string, topLevelDirs: string[]): boolean {
  return (
    existsSync(join(cwd, "alembic.ini")) ||
    existsSync(join(cwd, "schema.prisma")) ||
    existsSync(join(cwd, "prisma", "migrations")) ||
    topLevelDirs.includes("migrations") ||
    topLevelDirs.includes("migration") ||
    topLevelDirs.includes("database") ||
    topLevelDirs.includes("db")
  );
}

function detectCiConfig(cwd: string, topLevelDirs: string[]): boolean {
  return (
    existsSync(join(cwd, ".github", "workflows")) ||
    existsSync(join(cwd, ".gitlab-ci.yml")) ||
    existsSync(join(cwd, "Jenkinsfile")) ||
    existsSync(join(cwd, ".circleci")) ||
    existsSync(join(cwd, "Dockerfile")) ||
    topLevelDirs.includes("helm") ||
    topLevelDirs.includes("k8s")
  );
}

async function detectBaseBranch(cwd: string): Promise<string> {
  const remoteHead = await runGitCommand(cwd, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], 1200);
  if (remoteHead) {
    const match = remoteHead.trim().match(/^origin\/(.+)$/u);
    if (match?.[1]) return match[1];
  }
  const currentBranch = await runGitCommand(cwd, ["branch", "--show-current"], 900);
  if (currentBranch?.trim()) return currentBranch.trim();
  return "main";
}

async function detectRecentHotspots(cwd: string): Promise<string[]> {
  const raw = await runGitCommand(cwd, ["log", "--name-only", "--pretty=format:", "-n", "80"], 1500);
  if (!raw) return [];

  const counts = new Map<string, number>();
  for (const line of raw.split("\n")) {
    const file = line.trim();
    if (!file) continue;
    counts.set(file, (counts.get(file) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([file]) => file);
}

async function runGitCommand(cwd: string, args: string[], timeoutMs: number): Promise<string | null> {
  try {
    const { stdout } = await execa("git", args, {
      cwd,
      timeout: timeoutMs,
      stripFinalNewline: false,
      stdio: "pipe",
    });
    return stdout;
  } catch {
    return null;
  }
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
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
