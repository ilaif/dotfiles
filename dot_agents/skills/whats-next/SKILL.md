---
name: whats-next
description: Rank my next work item from Slack saved items, DMs, mentions, open PRs and review requests, correlating each PR with its Herdr session.
disable-model-invocation: true
---

# What's next

Fill the local store with what changed since the last run, then rank every open item and name the one to do now.

Store: `~/.claude/skills/whats-next/store.sh` (SQLite). An item is **fresh** when its key is new or its version differs from the stored one; only fresh items get read in full. Keys and versions are in the table below.

| kind | key | version |
| --- | --- | --- |
| `saved` | Slack permalink | message ts of the newest reply |
| `dm` | Slack permalink of the thread root | ts of the newest message |
| `mention` | Slack permalink of the thread root | ts of the newest message |
| `pr` | PR URL | `headRefOid` + `reviewDecision` + `updatedAt` |
| `review` | PR URL | `headRefOid` + `updatedAt` |

## 1. Fetch listings

Run in parallel; every call returns listing metadata only. My Slack user id is `U094RC7A7R6`.

Every Slack search passes `response_format: detailed`, `include_context: false`, `natural_language_query: ""`: only the detailed format returns the `Permalink` and `Message_ts` fields.

- **saved**: `slack_search_public_and_private` with `filters: "is:saved"`, paged to the end.
- **dm**: same tool, `filters: "is:dm after:<today-7d>"`, `channel_types: "im,mpim"`, `sort: timestamp`, paged to the end. Skip results with empty text.
- **mention**: same tool, `keywords: ["<@U094RC7A7R6>"]`, `filters: "after:<today-7d>"`, `sort: timestamp`, paged to the end. Bot posts (Nudge, Linear) rank with people; keep them and let step 4 rank.
- **pr**: `gh search prs --author @me --state open --limit 100 --json repository,number,title,url,isDraft,updatedAt`, then `gh pr view <url> --json headRefName,headRefOid,reviewDecision,mergeStateStatus,statusCheckRollup,reviewThreads` for each.
- **review**: `gh search prs --review-requested @me --state open --limit 100 --json repository,number,title,url,isDraft,updatedAt`, then `gh pr view <url> --json headRefOid,author,additions,deletions`.

Done when every source ran to its last page and each item has a key and version.

## 2. Read the fresh items

Compare each listing against `store.sh known <kind>`; read in full only the fresh ones (`slack_read_thread` for Slack, `gh pr view --comments` for PRs). Summarize each in one line that carries the ask, who is waiting, and any deadline. `store.sh upsert` every fresh item, then `store.sh prune <kind> <keys…>` per kind so items that left the listing (answered DMs, merged PRs) disappear. Slack items replied to by me after their version count as handled: `store.sh resolve <key>`.

Done when every fresh key is upserted and every kind is pruned to its current listing.

## 3. Correlate PRs with Herdr

`herdr workspace list` gives each workspace's `label`, `workspace_id` and `worktree.checkout_path`. Take `git -C <checkout_path> branch --show-current` for each and match it to the PR's `headRefName`. Pass the matched `"<label> (<workspace_id>)"` as the `herdr` field when upserting the PR. A PR without a matching workspace has an empty herdr field.

Done when every PR is matched or confirmed unmatched.

## 4. Rank

Read `store.sh open`. Order by who is blocked and for how long:

1. A review requested of me, or a DM or mention asking me a direct question: a person is waiting on me.
2. My PR blocked on me: red CI, merge conflict, unresolved threads, a change requested.
3. My PR approved and ready to merge.
4. Saved-for-later items.
5. My PRs waiting on reviewers.

Within a tier, older first. Name one item as **next**, with the reason in one line and a time estimate in minutes.

## 5. Output

Lead with **Next**: the link, the one-line reason, the estimate, then the first action doable in under two minutes. Below it, the ranked rest as a table of at most five rows per tier, `Tier | Item | Why | Links`. Every row links its Slack permalink or PR URL; a PR row carries its Herdr session next to the PR link (`PR URL · herdr: label (id)`), and `herdr workspace focus <id>` is the jump command. Items beyond five in a tier collapse into a count with the link to the oldest.
