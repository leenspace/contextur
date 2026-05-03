import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

export function templatesRoot(): string {
  // When installed from npm, dist/ sits next to templates/.
  // When running from source (tsx), __dirname points to cli/src/core.
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "..", "..", "templates"), // dist/core → package root
    resolve(here, "..", "..", "..", "templates"), // src/core → repo root
  ];
  for (const c of candidates) {
    if (
      existsSync(join(c, "base", "manifest.yaml.tmpl")) &&
      (existsSync(join(c, "base", "reviewers", "correctness.md")) ||
        existsSync(join(c, "base", "reviewers", "core-logic.md")))
    ) {
      return c;
    }
  }
  throw new Error(
    `templates/ directory not found. Looked in:\n${candidates.map((c) => `  - ${c}`).join("\n")}`,
  );
}

export async function readTemplate(relPath: string): Promise<string> {
  const full = join(templatesRoot(), relPath);
  return readFile(full, "utf8");
}

export function render(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{([a-z_]+)\}\}/gi, (_, key: string) => {
    return values[key] ?? `{{${key}}}`;
  });
}
