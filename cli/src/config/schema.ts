import { z } from "zod";

export const configSchema = z
  .object({
    version: z.literal("1"),
    base_branch: z.string().min(1).default("main"),
    ignored_paths: z.array(z.string()).default([]),
    high_risk_patterns: z.array(z.string()).default([]),
    max_file_bytes: z.number().int().positive().default(200_000),
  })
  .strict();

export type Config = z.infer<typeof configSchema>;

export const reviewerEntrySchema = z
  .object({
    id: z
      .string()
      .min(1)
      .regex(/^[a-z][a-z0-9-]*$/u, "reviewer id must be lowercase kebab-case"),
    path: z.string().min(1),
    trigger: z.union([z.string(), z.array(z.string()).min(1)]),
    mandatory: z.boolean().default(false),
  })
  .strict();

export const manifestSchema = z
  .object({
    reviewers: z.array(reviewerEntrySchema).min(1),
  })
  .strict();

export type Manifest = z.infer<typeof manifestSchema>;
export type ReviewerEntry = z.infer<typeof reviewerEntrySchema>;
