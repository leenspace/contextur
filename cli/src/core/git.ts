import { execa } from "execa";

export interface DiffExtract {
  baseRef: string;
  headSha: string;
  commitLog: string;
  diffStat: string;
  changedFiles: string[];
  unifiedDiff: string;
}

export interface GitOptions {
  cwd: string;
  fetch?: boolean;
}

export async function extractDiff(baseRef: string, opts: GitOptions): Promise<DiffExtract> {
  const { cwd } = opts;

  if (opts.fetch ?? false) {
    await run(["fetch", "origin"], cwd).catch(() => {
      // fetch is best-effort; offline users still get a review against local refs
    });
  }

  const range = `${baseRef}...HEAD`;

  const [headSha, commitLog, diffStat, nameOnly, unifiedDiff] = await Promise.all([
    run(["rev-parse", "HEAD"], cwd).then((s) => s.trim()),
    run(["log", `${baseRef}..HEAD`, "--oneline"], cwd),
    run(["diff", "--stat", range], cwd),
    run(["diff", "--name-only", range], cwd),
    run(["diff", range], cwd),
  ]);

  const changedFiles = nameOnly
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return { baseRef, headSha, commitLog, diffStat, changedFiles, unifiedDiff };
}

export async function readFileAtHead(path: string, cwd: string): Promise<string | null> {
  try {
    return await run(["show", `HEAD:${path}`], cwd);
  } catch {
    return null;
  }
}

export async function fileSize(path: string, cwd: string): Promise<number> {
  const buf = await run(["cat-file", "-s", `HEAD:${path}`], cwd).catch(() => "");
  const n = parseInt(buf.trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

async function run(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execa("git", args, { cwd, stripFinalNewline: false });
  return stdout;
}
