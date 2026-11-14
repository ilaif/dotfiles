---
name: ilai-review
description: Ilai's PR review workflow — requirement first, solution and data model, explainer artifact, GitHub review, author DM, then mandatory evidence-backed learning.
disable-model-invocation: true
argument-hint: <PR number or URL>
---

# ilai-review

Review a PR the way Ilai does: understand what was **asked**, then how the PR **answers** it, then hunt for gaps through Ilai's **lenses**. The reviewer reads an explainer artifact, comments on it, and the result becomes a GitHub review.

Every finding is **real**: a concrete scenario on this code's actual use, verified against source at the PR head. A hypothetical failure is not a finding (it goes nowhere, not even as a nit).

## Steps

### 0. Check the model

Read the model you run on from your system prompt (model name and id). If it is an Opus or an Astra model, continue to step 1. Otherwise, ask Ilai (AskUserQuestion) before any other tool call: name the current model, and offer "continue on <model>" or "stop, I'll switch with `/model`". Stop on anything but an explicit continue.

Done when: the model is Opus or Astra, or Ilai approved continuing on the named model.

### 1. Snapshot the PR

A stack (Ilai says "the stack", or the PR body lists layers): follow [references/stack.md](references/stack.md) for steps 1–8; the lenses and severity below still apply to every layer.

```bash
gh pr view <N> --json title,body,headRefName,headRefOid,files,additions,deletions,reviewDecision,mergeStateStatus,reviewRequests
```

Then list **unresolved** review threads only (GraphQL `reviewThreads`, `isResolved == false`) with author and first line. Bot threads (Codex, CodeRabbit, Baz) count as prior findings: a matching finding of yours becomes "+1 to the thread", not a duplicate.

Done when: you know the head SHA, the linked tickets, the changed areas, and every open thread.

### 2. Check out the head

A sibling worktree, never inside the main clone:

```bash
git fetch -q origin pull/<N>/head:pr-<N> && git worktree add -q ../<repo>-pr<N> pr-<N>
```

Done when: the worktree's HEAD equals `headRefOid`.

### 3. The requirement

Fetch every linked ticket (Linear `get_issue`) and its design reference before writing anything: the ticket records decisions (where config lives, push vs pull, flags) that Ilai already made. From the PR body and its tickets, write the **asks** as a short table: ask id, meaning, what in the PR delivers it. Name the gating (flag, tenant list), the deploy order, and the PR's own Known gaps.

Read your own earlier reviews on the ticket's other PRs (above all the merged base of a stack): `gh api --paginate repos/<o>/<r>/pulls/<M>/reviews` and `/comments`, filtered to `ilaif`. Each must-fix you raised there and the author fixed is a recorded decision: check it still holds at this PR's head (`git log -S '<removed symbol>'` finds the commit that undid it). This once caught an earlier must-fix fix removed by a cherry-picked commit with no rationale.

Done when: every ask maps to a piece of the change, or is marked missing, the ticket's recorded decisions are listed, and every earlier must-fix of yours on the ticket is confirmed to still hold or is a finding. Before any question goes into the artifact or review (yours or Ilai's), check it against that list: a question that reopens a recorded decision is flagged to Ilai as such, not raised to the author.

### 4. The solution

Read the core yourself: migrations and schema, the write path, the read/list path, and any shared code that runs for every tenant.

Map the **data model** before judging anything: every table the feature reads or writes, grouped by layer (domain, per-channel state, routing/config, delivery), with its writer. Name where the new code **hooks into** the existing flow (which workflow, service or capability calls it) and whether it rides an existing framework or a side path. When the feature selects "new" rows, read how those rows are written (upsert on a fixed id? which timestamp moves on update?) before trusting the selection. Delegate the other half (usually the client) to one `sonnet` subagent with a narrow brief: the diff command, the contract files, the focus files, "real correctness bugs only, at most 8, file:line + scenario + fix", and the repo's team rules.

Then **verify** each subagent finding against source yourself, and against the PR's own test evidence (a live proof in the Testing Notes beats a subagent's belief). Keep it, downgrade it (say which path reaches it), or drop it.

Done when: every changed area has been read by you or by the verified subagent, and every lens below has been applied to it.

### 5. The explainer artifact

Run `/explainer-artifact` (repo skill: `.agents/skills/explainer-artifact`) with this arc: requirement → core shift → how it works (diagrams) → **data model: where it hooks in** (table per layer + one card per hook point) → interface changes → **findings** (cards, severity-labelled, each with a `<Src>` link) → checked-and-fine → **proposed model** (for any must-fix that changes the design: today vs proposed cards, a diagram of the proposed flow, the proposed tables and column mapping) → reviewer questions → **things to fix and do**.

Build gotchas: `build.sh` copies only `App.tsx` into `<name>/src`, so copy any extra module (e.g. `shots.ts`) there yourself; diagram step labels are ≤28 chars and actor tags ≤5. If a rendered diagram fails self_check with "does not end with </html>" (the stock `--example` fails too), the renderer wrote a bare `<svg>`: wrap that `.html` in `<!doctype html><html><head><meta charset="utf-8"><title>…</title></head><body>…</body></html>`, run `diagram-to-jsx.sh <name> <file>`, then build without `--specs`. Rebuilds after an edit pass `App.tsx` again, or the old copy builds. The "ticket or PR mentioned without a link" check truncates each line before it looks for `<Ref`, so a `<Ref>` late in a long line still fails it: start the line with the `<Ref>`. `explainer.py start` prints its `App.tsx` scaffold at the end of a long output, so read the output's tail, never `| head`. The same check fails on string props (`beforeLabel`, `note`, card `label`) holding `repo#N`: write "Segments PR" there and keep `<Ref>` for prose. The contact sheet lands at `<workspace>/<name>/.verify/sheet.png`.

Embed the PR description's screenshots beside the sections they illustrate. GitHub attachment URLs need auth; take the signed ones:

```bash
gh api repos/<owner>/<repo>/pulls/<N> -H "Accept: application/vnd.github.full+json" --jq .body_html \
  | grep -oE 'https://private-user-images\.githubusercontent\.com/[^"]+' | sed 's/&amp;/\&/g'
```

Download each within minutes, convert to JPEG (`sips -Z 1100`), inline them as data URIs from a `shots.ts` module, and caption each "from the PR description". Embed only the 2–3 that illustrate a section.

Done when: the page is published, its takeaways read as one story, and every finding has a source link.

### 6. Reviewer comments

The artifact is watched from publish. When Ilai comments:

- Read all threads (`ArtifactComments` read). Threads not sent to Claude can't be replied to: answer each as a **Q-card** in "Reviewer questions" and add its action to "Things to fix and do", then republish.
- A GitHub link `…/changes#diff-<hash>R<line>` names the file by `sha256(path)`: match it against `git diff --name-only` hashes to find the file.
- Research each question in the code first (tables, call sites, real numbers from the PR's test notes) — answer with evidence, not opinion.

Done when: every open thread has a Q-card and, where it implies work, a to-do line.

### 7. The GitHub review

Map every finding, question and to-do to a **diff line** at the head SHA (RIGHT side). Items with no line go into the summary body, which also links the artifact. A review comment can't join an existing thread: a "+1 to <name>" goes in the body or in your own inline comment that names them. When the artifact has a proposed-model section, reply on the must-fix thread with its `#proposed` link.

The review goes out under Ilai's name, so write every inline comment and the summary body with `/writing-like-ilai`: one point per comment, a question or a position, in his voice. Keep the evidence (the scenario, the `file:line`) and drop the artifact's card prose.

Submit as **Comment**, never Request changes. When a must-fix exists, open the body with one line naming it as blocking merge, unless the PR's whole effect sits behind a flag that defaults to off: then name it as "must-fix before the flag turns on", since Ilai approves flag-gated work with open must-fixes. Approve only when Ilai asks for it; an approval goes out as a second review with a one-line body pointing at the inline comments already posted, never a copy of them. Then send the author one Slack line saying it is approved and what to fix before the flag turns on. Submit in one API call:

```bash
gh api -X POST repos/<owner>/<repo>/pulls/<N>/reviews --input review.json   # commit_id, body, event, comments[{path,line,side,body}]
```

Submit with `event` set. A pending review finished in the GitHub UI loses its API-set body, and a submitted empty-body review can't be edited afterwards.

Done when: the review is submitted with its body, and the inline count matches what you mapped.

### 8. DM the author

Find the author's Slack id (`slack_search_users` by name), read the last ~15 DMs to mirror tone, then send one short message with `/writing-like-ilai`. Write it in English always, even when the DM thread is in Hebrew: this overrides writing-like-ilai's reply-in-Hebrew rule (Ilai asked for it):

- the review link + "review is in!"
- TL;DR: the blocker in one line (or "no blockers"), then the questions in one line
- the artifact link (to `#proposed` when there is one)

Done when: the DM is sent and its link is reported.

### 9. Learn and improve (mandatory)

Run this step before the final hand-back of every review, including a review stopped early. When later feedback arrives, repeat it after addressing that feedback.

1. Compare the initial findings and approach with Ilai's corrections, artifact comments, the final review and observed tool failures. Identify missed checks, false positives, evidence that changed a conclusion, and workflow friction. Treat silence as no feedback, not agreement.
2. Turn each reusable lesson into an actionable rule: **trigger → check/action → completion criterion**, with its supporting comment, source link or observed failure. Keep PR-specific facts in the review; promote preferences only when Ilai states them and correctness lessons only when verified against source.
3. Read the current installed `SKILL.md` and any reference you will change. Update the existing owning step or lens in place; use a linked reference for guidance that applies only to a distinct branch. Merge overlapping rules and replace contradicted ones. This step authorizes local updates to this skill and its references; committing, pushing or changing other skills requires separate authorization.
4. Replay each proposed rule against the concrete case that taught it: name what the old instructions missed and how the new instruction would catch or avoid it. Check that the edit preserves source verification, real-findings-only severity and the existing review/DM flow.
5. Report the changed path and one-line lesson. If no reusable lesson is supported, report **“Learning check: no evidence-backed update.”** If an update is blocked, name the blocker rather than claiming this step is complete.

Done when: every supported reusable lesson is saved once in the owning guidance and replay-checked, or the no-update outcome is explicitly reported. The review is not finished until this check is complete.

## Lenses

Apply every lens to every changed area.

- **Requirement fit**: does each ask hold for every input class the code takes? A mode or branch that drops rows the ask says must be visible is a must-fix.
- **Snapshot tables**: stored data must never join or relate to tables the scan pipeline rewrites each run. Records key on natural ids (ARN, account id) or lineage roots, never a version id or snapshot id; snapshot data is read live only. Name every snapshot table the feature touches and how.
- **Replicas**: any in-process cache or state assumes one pod. With several, what does cost and consistency look like across pods (a page's calls split, different staleness windows)?
- **Scale**: what grows the work (items, paths, rows, new data sources)? Prefer joins, filters and pagination in SQL; work rebuilt in memory per request is a GA follow-up. A cap that truncates silently makes counts wrong: ask for a visible "partial results".
- **Flags**: rollout goes through one feature flag checked on both server and client, not a hard-coded tenant list. Two gates (code list + backoffice targeting) is a question: name the failure when they disagree.
- **Settings placement**: routing choices (what to send, where) live where they can be edited later (a rule or settings page), not on a one-time install form.
- **UI at scale**: a list that can grow (cards, chips, samples) needs a table, filter or limit; a sample says it is a sample and links to the full set.
- **Delivery model**: domain tables hold domain objects only; each outbound channel (Slack, SIEM, email) keeps its own state, and every send leaves a delivery row (reuse the existing delivery table before adding one). A path whose only record of a send is a workflow id or a log is a must-fix.
- **Select by state, not time**: "what still needs sending" is a ledger query ("matches, no sent row at this revision"), not "created since run start". A time window silently drops updated rows (repeat events, late-arriving children).
- **Coupling**: a new channel reads the domain through a domain read, not through another channel's repo.
- **Purpose**: every new table, column and event type has a stated job, and shipped code has a caller. Ask "what is X for?" where the PR doesn't say; built-but-unregistered code waits for the PR that exposes it.
- **Shared paths**: code that runs for every tenant keeps its behaviour; check the refactor is a pure move.
- **Layering**: for every new export in a shared lib (`libs/pg` above all), grep its consumers. Shared rules and row mapping used by two apps belong there; policy with one consumer (time horizons, resume rules, "re-enable starts now" in SQL `CASE`) belongs in that app's `domain/` with queries in its `adapters/pg`. A precedent file doing the same is drift, not a justification.
- **Exhaustive mappings**: a `Partial<Record<DomainEnum, …>>` or a lookup with a `?? DEFAULT` fallback over a domain enum: count the unmapped values against the enum's source and name them. Ask for a full `Record` (ideally the kind declared next to the enum) so a new value fails tsc.
- **Liveness**: a schedule or sweep that logs nothing on an idle run can't be told apart from one that never runs. Ask for one log line per run with its counts and a monitor on its absence.

## Severity

- **Must-fix**: wrong data, lost writes, an ask not met, a tenant leak.
- **Question**: a design choice Ilai wants the author to justify or change.
- **Follow-up**: right for now, needs a ticket before GA.
- **Nit**: small, real, cheap.
