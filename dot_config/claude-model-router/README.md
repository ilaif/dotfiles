# claude-model-router

A local `HTTPS_PROXY` for Claude Code that adds extra models without slowing down Claude ones or losing Remote Control.

- Claude Code keeps talking to `api.anthropic.com` (no `ANTHROPIC_BASE_URL`), so Remote Control and other first-party features stay on.
- The router decrypts `api.anthropic.com` only, with a local CA it creates in `tls/` on first start and Claude Code trusts via `NODE_EXTRA_CA_CERTS`. Other hosts (claude.ai, the Remote Control bridge, OAuth) are tunnelled untouched.
- `POST /v1/messages*` whose `model` starts with a route's `modelPrefix` goes to that route's `origin`, through an HTTPS proxy tunnel authenticated with `Proxy-Authorization` from `tokenCommand` (refreshed in the background). First-party-only body fields the gateway rejects (`diagnostics`, `safeguards`, `thread`) are dropped.
- Everything else goes straight to `https://api.anthropic.com` with your normal Claude login.
- Node only, no dependencies; runs as the LaunchAgent `dev.claude-model-router` on `127.0.0.1:8787`.

## Enable

1. Create `~/.config/claude-model-router/config.json` (not tracked; it holds your gateway details):

   ```json
   {
     "port": 8787,
     "routes": [
       {
         "modelPrefix": "my-gateway/",
         "origin": "https://gateway.example.com:8443",
         "tokenCommand": "my-token-helper",
         "refreshSeconds": 240
       }
     ]
   }
   ```

   `tokenCommand` prints the full header value, e.g. `Bearer <token>`. `proxy` defaults to `origin`.

2. Create `~/.claude/settings.private.json` (not tracked), merged over the tracked Claude settings:

   ```json
   {
     "env": { "ENABLE_TOOL_SEARCH": "true" },
     "modelPicker": {
       "replaceBuiltInOptions": false,
       "options": [{ "model": "my-gateway/model-a", "label": "Gateway — Model A" }]
     }
   }
   ```

3. `chezmoi apply`. The LaunchAgent is installed and started only when `config.json` exists.

## Operate

`claude-foundry` runs one session through the router (sets `HTTPS_PROXY`, `NO_PROXY`, `NODE_EXTRA_CA_CERTS`). On the Mac, `claude` is the same alias. For every session: `claude-router on`; `off` points new sessions straight at Anthropic (for when the router is down).

`claude-router status|restart|start|stop|logs|off|on`.

## GitHub Copilot

Quick start: `cp ~/.config/claude-model-router/config.example.json ~/.config/claude-model-router/config.json`, authenticate (below), `chezmoi apply`, then `claude-router restart`.

To pick Copilot models in `/model`, add rows to `modelPicker.options` in `~/.claude/settings.json` (or `settings.private.json`):

```json
{ "model": "copilot/claude-opus-5.5", "label": "GitHub Copilot — Opus 5.5", "behavesAs": "claude-opus-5-5" },
{ "model": "copilot/claude-sonnet-5.5", "label": "GitHub Copilot — Sonnet 5.5", "behavesAs": "claude-sonnet-5-5" },
{ "model": "copilot/claude-haiku-5.5", "label": "GitHub Copilot — Haiku 5.5", "behavesAs": "claude-haiku-5-5" }
```

`claude-copilot` starts Claude Code on your saved `/model` (e.g. Opus) with the subscription fallback below turned on for that session. Pick a `copilot/…` row in `/model` to use Copilot from the start.

Authenticate with `npm exec --yes --package=copilot-api@0.7.0 -- copilot-api auth`. It saves the GitHub credential locally with mode 0600; never track that file. `claude-copilot-token` exchanges it for a short-lived Copilot token.

Add a route to the untracked router config with `modelPrefix: "copilot/"`, `origin: "https://api.githubcopilot.com"`, `authMode: "bearer"`, `stripModelPrefix: true`, and `tokenCommand: "$HOME/.local/bin/claude-copilot-token"`. Bearer routes use direct HTTPS, replace the incoming authorization, and remove API keys and cookies. Their optional `headers` object supplies the upstream integration headers. Set `stripCacheScope: true` for Copilot: its Messages API rejects Claude Code's cache scope field. Restart the router after changing its config. The launcher disables Claude Code's advisor tool because Copilot rejects its executor/advisor pairing.

### Subscription fallback

With a top-level `subscriptionFallback` in `config.json`, Claude subscription requests from sessions that send `x-claude-router-fallback` (`claude-copilot` sets it through `ANTHROPIC_CUSTOM_HEADERS`; the router strips it) move to the Copilot route before extra (on-demand) usage starts, and return after the limit resets. Each response's `anthropic-ratelimit-unified-*` headers decide it:

- a 5h or 7d window at `preemptAt` utilization or above: Copilot until that window's reset;
- `anthropic-ratelimit-unified-status: rejected` (over the limit): Copilot until `anthropic-ratelimit-unified-reset`. A refused request (429) is retried on Copilot in the same call; one already served as extra usage (200) is delivered, and the next request moves.

Fallback requests drop Claude thinking blocks from the history, since Copilot rejects their signatures. Ordinary 429s, auth errors, API-key requests and models missing from `models` pass through unchanged. State is in memory: a router restart re-checks Claude on the next request. The router writes the reset time to `fallback-until`; the ccstatusline widget `claude-router-statusline` shows `⇄ Claude` or `⇄ Copilot until HH:MM` in `claude-copilot` sessions. Watch it with `claude-router logs` (`subscription fallback: <model> -> <model>`).

```json
"subscriptionFallback": {
  "routePrefix": "copilot/",
  "preemptAt": 0.98,
  "models": { "claude-opus-5-5": "claude-opus-5.5", "claude-sonnet-5-5": "claude-sonnet-5.5" }
}
```

This relies on GitHub's unofficial Copilot API; access and model availability depend on your subscription and organization policy. See [Copilot API](https://github.com/ericc-ch/copilot-api) and [native Messages integration](https://docs.litellm.ai/docs/providers/github_copilot).
