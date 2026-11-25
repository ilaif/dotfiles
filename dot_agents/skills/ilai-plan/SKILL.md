---
name: ilai-plan
description: Plan a feature, service or change the way Ilai does — verify the current state in code, recommend one design, and publish it as an HTML plan artifact built with web-artifacts-builder. Ilai's default planning artifact.
disable-model-invocation: true
argument-hint: <what to plan>
---

# ilai-plan

Turn "let's plan X" into one published HTML page Ilai can read, comment on and share. The page recommends a
design; it doesn't survey options. Each fact on it was read in the code, at a pinned commit.

Build the page with `/web-artifacts-builder` (load it first), not a Claude Docs doc or hand-written HTML.
If this machine has `references/example-App.tsx` and `references/example-specs.json` (a finished plan,
kept local), start from them. Read `references/local.md` too when it exists: org-specific gotchas.

## Steps

### 1. Ground it in the code

Read the repo's instructions chain (`AGENTS.md` root → target), then the code the plan touches: entry points,
auth and audit paths, the package to copy from. Count what you claim ("~205 procedures"), name the file each
fact comes from, and record `git rev-parse HEAD` for the `meta.sha`.

Done when: every row of "What exists today" has a source file, and you know what already exists vs what's new.

### 2. Draft in the repo

If the repo keeps temporary plans (e.g. a gitignored `docs/plans/YYYY-MM-DD-<name>.md`), write the plan there
first as markdown. It's the text source for the page and survives the session.

### 3. Build the page

Work in the session scratchpad: `<scratchpad>/<slug>/App.tsx` + `specs.json`, then build with this skill's
wrapper, not web-artifacts-builder's `build.sh` directly:

```bash
bash ~/.agents/skills/ilai-plan/scripts/build.sh <slug> App.tsx --specs specs.json --repo <checkout>
```

`App.tsx` imports `'./readable-theme.css'` right after the kit import. The wrapper copies
[assets/readable-theme.css](assets/readable-theme.css) into the build: the Catppuccin palette (Latte light,
Mocha dark; every text token 4.5:1 or better), 72-character lines, nothing under 13px. Never edit web-artifacts-builder for
readability; change that CSS file. Sections, in order; drop any that doesn't apply:

Three parts, each a `group` on its `<Section>`s, in this order. Every section answers one question; a section
whose question the reader wouldn't ask gets folded into another or dropped (no standalone "request end to end"
or "safety" section).

| Part | id | Section: the question it answers | Kit block |
|---|---|---|---|
| Why | `why` | Why: what do people do today, what does it cost, what's missing? | two short `P`s |
| Why | `before-after` | Before and after: what changes for ONE concrete operation? | `BeforeAfter`: a row per aspect, `same` for what doesn't change (checks, audit), `result`, "In short" caption |
| Design | `architecture` | Where does the new piece sit, and why there? | architecture diagram (new node `focal`) + one `Callout` for the rejected alternative |
| Design | `today` | Starting point: what already exists? | `Table` with a `<Src>` per row |
| Design | `security` | Security and auth. **Required whenever identity, tokens, permissions, secrets or audit are involved** | sign-in sequence diagram + `Table`: who signs in · token (issuer, audience, lifetime, refresh) · client registration · edge (Access paths) · authorization (scopes) · audit · untrusted text; the open auth question as a `Callout` |
| Design | `scope` | What does v1 cover, and with which guards? | `Table` + a `Grid cols={3}` of guard `Card`s |
| Design | `out-of-scope` | What's left out, why, and what instead? | `Table`: left out · why · instead |
| Delivery | `changes` | What changes in existing code? | `Changes` (before → after, area, note) |
| Delivery | `delivery` | Which PRs, in which order, how big? | `Steps`, spike first; one PR per seam (deploy step, one-way door) |
| Delivery | `decisions` | What does Ilai need to decide? | `Table`: decision · options · `<Chip kind="add">` recommendation |

Name the real runtime each operation hits, verified in code (e.g. a trigger that enqueues a scheduled job, not
the workflow engine you'd assume).

Page header: `eyebrow="Plan · YYYY-MM-DD"`, `title` = the thing's name, `thesis` = one sentence a newcomer gets.
Every section `takeaway` reads as a sentence; together they tell the whole plan (verify prints this test).

Done when: `build.sh` passes with no ✗, and you've looked at `.verify/sheet.png` once.

### 4. Publish and hand off

Publish `<slug>.html` with the Artifact tool (`icon: "plan"`). Edits later: rebuild and republish the same path
to keep the URL. Reply with the link, the recommendation in one line, and the open decisions with their
recommended answers, so Ilai can answer in one message.

## Gotchas

- **Architecture width:** verify warns past ~1000px (names shrink to 7–9px). Keep ≤ 3 columns: stack side
  stores and externals in row 1, set `"gap": [64, 64]`, and use a zone ("Behind Cloudflare Access") instead of a
  node for a boundary.
- **The no-smell hook** reads prose strings in `App.tsx` as code: the word "any" in a table cell trips its
  any-cast check. Rephrase ("every staff token").
- **Sizes are concrete** ("half a day", "2 days"); a piece you can't size yet says "not sized yet" and what
  sizes it.
- Recommend out of v1 anything that would put a credential or login link into a tool result or transcript.
