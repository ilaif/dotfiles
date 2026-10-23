// Local ANTHROPIC_BASE_URL for Claude Code: requests whose model starts with a route's prefix go to
// that route's origin through its authenticated HTTPS proxy tunnel; everything else goes to Anthropic.
// Config: ~/.config/claude-model-router/config.json (see README.md next to this file).
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { homedir } from "node:os";
import tls from "node:tls";

const config = JSON.parse(readFileSync(`${homedir()}/.config/claude-model-router/config.json`, "utf8"));
const anthropic = new URL(config.anthropic ?? "https://api.anthropic.com");
const directAgent = new https.Agent({ keepAlive: true });

function tokenCommand(route) {
  return new Promise((resolve, reject) => {
    execFile("/bin/sh", ["-c", route.tokenCommand], { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`token command failed: ${stderr.trim() || err.message}`));
      else resolve(stdout.trim());
    });
  });
}

async function refreshToken(route) {
  route.token = await tokenCommand(route);
}

// An https.Agent whose sockets are TLS-to-proxy, CONNECT origin, then TLS-to-origin; kept alive and reused.
function tunnelAgent(route) {
  const origin = new URL(route.origin);
  const proxy = new URL(route.proxy ?? route.origin);
  const agent = new https.Agent({ keepAlive: true });
  agent.createConnection = (_options, callback) => {
    const outer = tls.connect({ host: proxy.hostname, port: Number(proxy.port || 443), servername: proxy.hostname });
    outer.once("error", callback);
    outer.once("secureConnect", () => {
      outer.write(`CONNECT ${origin.host} HTTP/1.1\r\nHost: ${origin.host}\r\nProxy-Authorization: ${route.token}\r\n\r\n`);
      let head = "";
      const onData = (chunk) => {
        head += chunk.toString("latin1");
        if (!head.includes("\r\n\r\n")) return;
        outer.off("data", onData);
        const status = Number(head.split(" ")[1]);
        if (status !== 200) {
          if (status === 407) refreshToken(route).catch(() => {});
          outer.destroy();
          callback(new Error(`proxy CONNECT ${status}: ${head.split("\r\n")[0]}`));
          return;
        }
        const inner = tls.connect({ socket: outer, servername: origin.hostname });
        inner.once("secureConnect", () => callback(null, inner));
        inner.once("error", callback);
      };
      outer.on("data", onData);
    });
  };
  return agent;
}

const routes = config.routes.map((route) => ({ ...route, agent: tunnelAgent(route), url: new URL(route.origin) }));

// Claude Code sends "model" as the body's first key, so the route is known from the first bytes.
const MODEL = /^\s*\{\s*"model"\s*:\s*"([^"]*)"/;

function forward(req, res, head, target, agent) {
  const headers = { ...req.headers, host: target.host };
  const upstream = https.request(
    { host: target.hostname, port: Number(target.port || 443), method: req.method, path: req.url, headers, agent },
    (up) => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", (err) => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: `claude-model-router: ${err.message}` } }));
  });
  if (req.readableEnded) return upstream.end(head);
  upstream.write(head);
  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  let head = Buffer.alloc(0);
  const route = () => {
    const model = MODEL.exec(head.toString("latin1"))?.[1];
    const match = model && routes.find((r) => model.startsWith(r.modelPrefix));
    req.off("data", onData);
    req.off("end", route);
    if (match) forward(req, res, head, match.url, match.agent);
    else forward(req, res, head, anthropic, directAgent);
  };
  const onData = (chunk) => {
    head = Buffer.concat([head, chunk]);
    if (head.length >= 256 || MODEL.test(head.toString("latin1"))) {
      req.pause();
      route();
    }
  };
  req.on("data", onData);
  req.on("end", route);
});

await Promise.all(routes.map(refreshToken));
for (const route of routes) setInterval(() => refreshToken(route).catch((err) => console.error(err.message)), (route.refreshSeconds ?? 240) * 1000);
server.listen(config.port ?? 8787, "127.0.0.1", () => console.log(`claude-model-router on 127.0.0.1:${config.port ?? 8787}`));
