import type { Command } from "commander";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { input, confirm, checkbox } from "@inquirer/prompts";
import { stringify as stringifyYaml } from "yaml";
import { scanRepo, type RepoSignals } from "../core/repo-scan.js";
import { readTemplate, render, templatesRoot } from "../core/templates.js";
import type { Manifest, ReviewerEntry } from "../config/schema.js";

interface InitOptions {
  force: boolean;
  yes: boolean;
}

type AiTool = "claude-code" | "cursor" | "codex";
type AiToolWithSkills = AiTool | "shared-skills";

const REVIEWER_IDS = [
  "correctness",
  "security",
  "architecture",
  "testing",
  "operability",
  "performance",
  "api-contract",
  "data-migration",
  "ci-release",
  "maintainability",
] as const;

const MANDATORY_BASELINE = new Set<string>([
  "correctness",
  "security",
  "architecture",
  "testing",
  "operability",
]);

const DEFAULT_CODE_GLOBS = [
  "**/*.ts",
  "**/*.tsx",
  "**/*.js",
  "**/*.jsx",
  "**/*.py",
  "**/*.go",
  "**/*.rs",
  "**/*.java",
  "**/*.rb",
  "**/*.php",
  "**/*.cs",
  "**/*.kt",
  "**/*.swift",
  "**/*.scala",
  "**/*.dart",
];

export const SHARED_SKILL_DEFINITIONS = [
  {
    id: "contextur-init",
    outputPath: ".agents/skills/contextur-init/SKILL.md",
    templatePath: "base/integrations/skill-contextur-init.md",
  },
  {
    id: "contextur-update",
    outputPath: ".agents/skills/contextur-update/SKILL.md",
    templatePath: "base/integrations/skill-contextur-update.md",
  },
  {
    id: "contextur-review",
    outputPath: ".agents/skills/contextur-review/SKILL.md",
    templatePath: "base/integrations/skill-review.md",
  },
] as const;

interface RepoSnapshot {
  version: "1";
  base_branch: string;
  languages: string[];
  package_manager: string | null;
  monorepo: {
    enabled: boolean;
    tool: string | null;
    workspace_globs: string[];
  };
  top_level_dirs: string[];
  existing_context_files: string[];
  architecture_docs: string[];
  command_hints: {
    test: string[];
    lint: string[];
    build: string[];
  };
  capabilities: {
    api_contracts: boolean;
    data_migrations: boolean;
    ci_release: boolean;
  };
  recent_hotspots: string[];
  inferred_rules: string[];
}

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

      const aiTools: AiToolWithSkills[] = opts.yes
        ? ["claude-code", "shared-skills"]
        : await checkbox<AiToolWithSkills>({
            message: "Which AI tools do you use in this repo? (select all that apply)",
            choices: [
              {
                name: "Claude Code (.claude/commands/contextur-review.md)",
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
              {
                name: "Shared Skills (.agents/skills/{contextur-init,contextur-update,contextur-review})",
                value: "shared-skills",
                checked: true,
              },
            ],
          });

      await mkdir(join(dotDir, "reviewers"), { recursive: true });

      const snapshot = buildRepoSnapshot(signals, baseBranch);
      const values = buildReviewerTemplateValues(snapshot);

      await writeRendered(dotDir, "config.yaml", "base/config.yaml.tmpl", values);
      await writeFile(join(dotDir, "repo-snapshot.yaml"), stringifyYaml(snapshot));
      await writeFile(join(dotDir, "manifest.yaml"), stringifyYaml(buildManifestFromSignals(signals)));
      await writeCopy(dotDir, "challenger.md", "base/challenger.md");
      await writeCopy(dotDir, "synthesizer.md", "base/synthesizer.md");

      for (const name of REVIEWER_IDS) {
        await writeRendered(dotDir, `reviewers/${name}.md`, `base/reviewers/${name}.md`, values);
      }

      // Claude Code: .claude/commands/{contextur-review,contextur-init,contextur-update}.md
      if (aiTools.includes("claude-code")) {
        const clauDir = join(cwd, ".claude", "commands");
        await mkdir(clauDir, { recursive: true });

        const reviewTpl = await readTemplate("base/integrations/claude-command.md");
        await writeFile(join(clauDir, "contextur-review.md"), render(reviewTpl, values));

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

      // Shared cross-tool skills: .agents/skills/*/SKILL.md
      if (aiTools.includes("shared-skills")) {
        for (const skill of SHARED_SKILL_DEFINITIONS) {
          const skillPath = join(cwd, skill.outputPath);
          await mkdir(dirname(skillPath), { recursive: true });
          const tpl = await readTemplate(skill.templatePath);
          await writeFile(skillPath, render(tpl, values));
        }
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
          "    /project:contextur-review [base-branch] ← run a code review",
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
        integrationLines.push(
          "  Codex: reads AGENTS.md and can invoke shared skills (e.g. $contextur-review)",
        );
      }
      if (aiTools.includes("shared-skills")) {
        integrationLines.push(
          "  Shared Skills:",
          "    $contextur-init                  ← personalize reviewers for this repo",
          "    $contextur-update                ← refresh reviewers after major changes",
          "    $contextur-review                ← run contextur review workflow",
        );
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

export function buildRepoSnapshot(signals: RepoSignals, baseBranch: string): RepoSnapshot {
  return {
    version: "1",
    base_branch: baseBranch,
    languages: signals.languages,
    package_manager: signals.packageManager,
    monorepo: {
      enabled: signals.monorepo,
      tool: signals.monorepoTool,
      workspace_globs: signals.workspaceGlobs,
    },
    top_level_dirs: signals.topLevelDirs,
    existing_context_files: signals.existingContextFiles,
    architecture_docs: signals.architectureDocs,
    command_hints: {
      test: signals.testCommands,
      lint: signals.lintCommands,
      build: signals.buildCommands,
    },
    capabilities: {
      api_contracts: signals.hasApiContracts,
      data_migrations: signals.hasDataMigrations,
      ci_release: signals.hasCiConfig,
    },
    recent_hotspots: signals.recentHotspots,
    inferred_rules: signals.inferredRules,
  };
}

export function buildReviewerTemplateValues(snapshot: RepoSnapshot): Record<string, string> {
  const joinOrUnknown = (values: string[], unknownLabel = "(none detected)"): string =>
    values.length > 0 ? values.join(", ") : unknownLabel;

  return {
    base_branch: snapshot.base_branch,
    repo_languages: joinOrUnknown(snapshot.languages, "(none detected)"),
    repo_package_manager: snapshot.package_manager ?? "(unknown)",
    repo_monorepo: snapshot.monorepo.enabled
      ? `yes (${snapshot.monorepo.tool ?? "detected"})`
      : "no",
    repo_workspaces: joinOrUnknown(snapshot.monorepo.workspace_globs),
    repo_top_level_dirs: joinOrUnknown(snapshot.top_level_dirs),
    repo_context_files: joinOrUnknown(snapshot.existing_context_files),
    repo_architecture_docs: joinOrUnknown(snapshot.architecture_docs),
    repo_test_commands: joinOrUnknown(snapshot.command_hints.test),
    repo_lint_commands: joinOrUnknown(snapshot.command_hints.lint),
    repo_build_commands: joinOrUnknown(snapshot.command_hints.build),
    repo_hotspots: joinOrUnknown(snapshot.recent_hotspots),
    repo_has_api_contracts: snapshot.capabilities.api_contracts ? "yes" : "no",
    repo_has_data_migrations: snapshot.capabilities.data_migrations ? "yes" : "no",
    repo_has_ci_config: snapshot.capabilities.ci_release ? "yes" : "no",
    repo_inferred_rules_bullets:
      snapshot.inferred_rules.length > 0
        ? snapshot.inferred_rules.map((rule) => `- ${rule}`).join("\n")
        : "- No project-specific rules inferred yet.",
  };
}

export function buildManifestFromSignals(signals: RepoSignals): Manifest {
  const codeGlobs = codeGlobsForLanguages(signals.languages);
  const reviewers: ReviewerEntry[] = [
    reviewer("correctness", "**/*", true),
    reviewer("security", "**/*", true),
    reviewer("architecture", "**/*", true),
    reviewer("testing", "**/*", true),
    reviewer("operability", "**/*", true),
    reviewer("performance", codeGlobs, false),
    reviewer(
      "api-contract",
      [
        "**/*openapi*.yaml",
        "**/*openapi*.yml",
        "**/*openapi*.json",
        "**/*.proto",
        "**/*.graphql",
        "**/*.gql",
        "**/schema/**",
        "**/contracts/**",
      ],
      signals.hasApiContracts,
    ),
    reviewer(
      "data-migration",
      [
        "**/migrations/**",
        "**/migration/**",
        "**/alembic/**",
        "**/*.sql",
        "**/db/**",
        "**/database/**",
        "**/schema.prisma",
        "**/prisma/migrations/**",
      ],
      signals.hasDataMigrations,
    ),
    reviewer(
      "ci-release",
      [
        ".github/workflows/**",
        "**/Dockerfile",
        "**/Dockerfile.*",
        "**/docker-compose*.yaml",
        "**/docker-compose*.yml",
        "**/helm/**",
        "**/k8s/**",
        "**/.circleci/**",
        "**/.gitlab-ci.yml",
        "**/Jenkinsfile",
      ],
      false,
    ),
    reviewer("maintainability", codeGlobs, false),
  ];

  return { reviewers };
}

function reviewer(id: string, trigger: string | string[], mandatory: boolean): ReviewerEntry {
  return {
    id,
    path: `reviewers/${id}.md`,
    trigger,
    mandatory: mandatory || MANDATORY_BASELINE.has(id),
  };
}

function codeGlobsForLanguages(languages: string[]): string[] {
  const globs = new Set<string>();
  if (languages.includes("typescript/javascript")) {
    globs.add("**/*.ts");
    globs.add("**/*.tsx");
    globs.add("**/*.js");
    globs.add("**/*.jsx");
  }
  if (languages.includes("python")) globs.add("**/*.py");
  if (languages.includes("go")) globs.add("**/*.go");
  if (languages.includes("rust")) globs.add("**/*.rs");
  if (languages.includes("java") || languages.includes("java/kotlin")) {
    globs.add("**/*.java");
    globs.add("**/*.kt");
  }
  if (languages.includes("ruby")) globs.add("**/*.rb");
  if (languages.includes("php")) globs.add("**/*.php");
  if (languages.includes("dart/flutter")) globs.add("**/*.dart");

  const arr = [...globs].sort((a, b) => a.localeCompare(b));
  return arr.length > 0 ? arr : DEFAULT_CODE_GLOBS;
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
