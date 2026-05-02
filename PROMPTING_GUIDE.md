# How to Prompt Claude for Multi-Feature Work
### Keeping code clean, modular, and reviewable across long sessions

This guide is **project-agnostic** — copy it into any repo where you'll have a Claude Code session that touches more than one feature. It captures what worked (and what didn't) during the PI Website refactor session.

---

## TL;DR — The 5 rules

1. **Tell Claude to plan first, code second.** Ask for a numbered plan; approve it before implementation starts.
2. **One feature = one branch of work.** Bundle related files; don't interleave unrelated features in the same turn.
3. **Set hard limits up front.** Max file length, max function length, "no new top-level folders without asking", etc.
4. **Demand a typecheck/build pass per step.** Make Claude prove each step is green before moving to the next.
5. **Name the deliverable shape.** "Don't grow Page X — extract to folder Y" beats "make it nicer".

---

## 1. Why long sessions go wrong without structure

Without explicit constraints, the failure modes are predictable:

| Symptom | Root cause |
|---|---|
| One file balloons to 600+ lines | No file-size budget given |
| Same logic copy-pasted across pages | No "shared module first" rule |
| Half-finished refactor left in repo | No "verify each step green" rule |
| Random new folders (`utils/`, `helpers/`, `lib2/`) | No "where does it go?" decision tree |
| Behavior accidentally changes during cleanup | No "functionality must not change" pin |
| Final answer is a 2,000-token summary you can't audit | No "show me the diff and the typecheck output" rule |

Every rule below targets one of these.

---

## 2. The prompt skeleton

Use this shape any time the work spans more than ~3 files or ~30 minutes:

```
TASK
<one sentence — what's the user-visible outcome?>

CONSTRAINTS
- Functionality must not change. (or: list exactly what changes)
- Max file length: <N> lines. Max function length: <M> lines.
- No new top-level folders without asking first.
- Use the existing conventions in <ref file>; don't invent new ones.

DELIVERABLES
- A numbered plan I approve BEFORE you start coding.
- After each step: run typecheck/build, paste the result.
- After all steps: a short "what changed / what didn't" summary.

OUT OF SCOPE
<list things you do NOT want touched>

TODAY
<the specific feature/refactor for this session>
```

The `CONSTRAINTS` block is where you save yourself from the failure modes in §1. Don't skip it.

---

## 3. Phase 1 — get a plan, not code

**Bad first prompt:** "Refactor the project to be cleaner."

**Good first prompt:** "Review the project structure. Don't write any code yet. Identify the top 5 maintainability problems, ranked by impact, and propose a 5–8 step refactor that fixes them without changing behavior. For each step, say what files move/split and roughly how many lines the result will be. I'll approve before you start."

Why this works:
- "Don't write code yet" stops Claude from action-biasing into edits.
- "Ranked by impact" forces prioritization instead of a kitchen-sink list.
- "Roughly how many lines" makes the size budget concrete.
- "I'll approve before you start" creates a checkpoint you can redirect.

**Approve with edits.** "Yes, but skip step 4, and do step 7 *first* because it'll catch breakage from steps 1–3." Now Claude has an ordered, audited plan.

---

## 4. Phase 2 — execute one step at a time

Use a TODO list. Either ask Claude to maintain one (`TodoWrite` tool) or paste the plan back and say "in_progress: step 1, the rest pending."

**Per step, expect this rhythm:**

1. Claude states the step it's starting.
2. Claude makes the changes.
3. Claude runs the verification command (`tsc --noEmit`, `pytest`, `cargo check`, whatever).
4. Claude pastes the exit code.
5. Claude marks the step done and moves to the next.

If you don't see exit-code output, **make Claude run it again**. Silent steps drift.

**Hard rule for the prompt:** "Do not start step N+1 until step N typechecks. If step N breaks something, fix it in step N — do not paper over it in a later step."

---

## 5. Phase 3 — boundary rules that prevent mess

Put these in `CONSTRAINTS` for any non-trivial session. They're the rules that produced the clean result in this repo:

### File-size rule
> No file exceeds ~300 lines. If a file would, you must split it before finishing the step.

### Folder rule
> One folder per business domain (e.g. `pi/`, `products/`), not per file type. Never create `utils/` or `helpers/` — name folders after what the code is for.

### "Where does it go?" rule
> Code shared by 2+ files in the same domain → a new file in that domain folder. Code shared across domains → put it where its primary consumer lives. Never create a new top-level shared folder without asking.

### Pages-are-orchestrators rule (for frontend)
> Page files only wire API + state + layout. Components, business logic, formatters, and types live in the domain folder. If a page grows past ~300 lines, extract.

### No-drift rule
> If the same type or function appears in 2+ files, that's a bug. Extract to one canonical home; the others import.

### Surgical-change rule
> Don't refactor surrounding code "while you're there." Only touch what the current step requires. Cleanup of unrelated code goes in its own approved step.

### Backwards-compat rule (if applicable)
> No backwards-compat shims, renamed `_var` placeholders, or `// removed` comments. Delete cleanly.

---

## 6. Phase 4 — verification you can audit

Specify in the prompt:

- "After each step, run `<command>` and paste the last 20 lines of output."
- "After the final step, run a full build and paste the result."
- "List every file you created, modified, or deleted, grouped by step."

This gives you an auditable trail without re-reading every diff.

---

## 7. The "next-time prompt" template (copy this)

For your future self, when you're about to start a session like this one:

```
We're going to do a multi-step refactor of <project>.

GROUND RULES (apply for the whole session, not just one turn):
- Functionality must not change. If you find a bug, flag it; don't silently fix it.
- File budget: ~300 lines max per file. Function budget: ~50 lines max.
- Folders: one per business domain (e.g. pi/, products/, excel/). No utils/ or helpers/.
- Pages are orchestrators only — extract components and helpers to domain folders.
- Code shared by 2+ files at the same level → extract to a sibling module. No duplicates.
- Don't create new top-level folders without asking.
- Surgical changes only — don't refactor unrelated code while you're there.

WORKFLOW:
1. First, audit the structure and propose a ranked list of issues + a 5–8 step plan. No code yet.
2. I'll approve / edit the plan.
3. Execute one step at a time. After each step: run typecheck (or build), paste exit code.
4. Use a TODO list and keep exactly one item in_progress.
5. Don't start step N+1 until step N is green.

DELIVERABLES at the end:
- Updated file structure summary (what moved where).
- Total lines before/after, and the largest file before/after.
- Any dead code removed.
- Anything you noticed but didn't fix (so I can decide whether to schedule it).

TODAY: <state the actual goal here>
```

Save this in your repo (this file, `PROMPTING_GUIDE.md`, is exactly that — copy it into other repos).

---

## 8. Should this live in a markdown doc?

**Yes, if any of these are true:**
- You'll have multi-feature sessions in this repo more than once.
- More than one person prompts Claude on this codebase.
- The conventions you want enforced are project-specific (file budgets, folder names, framework choices).

Put it in **two places**:
1. **Repo-specific conventions** → `CLAUDE.md` (or a "Conventions" section in `README.md`). Claude Code reads `CLAUDE.md` automatically. Keep it tight: file/function budgets, folder rules, "where does X go" decision tree, naming conventions, the verification command.
2. **Reusable prompt template** → `PROMPTING_GUIDE.md` (this file). Copy across repos.

**Skip the doc if** the work is a one-off bug fix or a single-file change. Overhead isn't worth it.

---

## 9. Anti-patterns to avoid in your prompts

| Don't write | Why it fails | Write instead |
|---|---|---|
| "Make it cleaner" | Subjective; Claude will guess | "No file > 300 lines; no duplicated logic across files" |
| "Fix all the issues" | Unbounded scope; Claude will sprawl | "Fix the top 3 issues you ranked; defer the rest" |
| "Refactor and add feature X" | Two intents in one session | Two sessions, or one session with X explicitly out of scope |
| "Just do it the right way" | No checkpoint | "Show plan first; I approve before code" |
| "Don't break anything" | Unverifiable | "Run `tsc --noEmit` after each step; paste exit code" |
| "Use best practices" | Best practice for what stack? | "Match the conventions in `<ref file>`" |

---

## 10. When to abandon the plan

Some plans don't survive contact with the code. Tell Claude in advance:

> If during step N you discover the plan was wrong (the file's structure makes the proposed split worse, or there's a hidden dependency), STOP. Tell me what you found and propose a revised plan. Don't proceed with a worse-than-current solution.

This prevents the worst outcome: a half-applied refactor that left the codebase messier than it started.

---

## Reference: what worked in this repo's session

For concrete results, see `SALES_PORTAL_PLAN.md` → **As-Built Architecture (post-refactor)** section. The approach above produced:

- 4 files >300 lines → 0 files >340 lines.
- 3 copies of `ModelRule`/`normalizeRule` logic → 1 canonical home.
- 1 monolithic 390-line API entry → 1 × 45-line entry + 9 × focused route modules.
- All steps verified by `tsc --noEmit` and `vite build` before merging into the next.
