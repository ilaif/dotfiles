# Herdr tab name
On the first prompt of a session, when `HERDR_ENV=1`, name the tab after the topic before any other tool call. Read the label with `herdr tab get "$HERDR_TAB_ID" | jq -r .result.tab.label`; if it is only digits (Herdr's default), run `herdr tab rename "$HERDR_TAB_ID" <slug>`, where the slug is 2–4 lowercase kebab-case words naming the topic (e.g. `pr1759-grokbot-review`). A non-numeric label was set on purpose: leave it.

# Pull requests
After opening a PR (any repo), suggest 1–3 reviewers and ask me who to assign. Base the picks on the code owners for the changed paths and on who recently changed those files (`git log`), with one line of reasoning each. The question is non-blocking: keep working (CI, review loop) while it waits, and assign only the people I name.

# Code style
- Happy path only. Write for the cases this code meets in real use; a guard, retry, fallback or re-check lands only after its failure is observed. The same bar applies to review findings (bots and humans): decline a hypothetical failure in the reply instead of patching it.
- Guards stay on security paths (authz, secrets, audit) and input validation at trust boundaries.
- Plain functions over classes; flat early returns over nested try/catch.

# Shell (Bash tool runs zsh)
- zsh never word-splits an unquoted `$var`: `set -- $s`, `for x in $list` and `cmd $args` each see one word, so a loop or test built on splitting silently never matches or never exits. Split explicitly instead: `awk '{print $2}' <<<"$s"`, `${(f)var}` for lines, `${=var}` for whitespace, or write the logic in a bash script (`bash -c '…'`).
- Name variables anything but `path`: in zsh it is tied to `PATH`.

# Subagents
Set `model` on every Agent call by use case. Never rely on `CLAUDE_CODE_SUBAGENT_MODEL`; it overrides this choice.
- haiku: file search, grep sweeps, log and CI triage, summarizing output
- sonnet: implementation, tests, fixing review comments, routine code review
- opus: design and planning, hard debugging, security-sensitive review
- fable: only when the user asks for it

@~/.codex/RTK.md
