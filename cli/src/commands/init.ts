import type { Command } from "commander";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { input, confirm, checkbox } from "@inquirer/prompts";
import { scanRepo } from "../core/repo-scan.js";
import { readTemplate, render, templatesRoot } from "../core/templates.js";

interface InitOptions {
  force: boolean;
  yes: boolean;
}

type AiTool = "claude-code" | "cursor" | "codex";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Scan the current repo and generate a .contextur/ configuration tree.")
    .option("--force", "Overwrite existing .contextur/ files without prompting", false)
    .option("-y, --yes", "Accept all defaults non-interactively", false)
    .action(async (opts: InitOptions) => {
      const cwd = process.cwd();
      const dotDir = join(cwd, ".contextur");

      if (existsSync(dotDir) && !opts.force) {
        const cont = opts.yes
          ? false
          : await confirm({
              message: ".contextur/ already exists. Overwrite?",
              default: false,
            });
        if (!cont) {
          process.stdout.write("Aborted. Re-run with --force to overwrite.\n");
          return;
        }
      }

      const signals = await scanRepo(cwd);

      process.stdout.write(
        `\nDetected languages: ${signals.languages.join(", ") || "(none)"}\n` +
          `Monorepo: ${signals.monorepoTool ?? "no"}\n` +
          `Existing context files: ${signals.existingContextFiles.join(", ") || "(none)"}\n\n`,
      );

      const baseBranch = opts.yes
        ? signals.baseBranchGuess
        : await input({
            message: "Base branch for diffs",
            default: signals.baseBranchGuess,
          });

      const aiTools: AiTool[] = opts.yes
        ? ["claude-code"]
        : await checkbox<AiTool>({
            message: "Which AI tools do you use in this repo? (select all that apply)",
            choices: [
              {
                name: "Claude Code (.claude/commands/review.md)",
                value: "claude-code",
                checked: true,
              },
              {
                name: "Cursor (.cursor/rules/contextur.mdc)",
                value: "cursor",
              },
              {
                name: "Codex / OpenAI agents (AGENTS.md only — no extra file needed)",
                value: "codex",
                checked: true,
              },
            ],
          });

      await mkdir(join(dotDir, "reviewers"), { recursive: true });

      const values: Record<string, string> = {
        base_branch: baseBranch,
      };

      await writeRendered(dotDir, "config.yaml", "base/config.yaml.tmpl", values);
      await writeRendered(dotDir, "manifest.yaml", "base/manifest.yaml.tmpl", values);
      await writeCopy(dotDir, "challenger.md", "base/challenger.md");
      await writeCopy(dotDir, "synthesizer.md", "base/synthesizer.md");

      for (const name of ["core-logic", "security", "architecture"]) {
        await writeCopy(dotDir, `reviewers/${name}.md`, `base/reviewers/${name}.md`);
      }

      // Claude Code: .claude/commands/{review,contextur-init,contextur-update}.md
      if (aiTools.includes("claude-code")) {
        const clauDir = join(cwd, ".claude", "commands");
        await mkdir(clauDir, { recursive: true });

        const reviewTpl = await readTemplate("base/integrations/claude-command.md");
        await writeFile(join(clauDir, "review.md"), render(reviewTpl, values));

        const initTpl = await readTemplate("base/integrations/claude-init-command.md");
        await writeFile(join(clauDir, "contextur-init.md"), render(initTpl, values));

        const updateTpl = await readTemplate("base/integrations/claude-update-command.md");
        await writeFile(join(clauDir, "contextur-update.md"), render(updateTpl, values));
      }

      // Cursor: .cursor/rules/contextur.mdc
      if (aiTools.includes("cursor")) {
        const cursorDir = join(cwd, ".cursor", "rules");
        await mkdir(cursorDir, { recursive: true });
        const tpl = await readTemplate("base/integrations/cursor-rule.mdc");
        await writeFile(join(cursorDir, "contextur.mdc"), render(tpl, values));
      }

      // AGENTS.md at repo root (covers Codex + general AI assistant context)
      const inferred = signals.inferredRules;
      const agentsTpl = await readTemplate("base/AGENTS.md.tmpl");
      const agentsOut = render(agentsTpl, {
        base_branch: baseBranch,
        inferred_standards:
          inferred.length > 0
            ? inferred.map((r) => `- ${r}`).join("\n")
            : "- No specific standards inferred — edit this file to add your team's rules.",
        inferred_rules_raw: inferred.join("\n"),
      });
      const agentsPath = join(cwd, "AGENTS.md");
      if (existsSync(agentsPath) && !opts.force) {
        const cont = opts.yes
          ? false
          : await confirm({
              message: "AGENTS.md already exists. Overwrite?",
              default: false,
            });
        if (!cont) {
          process.stdout.write("Left existing AGENTS.md untouched.\n");
        } else {
          await writeFile(agentsPath, agentsOut);
        }
      } else {
        await writeFile(agentsPath, agentsOut);
      }

      const integrationLines: string[] = [];
      if (aiTools.includes("claude-code")) {
        integrationLines.push(
          "  Claude Code:",
          "    /project:contextur-init            ← run this NEXT to personalize reviewers",
          "    /project:contextur-update          ← run after major repo changes",
          "    /project:review [base-branch]      ← run a code review",
        );
      }
      if (aiTools.includes("cursor")) {
        integrationLines.push(
          "  Cursor:",
          '    Ask: "initialize contextur for this repo" to personalize reviewers',
          '    Ask: "review this PR" to run a code review',
          '    Ask: "update contextur" to refresh reviewers',
        );
      }
      if (aiTools.includes("codex")) {
        integrationLines.push("  Codex: reads AGENTS.md and runs contextur review as a tool");
      }

      process.stdout.write(
        `\nWrote .contextur/ and AGENTS.md.\n` +
          (integrationLines.length > 0
            ? `\nIDE integrations generated:\n${integrationLines.join("\n")}\n`
            : "") +
          `\nNext: open this repo in your AI IDE and run the personalize step above.\n` +
          `To run a review manually from the terminal:\n  contextur review --base ${baseBranch}\n`,
      );
    });
}

async function writeCopy(dotDir: string, dest: string, tplRel: string): Promise<void> {
  const content = await readFile(join(templatesRoot(), tplRel), "utf8");
  await writeFile(join(dotDir, dest), content);
}

async function writeRendered(
  dotDir: string,
  dest: string,
  tplRel: string,
  values: Record<string, string>,
): Promise<void> {
  const tpl = await readFile(join(templatesRoot(), tplRel), "utf8");
  await writeFile(join(dotDir, dest), render(tpl, values));
}
