#!/usr/bin/env node
import { Command } from "commander";
import { registerInitCommand } from "./commands/init.js";
import { registerReviewCommand } from "./commands/review.js";

const program = new Command();

program
  .name("contextur")
  .description(
    "Vendor-neutral multi-agent code review CLI. Generates reviewer prompts into your repo and runs them against local git diffs.",
  )
  .version("0.0.1");

registerInitCommand(program);
registerReviewCommand(program);

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`\ncontextur: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
