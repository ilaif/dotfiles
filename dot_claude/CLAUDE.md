# graphify
- **graphify** (`~/.claude/skills/graphify/SKILL.md`) - any input to knowledge graph. Trigger: `/graphify`
When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

# Pull requests
- After opening a PR (any repo), suggest 1–3 reviewers and ask me who to assign. Base the picks on the code owners for the changed paths and on who recently changed those files (`git log`), with one line of reasoning each. The question is non-blocking: keep working (CI, review loop) while it waits, and assign only the people I name.

# Code style
- Assume the happy path. No defensive code: no guards for states that can't happen, no repeated state re-checks, no list-then-reread, no catch-and-continue for unlikely races, no fallback chains, no optional chaining on always-set fields. Add a guard only after a real failure is observed.
- Keep guards only on security paths (authz, secrets, audit) and input validation at trust boundaries.
- Write for the cases you expect to happen, not every case that could. This holds for review findings too (bots and humans): a hypothetical failure (hang, crash, leak, race, odd input) gets no code until it is observed or very likely in this code's real use. Decline it in the reply instead of patching.
- Prefer plain functions over classes; prefer the simplest readable flow (flat early returns over nested try/catch).
