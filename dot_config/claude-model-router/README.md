# claude-model-router

A local `HTTPS_PROXY` for Claude Code that adds extra models through a local [Bifrost](https://github.com/maximhq/bifrost) gateway, without slowing down Claude models or losing Remote Control.

- Claude Code keeps talking to `api.anthropic.com` (no `ANTHROPIC_BASE_URL`), so Remote Control and other first-party features stay on. Bifrost alone would need `ANTHROPIC_BASE_URL`.
- The router decrypts `api.anthropic.com` only, with a local CA it creates in `tls/` on first start and Claude Code trusts via `NODE_EXTRA_CA_CERTS`. Other hosts (claude.ai, the Remote Control bridge, OAuth) are tunnelled untouched.
- `POST /v1/messages*` for a provider-prefixed model (`github-copilot/claude-opus-5.5`, `gateway/vendor/model-a`) goes to Bifrost's Anthropic route; Bifrost picks the provider from the first segment. The router drops your Claude login headers and Claude Code's first-party `diagnostics`/`safeguards` fields on the way.
- Claude models go straight to Anthropic with your normal Claude login, server-side threads included.
- **Limit fallback:** once the subscription is spent (`anthropic-ratelimit-unified-status: rejected`, which Anthropic sends both when it serves a request from extra usage and when it refuses one with `429`), the router sends Claude-model requests to the `limitFallback` model through Bifrost until `anthropic-ratelimit-unified-reset`, without thinking blocks (their signatures belong to the Claude account). The request that first sees the rejection is still served from extra usage if it is available, or retried on the fallback if refused. Ordinary rate limits stay with Claude Code's own retries. The spent-until time lives in memory, so after a router restart the first request tries Claude again. The router writes the route each session last used to `sessions/<session id>`; the ccstatusline widget `claude-router-statusline` shows it as `⇄ Claude`, `⇄ Copilot` or `⇄ Foundry` (Foundry and Copilot model picks come from the model id).
- A non-Claude model behind a custom `base_provider_type: "anthropic"` provider needs a `datasheet_overrides` entry per model in `bifrost/config.json`: `{"provider": "anthropic", "model": "<model without the custom provider prefix>", "params_patch": {"supports_native_mid_conversation_system": true}}`. Without it, Bifrost (v2.6.0) rewrites Claude Code's mid-conversation `role: "system"` messages as `<system-reminder>` user turns, which GPT models refuse ("I cannot assist with that request", then a mid-response server error). The key is the base provider type, not the custom provider's name. A system message followed by a user turn stays inlined either way, because Anthropic's placement rule requires that.
- Bifrost refuses Claude Code's server-side thread continues (`thread_unsupported_request`), so Claude Code resends the full history and stays stateless on that model for the session. Without this, a gateway sees only the newest messages.
- The router starts Bifrost (`npx @maximhq/bifrost`, version pinned in `config.json`) as a child on `127.0.0.1:8790` and exits when it does, so launchd restarts both. Node only, no dependencies; runs as the LaunchAgent `dev.claude-model-router` on `127.0.0.1:8787`.

## Enable

1. `~/.config/claude-model-router/config.json` (untracked; start from `config.example.json`):

   ```json
   {
     "port": 8787,
     "bifrost": { "port": 8790, "version": "v2.6.0" },
     "limitFallback": { "claude-opus-5-5": "github-copilot/claude-opus-5.5" },
     "upstreamProxies": []
   }
   ```

2. `~/.config/claude-model-router/bifrost/config.json` (untracked; start from `bifrost.config.example.json`). This file is Bifrost's whole configuration (no config database, no auth on its localhost port). Requests are logged to `bifrost/logs.db` as metadata only (model, provider, tokens, latency, status; `disable_content_logging` keeps prompts and responses out). Restart the router after editing it.

3. `~/.claude/settings.private.json` (untracked), merged over the tracked Claude settings. Claude Code accepts only models listed here:

   ```json
   {
     "modelPicker": {
       "replaceBuiltInOptions": false,
       "options": [
         { "model": "github-copilot/claude-opus-5.5", "label": "GitHub Copilot — Opus 5.5", "behavesAs": "claude-opus-5-5" },
         { "model": "github-copilot/gemini-4-neon", "label": "GitHub Copilot — Gemini 4 Neon" }
       ]
     }
   }
   ```

4. `chezmoi apply`. The LaunchAgent is installed and started only when `config.json` exists.

## Operate

`claude-act` runs one session through the router. On the Mac, `claude` is an alias for it. For every session, including Claude Code in the Desktop app: `claude-router on` writes the proxy into the `env` of `~/.claude/settings.json`; `off` removes it and points new sessions straight at Anthropic (for when the router is down).

`claude-router status|restart|start|stop|logs|console|off|on`. `logs` shows both the router (`limit fallback: <model> -> <model>`) and Bifrost; `console` opens the Bifrost dashboard (requests, tokens, latency per model and provider).

## GitHub Copilot

Bifrost's native `github-copilot` provider: Claude models over Copilot's Messages endpoint, others (Gemini, GPT) over Chat Completions or Responses, editor headers and Copilot token refresh included. The router passes it the GitHub token from `~/.local/share/copilot-api/github_token` as `GITHUB_COPILOT_TOKEN`. Sign in once with `npm exec --yes --package=copilot-api@0.7.0 -- copilot-api auth` (device login; never track that file).

One-line install on a Mac (no chezmoi needed; sets aside a pre-Bifrost `config.json`, signs in to Copilot, starts the router):

```sh
curl -fsSL https://raw.githubusercontent.com/ilaif/dotfiles/main/claude-act-install.sh | bash
```

The launcher disables Claude Code's advisor tool because Copilot rejects its executor/advisor pairing. This relies on GitHub's unofficial Copilot API; see [Bifrost's Copilot provider](https://docs.getbifrost.ai/providers/supported-providers/github-copilot).

## A gateway behind an authenticated proxy

Some gateways are reached only through an HTTPS proxy that wants a short-lived `Proxy-Authorization` token, which Bifrost's proxy settings can't produce. Point the Bifrost provider's `proxy_config` at the router and list the host in `upstreamProxies`; the router chains that CONNECT through the real proxy with a token from `tokenCommand` (refreshed every `refreshSeconds`, and on a `407`):

```json
"upstreamProxies": [
  { "host": "gateway.example.com:8443", "proxy": "https://gateway.example.com:8443", "tokenCommand": "my-token-helper", "refreshSeconds": 240 }
]
```

```json
"gateway": {
  "keys": [],
  "network_config": { "base_url": "https://gateway.example.com:8443", "default_request_timeout_in_seconds": 600 },
  "proxy_config": { "type": "http", "url": "http://127.0.0.1:8787" },
  "custom_provider_config": { "base_provider_type": "anthropic", "is_key_less": true }
}
```

Bifrost strips only the first `provider/` segment, so a gateway that wants its own prefix (`vendor/model-a`) is reached as `gateway/vendor/model-a`. A keyless provider sends no `x-api-key`, for gateways that authenticate at the proxy and refuse one.
