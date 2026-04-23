import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import micromatch from "micromatch";
import type { DiffExtract } from "./git.js";

export interface BundleOptions {
  cwd: string;
  maxFileBytes: number;
  largeDiffFileThreshold?: number;
  largeDiffLineThreshold?: number;
  preloadFileBudget?: number;
  preloadCharBudget?: number;
  highRiskPatterns?: string[];
}

export interface FileContent {
  path: string;
  bytes: number;
  content: string;
  truncated: boolean;
}

export interface ContextBundle {
  diff: DiffExtract;
  large: boolean;
  preloaded: FileContent[];
  summarised: string[];
  totalChars: number;
}

const DEFAULTS = {
  largeDiffFileThreshold: 25,
  largeDiffLineThreshold: 3500,
  preloadFileBudget: 60,
  preloadCharBudget: 200_000,
};

export async function buildBundle(
  diff: DiffExtract,
  opts: BundleOptions,
): Promise<ContextBundle> {
  const fileThreshold = opts.largeDiffFileThreshold ?? DEFAULTS.largeDiffFileThreshold;
  const lineThreshold = opts.largeDiffLineThreshold ?? DEFAULTS.largeDiffLineThreshold;
  const fileBudget = opts.preloadFileBudget ?? DEFAULTS.preloadFileBudget;
  const charBudget = opts.preloadCharBudget ?? DEFAULTS.preloadCharBudget;

  const diffLines = diff.unifiedDiff.split("\n").length;
  const large =
    diff.changedFiles.length > fileThreshold || diffLines > lineThreshold;

  const ordered = prioritise(diff.changedFiles, opts.highRiskPatterns ?? []);

  const preloaded: FileContent[] = [];
  const summarised: string[] = [];
  let totalChars = 0;

  for (const rel of ordered) {
    if (large && (preloaded.length >= fileBudget || totalChars >= charBudget)) {
      summarised.push(rel);
      continue;
    }

    const loaded = await loadFile(rel, opts.cwd, opts.maxFileBytes);
    if (!loaded || loaded.truncated) {
      summarised.push(rel);
      continue;
    }

    if (large && totalChars + loaded.content.length > charBudget) {
      summarised.push(rel);
      continue;
    }

    preloaded.push(loaded);
    totalChars += loaded.content.length;
  }

  return { diff, large, preloaded, summarised, totalChars };
}

async function loadFile(
  rel: string,
  cwd: string,
  maxBytes: number,
): Promise<FileContent | null> {
  try {
    const full = join(cwd, rel);
    const st = await stat(full);
    if (!st.isFile()) return null;
    const truncated = st.size > maxBytes;
    if (truncated) {
      return { path: rel, bytes: st.size, content: "", truncated: true };
    }
    const content = await readFile(full, "utf8");
    return { path: rel, bytes: st.size, content, truncated: false };
  } catch {
    // file may have been deleted in the diff
    return null;
  }
}

function prioritise(files: string[], highRiskPatterns: string[]): string[] {
  if (highRiskPatterns.length === 0) return files;
  const highSet = new Set(micromatch(files, highRiskPatterns, { dot: true }));
  const rest = files.filter((f) => !highSet.has(f));
  const high = files.filter((f) => highSet.has(f));
  return [...high, ...rest];
}
