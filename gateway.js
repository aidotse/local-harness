#!/usr/bin/env node
/*
 * local-harness gateway
 *
 * A zero-dependency reverse proxy that routes OpenAI-compatible (and, via
 * translation, Anthropic Messages API) traffic from coding tools (VS Code /
 * Copilot Chat, Claude Code, OpenCode) to:
 *   - local model servers (Ollama, vLLM, LM Studio, ...)
 *   - subscription wrappers (copilot-api, claude-code proxies, gemini wrappers)
 *
 * It injects audit headers ("zero token tax"), writes a JSONL audit log,
 * and serves an admin GUI on /admin for configuration.
 *
 * No npm packages. Node >= 18. Everything binds to 127.0.0.1 by default.
 */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { URL } = require('url');
const { spawn } = require('child_process');
const crypto = require('crypto');
const { StringDecoder } = require('string_decoder');

const ROOT = __dirname;
// Overridable so the regression suite can run an isolated instance
const CONFIG_PATH = process.env.HARNESS_CONFIG || path.join(ROOT, 'config.json');
const PUBLIC_DIR = path.join(ROOT, 'public');
const LOG_DIR = process.env.HARNESS_LOG_DIR || path.join(ROOT, 'logs');

const MAX_REQUEST_BODY = 32 * 1024 * 1024; // 32 MB cap on buffered request bodies
const RING_SIZE = 500; // in-memory audit entries kept for the GUI

// Hop-by-hop headers must not be forwarded by a proxy (RFC 7230 §6.1)
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length',
]);

const DEFAULT_CONFIG = {
  host: '127.0.0.1',
  port: 4000,
  defaultLane: 'local',
  audit: {
    enabled: true,
    developerId: 'my-username',
    project: 'my-codebase',
    extraHeaders: {},
    logToFile: true,
  },
  lanes: [
    {
      id: 'local',
      name: 'Local model (Ollama)',
      prefix: '/local',
      target: 'http://127.0.0.1:11434',
      enabled: true,
      stripPrefix: true,
      apiKey: '',
      healthPath: '/v1/models',
      notes: 'Ollama default port. For vLLM use http://127.0.0.1:8000',
    },
    {
      id: 'copilot',
      name: 'GitHub Copilot subscription',
      prefix: '/copilot',
      target: 'http://127.0.0.1:4141',
      enabled: false,
      stripPrefix: true,
      apiKey: '',
      healthPath: '/v1/models',
      notes: 'Run a copilot-api wrapper on port 4141 first',
    },
    {
      id: 'claude',
      name: 'Claude subscription (Claude Code CLI)',
      prefix: '/claude',
      type: 'claude-cli',
      command: 'claude',
      enabled: false,
      stripPrefix: true,
      models: ['sonnet', 'opus', 'haiku'],
      defaultModel: 'sonnet',
      notes: 'Log in once: npm i -g @anthropic-ai/claude-code --ignore-scripts, then run "claude" and /login with your claude.ai account.',
    },
    {
      id: 'gemini',
      name: 'Gemini subscription (Gemini CLI)',
      prefix: '/gemini',
      type: 'gemini-cli',
      command: 'gemini',
      enabled: false,
      stripPrefix: true,
      models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
      defaultModel: 'gemini-2.5-pro',
      notes: 'Log in once: npm i -g @google/gemini-cli --ignore-scripts, then run "gemini" and sign in with the Google account that holds your subscription (Google AI Pro/Ultra quota is used automatically if that account has one — otherwise the free Code Assist tier). Google is rolling out a replacement "antigravity" CLI; if "gemini" stops working, just change the CLI command field below to "antigravity".',
    },
  ],
};

// ---------------------------------------------------------------------------
// CLI-backed lanes ("built-in subscription wrappers")
//
// Instead of trusting a third-party proxy with your session tokens, these
// lanes spawn the OFFICIAL provider CLI per request. You log in once in the
// CLI (claude -> /login, gemini -> Google sign-in); the CLI keeps the OAuth
// token; the gateway only translates OpenAI-protocol requests to CLI calls.

const CLI_PROVIDERS = {
  'claude-cli': {
    defaultCommand: 'claude',
    buildArgs(model, system) {
      const args = ['-p', '--output-format', 'json'];
      if (model) args.push('--model', model);
      if (system) args.push('--append-system-prompt', system);
      return args;
    },
    promptViaStdin: true,
    systemInPrompt: false,
    parse(stdout) {
      const j = JSON.parse(stdout);
      if (j.is_error) throw new Error(j.result || 'claude CLI reported an error');
      return {
        text: typeof j.result === 'string' ? j.result : '',
        usage: j.usage ? {
          prompt_tokens: j.usage.input_tokens ?? 0,
          completion_tokens: j.usage.output_tokens ?? 0,
        } : undefined,
      };
    },
    loginHint: 'Run "claude" in a terminal and type /login to sign in with your claude.ai subscription.',
    installCmd: 'npm install -g @anthropic-ai/claude-code --ignore-scripts',
    // Best-effort local check: Claude Code records the OAuth account in ~/.claude.json
    loginStatus() {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8'));
        const email = j.oauthAccount && j.oauthAccount.emailAddress;
        return email ? { loggedIn: true, account: email } : { loggedIn: false };
      } catch {
        return { loggedIn: false };
      }
    },
  },
  'gemini-cli': {
    defaultCommand: 'gemini',
    // Gemini CLI's documented non-interactive pattern is `-p "<prompt>"` as
    // an argv value, not raw stdin without -p (stdin-only invocation isn't
    // guaranteed to enter headless mode). No --output-format flag: plain-text
    // output is stable across CLI versions, JSON output is not.
    buildArgs(model, _system, prompt) {
      const args = ['-p', prompt];
      if (model) args.push('-m', model);
      return args;
    },
    promptViaStdin: false,
    systemInPrompt: true,
    parse(stdout) {
      return { text: stdout.trim() };
    },
    loginHint: 'Run "gemini -p \'say hi\'" directly in a terminal (not through this gateway) and watch what happens. If it asks to open a browser or fails the same way, your account\'s Google OAuth / Gemini Code Assist login isn\'t fully established yet — this is between you and Google, the gateway can\'t complete that for you. Common causes: signed in with a different Google account than the one holding your subscription, or a Workspace-managed account that Google restricts from personal Code Assist. If Code Assist genuinely isn\'t available for your account, use the "Gemini Pro via your browser session" lane instead (Lanes → advanced) — it uses the gemini.google.com web app directly and sidesteps Code Assist entirely.',
    installCmd: 'npm install -g @google/gemini-cli --ignore-scripts',
    // Best-effort local check: Gemini CLI stores OAuth creds under ~/.gemini
    loginStatus() {
      try {
        const dir = path.join(os.homedir(), '.gemini');
        if (!fs.existsSync(path.join(dir, 'oauth_creds.json'))) return { loggedIn: false };
        let account = null;
        try {
          account = JSON.parse(fs.readFileSync(path.join(dir, 'google_accounts.json'), 'utf8')).active || null;
        } catch { /* account name is optional */ }
        return { loggedIn: true, account };
      } catch {
        return { loggedIn: false };
      }
    },
  },
};

// Open a real terminal window running the CLI so the user can complete the
// interactive OAuth login from the GUI ("sign in here" button).
function openLoginTerminal(cmd) {
  const manual = `If no window opened, run "${cmd}" in any terminal yourself.`;
  try {
    let child;
    if (process.platform === 'darwin') {
      const script = `tell application "Terminal"\n  activate\n  do script "${cmd.replace(/[\\"]/g, '\\$&')}"\nend tell`;
      child = spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' });
    } else if (process.platform === 'win32') {
      child = spawn('cmd', ['/c', 'start', 'cmd', '/k', cmd], { detached: true, stdio: 'ignore' });
    } else {
      child = spawn('x-terminal-emulator', ['-e', cmd], { detached: true, stdio: 'ignore' });
    }
    child.on('error', () => {});
    child.unref();
    return { ok: true, launched: `terminal window running "${cmd}"`, manual };
  } catch (err) {
    return { ok: false, error: err.message, manual };
  }
}

// ---------------------------------------------------------------------------
// Anthropic Messages API <-> OpenAI Chat Completions translation
//
// Proxy lanes expose an OpenAI-compatible upstream. When a client that speaks
// Anthropic's wire format (e.g. Claude Code with ANTHROPIC_BASE_URL pointing
// at a local lane) sends POST /v1/messages the gateway:
//   1. Translates the Anthropic request body -> OpenAI chat/completions body
//   2. Re-routes the request to /v1/chat/completions on the same upstream
//   3. Translates the OpenAI response (or SSE stream) back to Anthropic format
// The upstream never sees Anthropic-format traffic.

function anthropicToOpenAI(anthropicBody) {
  const systemParts = [];
  // Anthropic's top-level "system" field -> OpenAI system message
  if (anthropicBody.system) {
    const sysText = typeof anthropicBody.system === 'string'
      ? anthropicBody.system
      : Array.isArray(anthropicBody.system)
        ? anthropicBody.system.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n')
        : '';
    if (sysText) systemParts.push(sysText);
  }

  const turns = [];
  for (const msg of (anthropicBody.messages || [])) {
    // Anthropic's spec reserves "messages" for user/assistant turns only, but
    // some clients (Claude Code included) embed extra role:"system" entries
    // inside it anyway. Forwarding them in their original position breaks
    // OpenAI backends that strictly require the system message to come
    // first ("System message must be at the beginning" — reproduced and
    // confirmed against a real vLLM deployment), so pull them out here and
    // merge them into the single leading system message instead.
    if (msg.role === 'system') {
      const content = typeof msg.content === 'string' ? msg.content
        : Array.isArray(msg.content) ? msg.content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n')
        : '';
      if (content) systemParts.push(content);
      continue;
    }

    if (msg.role === 'assistant') {
      // An assistant turn can mix plain text with the assistant's own past
      // tool_use blocks (Claude Code replays these as history on later
      // turns) — OpenAI expects that as a "tool_calls" array on the message.
      if (typeof msg.content === 'string') {
        turns.push({ role: 'assistant', content: msg.content });
      } else if (Array.isArray(msg.content)) {
        const text = msg.content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n');
        const toolUse = msg.content.filter((b) => b && b.type === 'tool_use');
        const out = { role: 'assistant', content: text || null };
        if (toolUse.length) {
          out.tool_calls = toolUse.map((b) => ({
            id: b.id, type: 'function',
            function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
          }));
        }
        turns.push(out);
      } else {
        turns.push({ role: 'assistant', content: '' });
      }
      continue;
    }

    // role === "user" (or anything else Anthropic might send)
    if (typeof msg.content === 'string') {
      turns.push({ role: msg.role, content: msg.content });
    } else if (Array.isArray(msg.content)) {
      // tool_result blocks -> one OpenAI role:"tool" message each. Anthropic
      // lets a single user turn carry several results plus ordinary text;
      // OpenAI wants each result as its own message.
      const toolResults = msg.content.filter((b) => b && b.type === 'tool_result');
      for (const tr of toolResults) {
        const trText = typeof tr.content === 'string' ? tr.content
          : Array.isArray(tr.content) ? tr.content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n')
          : '';
        turns.push({ role: 'tool', tool_call_id: tr.tool_use_id, content: tr.is_error ? `Error: ${trText}` : trText });
      }
      const text = msg.content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n');
      if (!toolResults.length || text) turns.push({ role: msg.role, content: text });
    } else {
      turns.push({ role: msg.role, content: '' });
    }
  }

  const messages = [];
  if (systemParts.length) messages.push({ role: 'system', content: systemParts.join('\n') });
  messages.push(...turns);

  const out = { model: anthropicBody.model, messages };
  if (anthropicBody.max_tokens !== undefined) out.max_tokens = anthropicBody.max_tokens;
  if (anthropicBody.temperature !== undefined) out.temperature = anthropicBody.temperature;
  if (anthropicBody.top_p !== undefined) out.top_p = anthropicBody.top_p;
  if (Array.isArray(anthropicBody.stop_sequences)) out.stop = anthropicBody.stop_sequences;
  if (anthropicBody.stream) out.stream = true;

  // Tool-calling: an agentic Anthropic client (Claude Code above all) can
  // only read files, run commands, etc. if its tool definitions actually
  // reach the model in a structured form. Without this, the model has no
  // real mechanism to call a tool and may hallucinate free-text pseudo-tool
  // syntax instead (reproduced directly: garbled "Read x / List files..."
  // text in the response, with the client unable to parse it and exiting).
  if (Array.isArray(anthropicBody.tools) && anthropicBody.tools.length) {
    out.tools = anthropicBody.tools.filter((t) => t && t.name).map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description || '',
        parameters: t.input_schema || { type: 'object', properties: {} },
      },
    }));
  }
  if (anthropicBody.tool_choice) {
    const tc = anthropicBody.tool_choice;
    if (tc.type === 'auto') out.tool_choice = 'auto';
    else if (tc.type === 'any') out.tool_choice = 'required';
    else if (tc.type === 'none') out.tool_choice = 'none';
    else if (tc.type === 'tool' && tc.name) out.tool_choice = { type: 'function', function: { name: tc.name } };
  }
  return out;
}

function openAIToAnthropic(openAIResp, reqId, requestedModel) {
  const choice = openAIResp.choices?.[0];
  const msg = choice?.message || {};
  const content = [];
  if (typeof msg.content === 'string' && msg.content) {
    content.push({ type: 'text', text: msg.content });
  }
  for (const tc of (msg.tool_calls || [])) {
    let input;
    try { input = JSON.parse(tc.function?.arguments || '{}'); } catch { input = {}; }
    content.push({ type: 'tool_use', id: tc.id || `toolu_${reqId}_${content.length}`, name: tc.function?.name || '', input });
  }
  if (!content.length) content.push({ type: 'text', text: '' }); // keep the shape stable even for an empty reply
  const fr = choice?.finish_reason ?? 'stop';
  return {
    id: `msg_harness_${reqId}`,
    type: 'message',
    role: 'assistant',
    content,
    model: requestedModel || openAIResp.model || '',
    // tool_calls is OpenAI's finish_reason when the model wants to call a
    // tool — Claude Code relies on stop_reason: "tool_use" specifically to
    // know it should execute the tool(s) and send back a tool_result turn.
    stop_reason: fr === 'tool_calls' ? 'tool_use' : fr === 'length' ? 'max_tokens' : 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: openAIResp.usage?.prompt_tokens ?? 0,
      output_tokens: openAIResp.usage?.completion_tokens ?? 0,
    },
  };
}

// Collapse an OpenAI messages array into (system, prompt) for a single-shot CLI call
function flattenMessages(messages) {
  const system = [];
  const turns = [];
  for (const m of messages || []) {
    const content = typeof m.content === 'string' ? m.content
      : Array.isArray(m.content) ? m.content.map((p) => (p && p.text) || '').join('\n')
      : '';
    if (m.role === 'system' || m.role === 'developer') system.push(content);
    else if (m.role === 'assistant') turns.push(`Assistant: ${content}`);
    else turns.push(`User: ${content}`);
  }
  let prompt;
  if (turns.length === 1 && turns[0].startsWith('User: ')) {
    prompt = turns[0].slice('User: '.length);
  } else {
    prompt = turns.join('\n\n') + "\n\nReply with only the assistant's next message.";
  }
  return { system: system.join('\n\n'), prompt };
}

function runCli(command, args, stdinText, res) {
  // stdinText may be '' when the provider delivers the prompt via argv
  // instead (see promptViaStdin) — an empty/closed stdin is still sent so
  // the child never blocks waiting for input that will never arrive.
  return new Promise((resolve, reject) => {
    // cwd = tmpdir so an agentic CLI never sees this project's files
    const child = spawn(command, args, { cwd: os.tmpdir(), env: process.env });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`${command} timed out after 600s`));
    }, 600000);
    res.on('close', () => {
      if (!settled) child.kill('SIGTERM'); // client hung up: stop burning quota
    });
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(err.code === 'ENOENT'
        ? `"${command}" is not installed (or not on PATH)`
        : `failed to launch "${command}": ${err.message}`));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.on('error', () => {}); // CLI may exit before reading stdin
    child.stdin.end(stdinText);
  });
}

async function cliRequest(req, res, lane, viaDefault) {
  const started = Date.now();
  const id = ++requestCounter;
  const provider = CLI_PROVIDERS[lane.type];

  let forwardPath = req.url.split('?')[0];
  if (!viaDefault && lane.stripPrefix !== false) {
    forwardPath = forwardPath.slice(lane.prefix.length) || '/';
  }

  if (req.method === 'GET' && forwardPath === '/v1/models') {
    return jsonResponse(res, 200, {
      object: 'list',
      data: (lane.models || []).map((m) => ({ id: m, object: 'model', owned_by: lane.id })),
    });
  }
  if (req.method !== 'POST' || forwardPath !== '/v1/chat/completions') {
    return jsonResponse(res, 404, {
      error: `CLI lane "${lane.id}" supports GET ${lane.prefix}/v1/models and POST ${lane.prefix}/v1/chat/completions`,
    });
  }

  let body;
  try {
    body = JSON.parse((await readBody(req, MAX_REQUEST_BODY)).toString('utf8'));
  } catch {
    return jsonResponse(res, 400, { error: 'request body must be JSON' });
  }

  // Clients often send their own alias (e.g. "harness-claude") — map anything
  // we don't recognize to the lane's default model.
  const requested = typeof body.model === 'string' ? body.model : '';
  const model = (lane.models || []).includes(requested) ? requested : (lane.defaultModel || requested);
  const { system, prompt } = flattenMessages(body.messages);
  const fullPrompt = provider.systemInPrompt && system
    ? `System instructions:\n${system}\n\n${prompt}`
    : prompt;
  const args = provider.buildArgs(model, provider.systemInPrompt ? '' : system, fullPrompt);
  const command = lane.command || provider.defaultCommand;

  const finish = (status, errMsg, text) => auditRecord({
    ts: new Date().toISOString(),
    id,
    lane: lane.id,
    method: req.method,
    path: req.url,
    target: `cli:${command}`,
    model,
    stream: !!body.stream,
    status,
    durationMs: Date.now() - started,
    bytesIn: Buffer.byteLength(JSON.stringify(body)),
    bytesOut: text ? Buffer.byteLength(text) : 0,
    ...(errMsg ? { error: errMsg } : {}),
  });

  let result;
  try {
    const run = await runCli(command, args, provider.promptViaStdin ? fullPrompt : '', res);
    if (run.code !== 0) {
      const detail = (run.stderr || run.stdout || '').trim().slice(0, 800);
      const authy = /login|auth|credential|unauthorized|sign.?in/i.test(detail);
      finish(502, `exit ${run.code}`);
      return jsonResponse(res, 502, {
        error: `${command} exited with code ${run.code}`,
        detail,
        ...(authy ? { hint: provider.loginHint } : {}),
      });
    }
    result = provider.parse(run.stdout);
  } catch (err) {
    finish(502, err.message);
    return jsonResponse(res, 502, { error: err.message, hint: provider.loginHint });
  }

  const created = Math.floor(Date.now() / 1000);
  const respId = `chatcmpl-harness-${id}`;

  if (body.stream) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    const chunk = (delta, finish_reason = null) => ({
      id: respId, object: 'chat.completion.chunk', created, model,
      choices: [{ index: 0, delta, finish_reason }],
    });
    send(chunk({ role: 'assistant', content: '' }));
    for (let i = 0; i < result.text.length; i += 120) {
      send(chunk({ content: result.text.slice(i, i + 120) }));
    }
    send(chunk({}, 'stop'));
    res.write('data: [DONE]\n\n');
    res.end();
  } else {
    jsonResponse(res, 200, {
      id: respId, object: 'chat.completion', created, model,
      choices: [{ index: 0, message: { role: 'assistant', content: result.text }, finish_reason: 'stop' }],
      ...(result.usage ? { usage: { ...result.usage, total_tokens: (result.usage.prompt_tokens || 0) + (result.usage.completion_tokens || 0) } } : {}),
    });
  }
  finish(200, null, result.text);
}

// ---------------------------------------------------------------------------
// Config

// config.json can hold lane API keys in plaintext — keep it owner-only.
// `mode` on writeFileSync only applies when the file doesn't already exist,
// so chmod explicitly to also tighten a pre-existing, more-permissive file.
function writeConfigFile(obj) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(obj, null, 2), { mode: 0o600 });
  try { fs.chmodSync(CONFIG_PATH, 0o600); } catch { /* e.g. unsupported on this fs */ }
}

function loadConfig() {
  let loaded;
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    // Shallow-merge with defaults so new fields appear after upgrades
    loaded = {
      ...DEFAULT_CONFIG,
      ...parsed,
      audit: { ...DEFAULT_CONFIG.audit, ...(parsed.audit || {}) },
      lanes: (Array.isArray(parsed.lanes) ? parsed.lanes : DEFAULT_CONFIG.lanes)
        .map((l) => ({ type: 'proxy', ...l })),
    };
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`[gateway] config.json is invalid (${err.message}); using defaults`);
    }
    loaded = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
  // The admin API (config writes, lane logins) requires this token — generated
  // once per install and persisted, never baked into DEFAULT_CONFIG since it
  // must be unique per machine. Covers both a brand-new install and an
  // existing config.json from before this field existed.
  if (!loaded.adminToken || typeof loaded.adminToken !== 'string') {
    loaded.adminToken = crypto.randomBytes(24).toString('hex');
  }
  writeConfigFile(loaded);
  return loaded;
}

function validateConfig(candidate) {
  const errors = [];
  if (!Number.isInteger(candidate.port) || candidate.port < 1 || candidate.port > 65535) {
    errors.push('port must be an integer between 1 and 65535');
  }
  if (!Array.isArray(candidate.lanes)) {
    errors.push('lanes must be an array');
    return errors;
  }
  const seenIds = new Set();
  const seenPrefixes = new Set();
  for (const lane of candidate.lanes) {
    if (!lane.id || !/^[a-z0-9-]+$/.test(lane.id)) {
      errors.push(`lane id "${lane.id}" must be lowercase letters, digits, or dashes`);
    }
    if (seenIds.has(lane.id)) errors.push(`duplicate lane id "${lane.id}"`);
    seenIds.add(lane.id);
    if (!lane.prefix || !lane.prefix.startsWith('/') || lane.prefix === '/' || lane.prefix.startsWith('/admin')) {
      errors.push(`lane "${lane.id}": prefix must start with "/" and cannot be "/" or "/admin..."`);
    }
    if (seenPrefixes.has(lane.prefix)) errors.push(`duplicate prefix "${lane.prefix}"`);
    seenPrefixes.add(lane.prefix);
    const type = lane.type || 'proxy';
    if (type === 'proxy') {
      try {
        const u = new URL(lane.target);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          errors.push(`lane "${lane.id}": target must be http(s)`);
        }
      } catch {
        errors.push(`lane "${lane.id}": target "${lane.target}" is not a valid URL`);
      }
    } else if (CLI_PROVIDERS[type]) {
      if (!lane.command || typeof lane.command !== 'string') {
        errors.push(`lane "${lane.id}": CLI lanes need a "command" (e.g. "claude" or "gemini")`);
      } else if (/[;&|`$\n\r]/.test(lane.command)) {
        // spawn() below never invokes a shell, so these characters have no
        // special meaning at runtime — this rejects them anyway as hygiene:
        // no legitimate binary name/path needs them, and it keeps this field
        // safe even if a future refactor ever introduces a shell.
        errors.push(`lane "${lane.id}": command contains characters that are never valid in a binary name or path`);
      }
    } else {
      errors.push(`lane "${lane.id}": unknown type "${type}"`);
    }
  }
  return errors;
}

let config = loadConfig();

// PORT/HOST env vars override config.json for this run only (e.g. from
// start.sh's custom-port option) — never persisted, so the GUI's saved port
// survives a one-off override.
if (process.env.PORT) {
  const envPort = parseInt(process.env.PORT, 10);
  if (Number.isInteger(envPort) && envPort >= 1 && envPort <= 65535) {
    config.port = envPort;
  } else {
    console.error(`[gateway] ignoring invalid PORT env var "${process.env.PORT}"`);
  }
}
if (process.env.HOST) config.host = process.env.HOST;

// ---------------------------------------------------------------------------
// Audit log

const ringBuffer = [];
let requestCounter = 0;

function auditRecord(entry) {
  ringBuffer.push(entry);
  if (ringBuffer.length > RING_SIZE) ringBuffer.shift();
  if (config.audit.enabled && config.audit.logToFile) {
    try {
      if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
      fs.appendFile(path.join(LOG_DIR, 'audit.jsonl'), JSON.stringify(entry) + '\n', () => {});
    } catch { /* logging must never break proxying */ }
  }
}

// ---------------------------------------------------------------------------
// Proxy

function findLane(urlPath) {
  let best = null;
  for (const lane of config.lanes) {
    if (!lane.enabled) continue;
    if (urlPath === lane.prefix || urlPath.startsWith(lane.prefix + '/')) {
      if (!best || lane.prefix.length > best.prefix.length) best = lane;
    }
  }
  if (best) return { lane: best, viaDefault: false };
  // Bare /v1/... falls through to the default lane so simple clients work
  if (urlPath === '/v1' || urlPath.startsWith('/v1/')) {
    const def = config.lanes.find((l) => l.id === config.defaultLane && l.enabled);
    if (def) return { lane: def, viaDefault: true };
  }
  return null;
}

function jsonResponse(res, status, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function proxyRequest(req, res, lane, viaDefault) {
  const started = Date.now();
  const id = ++requestCounter;

  let body;
  try {
    body = await readBody(req, MAX_REQUEST_BODY);
  } catch (err) {
    return jsonResponse(res, 413, { error: err.message });
  }

  // Compute the path forwarded to the target
  let forwardPath = req.url;
  if (!viaDefault && lane.stripPrefix) {
    forwardPath = req.url.slice(lane.prefix.length) || '/';
  }
  const target = new URL(lane.target);
  // Resolve forwardPath (always absolute — starts with "/") against target the
  // same way checkLane's health probe does: new URL(absolutePath, base)
  // replaces the base's own path rather than appending to it. Without this,
  // a target that already includes a path (e.g. "https://host/v1" — an easy
  // mistake since the GUI's own examples are bare origins) silently doubles
  // into "/v1/v1/chat/completions" here while the health check "passes",
  // making "Test connection" lie about whether real requests will work.
  const resolved = new URL(forwardPath, target);
  let fullPath = resolved.pathname + resolved.search;

  // Build outgoing headers: copy, strip hop-by-hop, inject audit + auth
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) headers[k] = v;
  }
  headers['host'] = target.host;
  headers['content-length'] = Buffer.byteLength(body);
  if (config.audit.enabled) {
    headers['x-developer-id'] = config.audit.developerId || '';
    headers['x-project'] = config.audit.project || '';
    headers['x-gateway-request-id'] = String(id);
    for (const [k, v] of Object.entries(config.audit.extraHeaders || {})) {
      headers[k.toLowerCase()] = String(v);
    }
  }
  if (lane.apiKey) headers['authorization'] = `Bearer ${lane.apiKey}`;

  // Best-effort extraction of the model name for the audit trail
  let model = null;
  let stream = null;
  const ct = (req.headers['content-type'] || '').toLowerCase();
  if (ct.includes('application/json') && body.length > 0 && body.length < 1024 * 1024) {
    try {
      const parsed = JSON.parse(body.toString('utf8'));
      if (typeof parsed.model === 'string') model = parsed.model;
      if (typeof parsed.stream === 'boolean') stream = parsed.stream;
    } catch { /* non-JSON or partial body: skip */ }
  }

  // Detect Anthropic Messages API (POST /v1/messages or anthropic-version header) and
  // translate to OpenAI Chat Completions so the upstream only ever sees OpenAI format.
  let isAnthropicTranslation = false;
  let anthropicModel = model;
  let anthropicStream = false;
  if (req.method === 'POST' &&
      (forwardPath.split('?')[0].endsWith('/v1/messages') || req.headers['anthropic-version'])) {
    let anthropicBody;
    try {
      anthropicBody = JSON.parse(body.toString('utf8'));
    } catch {
      return jsonResponse(res, 400, { error: 'request body must be valid JSON' });
    }
    isAnthropicTranslation = true;
    if (typeof anthropicBody.model === 'string') anthropicModel = anthropicBody.model;
    anthropicStream = !!anthropicBody.stream;
    const openAIBody = anthropicToOpenAI(anthropicBody);
    body = Buffer.from(JSON.stringify(openAIBody));
    headers['content-type'] = 'application/json';
    headers['content-length'] = Buffer.byteLength(body);
    // Reroute /v1/messages -> /v1/chat/completions; upstream speaks OpenAI, not Anthropic
    const newForwardPath = forwardPath.replace(/\/v1\/messages(\?|$)/, '/v1/chat/completions$1');
    const resolvedChat = new URL(newForwardPath, target);
    fullPath = resolvedChat.pathname + resolvedChat.search;
    // Drop Anthropic-specific headers the OpenAI upstream does not understand
    delete headers['anthropic-version'];
    delete headers['x-api-key']; // Anthropic uses x-api-key; upstream expects Authorization
  }

  const lib = target.protocol === 'https:' ? https : http;
  const proxyReq = lib.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    method: req.method,
    path: fullPath,
    headers,
  }, (proxyRes) => {
    const outHeaders = {};
    for (const [k, v] of Object.entries(proxyRes.headers)) {
      if (!HOP_BY_HOP.has(k.toLowerCase())) outHeaders[k] = v;
    }

    // Anthropic translation: intercept the upstream response and reformat it
    if (isAnthropicTranslation && proxyRes.statusCode >= 200 && proxyRes.statusCode < 300) {
      let bytesOut = 0;
      if (anthropicStream) {
        // Translate OpenAI SSE stream -> Anthropic SSE stream
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        const msgId = `msg_harness_${id}`;
        const sendEvt = (evt, data) => res.write(`event: ${evt}\ndata: ${JSON.stringify(data)}\n\n`);
        let buf = '';
        let preambleSent = false;
        let outputTokens = 0;
        // A multi-byte UTF-8 character (accented letters, emoji, non-Latin
        // scripts, ...) can land split across two TCP/SSE chunks. Decoding
        // each chunk independently via chunk.toString('utf8') corrupts that
        // character into garbage (mangled bytes / replacement characters) —
        // StringDecoder buffers any incomplete trailing bytes and only
        // emits fully-decoded characters, joining them correctly across
        // chunk boundaries.
        const decoder = new StringDecoder('utf8');
        // Anthropic streams multiple concurrent "content blocks" (text and/or
        // one-per-tool-call tool_use blocks), each with its own index and its
        // own content_block_start/delta/stop sequence. OpenAI's delta shape
        // is different: a single delta.tool_calls array where only the FIRST
        // chunk for a given call carries id/name, and later chunks stream
        // delta.function.arguments as raw partial-JSON string fragments — so
        // this tracks OpenAI's per-call "index" -> the Anthropic block index
        // assigned to it (blocks are numbered in the order they first appear,
        // not by OpenAI's own index, since text may or may not precede them).
        let nextBlockIndex = 0;
        let textBlockIndex = null;
        const toolCallBlocks = new Map();
        let finalFinishReason = null;
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          if (!preambleSent) {
            // Upstream sent [DONE] (or closed) without ever sending a real
            // chunk — still emit a spec-valid, if empty, event sequence.
            preambleSent = true;
            sendEvt('message_start', { type: 'message_start', message: {
              id: msgId, type: 'message', role: 'assistant', content: [],
              model: anthropicModel || '', stop_reason: null, stop_sequence: null,
              usage: { input_tokens: 0, output_tokens: 0 },
            } });
          }
          if (textBlockIndex !== null) sendEvt('content_block_stop', { type: 'content_block_stop', index: textBlockIndex });
          for (const entry of toolCallBlocks.values()) {
            sendEvt('content_block_stop', { type: 'content_block_stop', index: entry.anthropicIndex });
          }
          const stopReason = finalFinishReason === 'tool_calls' ? 'tool_use'
            : finalFinishReason === 'length' ? 'max_tokens'
            : 'end_turn';
          sendEvt('message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: outputTokens } });
          sendEvt('message_stop', { type: 'message_stop' });
          res.end();
        };
        proxyRes.on('data', (chunk) => {
          bytesOut += chunk.length;
          buf += decoder.write(chunk);
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (raw === '[DONE]') { finish(); return; }
            let parsed;
            try { parsed = JSON.parse(raw); } catch { continue; }
            if (!preambleSent) {
              preambleSent = true;
              sendEvt('message_start', { type: 'message_start', message: {
                id: msgId, type: 'message', role: 'assistant', content: [],
                model: anthropicModel || parsed.model || '',
                stop_reason: null, stop_sequence: null,
                usage: { input_tokens: 0, output_tokens: 0 },
              } });
            }
            const choice = parsed.choices?.[0];
            const delta = choice?.delta;
            if (choice?.finish_reason) finalFinishReason = choice.finish_reason;
            if (delta && typeof delta.content === 'string' && delta.content) {
              if (textBlockIndex === null) {
                textBlockIndex = nextBlockIndex++;
                sendEvt('content_block_start', { type: 'content_block_start', index: textBlockIndex, content_block: { type: 'text', text: '' } });
              }
              outputTokens++;
              sendEvt('content_block_delta', { type: 'content_block_delta', index: textBlockIndex, delta: { type: 'text_delta', text: delta.content } });
            }
            if (delta && Array.isArray(delta.tool_calls)) {
              for (const tc of delta.tool_calls) {
                const oaIndex = tc.index ?? 0;
                let entry = toolCallBlocks.get(oaIndex);
                if (!entry) {
                  entry = { anthropicIndex: nextBlockIndex++, id: tc.id || `toolu_${id}_${oaIndex}` };
                  toolCallBlocks.set(oaIndex, entry);
                  sendEvt('content_block_start', { type: 'content_block_start', index: entry.anthropicIndex, content_block: { type: 'tool_use', id: entry.id, name: tc.function?.name || '', input: {} } });
                }
                if (tc.function?.arguments) {
                  outputTokens++;
                  sendEvt('content_block_delta', { type: 'content_block_delta', index: entry.anthropicIndex, delta: { type: 'input_json_delta', partial_json: tc.function.arguments } });
                }
              }
            }
            if (parsed.usage) outputTokens = parsed.usage.completion_tokens || outputTokens;
          }
        });
        proxyRes.on('end', () => {
          finish(); // safety net: upstream closed without ever sending [DONE]
          auditRecord({ ts: new Date().toISOString(), id, lane: lane.id, method: req.method,
            path: req.url, target: lane.target + fullPath, model: anthropicModel, stream: true,
            status: 200, durationMs: Date.now() - started, bytesIn: body.length, bytesOut });
        });
      } else {
        // Non-streaming: buffer the full OpenAI response and translate to Anthropic format
        const chunks = [];
        proxyRes.on('data', (chunk) => { bytesOut += chunk.length; chunks.push(chunk); });
        proxyRes.on('end', () => {
          let anthropicResp;
          try {
            anthropicResp = openAIToAnthropic(
              JSON.parse(Buffer.concat(chunks).toString('utf8')), id, anthropicModel,
            );
          } catch (err) {
            if (!res.headersSent) {
              jsonResponse(res, 502, { error: 'failed to translate upstream response: ' + err.message });
            }
            return;
          }
          const respBody = JSON.stringify(anthropicResp);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(respBody);
          auditRecord({ ts: new Date().toISOString(), id, lane: lane.id, method: req.method,
            path: req.url, target: lane.target + fullPath, model: anthropicModel, stream: false,
            status: 200, durationMs: Date.now() - started, bytesIn: body.length,
            bytesOut: Buffer.byteLength(respBody) });
        });
      }
      return;
    }

    // Normal pass-through (non-Anthropic or upstream error responses)
    // Opt-in debug capture: HARNESS_DEBUG_BODIES=1 dumps the exact translated
    // request body for upstream errors to logs/debug-errors.jsonl. Off by
    // default — the audit log's "never records bodies" guarantee still holds
    // unless this is explicitly set. Temporary troubleshooting aid; safe to
    // remove once the root cause of a given upstream 4xx/5xx is found.
    if (process.env.HARNESS_DEBUG_BODIES === '1' && proxyRes.statusCode >= 400) {
      try {
        fs.appendFileSync(path.join(__dirname, 'logs', 'debug-errors.jsonl'), JSON.stringify({
          ts: new Date().toISOString(),
          id,
          lane: lane.id,
          status: proxyRes.statusCode,
          isAnthropicTranslation,
          requestBody: body.toString('utf8').slice(0, 40000),
        }) + '\n');
      } catch { /* best-effort debug aid, never block the response */ }
    }
    res.writeHead(proxyRes.statusCode || 502, outHeaders);
    let bytesOut = 0;
    proxyRes.on('data', (chunk) => { bytesOut += chunk.length; });
    proxyRes.pipe(res); // streaming (SSE-safe): chunks pass through untouched
    proxyRes.on('end', () => {
      auditRecord({
        ts: new Date().toISOString(),
        id,
        lane: lane.id,
        method: req.method,
        path: req.url,
        target: lane.target + fullPath,
        model,
        stream,
        status: proxyRes.statusCode,
        durationMs: Date.now() - started,
        bytesIn: body.length,
        bytesOut,
      });
    });
  });

  proxyReq.setTimeout(600000, () => proxyReq.destroy(new Error('upstream timeout')));
  proxyReq.on('error', (err) => {
    auditRecord({
      ts: new Date().toISOString(),
      id,
      lane: lane.id,
      method: req.method,
      path: req.url,
      model,
      status: 502,
      durationMs: Date.now() - started,
      error: err.message,
    });
    if (!res.headersSent) {
      jsonResponse(res, 502, {
        error: `Lane "${lane.id}" upstream unreachable: ${err.message}`,
        hint: `Is the server behind ${lane.target} running?`,
      });
    } else {
      res.end();
    }
  });

  req.on('close', () => proxyReq.destroy());
  proxyReq.end(body);
}

// ---------------------------------------------------------------------------
// Health checks

function checkCliLane(lane) {
  return new Promise((resolve) => {
    const provider = CLI_PROVIDERS[lane.type];
    const command = lane.command || provider.defaultCommand;
    const child = spawn(command, ['--version'], { cwd: os.tmpdir(), env: process.env });
    let out = '';
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      child.kill('SIGKILL');
      resolve({ id: lane.id, up: false, error: `${command} --version timed out` });
    }, 8000);
    child.stdout.on('data', (c) => { out += c; });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const notFoundHint = command === 'gemini'
        ? `"${command}" not found — install it, or if you already have it, Google may have renamed it to "antigravity" (edit the CLI command field above).`
        : `"${command}" not installed — ${provider.loginHint}`;
      resolve({ id: lane.id, up: false, error: err.code === 'ENOENT' ? notFoundHint : err.message });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({
          id: lane.id, up: true,
          version: out.trim().split('\n')[0].slice(0, 60),
          ...provider.loginStatus(),
        });
      } else {
        resolve({ id: lane.id, up: false, error: `${command} --version exited with ${code}` });
      }
    });
  });
}

function checkLane(lane) {
  if (CLI_PROVIDERS[lane.type]) return checkCliLane(lane);
  return new Promise((resolve) => {
    let target;
    try {
      target = new URL(lane.healthPath || '/v1/models', lane.target);
    } catch {
      return resolve({ id: lane.id, up: false, error: 'invalid target URL' });
    }
    const lib = target.protocol === 'https:' ? https : http;
    const started = Date.now();
    const hreq = lib.get(target, {
      timeout: 3000,
      headers: lane.apiKey ? { authorization: `Bearer ${lane.apiKey}` } : {},
    }, (hres) => {
      hres.resume();
      resolve({ id: lane.id, up: true, status: hres.statusCode, latencyMs: Date.now() - started });
    });
    hreq.on('timeout', () => hreq.destroy(new Error('timeout')));
    hreq.on('error', (err) => resolve({ id: lane.id, up: false, error: err.message }));
  });
}

// ---------------------------------------------------------------------------
// Admin API + GUI

// Defense against a malicious website silently reconfiguring the gateway
// via the browser you already have open (CSRF): browsers always send Origin
// on cross-origin requests, and — since Chrome/Firefox — on same-origin
// state-changing fetches too, so a mismatch is a reliable cross-site signal.
// Non-browser clients (curl, this project's own test suite) send no Origin
// at all and are allowed through unchanged.
function isTrustedAdminOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

// Authentication for the whole admin surface (page + API): without this, any
// process or local user that can reach 127.0.0.1:<port> can read/rewrite the
// gateway's config, including a CLI lane's "command" field (arbitrary code
// execution the next time that lane runs). The token is generated once per
// install (see loadConfig) and accepted via header or query param so both
// programmatic clients and the plain "click this link" GUI flow work.
function isAuthorizedAdmin(req, u) {
  const provided = req.headers['x-admin-token'] || u.searchParams.get('token') || '';
  const expected = config.adminToken || '';
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  // Constant-time compare: avoids leaking token length/prefix via timing.
  // Buffers must be equal length for timingSafeEqual, so pad the shorter one
  // (an inequality due to padding alone still fails the comparison).
  const len = Math.max(a.length, b.length, 1);
  const pa = Buffer.concat([a, Buffer.alloc(len - a.length)]);
  const pb = Buffer.concat([b, Buffer.alloc(len - b.length)]);
  return a.length === b.length && crypto.timingSafeEqual(pa, pb) && expected.length > 0;
}

async function handleAdmin(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const route = `${req.method} ${u.pathname}`;

  if (!isAuthorizedAdmin(req, u)) {
    if (route === 'GET /admin' || route === 'GET /admin/') {
      res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(
        '<pre style="font:14px monospace;padding:2em">Missing or invalid admin token.\n\n'
        + 'Find the full URL (with ?token=...) in this terminal\'s startup banner, or in logs/gateway.log.</pre>',
      );
    }
    return jsonResponse(res, 401, { error: 'missing or invalid admin token (see the gateway\'s startup banner / logs/gateway.log for the full URL)' });
  }

  if (req.method !== 'GET' && !isTrustedAdminOrigin(req)) {
    return jsonResponse(res, 403, {
      error: 'blocked: request Origin does not match this gateway — looks like a cross-site request, not a same-origin GUI action',
    });
  }

  if (route === 'GET /admin' || route === 'GET /admin/') {
    try {
      const html = fs.readFileSync(path.join(PUBLIC_DIR, 'admin.html'), 'utf8')
        .replace('</head>', `<script>window.__ADMIN_TOKEN__ = ${JSON.stringify(config.adminToken)};</script></head>`);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    } catch {
      return jsonResponse(res, 500, { error: 'public/admin.html is missing' });
    }
  }

  if (route === 'GET /admin/api/config') {
    // adminToken is deliberately withheld here — the caller already proved
    // they know it to get past isAuthorizedAdmin, no need to keep echoing
    // the secret back.
    const { adminToken, ...rest } = config;
    return jsonResponse(res, 200, rest);
  }

  if (route === 'POST /admin/api/config') {
    // 'text/plain'/'multipart/form-data'/urlencoded are CORS "simple" content
    // types a cross-origin page can send without a preflight — requiring
    // exactly application/json forces a real browser to preflight, which
    // this server (no Access-Control-Allow-* headers) will fail, blocking
    // the request before it ever reaches here. Belt-and-suspenders with the
    // Origin check above, which alone should already stop this.
    const contentType = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (contentType !== 'application/json') {
      return jsonResponse(res, 415, { error: 'admin API requires Content-Type: application/json' });
    }
    let body;
    try {
      body = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8'));
    } catch {
      return jsonResponse(res, 400, { error: 'invalid JSON body' });
    }
    const candidate = {
      ...config,
      ...body,
      audit: { ...config.audit, ...(body.audit || {}) },
      // Never allow the admin API to rebind off localhost silently, or to
      // rotate the admin token itself through this endpoint (that would let
      // an attacker who already has one valid token silently lock the real
      // user out by swapping it for one only the attacker knows).
      host: config.host,
      adminToken: config.adminToken,
    };
    const errors = validateConfig(candidate);
    if (errors.length) return jsonResponse(res, 400, { error: 'validation failed', details: errors });
    const portChanged = candidate.port !== config.port;
    config = candidate;
    writeConfigFile(config);
    return jsonResponse(res, 200, { ok: true, portChanged, note: portChanged ? 'Restart the gateway for the new port to take effect.' : 'Applied live.' });
  }

  if (route === 'GET /admin/api/health') {
    const results = await Promise.all(config.lanes.map(checkLane));
    return jsonResponse(res, 200, { lanes: results });
  }

  if (route === 'GET /admin/api/logs') {
    const limit = Math.min(parseInt(u.searchParams.get('limit') || '100', 10) || 100, RING_SIZE);
    return jsonResponse(res, 200, { entries: ringBuffer.slice(-limit) });
  }

  if (route === 'GET /admin/api/stats') {
    const stats = {};
    for (const e of ringBuffer) {
      const s = stats[e.lane] || (stats[e.lane] = { requests: 0, errors: 0, bytesIn: 0, bytesOut: 0 });
      s.requests += 1;
      if (!e.status || e.status >= 400) s.errors += 1;
      s.bytesIn += e.bytesIn || 0;
      s.bytesOut += e.bytesOut || 0;
    }
    return jsonResponse(res, 200, { since: ringBuffer[0]?.ts || null, lanes: stats });
  }

  // POST /admin/api/lanes/<id>/login — open a terminal running the lane's CLI
  // so the user can complete the provider's interactive OAuth sign-in
  const loginMatch = u.pathname.match(/^\/admin\/api\/lanes\/([a-z0-9-]+)\/login$/);
  if (req.method === 'POST' && loginMatch) {
    const lane = config.lanes.find((l) => l.id === loginMatch[1]);
    if (!lane || !CLI_PROVIDERS[lane.type]) {
      return jsonResponse(res, 404, { error: `no CLI-backed lane with id "${loginMatch[1]}"` });
    }
    const provider = CLI_PROVIDERS[lane.type];
    const result = openLoginTerminal(lane.command || provider.defaultCommand);
    return jsonResponse(res, result.ok ? 200 : 500, { ...result, hint: provider.loginHint });
  }

  return jsonResponse(res, 404, { error: `unknown admin route: ${route}` });
}

// ---------------------------------------------------------------------------
// Server

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];

  if (urlPath === '/' || urlPath === '/index.html') {
    res.writeHead(302, { location: '/admin' });
    return res.end();
  }
  // Deliberately unauthenticated liveness probe (no config/lane data) so
  // start.sh can confirm the process is up without needing the admin token.
  if (urlPath === '/healthz') {
    return jsonResponse(res, 200, { status: 'ok' });
  }
  if (urlPath === '/admin' || urlPath.startsWith('/admin/')) {
    return handleAdmin(req, res).catch((err) => {
      if (!res.headersSent) jsonResponse(res, 500, { error: err.message });
    });
  }

  const match = findLane(urlPath);
  if (!match) {
    return jsonResponse(res, 404, {
      error: `No lane matches "${urlPath}"`,
      lanes: config.lanes.filter((l) => l.enabled).map((l) => `${l.prefix} -> ${l.target}`),
      hint: 'Open http://localhost:' + config.port + '/admin to configure lanes.',
    });
  }
  if (CLI_PROVIDERS[match.lane.type]) {
    cliRequest(req, res, match.lane, match.viaDefault).catch((err) => {
      if (!res.headersSent) jsonResponse(res, 500, { error: err.message });
      else res.end();
    });
    return;
  }
  proxyRequest(req, res, match.lane, match.viaDefault);
});

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

server.listen(config.port, config.host, () => {
  console.log('');
  console.log('  local-harness gateway');
  console.log(`  Admin GUI : http://${config.host}:${config.port}/admin?token=${config.adminToken}`);
  console.log('  (this URL contains your admin token — treat it like a password; find it again in logs/gateway.log)');
  if (!LOOPBACK_HOSTS.has(config.host)) {
    console.log('');
    console.log(`  !! WARNING: host is "${config.host}", not loopback. The admin API has no TLS and is only`);
    console.log('  !! as secret as the token above. Do not do this on an untrusted network.');
  }
  for (const lane of config.lanes) {
    const flag = lane.enabled ? 'on ' : 'off';
    const dest = CLI_PROVIDERS[lane.type]
      ? `cli:${lane.command || CLI_PROVIDERS[lane.type].defaultCommand}`
      : lane.target;
    console.log(`  [${flag}] ${lane.prefix.padEnd(9)} -> ${dest}  (${lane.name})`);
  }
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[gateway] port ${config.port} is already in use. Edit config.json or stop the other process.`);
    process.exit(1);
  }
  throw err;
});
