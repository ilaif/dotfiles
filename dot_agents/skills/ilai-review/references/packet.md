# Reviewing a packet

A packet is several PRs reviewed together ("in one review packet", or an author's overview page listing them), often across repos (app, infrastructure, gitops) with a deploy order. The lenses and severity in `SKILL.md` apply to every PR.

1. **Snapshot all PRs in one loop** (step 1's commands per PR). Read the riskiest semantics yourself; split the rest across ≤2 `sonnet` subagents by area. Check `ilaif` reviews already on each PR: a PR Ilai approved takes an inline nit only, never a second approval. Done when every PR has a head SHA and its open threads.
2. **Trial-merge** every head onto `origin/main` in one scratch worktree per repo (`git merge --no-edit pr-<N>` in turn, or `git merge-tree --write-tree --name-only origin/main pr-<N>`). A conflict confined to a generated file is a one-line "regenerate" note, not a finding. Done when each repo's set merges or its conflicts are named.
3. **The author's overview page** counts as an ask source: check each of its claims about stored data or behavior against the code (one said "we store the token's expiry"; nothing did). Its screenshots feed step 5's "see it working" when the PRs have none.
4. **One artifact for the packet**: Part 1's PR table carries each PR's deploy step.
5. **Post**: a review on each PR that carries an item. When Ilai asks to approve, the PRs with no item get an `APPROVE` with a short "LGTM" body (plus any one-line housekeeping note, e.g. a bot thread to resolve); otherwise list them to Ilai as "ready to approve". Done when every PR has a review or is listed.
6. **One DM** to the author for the whole packet (step 8), linking the PR that holds the findings.
