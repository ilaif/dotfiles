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

`claude-foundry` runs one session through the router (sets `HTTPS_PROXY`, `NO_PROXY`, `NODE_EXTRA_CA_CERTS`). For every session: `claude-router on`; `off` points new sessions straight at Anthropic (for when the router is down).

`claude-router status|restart|start|stop|logs|off|on`.
