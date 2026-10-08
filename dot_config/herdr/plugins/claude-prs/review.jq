# Review status of a `gh pr view --json author,latestReviews,reviewRequests` object, counting only
# humans: bots, the PR author and team review requests are ignored.
def human: (.login // .author.login // "") as $l | ($l | endswith("[bot]") | not) and .authorAssociation != "NONE";

def review_state:
  .author.login as $me
  | [.latestReviews[] | select(human and .author.login != $me) | .state] as $s
  | if any($s[]; . == "CHANGES_REQUESTED") then "CHANGES"
    elif any($s[]; . == "APPROVED") then "APPROVED"
    elif any($s[]; . == "COMMENTED") then "COMMENTED"
    elif any(.reviewRequests[]; .__typename == "User" and human) then "REQUESTED"
    else "NONE" end;

def review_icon: {NONE: "○", REQUESTED: "◐", COMMENTED: "◆", CHANGES: "◆", APPROVED: "●"}[. // ""] // "";

def review_rgb: {NONE: "98;114;164", REQUESTED: "241;250;140", COMMENTED: "255;184;108", CHANGES: "255;85;85", APPROVED: "80;250;123"}[. // ""] // "248;248;242";

def review_badge: if review_icon == "" then "" else "\u001b[38;2;\(review_rgb)m\(review_icon)\u001b[0m " end;
