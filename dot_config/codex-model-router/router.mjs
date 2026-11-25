// Local model provider for Codex: requests whose model starts with a route's prefix go to that route's
// base URL with a bearer token from its tokenCommand; everything else passes through untouched to the
// ChatGPT Codex backend with Codex's own ChatGPT auth headers.
// Config: ~/.config/codex-model-router/config.json
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import http from "node:http";
import { homedir } from "node:os";
import { Readable } from "node:stream";
import zlib from "node:zlib";

const config = JSON.parse(readFileSync(`${homedir()}/.config/codex-model-router/config.json`, "utf8"));

function refreshToken(route) {
  route.ready = new Promise((resolve, reject) => {
    execFile("/bin/sh", ["-c", route.tokenCommand], { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`token command failed: ${stderr.trim() || err.message}`));
      route.token = stdout.trim();
      resolve();
    });
  });
  route.ready.catch((err) => console.error(err.message));
}

const routes = config.routes.map((route) => ({ ...route }));
for (const route of routes) {
  refreshToken(route);
  setInterval(() => refreshToken(route), (route.refreshSeconds ?? 240) * 1000);
}

const DECODE = { zstd: zlib.zstdDecompressSync, gzip: zlib.gunzipSync, br: zlib.brotliDecompressSync, deflate: zlib.inflateSync };

function modelOf(req, body) {
  if (!body.length) return undefined;
  const encoding = req.headers["content-encoding"];
  const json = encoding ? DECODE[encoding](body) : body;
  return JSON.parse(json.toString("utf8")).model;
}

// Hop-by-hop and length headers fetch sets itself.
const DROP = new Set(["host", "connection", "content-length", "transfer-encoding", "keep-alive"]);

async function forward(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const model = modelOf(req, body);
  const route = model && routes.find((r) => model.startsWith(r.modelPrefix));

  const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !DROP.has(k)));
  let target = `${config.default}${req.url}`;
  if (route) {
    await route.ready;
    target = `${route.base}${req.url}`;
    delete headers["chatgpt-account-id"];
    headers.authorization = `Bearer ${route.token}`;
  }

  const up = await fetch(target, { method: req.method, headers, body: body.length ? body : undefined });
  console.log(`${req.method} ${req.url} model=${model ?? "-"} -> ${new URL(target).host} ${up.status}`);
  const outHeaders = Object.fromEntries([...up.headers].filter(([k]) => !DROP.has(k) && k !== "content-encoding"));
  res.writeHead(up.status, outHeaders);
  if (up.body) Readable.fromWeb(up.body).pipe(res);
  else res.end();
}

const server = http.createServer((req, res) => {
  forward(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: `codex-model-router: ${err.message}` } }));
  });
});

server.listen(config.port ?? 8788, "127.0.0.1", () => console.log(`codex-model-router on 127.0.0.1:${config.port ?? 8788}`));
