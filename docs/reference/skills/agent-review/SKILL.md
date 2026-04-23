---
name: agent-review
description: Runs git diff vs origin/develop and asks the agent to review it like a PR with staged context and specialized subagents
disable-model-invocation: true
---
# Review vs Develop

Collects a rich context bundle (diff, stat, commit log, selected full file contents, consumer graph) then dispatches up to **ten subagents**: six-to-eight specialist reviewers run in parallel, then a challenger validates Critical findings, and a synthesis agent runs last to produce an executive summary.

| Subagent | Always runs? | Triggered by |
| --- | --- | --- |
| `code-quality-reviewer` | ✅ Yes | All diffs |
| `bug-reviewer` | ✅ Yes | All diffs |
| `architecture-reviewer` | ✅ Yes | All diffs |
| `pre-pr-validator` | ✅ Yes | All diffs |
| `tech-debt-reviewer` | ✅ Yes | All diffs |
| `perf-reviewer` | Conditional | Files in `presentation/`, `*_bloc.dart`, `*_cubit.dart` |
| `data-layer-reviewer` | Conditional | Files in `data/service/`, `data/dto/`, `data/source/`, `data/repository/`, `data/mapper/` |
| `ui-reviewer` | Conditional | Files in `presentation/pages/`, `presentation/widgets/`, or any `*_page.dart`/`*_widget.dart` |
| `finding-challenger` | ✅ Yes (runs after parallel reviewers) | All Critical/Blocker findings from above subagents |
| `review-synthesizer` | ✅ Yes (runs last) | All diffs — reads outputs of all other subagents + challenger report |

steps:

- agent:
      prompt: |
        Run `git fetch origin` with 'all' permissions to bypass sandbox restrictions for SSH key permissions.

- run: git log develop..HEAD --oneline

- run: git diff --stat develop...HEAD

- run: git diff --name-only develop...HEAD

- run: git diff develop...HEAD

- agent:
      prompt: |
        You have the output of `git diff --name-only develop...HEAD` from the previous step.

        ## Pre-review configuration

        ### Step A — Classify conditional reviewers and path groups

        **A1 — Conditional reviewers:** Scan the changed file list and determine which conditional subagents apply:

        - `perf-reviewer` → triggered if any file is under `presentation/` OR matches `*_bloc.dart` / `*_cubit.dart`
        - `data-layer-reviewer` → triggered if any file path includes `data/service/`, `data/dto/`, `data/source/`, `data/repository/`, or `data/mapper/`
        - `ui-reviewer` → triggered if any file is under `presentation/pages/` or `presentation/widgets/`, or matches `*_page.dart` / `*_widget.dart`

        Build two lists:
        - `ALWAYS_REVIEWERS`: `code-quality-reviewer`, `bug-reviewer`, `architecture-reviewer`, `pre-pr-validator`, `tech-debt-reviewer`
        - `CONDITIONAL_REVIEWERS`: the subset of `perf-reviewer`, `data-layer-reviewer`, `ui-reviewer` that are triggered

        **A2 — Path groups:** Parse the changed file list and group files into logical review segments using this hierarchy (apply the first matching rule):

        | Path pattern | Group label |
        |---|---|
        | `packages/features/<feature>/lib/src/<segment>/` or files directly under `lib/src/<segment>/` | `<feature>/<segment>` (e.g. `store_oechsle/search`) |
        | `packages/features/<feature>/test/` | `<feature>/test` |
        | `packages/features/<feature>/` (anything else) | `<feature>` |
        | `packages/core/` | `core` |
        | `packages/libraries/<lib>/` | `<lib>` |
        | `apps/<app>/` | `apps/<app>` |
        | `.cursor/` | `project config` |
        | anything else | `other` |

        Build `PATH_GROUPS`: a deduplicated, sorted list of group labels present in this diff.
        For each group, also record the path prefix used to match files into it (needed for filtering in the orchestration step).

        ### Step B — Ask the user

        Use the `AskQuestion` tool to present **2–3 questions at once**:

        **Q1 (multi-select, id: `reviewers`):** "The following reviewers always run: code-quality-reviewer, bug-reviewer, architecture-reviewer, pre-pr-validator, tech-debt-reviewer. Which additional reviewers would you like to enable?"
        - Do NOT include the 5 core reviewers (`code-quality-reviewer`, `bug-reviewer`, `architecture-reviewer`, `pre-pr-validator`, `tech-debt-reviewer`) as options — they always run and are non-negotiable.
        - Do NOT list `finding-challenger` or `review-synthesizer` — they always run and are not user-configurable.
        - List ONLY the conditional reviewers that are in `CONDITIONAL_REVIEWERS`:
          - `perf-reviewer` — Widget rebuilds, memory leaks, BLoC state efficiency
          - `data-layer-reviewer` — Retrofit, DTOs, DataSource/Repository patterns
          - `ui-reviewer` — UI Kit compliance, design tokens, Agora* components
        - Pre-select all reviewers in `CONDITIONAL_REVIEWERS` by default; the user may deselect any of them.
        - If `CONDITIONAL_REVIEWERS` is empty, skip Q1 entirely and inform the user that only the 5 core reviewers apply for this diff.

        **Q2 (single-select, id: `focus`):** "Should reviewers focus on a specific concern?"
        - no_focus — No specific focus — full review
        - correctness — Correctness & null safety
        - architecture — Architecture & layer boundaries
        - performance — Performance & memory
        - test_coverage — Test coverage gaps
        - ui_design — UI / design system compliance
        - data_layer — Data layer & API contracts
        - technical_debt — Refactor opportunities & technical debt hotspots

        **Q3 (multi-select, id: `scope`):** "Which changed areas do you want to include in the review?" (all pre-selected by default)
        - Generate one option per group in `PATH_GROUPS`. Use the group label as the option label and id.
        - The user can deselect groups they do NOT want reviewed.
        - If the user keeps all groups selected, treat it as "review everything" (no filtering).

        ### Step C — Output the configuration

        After the user responds, output the following block **exactly** (replace placeholders with actual values):

        ```
        === USER REVIEW CONFIGURATION ===
        SELECTED_OPTIONAL_REVIEWERS: <comma-separated list of optional reviewer names the user selected, or "none" if Q1 was skipped or nothing was selected>
        FOCUS_AREA: <label of the focus option the user selected, e.g. "No specific focus — full review">
        SELECTED_PATHS: <"all" if every path group was selected, otherwise a comma-separated list of the path prefixes for the selected groups>
        ```

        Do not proceed further. The next step will read this configuration.

- agent:
      prompt: |
        You now have all the data from the previous steps:
        - (1) Commit log (git log develop..HEAD --oneline)
        - (2) Diff stat summary (git diff --stat)
        - (3) Changed file list (git diff --name-only)
        - (4) Full diff (git diff develop...HEAD)
        - (5) User review configuration (=== USER REVIEW CONFIGURATION === block from the pre-review config step)

        Follow these steps **in order**.

        ---

        ## Step 0 — Apply scope filter (path scoping)

        Read `SELECTED_PATHS` from the `=== USER REVIEW CONFIGURATION ===` block.

        - If `SELECTED_PATHS` is `"all"`: proceed with the full file list and full diff unchanged. Set `SCOPED_FILE_LIST` = full file list and `SCOPED_DIFF` = full diff.
        - Otherwise, produce a scoped diff using git directly:
          1. **Build `SCOPED_FILE_LIST`:** From the full `git diff --name-only` output, keep only files whose normalized repo-relative path **starts with** one of the path prefixes in `SELECTED_PATHS` (prefix-only matching; do NOT use substring/`contains` matching).
          2. **Build `SCOPED_DIFF`:** Run `git diff develop...HEAD -- <path1> <path2> ...` where each `<pathN>` is a path prefix from `SELECTED_PATHS`. This produces a correctly scoped diff natively — do NOT attempt to parse diff hunks manually.
          3. Log a one-line note: "Scope filter applied: reviewing X of Y changed files (excluded: [omitted groups])."

        **From this point on, all steps use `SCOPED_FILE_LIST` and `SCOPED_DIFF` in place of the original file list and diff.** The `LARGE_DIFF` estimate in Step 1, the consumer graph in Step 2, and all subagent payloads in Step 4 are based on the scoped data.

        ---

        ## Step 1 — Build a staged context bundle (accuracy first, token-safe)

        First, estimate diff size:
        - `changed_files_count` = number of files in `SCOPED_FILE_LIST` (i.e., `|SCOPED_FILE_LIST|`)
        - `diff_lines` = line count of `SCOPED_DIFF`
        - Set `LARGE_DIFF=true` if `changed_files_count > 25` OR `diff_lines > 3500`; otherwise `LARGE_DIFF=false`.

        Then load full file contents with this policy:
        - Always load full contents for high-risk files:
          - `packages/core/lib/src/contracts/**` (public contracts/events)
          - Any `*_initializer.dart` (wiring/registration)
          - Any barrel `lib/<package>.dart` (public API surface)
          - Any `*_bloc.dart` or `*_cubit.dart` (state logic)
          - Any file under `data/service/`, `data/dto/`, `data/source/`, `data/repository/`, `data/mapper/`
          - Any file under `presentation/`
        - If `LARGE_DIFF=false`, load full contents for every changed file.
        - If `LARGE_DIFF=true`, enforce a preload budget:
          - preload at most 60 files OR ~200k characters total (whichever comes first), prioritising: core contracts > initializers > barrels > bloc/cubit > data > presentation.
          - For files beyond budget, pass file paths + diff hunks and require subagents to Read on demand before reporting.

        Reliability rule:
        - Any finding must be backed by full file context (from preloaded content OR a direct Read done by the reviewing subagent before reporting).

        ---

        ## Step 2 — Identify consumers of changed public APIs

        For every class, event, typedef, or function that was **added, removed, or renamed** inside `packages/core/` or a barrel export:
        1. Use Grep to search the entire workspace for files that import or reference the changed symbol.
        2. Build a short list: **changed symbol → [list of consumer files]**. Note which consumers appear in the diff and which do not.

        This is the "impact surface" for the `architecture-reviewer`.

        ---

        ## Step 3 — Determine which specialist subagents to invoke

        Read the `=== USER REVIEW CONFIGURATION ===` block from the pre-review config step output:
        - `SELECTED_OPTIONAL_REVIEWERS` — the optional reviewers the user chose to enable (may be "none").
        - `FOCUS_AREA` — the concern the user wants reviewers to prioritise (may be "No specific focus — full review").

        Normalization rule:
        - If `SELECTED_OPTIONAL_REVIEWERS` is `"none"` (or empty), normalize it to an empty list `[]` before any further processing.

        Build the final reviewer list by combining the 5 mandatory reviewers (`code-quality-reviewer`, `bug-reviewer`, `architecture-reviewer`, `pre-pr-validator`, `tech-debt-reviewer`) with the normalized optional reviewer list from the user config. Use this combined list as the definitive set of subagents to launch in Step 4. If a reviewer is not in the combined list, skip it entirely — do not invoke it.

        Note: `finding-challenger` and `review-synthesizer` always run regardless of the combined reviewer list.

        ---

        ## Step 4 — Launch all applicable specialist subagents in parallel

        Send a **single message** with one Task tool call per subagent. All calls go out simultaneously.
        For conditional reviewers, derive filtered diffs from `SCOPED_DIFF` by path pattern before sending payloads.

        **Focus instruction:** If `FOCUS_AREA` from Step 3 is NOT "No specific focus — full review", prepend the following block to every subagent prompt you send:

        ```
        REVIEW FOCUS (developer-requested): [FOCUS_AREA]
        Prioritise findings related to this concern. Still report all findings, but within each severity tier surface [FOCUS_AREA] issues first.
        ```

        Only launch the subagents in the combined reviewer list from Step 3. Skip any reviewer not in that list.

        ### Task A — code-quality-reviewer (always — mandatory)
        Pass:
        - `SCOPED_DIFF`
        - Commit log
        - `SCOPED_FILE_LIST`
        - Preloaded full file contents from Step 1
        - Focus instruction (if applicable)

        Scope: correctness, null/async safety, state management (BLoC/Cubit), Flutter best practices, code quality, test coverage gaps. If the diff touches `presentation/` (especially `presentation/model/` or view-data factories), explicitly evaluate parsing/transformation versus BLoC/Cubit or use case placement and whether failures are observable in state (`ResultState` or equivalent).

        ### Task B — bug-reviewer (always — mandatory)
        Pass:
        - `SCOPED_DIFF`
        - Commit log
        - `SCOPED_FILE_LIST`
        - Preloaded full file contents from Step 1
        - Focus instruction (if applicable)

        Scope: runtime crash risks, async/state defects, logic regressions introduced by the diff, integration/contract mismatches. If the diff touches `presentation/` (especially `presentation/model/` or view-data factories), explicitly evaluate presentation-side parsing/formatting for crash paths, silent wrong UI, and missing loading/data/error state from BLoC/Cubit.

        ### Task C — architecture-reviewer (always — mandatory)
        Pass:
        - `SCOPED_DIFF`
        - `SCOPED_FILE_LIST`
        - Preloaded full file contents from Step 1
        - Consumer impact surface map (from Step 2)
        - Focus instruction (if applicable)

        Scope: Clean Architecture layer boundaries, feature package isolation, DI registration completeness, barrel/API surface changes, cross-package impact. **Mandatory:** For any change to `packages/features/*/lib/<feature>.dart`, enforce `docs/rules.md` §2.3 — meta-feature barrels MUST only export initializers and integration configs; forbidden exports (e.g. `*Routes` path helpers, `export 'src/routing/..._routes.dart'`) are **Blocker/Critical** and must not be reported as lower severity.

        ### Task D — pre-pr-validator (always — mandatory)
        Pass:
        - `SCOPED_DIFF`
        - `SCOPED_FILE_LIST`
        - Preloaded full file contents from Step 1
        - Focus instruction (if applicable)

        Scope: pubspec.yaml version rules (no `^`, version consistency, unused deps), hardcoded colors/sizes/strings, Spanish text in UI, magic numbers, Freezed usage in domain/state, generic exceptions, English-only comments and logs, initializer registration completeness. Produces a ✅/❌/⚠️ checklist and a final 🔴/🟡/🟢 verdict.

        ### Task E — tech-debt-reviewer (always — mandatory)
        Pass:
        - `SCOPED_DIFF`
        - Commit log
        - `SCOPED_FILE_LIST`
        - Preloaded full file contents from Step 1
        - Focus instruction (if applicable)

        Scope: identify refactor candidates and technical debt hotspots (high coupling, duplication, oversized methods/classes, leaky abstractions, dead code, weak boundaries) with actionable improvements and estimated change risk. Severity policy: default to Suggestions/Nice-to-have; escalate to Blocker/Critical only when there is clear near-term correctness/reliability risk.

        ### Task F — perf-reviewer (skip if not in combined reviewer list)
        Pass:
        - Changed-file list from `SCOPED_FILE_LIST`, filtered to presentation + BLoC/Cubit scope
        - Filtered diff for `presentation/`, `*_bloc.dart`, `*_cubit.dart`
        - Preloaded full file contents for those same scoped files
        - `LARGE_DIFF` flag (for prioritisation only)
        - Focus instruction (if applicable)

        Scope: Widget rebuild analysis (`buildWhen`/`listenWhen`), memory leaks (undisposed timers/streams/controllers), object allocation in `build()`, BLoC state efficiency, algorithmic complexity.

        ### Task G — data-layer-reviewer (skip if not in combined reviewer list)
        Pass:
        - Changed-file list from `SCOPED_FILE_LIST`, filtered to data scope only
        - Filtered diff for `data/service/`, `data/dto/`, `data/source/`, `data/repository/`, `data/mapper/`
        - Preloaded full file contents for those same scoped files
        - `LARGE_DIFF` flag (for prioritisation only)
        - Focus instruction (if applicable)

        Scope: Retrofit annotations, DTO structure (`BaseDtoResponse`, `toDomainModel`), DataSource/Repository patterns, DI named bindings.

        ### Task H — ui-reviewer (skip if not in combined reviewer list)
        Pass:
        - Changed-file list from `SCOPED_FILE_LIST`, filtered to UI scope only
        - Filtered diff for `presentation/pages/`, `presentation/widgets/`, `*_page.dart`, `*_widget.dart`
        - Preloaded full file contents for those same scoped files
        - `LARGE_DIFF` flag (for prioritisation only)
        - Focus instruction (if applicable)

        Scope: UI Kit System compliance (`AgoraTheme`, `theme.colorTheme.*`, `theme.gaps.*`, `Agora*` components), widget structure (private `_Widget` classes, `const`), responsiveness consistency, accessibility. Keep `build()` and page/widget code thin: non-trivial parsing or transport shaping belongs in BLoC/Cubit or use case with failures reflected in state, not buried in widgets.

        ---

        ## Step 5 — Wait for all specialist subagents to finish, then challenge findings

        Once all parallel subagents have returned their outputs, invoke the **finding-challenger** subagent.

        Pass to the challenger:
        - The full text output of every subagent that ran (label each clearly: "=== code-quality-reviewer output ===", "=== bug-reviewer output ===", "=== tech-debt-reviewer output ===", etc.)
        - The list of subagents that were invoked
        - **Mandatory instruction:** "Layer boundary violations (semantic API contract leakage, presentation containing backend/API identifiers or data-layer concerns) must NOT be downgraded. CONFIRM them as Critical. Precedent elsewhere in the codebase does not justify downgrading. **Meta feature barrel violations** (`docs/rules.md` §2.3): any forbidden export from `packages/features/*/lib/<feature>.dart` (e.g. route path helpers / `*Routes` classes re-exported from the barrel) must NOT be downgraded — CONFIRM as Blocker/Critical; never move to Suggestion or Nice to have. **Presentation parsing / view-data shaping:** findings that cite concrete crash risk, unhandled exceptions, or wrong UI without error state must not be marked REJECTED as style-only; verify against code and CONFIRM or adjust severity only."

        The challenger will verify every Critical/Blocker/❌ finding against actual code on disk, codebase patterns, and rule applicability. It will mark each finding as CONFIRMED, DOWNGRADED, or REJECTED. Layer violations must remain Critical.

        ---

        ## Step 6 — Synthesize with challenger results

        After the challenger has returned, invoke the **review-synthesizer** subagent.

        Pass to the synthesizer:
        - The full text output of every specialist subagent (label each clearly: "=== code-quality-reviewer output ===", "=== bug-reviewer output ===", "=== tech-debt-reviewer output ===", etc.)
        - The **finding-challenger report** (labeled "=== finding-challenger output ===")
        - The list of subagents that were invoked

        **IMPORTANT:** The synthesizer MUST respect the challenger's verdicts:
        - **REJECTED** findings must be **excluded** from the priority action list entirely.
        - **DOWNGRADED** findings must use the challenger's recommended severity, not the original.
        - **CONFIRMED** findings keep their original severity.

        The synthesizer will produce a **single developer-facing report** that is concise, deduplicated, and action-oriented.

        **Required synthesis format (strict):**

        1. `# PR Review Summary`
        2. `## Overall verdict` (🔴/🟡/🟢 + one sentence)
        3. `## Priority action list` with **deduplicated** findings only
           - Group by severity: `Blockers`, `Suggestions`, `Nice to have`
           - Each item must be short and fix-oriented:
             - **Title:** imperative, 1 line (what to change)
             - **Where:** one primary `path:line`
             - **Why:** max 2 short sentences
             - **How to fix:** 1 concrete action sentence
             - **Reported by:** reviewer tags (comma-separated)
           - If multiple reviewers report the same issue, merge into one item and union reviewer tags.
           - Keep only actionable items; remove stylistic noise and repeated context.
        4. `## What looks good` with max 3 bullets
        5. `## Reviewer capsules` (very short, no repeated findings)
           - One subsection per invoked reviewer.
           - Format: `Reviewer → <count by severity> · <one-line focus note>`
           - Do **not** restate full findings here; this section is just orientation.
        6. Optional `## Open questions` only when uncertainty blocks a confident recommendation.

        **Hard anti-duplication rules:**
        - Do not repeat the same finding in multiple sections.
        - Do not print full raw outputs from individual reviewers.
        - Prefer one merged actionable item over several near-duplicate items.
        - Target length: ~400-900 words for typical diffs.

        ---

        ## Step 7 — Present the final output

        Show the results to the user as a **single consolidated report**:

        ```
        <review-synthesizer output using the strict concise format from Step 6>
        ```

        The final output must optimise for developer readability and fast execution of fixes.
        Never append full reviewer transcripts by default. If raw details are needed, provide them only when explicitly requested by the user.
