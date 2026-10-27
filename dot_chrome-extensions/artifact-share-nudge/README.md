# Artifact Share Nudge

Chrome extension for claude.ai artifacts. On load, if an artifact's General access is **Only you**, a banner offers one click to switch it to **Anyone at &lt;your org&gt; · Commenter**. ✕ dismisses the banner per artifact (stored in localStorage).

## Install (agents: run this, then hand the user the manual step)

```bash
mkdir -p ~/.chrome-extensions && git clone --depth 1 https://github.com/ilaif/dotfiles /tmp/df && cp -R /tmp/df/dot_chrome-extensions/artifact-share-nudge ~/.chrome-extensions/ && open -a "Google Chrome" "chrome://extensions"
```

Manual step (Chrome blocks scripted unpacked installs): turn on **Developer mode** → **Load unpacked** → choose `~/.chrome-extensions/artifact-share-nudge` (⌘⇧. shows hidden folders).

## Update

Edit `content.js`, then ↻ the extension in `chrome://extensions` and hard-reload the artifact tab.

## Notes

- Works for any org: it picks the "Anyone at …" option. Role (Commenter) is set in `makeOrgCommenter()` in `content.js`.
- Debug: DevTools Console, filter `[share-nudge]`.
- Re-enable a dismissed banner: `localStorage.removeItem(\`share-nudge:dismissed:${location.pathname}\`)`.
