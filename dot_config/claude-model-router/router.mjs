// Local HTTPS_PROXY for Claude Code: it decrypts api.anthropic.com only, sends Messages API requests whose
// model starts with a route's prefix to that route's origin through its authenticated HTTPS proxy tunnel,
// and passes everything else to Anthropic. Other hosts (claude.ai, Remote Control) are tunnelled untouched.
// Config: ~/.config/claude-model-router/config.json (see README.md next to this file).
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { homedir } from "node:os";
import tls from "node:tls";

const dir = `${homedir()}/.config/claude-model-router`;
const config = JSON.parse(readFileSync(`${dir}/config.json`, "utf8"));
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
    route.ready.then(() => connect(callback), callback);
  };
  const connect = (callback) => {
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

const routes = config.routes.map((route) => {
  const r = { ...route, url: new URL(route.origin) };
  r.agent = r.authMode === "bearer" ? directAgent : tunnelAgent(r);
  r.ready = refreshToken(r);
  r.ready.catch((err) => console.error(err.message));
  return r;
});

// Claude Code sends "model" as the body's first key, so the route is known from the first bytes.
const MODEL = /^\s*\{\s*"model"\s*:\s*"([^"]*)"/;

function forward(req, res, head, target, agent, route, onResponse) {
  const headers = { ...req.headers, host: target.host };
  if (route?.authMode === "bearer") {
    delete headers["x-api-key"];
    delete headers.cookie;
    headers.authorization = route.token;
    Object.assign(headers, route.headers);
  }
  if (req.readableEnded) headers["content-length"] = head.length;
  const upstream = https.request(
    { host: target.hostname, port: Number(target.port || 443), method: req.method, path: req.url, headers, agent },
    (up) => {
      if (onResponse) return onResponse(up);
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

// Body fields Claude Code sends only to first-party Anthropic; the gateway rejects them with a 400.
const FIRST_PARTY_FIELDS = ["diagnostics", "safeguards", "thread"];

function forwardToRoute(req, res, head, route) {
  readBody(req, head, (body) => sendToRoute(req, res, body, route));
}

function readBody(req, head, send) {
  const chunks = [head];
  if (req.readableEnded) return send(head);
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => send(Buffer.concat(chunks)));
  req.resume();
}

async function sendToRoute(req, res, raw, route) {
  const body = JSON.parse(raw);
  for (const field of FIRST_PARTY_FIELDS) delete body[field];
  if (route.stripModelPrefix && body.model.startsWith(route.modelPrefix)) body.model = body.model.slice(route.modelPrefix.length);
  if (route.stripCacheScope) stripCacheScope(body);
  if (route.disableAdvisor) body.tools = body.tools?.filter((tool) => !tool.type?.startsWith("advisor_"));
  try {
    await route.ready;
  } catch (err) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: err.message } }));
    return;
  }
  forward(req, res, Buffer.from(JSON.stringify(body)), route.url, route.agent, route);
}

const subscriptionFallback = config.subscriptionFallback;
const fallbackRoute = subscriptionFallback && routes.find((route) => route.modelPrefix === subscriptionFallback.routePrefix);
const subscriptionResets = new Map();

function forwardWithSubscriptionFallback(req, res, head, model) {
  const credential = createHash("sha256").update(req.headers.authorization ?? "").digest("hex");
  readBody(req, head, (raw) => {
    const useCopilot = () => {
      const body = JSON.parse(raw);
      body.model = subscriptionFallback.models[model];
      // Copilot rejects thinking signatures minted on the Claude subscription account.
      for (const message of body.messages) {
        if (Array.isArray(message.content)) message.content = message.content.filter((block) => !["thinking", "redacted_thinking"].includes(block.type));
      }
      console.log(`subscription fallback: ${model} -> ${body.model}`);
      sendToRoute(req, res, Buffer.from(JSON.stringify(body)), fallbackRoute);
    };
    if (Date.now() < subscriptionResets.get(credential)) return useCopilot();
    forward(req, res, raw, anthropic, directAgent, undefined, (up) => {
      const reset = subscriptionLimitReset(up.headers);
      if (reset) {
        subscriptionResets.set(credential, reset);
        console.log(`subscription limit reached; Copilot until ${new Date(reset).toISOString()}`);
      }
      const refused = up.statusCode === 429 && up.headers["anthropic-ratelimit-unified-status"] === "rejected";
      if (!refused) {
        res.writeHead(up.statusCode, up.headers);
        up.pipe(res);
        return;
      }
      up.resume();
      up.on("end", useCopilot);
    });
  });
}

// Over the limit (refused, or served as extra usage), or a window at preemptAt utilization: the reset to wait for.
function subscriptionLimitReset(headers) {
  const header = (name) => headers[`anthropic-ratelimit-unified-${name}`];
  if (header("status") === "rejected") return Number(header("reset")) * 1000;
  const window = ["5h", "7d"].find((w) => Number(header(`${w}-utilization`)) >= subscriptionFallback.preemptAt);
  return window && Number(header(`${window}-reset`)) * 1000;
}

function stripCacheScope(value) {
  if (!value || typeof value !== "object") return;
  if (value.cache_control) delete value.cache_control.scope;
  for (const child of Object.values(value)) stripCacheScope(child);
}

// Only the Messages API carries a model; every other path goes straight to Anthropic.
function handle(req, res) {
  if (req.method !== "POST" || !req.url.startsWith("/v1/messages")) return forward(req, res, Buffer.alloc(0), anthropic, directAgent);
  let head = Buffer.alloc(0);
  const route = () => {
    const model = MODEL.exec(head.toString("latin1"))?.[1];
    const match = model && routes.find((r) => model.startsWith(r.modelPrefix));
    req.off("data", onData);
    req.off("end", route);
    if (match) forwardToRoute(req, res, head, match);
    else if (req.url.split("?")[0] === "/v1/messages" && !req.headers["x-api-key"] && req.headers.authorization?.startsWith("Bearer ") && subscriptionFallback?.models[model]) forwardWithSubscriptionFallback(req, res, head, model);
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
}

// A local CA (trusted by Claude Code via NODE_EXTRA_CA_CERTS) and a leaf for the Anthropic host, made once.
function anthropicCert() {
  const tlsDir = `${dir}/tls`;
  const openssl = (...args) => execFileSync("openssl", args, { cwd: tlsDir, stdio: "ignore" });
  if (!existsSync(`${tlsDir}/leaf.pem`)) {
    mkdirSync(tlsDir, { recursive: true, mode: 0o700 });
    writeFileSync(`${tlsDir}/leaf.ext`, `subjectAltName=DNS:${anthropic.hostname}\nextendedKeyUsage=serverAuth\n`);
    openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.pem", "-days", "3650",
      "-subj", "/CN=claude-model-router local CA", "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign");
    openssl("req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", "leaf.key", "-out", "leaf.csr", "-subj", `/CN=${anthropic.hostname}`);
    openssl("x509", "-req", "-in", "leaf.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-out", "leaf.pem", "-days", "825",
      "-extfile", "leaf.ext");
  }
  return { key: readFileSync(`${tlsDir}/leaf.key`), cert: readFileSync(`${tlsDir}/leaf.pem`) };
}

const server = http.createServer(handle);
const decrypted = http.createServer(handle);
const secureContext = tls.createSecureContext(anthropicCert());

server.on("connect", (req, client, head) => {
  const [host, port] = req.url.split(":");
  client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
  if (head.length) client.unshift(head);
  if (host === anthropic.hostname) {
    decrypted.emit("connection", new tls.TLSSocket(client, { isServer: true, secureContext, ALPNProtocols: ["http/1.1"] }));
    return;
  }
  const upstream = net.connect(Number(port || 443), host);
  upstream.on("error", () => client.destroy());
  client.on("error", () => upstream.destroy());
  upstream.pipe(client);
  client.pipe(upstream);
});

for (const route of routes) setInterval(() => refreshToken(route).catch((err) => console.error(err.message)), (route.refreshSeconds ?? 240) * 1000);
server.listen(config.port ?? 8787, "127.0.0.1", () => console.log(`claude-model-router on 127.0.0.1:${config.port ?? 8787}`));
