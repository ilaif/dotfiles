import json
import re
import sys

payload = json.load(sys.stdin)
prompt = payload.get("prompt", "")
if re.search(r"\b(status|ready|readiness|merge|review|prep|prepare)\b", prompt, re.IGNORECASE):
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": "For any PR status, preparation for review/merge, or readiness report in this turn: freshly fetch unresolved review threads from GitHub for every PR in scope, explicitly inspect CodeRabbit comments and its current review completion status. Do not reuse earlier no-comments results or infer no findings from green/neutral CI. Distinguish CodeRabbit, Baz and human findings. If review is running or the fetch fails, state that instead of claiming no comments. This is a required check, not authorization to merge or post replies."}}))
