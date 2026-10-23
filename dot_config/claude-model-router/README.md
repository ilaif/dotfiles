# claude-model-router

A local `ANTHROPIC_BASE_URL` for Claude Code that adds extra models without slowing down Claude ones.

- Requests whose `model` starts with a route's `modelPrefix` go to that route's `origin`, through an HTTPS proxy tunnel authenticated with `Proxy-Authorization` from `tokenCommand` (refreshed in the background).
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
     "env": { "ANTHROPIC_BASE_URL": "http://127.0.0.1:8787", "ENABLE_TOOL_SEARCH": "true" },
     "modelPicker": {
       "replaceBuiltInOptions": false,
       "options": [{ "model": "my-gateway/model-a", "label": "Gateway — Model A" }]
     }
   }
   ```

3. `chezmoi apply`. The LaunchAgent is installed and started only when `config.json` exists.

## Operate

`claude-router status|restart|start|stop|logs|off|on`. `off` points new Claude sessions straight at Anthropic (for when the router is down); `on` points them back.
