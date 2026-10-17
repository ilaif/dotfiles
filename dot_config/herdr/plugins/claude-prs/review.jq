# Review status of a `gh pr view --json author,latestReviews,reviewRequests,mergeStateStatus` object, counting
# only humans: bots, the PR author and team review requests are ignored. An approved PR that GitHub would still
# not merge (missing code-owner review, required checks, conflicts, behind base) is APPROVED_BLOCKED. GitHub
# reports UNKNOWN until its first query computes the state, so UNKNOWN counts as mergeable.
def human: (.login // .author.login // "") as $l | ($l | endswith("[bot]") | not) and .authorAssociation != "NONE";

def review_state:
  .author.login as $me
  | [.latestReviews[] | select(human and .author.login != $me) | .state] as $s
  | if any($s[]; . == "CHANGES_REQUESTED") then "CHANGES"
    elif any($s[]; . == "APPROVED") then
      (if .mergeStateStatus | IN("BLOCKED", "BEHIND", "DIRTY", "DRAFT") then "APPROVED_BLOCKED" else "APPROVED" end)
    elif any($s[]; . == "COMMENTED") then "COMMENTED"
    elif any(.reviewRequests[]; .__typename == "User" and human) then "REQUESTED"
    else "NONE" end;

def review_icon: {NONE: "○", REQUESTED: "◐", COMMENTED: "◆", CHANGES: "◆", APPROVED_BLOCKED: "◕", APPROVED: "●"}[. // ""] // "";

def review_rgb: {NONE: "98;114;164", REQUESTED: "241;250;140", COMMENTED: "255;184;108", CHANGES: "255;85;85", APPROVED_BLOCKED: "80;250;123", APPROVED: "80;250;123"}[. // ""] // "248;248;242";

def review_badge: if review_icon == "" then "" else "\u001b[38;2;\(review_rgb)m\(review_icon)\u001b[0m " end;
