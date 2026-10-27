# Artifact Share Nudge

Browser extension for claude.ai artifacts, for any Chromium browser (Chrome, Dia, Arc, Brave, Edge). When an artifact's General access is **Only you**, a banner offers one click to switch it to **Anyone at &lt;your org&gt; · Commenter**. ✕ hides the banner for that artifact for good.

## Install

1. Fetch the files (safe to re-run; it overwrites):

   ```bash
   d=~/.chrome-extensions/artifact-share-nudge; mkdir -p "$d" && for f in manifest.json content.js README.md; do curl -fsSL "https://raw.githubusercontent.com/ilaif/dotfiles/main/dot_chrome-extensions/artifact-share-nudge/$f" -o "$d/$f"; done
   ```

2. Hand the user this step; browsers only load unpacked extensions by hand: in their browser, open `chrome://extensions` → **Developer mode** on → **Load unpacked** → `~/.chrome-extensions/artifact-share-nudge` (⌘⇧. shows hidden folders).

Done when the user opens a private artifact and sees the banner.

## Update

Re-run install step 1, then ↻ the extension in `chrome://extensions` and hard-reload the artifact tab.

## Troubleshooting

- Every log line is prefixed `[share-nudge]`; a timeout names the element it waited for. Filter the DevTools Console on that prefix.
- To show a dismissed banner again, run in that artifact's Console:

  ```js
  localStorage.removeItem(`share-nudge:dismissed:${location.pathname}`)
  ```
