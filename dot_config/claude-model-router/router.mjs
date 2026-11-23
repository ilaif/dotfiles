// Local HTTPS_PROXY for Claude Code: it decrypts api.anthropic.com only, sends Messages API requests whose
// model starts with a route's prefix to that route's origin through its authenticated HTTPS proxy tunnel,
// and passes everything else to Anthropic. Other hosts (claude.ai, Remote Control) are tunnelled untouched.
// Config: ~/.config/claude-model-router/config.json (see README.md next to this file).
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  delete headers[FALLBACK_HEADER];
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
// Sessions opt in to the subscription fallback with this request header (claude-act sets it).
const FALLBACK_HEADER = "x-claude-router-fallback";

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
  if (route.chatModels?.includes(body.model)) return sendAsChat(req, res, body, route);
  forward(req, res, Buffer.from(JSON.stringify(body)), route.url, route.agent, route);
}

// Models a route serves over OpenAI Chat Completions only (Copilot's Gemini): Messages in, Chat Completions upstream,
// Messages (or its SSE stream) back.
const STOP_REASONS = { stop: "end_turn", length: "max_tokens", tool_calls: "tool_use", content_filter: "refusal" };

function sendAsChat(req, res, body, route) {
  const model = `${route.stripModelPrefix ? route.modelPrefix : ""}${body.model}`;
  if (req.url.startsWith("/v1/messages/count_tokens")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ input_tokens: Math.ceil(JSON.stringify(body).length / 4) }));
    return;
  }
  const payload = Buffer.from(JSON.stringify(chatRequest(body)));
  const headers = { ...route.headers, authorization: route.token, "content-type": "application/json", "content-length": payload.length };
  const upstream = https.request(
    { host: route.url.hostname, port: Number(route.url.port || 443), method: "POST", path: "/chat/completions", headers, agent: route.agent },
    (up) => {
      if (up.statusCode !== 200) return relayChatError(up, res);
      if (body.stream) return streamChat(up, res, model);
      readBody(up, Buffer.alloc(0), (raw) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(messageFromChat(JSON.parse(raw), model)));
      });
    },
  );
  upstream.on("error", (err) => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: `claude-model-router: ${err.message}` } }));
  });
  upstream.end(payload);
}

function chatRequest(body) {
  const messages = [];
  const system = typeof body.system === "string" ? body.system : body.system?.map((block) => block.text).join("\n\n");
  if (system) messages.push({ role: "system", content: system });
  for (const message of body.messages) {
    const blocks = typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content;
    if (message.role === "assistant") {
      const text = blocks.filter((block) => block.type === "text").map((block) => block.text).join("");
      const toolCalls = blocks
        .filter((block) => block.type === "tool_use")
        .map((block) => ({ id: block.id, type: "function", function: { name: block.name, arguments: JSON.stringify(block.input) } }));
      messages.push({ role: "assistant", content: text || null, ...(toolCalls.length && { tool_calls: toolCalls }) });
      continue;
    }
    // Tool messages take text only, so images a tool returned (Read on a screenshot) follow as a user message.
    const images = [];
    for (const block of blocks.filter((b) => b.type === "tool_result")) {
      const content = typeof block.content === "string" ? [{ type: "text", text: block.content }] : (block.content ?? []);
      const text = content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      messages.push({ role: "tool", tool_call_id: block.tool_use_id, content: block.is_error ? `Error: ${text}` : text });
      images.push(...content.filter((b) => b.type === "image"));
    }
    const parts = [...images, ...blocks.filter((block) => block.type === "text" || block.type === "image")].map(chatPart);
    if (parts.length) messages.push({ role: "user", content: parts });
  }
  const tools = body.tools
    ?.filter((tool) => tool.input_schema)
    .map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.input_schema } }));
  return {
    model: body.model,
    messages,
    max_tokens: body.max_tokens,
    temperature: body.temperature,
    top_p: body.top_p,
    stop: body.stop_sequences,
    stream: body.stream,
    stream_options: body.stream ? { include_usage: true } : undefined,
    tools: tools?.length ? tools : undefined,
    tool_choice: tools?.length ? chatToolChoice(body.tool_choice) : undefined,
  };
}

function chatPart(block) {
  if (block.type === "text") return { type: "text", text: block.text };
  const url = block.source.type === "url" ? block.source.url : `data:${block.source.media_type};base64,${block.source.data}`;
  return { type: "image_url", image_url: { url } };
}

function chatToolChoice(choice) {
  if (choice?.type === "any") return "required";
  if (choice?.type === "none") return "none";
  if (choice?.type === "tool") return { type: "function", function: { name: choice.name } };
  return "auto";
}

function messageFromChat(chat, model) {
  const { message, finish_reason } = chat.choices[0];
  const content = [];
  if (message.content) content.push({ type: "text", text: message.content });
  for (const call of message.tool_calls ?? []) {
    content.push({ type: "tool_use", id: call.id, name: call.function.name, input: JSON.parse(call.function.arguments || "{}") });
  }
  return {
    id: `msg_${chat.id}`,
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: STOP_REASONS[finish_reason] ?? "end_turn",
    stop_sequence: null,
    usage: { input_tokens: chat.usage?.prompt_tokens ?? 0, output_tokens: chat.usage?.completion_tokens ?? 0 },
  };
}

function streamChat(up, res, model) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  send("message_start", {
    message: { id: `msg_${Date.now()}`, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } },
  });
  let index = -1;
  let open = null;
  let stopReason = "end_turn";
  let usage = {};
  const startBlock = (key, block) => {
    if (open !== null) send("content_block_stop", { index });
    index += 1;
    open = key;
    send("content_block_start", { index, content_block: block });
  };
  let buffer = "";
  up.setEncoding("utf8");
  up.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
      const event = JSON.parse(line.slice(6));
      if (event.usage) usage = event.usage;
      const choice = event.choices?.[0];
      if (!choice) continue;
      if (choice.delta?.content) {
        if (open !== "text") startBlock("text", { type: "text", text: "" });
        send("content_block_delta", { index, delta: { type: "text_delta", text: choice.delta.content } });
      }
      for (const call of choice.delta?.tool_calls ?? []) {
        if (call.id) startBlock(`tool${call.index}`, { type: "tool_use", id: call.id, name: call.function.name, input: {} });
        if (call.function?.arguments) send("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: call.function.arguments } });
      }
      if (choice.finish_reason) stopReason = STOP_REASONS[choice.finish_reason] ?? "end_turn";
    }
  });
  up.on("end", () => {
    if (open !== null) send("content_block_stop", { index });
    send("message_delta", {
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { input_tokens: usage.prompt_tokens ?? 0, output_tokens: usage.completion_tokens ?? 0 },
    });
    send("message_stop", {});
    res.end();
  });
}

function relayChatError(up, res) {
  readBody(up, Buffer.alloc(0), (raw) => {
    res.writeHead(up.statusCode, { "content-type": "application/json" });
    res.end(JSON.stringify({ type: "error", error: { type: up.statusCode === 429 ? "rate_limit_error" : "api_error", message: raw.toString() } }));
  });
}

const subscriptionFallback = config.subscriptionFallback;
const fallbackRoute = subscriptionFallback && routes.find((route) => route.modelPrefix === subscriptionFallback.routePrefix);
const subscriptionResets = new Map();
// The switch state lives in memory, so a restart starts on Claude; drop the status line's copy from the last run.
rmSync(`${dir}/fallback-until`, { force: true });

function forwardWithSubscriptionFallback(req, res, head, model) {
  const credential = createHash("sha256").update(req.headers.authorization ?? "").digest("hex");
  readBody(req, head, (raw) => {
    const useCopilot = () => {
      const body = JSON.parse(raw);
      // A server-side thread continue carries only the new messages; Copilot has no copy of the rest. This error makes
      // Claude Code resend the turn with the whole history and stay stateless on this model for the session.
      if (body.thread?.type === "continue") {
        console.log(`subscription fallback: ${model} thread continue -> asked for a stateless resend`);
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "thread_unsupported_request: the Copilot fallback has no server-side thread", details: { error_code: "thread_unsupported_request" } } }));
        return;
      }
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
      const reset = subscriptionLimitReset(up);
      if (reset) {
        subscriptionResets.set(credential, reset);
        writeFileSync(`${dir}/fallback-until`, String(reset));
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

// The reset to wait for. Trigger "limit": a refused request (429). Otherwise: over the limit (refused, or served as
// extra usage), or a window at preemptAt utilization.
function subscriptionLimitReset(up) {
  const header = (name) => up.headers[`anthropic-ratelimit-unified-${name}`];
  if (subscriptionFallback.trigger === "limit") return up.statusCode === 429 && header("status") === "rejected" && Number(header("reset")) * 1000;
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
    else if (req.url.split("?")[0] === "/v1/messages" && !req.headers["x-api-key"] && req.headers.authorization?.startsWith("Bearer ") && req.headers[FALLBACK_HEADER] && subscriptionFallback?.models[model]) forwardWithSubscriptionFallback(req, res, head, model);
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
