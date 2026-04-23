import micromatch from "micromatch";

export type Trigger = string | string[];

export function filterFiles(files: string[], trigger: Trigger): string[] {
  const patterns = Array.isArray(trigger) ? trigger : [trigger];
  return micromatch(files, patterns, { dot: true });
}

export function matchesAny(files: string[], trigger: Trigger): boolean {
  return filterFiles(files, trigger).length > 0;
}

export function excludeIgnored(files: string[], ignored: string[]): string[] {
  if (ignored.length === 0) return files;
  return micromatch(files, ["**/*"], { ignore: ignored, dot: true });
}
