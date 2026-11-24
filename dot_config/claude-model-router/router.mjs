// Local HTTPS_PROXY for Claude Code in front of a local Bifrost gateway. It decrypts api.anthropic.com only:
// Messages API requests for a provider-prefixed model ("github-copilot/…", "gateway/…") go to Bifrost, the rest
// go to Anthropic with your normal Claude login, and a request Claude refuses because the subscription and extra usage
// are spent is retried on Bifrost. Other hosts (claude.ai, Remote Control) are tunnelled untouched; tunnels to an
// `upstreamProxies` host (Bifrost's own outbound traffic) are chained through that proxy with a refreshed token.
// Config: ~/.config/claude-model-router/config.json (see README.md next to this file).
import { execFile, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { homedir } from "node:os";
import { dirname } from "node:path";
import tls from "node:tls";

const dir = process.env.CLAUDE_MODEL_ROUTER_DIR ?? `${homedir()}/.config/claude-model-router`;
const config = JSON.parse(readFileSync(`${dir}/config.json`, "utf8"));
const anthropic = new URL("https://api.anthropic.com");
const bifrostPort = config.bifrost?.port ?? 8790;
const bifrost = new URL(`http://127.0.0.1:${bifrostPort}`);

// Bifrost runs as a child, file-only from bifrost/config.json; the router exits with it so launchd restarts both.
const copilotToken = `${homedir()}/.local/share/copilot-api/github_token`;
const bifrostProcess = spawn(
  `${dirname(process.execPath)}/npx`,
  ["-y", "@maximhq/bifrost", "--transport-version", config.bifrost?.version ?? "v2.6.0", "-app-dir", `${dir}/bifrost`, "-host", "127.0.0.1", "-port", String(bifrostPort), "-log-level", "warn"],
  { stdio: "inherit", env: { ...process.env, GITHUB_COPILOT_TOKEN: existsSync(copilotToken) ? readFileSync(copilotToken, "utf8").trim() : "" } },
);
bifrostProcess.on("exit", (code) => {
  console.error(`bifrost exited (${code})`);
  process.exit(1);
});
process.on("SIGTERM", () => {
  bifrostProcess.kill();
  process.exit(0);
});
const anthropicAgent = new https.Agent({ keepAlive: true });
const bifrostAgent = new http.Agent({ keepAlive: true });
const limitFallback = config.limitFallback ?? {};

const upstreamProxies = new Map(
  (config.upstreamProxies ?? []).map((proxy) => {
    const p = { ...proxy, url: new URL(proxy.proxy) };
    p.ready = refreshToken(p);
    p.ready.catch((err) => console.error(err.message));
    setInterval(() => refreshToken(p).catch((err) => console.error(err.message)), (p.refreshSeconds ?? 240) * 1000);
    return [p.host, p];
  }),
);

function refreshToken(proxy) {
  return new Promise((resolve, reject) => {
    execFile("/bin/sh", ["-c", proxy.tokenCommand], { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`token command failed: ${stderr.trim() || err.message}`));
      proxy.token = stdout.trim();
      resolve();
    });
  });
}

function sendError(res, status, message) {
  if (!res.headersSent) res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: `claude-model-router: ${message}` } }));
}

function forwardToAnthropic(req, res, body, onResponse) {
  const upstream = https.request(
    { host: anthropic.hostname, port: 443, method: req.method, path: req.url, headers: { ...req.headers, host: anthropic.host }, agent: anthropicAgent },
    (up) => {
      if (onResponse) return onResponse(up);
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", (err) => sendError(res, 502, err.message));
  if (body) return upstream.end(body);
  req.pipe(upstream);
}

// Bifrost serves every provider with its own credentials, so Claude login headers stay here. Claude Code's
// first-party telemetry fields go too (some gateways refuse `diagnostics`); Bifrost itself refuses `thread`.
function forwardToBifrost(req, res, payload) {
  delete payload.diagnostics;
  delete payload.safeguards;
  const body = Buffer.from(JSON.stringify(payload));
  const headers = { ...req.headers, host: bifrost.host, "content-length": body.length };
  delete headers.authorization;
  delete headers["x-api-key"];
  delete headers.cookie;
  const upstream = http.request(
    { host: bifrost.hostname, port: bifrost.port, method: req.method, path: `/anthropic${req.url}`, headers, agent: bifrostAgent },
    (up) => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", (err) => sendError(res, 502, `bifrost: ${err.message}`));
  upstream.end(body);
}

// Claude refuses with 429 + unified-status "rejected" only once the subscription and any extra usage are spent;
// ordinary rate limits stay with Claude Code's own retries.
function forwardWithLimitFallback(req, res, raw, body) {
  forwardToAnthropic(req, res, raw, (up) => {
    const refused = up.statusCode === 429 && up.headers["anthropic-ratelimit-unified-status"] === "rejected";
    if (!refused) {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
      return;
    }
    up.resume();
    up.on("end", () => {
      const model = body.model;
      body.model = limitFallback[model];
      // The fallback account rejects thinking signatures minted on the Claude account.
      for (const message of body.messages) {
        if (Array.isArray(message.content)) message.content = message.content.filter((block) => !["thinking", "redacted_thinking"].includes(block.type));
      }
      console.log(`limit fallback: ${model} -> ${body.model}`);
      forwardToBifrost(req, res, body);
    });
  });
}

function handle(req, res) {
  if (req.method !== "POST" || !req.url.startsWith("/v1/messages")) return forwardToAnthropic(req, res);
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const raw = Buffer.concat(chunks);
    const body = JSON.parse(raw);
    if (body.model.includes("/")) return forwardToBifrost(req, res, body);
    if (limitFallback[body.model] && req.url.split("?")[0] === "/v1/messages") return forwardWithLimitFallback(req, res, raw, body);
    forwardToAnthropic(req, res, raw);
  });
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

// TLS to the upstream proxy, then CONNECT with its token; the client's own TLS runs inside the returned socket.
function chainedTunnel(proxy, target, callback) {
  const outer = tls.connect({ host: proxy.url.hostname, port: Number(proxy.url.port || 443), servername: proxy.url.hostname });
  outer.once("error", callback);
  outer.once("secureConnect", () => {
    outer.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\nProxy-Authorization: ${proxy.token}\r\n\r\n`);
    let head = "";
    const onData = (chunk) => {
      head += chunk.toString("latin1");
      if (!head.includes("\r\n\r\n")) return;
      outer.off("data", onData);
      const status = Number(head.split(" ")[1]);
      if (status === 200) return callback(null, outer);
      if (status === 407) refreshToken(proxy).catch(() => {});
      outer.destroy();
      callback(new Error(`proxy CONNECT ${status}: ${head.split("\r\n")[0]}`));
    };
    outer.on("data", onData);
  });
}

const server = http.createServer(handle);
const decrypted = http.createServer(handle);
const secureContext = tls.createSecureContext(anthropicCert());

function pipeBoth(client, upstream) {
  upstream.on("error", () => client.destroy());
  client.on("error", () => upstream.destroy());
  upstream.pipe(client);
  client.pipe(upstream);
}

server.on("connect", (req, client, head) => {
  const [host, port] = req.url.split(":");
  if (head.length) client.unshift(head);
  const proxy = upstreamProxies.get(req.url);
  if (proxy) {
    proxy.ready.then(
      () => chainedTunnel(proxy, req.url, (err, upstream) => {
        if (err) {
          console.error(err.message);
          return client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        }
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        pipeBoth(client, upstream);
      }),
      () => client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"),
    );
    return;
  }
  client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
  if (host === anthropic.hostname) {
    decrypted.emit("connection", new tls.TLSSocket(client, { isServer: true, secureContext, ALPNProtocols: ["http/1.1"] }));
    return;
  }
  pipeBoth(client, net.connect(Number(port || 443), host));
});

server.listen(config.port ?? 8787, "127.0.0.1", () => console.log(`claude-model-router on 127.0.0.1:${config.port ?? 8787}`));
