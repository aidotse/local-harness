#!/usr/bin/env node
/*
 * local-harness regression suite (zero dependencies, POSIX only)
 *
 * Runs a fully isolated gateway instance on port 4999 with:
 *   - a mock OpenAI-compatible HTTP backend (proxy-lane tests)
 *   - fake claude/gemini CLIs (CLI-lane tests, no real quota used)
 *   - a scratch config + log dir (never touches your real config.json)
 *
 * Usage: npm test
 */
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-test-'));
const PORT = 4999;
const MOCK_PORT = 4998;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_TOKEN = 'test-admin-token-not-secret';
const AUTH = { 'x-admin-token': ADMIN_TOKEN };

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) {
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failed += 1;
    failures.push(name + (extra ? ` — ${extra}` : ''));
    console.log(`  \x1b[31m✗\x1b[0m ${name}${extra ? ' — ' + String(extra).slice(0, 200) : ''}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

function writeExec(name, content) {
  const p = path.join(WORK, name);
  fs.writeFileSync(p, content);
  fs.chmodSync(p, 0o755);
  return p;
}

// ---------------------------------------------------------------------------
// Fixtures

const FAKE_CLAUDE = writeExec('fake-claude', `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('9.9.9 (fake claude)'); process.exit(0); }
let inp = '';
process.stdin.on('data', (c) => inp += c);
process.stdin.on('end', () => {
  console.log(JSON.stringify({ type: 'result', is_error: false,
    result: 'CLAUDE ARGS=' + args.join(' ') + ' PROMPT=' + inp,
    usage: { input_tokens: 5, output_tokens: 7 } }));
});
`);

const FAKE_GEMINI = writeExec('fake-gemini', `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('8.8.8 (fake gemini)'); process.exit(0); }
// Real gemini CLI takes the prompt as an argv value via -p, not stdin — this
// fake asserts the same contract so a regression here is caught.
console.log('GEMINI ARGS=' + JSON.stringify(args));
`);

const FAKE_BROKEN = writeExec('fake-broken', `#!/usr/bin/env node
process.stderr.write('fatal: please login first');
process.exit(3);
`);

const TEST_CONFIG = {
  host: '127.0.0.1',
  port: PORT,
  adminToken: ADMIN_TOKEN,
  defaultLane: 'mock',
  audit: { enabled: true, developerId: 'test-dev', project: 'test-proj', extraHeaders: {}, logToFile: true },
  lanes: [
    { id: 'mock', name: 'Mock backend', prefix: '/mock', type: 'proxy',
      target: `http://127.0.0.1:${MOCK_PORT}`, enabled: true, stripPrefix: true,
      apiKey: 'sekret', healthPath: '/v1/models' },
    // Target already includes a path — a common real-world mistake (the GUI's
    // own examples are bare origins) that must not double into /v1/v1/...
    { id: 'mockv1', name: 'Mock backend with /v1 baked into the address', prefix: '/mockv1', type: 'proxy',
      target: `http://127.0.0.1:${MOCK_PORT}/v1`, enabled: true, stripPrefix: true,
      apiKey: '', healthPath: '/v1/models' },
    { id: 'dead', name: 'Dead backend', prefix: '/dead', type: 'proxy',
      target: 'http://127.0.0.1:4901', enabled: true, stripPrefix: true },
    { id: 'fclaude', name: 'Fake Claude', prefix: '/fclaude', type: 'claude-cli',
      command: FAKE_CLAUDE, enabled: true, models: ['sonnet', 'opus'], defaultModel: 'sonnet' },
    { id: 'fgemini', name: 'Fake Gemini', prefix: '/fgemini', type: 'gemini-cli',
      command: FAKE_GEMINI, enabled: true, models: ['g-pro'], defaultModel: 'g-pro' },
    { id: 'fbroken', name: 'Broken CLI', prefix: '/fbroken', type: 'claude-cli',
      command: FAKE_BROKEN, enabled: true, models: ['x'], defaultModel: 'x' },
  ],
};

const CONFIG_PATH = path.join(WORK, 'config.json');
const LOG_DIR = path.join(WORK, 'logs');
fs.writeFileSync(CONFIG_PATH, JSON.stringify(TEST_CONFIG, null, 2));

// Mock OpenAI-compatible backend: echoes the headers it receives so we can
// prove the gateway injected the audit headers and the lane API key.
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-1' }] }));
    }
    if (req.url === '/v1/sse') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      let n = 0;
      const iv = setInterval(() => {
        n += 1;
        res.write(`data: chunk${n}\n\n`);
        if (n === 3) { clearInterval(iv); res.end(); }
      }, 80);
      return;
    }
    let parsedBody;
    try { parsedBody = JSON.parse(body); } catch { /* not JSON, or empty */ }
    // Deliberately split a multi-byte UTF-8 character's raw bytes across two
    // separate socket writes (with a real delay between them, so Node's http
    // client sees them as two distinct 'data' events) — this is exactly the
    // shape of bug that corrupts non-ASCII output if the gateway decodes each
    // stream chunk independently instead of as one continuous byte stream.
    // Triggered via a sentinel model name since anthropicToOpenAI only
    // forwards known fields, not arbitrary extra ones, and this needs to
    // survive Anthropic->OpenAI request translation to reach here.
    if (parsedBody && parsedBody.model === 'force-split-utf8-test' && parsedBody.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const payload = Buffer.from(`data: ${JSON.stringify({ choices: [{ delta: { content: '日本語' } }] })}\n\n`, 'utf8');
      const marker = Buffer.from('本', 'utf8'); // e6 9c ac — a 3-byte UTF-8 sequence
      const splitAt = payload.indexOf(marker) + 1; // land inside the sequence, not on a char boundary
      res.write(payload.subarray(0, splitAt));
      setTimeout(() => {
        res.write(payload.subarray(splitAt));
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { completion_tokens: 1 } })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      }, 30);
      return;
    }
    // Non-streaming tool-call response — the model "decides" to call a tool
    // instead of replying with text, exactly what Claude Code needs to be
    // able to read files / run commands at all.
    if (parsedBody && parsedBody.model === 'return-tool-call-test') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({
        id: 'mock-1', object: 'chat.completion', model: parsedBody.model,
        usage: { prompt_tokens: 5, completion_tokens: 7 },
        choices: [{ index: 0, finish_reason: 'tool_calls', message: {
          role: 'assistant', content: null,
          tool_calls: [{ id: 'call_abc123', type: 'function', function: { name: 'Read', arguments: JSON.stringify({ file_path: '/tmp/x.txt' }) } }],
        } }],
      }));
    }
    // Streaming tool-call response — OpenAI streams tool_calls as deltas:
    // only the first chunk for a given call carries id/name, later chunks
    // stream "arguments" as raw partial-JSON string fragments to concatenate.
    if (parsedBody && parsedBody.model === 'stream-tool-call-test' && parsedBody.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      send({ choices: [{ delta: { content: 'Sure, ' } }] });
      send({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_xyz', type: 'function', function: { name: 'Bash', arguments: '' } }] } }] });
      send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"comm' } }] } }] });
      send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'and":"ls"}' } }] } }] });
      send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { completion_tokens: 4 } });
      res.write('data: [DONE]\n\n');
      return res.end();
    }
    // Real OpenAI-style streaming chat completion — used to prove the
    // gateway's Anthropic-SSE translation (message_start/content_block_delta/
    // message_stop) is built from genuine upstream chunks, not faked locally.
    if (parsedBody && parsedBody.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      send({ choices: [{ delta: { content: 'Hi' } }] });
      send({ choices: [{ delta: { content: ' there' } }] });
      send({ choices: [{ delta: {} }], usage: { completion_tokens: 2 } });
      res.write('data: [DONE]\n\n');
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'mock-1', object: 'chat.completion',
      model: parsedBody && parsedBody.model,
      usage: { prompt_tokens: 11, completion_tokens: 3 },
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({
        dev: req.headers['x-developer-id'] || null,
        proj: req.headers['x-project'] || null,
        auth: req.headers['authorization'] || null,
        path: req.url,
        // Echoed so tests can verify Anthropic-only headers were stripped
        // before the request reached this (OpenAI-speaking) upstream.
        anthropicVersionHeader: req.headers['anthropic-version'] || null,
        xApiKeyHeader: req.headers['x-api-key'] || null,
        // Echoed so tests can verify the gateway's Anthropic->OpenAI request
        // translation reached the upstream in the right shape.
        receivedMessages: parsedBody && parsedBody.messages,
        receivedTools: parsedBody && parsedBody.tools,
        receivedToolChoice: parsedBody && parsedBody.tool_choice,
      }) } }],
    }));
  });
});

// ---------------------------------------------------------------------------
// Helpers

let gateway;

function startGateway() {
  gateway = spawn(process.execPath, [path.join(ROOT, 'gateway.js')], {
    env: { ...process.env, HARNESS_CONFIG: CONFIG_PATH, HARNESS_LOG_DIR: LOG_DIR },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  gateway.stderr.on('data', (c) => process.stderr.write(`[gateway] ${c}`));
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 8000;
    (function poll() {
      // /healthz is deliberately unauthenticated, unlike everything under
      // /admin — use it here so readiness doesn't depend on auth being wired up.
      fetch(`${BASE}/healthz`).then((r) => (r.ok ? resolve() : retry())).catch(retry);
      function retry() {
        if (Date.now() > deadline) return reject(new Error('gateway did not start within 8s'));
        setTimeout(poll, 150);
      }
    })();
  });
}

async function jpost(url, obj, extraHeaders = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: JSON.stringify(obj),
  });
  return { status: res.status, body: await res.json() };
}

function chat(lanePrefix, payload) {
  return jpost(`${BASE}${lanePrefix}/v1/chat/completions`, payload);
}

// Most recent audit entry matching a path suffix — used to check the
// token/TTFT/throughput fields the gateway attaches after a request completes.
async function latestAuditEntry(pathSuffix) {
  const r = await fetch(`${BASE}/admin/api/logs?limit=100`, { headers: AUTH });
  const { entries } = await r.json();
  return [...entries].reverse().find((e) => e.path.startsWith(pathSuffix));
}

// ---------------------------------------------------------------------------
// Tests

async function main() {
  await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r));
  await startGateway();

  section('Admin GUI & API');
  {
    const r = await fetch(`${BASE}/`, { redirect: 'manual' });
    check('GET / redirects to /admin', r.status === 302 && r.headers.get('location') === '/admin');

    check('/healthz is unauthenticated and always answers', (await (await fetch(`${BASE}/healthz`)).json()).status === 'ok');

    // Access control: the admin surface (page + API) requires the token,
    // closing the "any local process/webpage can read or rewrite config"
    // gap — the config-write endpoint doubles as arbitrary code execution
    // via a CLI lane's "command" field, so this is the primary access gate.
    const noToken = await fetch(`${BASE}/admin/api/config`);
    check('admin API rejects requests with no token', noToken.status === 401);
    const wrongToken = await fetch(`${BASE}/admin/api/config`, { headers: { 'x-admin-token': 'nope' } });
    check('admin API rejects an incorrect token', wrongToken.status === 401);
    const noTokenPage = await fetch(`${BASE}/admin`);
    check('the /admin page itself is also gated', noTokenPage.status === 401);
    const queryTokenPage = await fetch(`${BASE}/admin?token=${ADMIN_TOKEN}`);
    const queryTokenHtml = await queryTokenPage.text();
    check('a valid token via query param serves the page and embeds the token for the JS to reuse',
      queryTokenPage.status === 200 && queryTokenHtml.includes(`window.__ADMIN_TOKEN__ = "${ADMIN_TOKEN}"`));

    const html = await (await fetch(`${BASE}/admin`, { headers: AUTH })).text();
    check('GET /admin serves the GUI (token via header)', html.includes('local-harness') && html.includes('Your AI subscriptions'));

    const cfg = await (await fetch(`${BASE}/admin/api/config`, { headers: AUTH })).json();
    check('config API returns all configured lanes', cfg.lanes.length === 6);
    check('config API withholds the admin token itself', !('adminToken' in cfg));

    const bad1 = await jpost(`${BASE}/admin/api/config`, { ...cfg, port: 70000 }, AUTH);
    check('config validation rejects bad port', bad1.status === 400);

    const dup = JSON.parse(JSON.stringify(cfg));
    dup.lanes[1].prefix = dup.lanes[0].prefix;
    const bad2 = await jpost(`${BASE}/admin/api/config`, dup, AUTH);
    check('config validation rejects duplicate prefixes', bad2.status === 400);

    const shellyCommand = JSON.parse(JSON.stringify(cfg));
    shellyCommand.lanes.find((l) => l.id === 'fclaude').command = 'claude; rm -rf ~';
    const bad3 = await jpost(`${BASE}/admin/api/config`, shellyCommand, AUTH);
    check('config validation rejects shell metacharacters in a CLI lane command', bad3.status === 400);

    const hijackToken = JSON.parse(JSON.stringify(cfg));
    hijackToken.adminToken = 'attacker-chosen-token';
    const hijackRes = await jpost(`${BASE}/admin/api/config`, hijackToken, AUTH);
    check('admin token cannot be changed via the config-write endpoint', hijackRes.status === 200 && hijackRes.body.ok === true);
    check('...and the original token still works after that attempt',
      (await fetch(`${BASE}/admin/api/config`, { headers: AUTH })).status === 200);
    check('...while the attacker-chosen token does not',
      (await fetch(`${BASE}/admin/api/config`, { headers: { 'x-admin-token': 'attacker-chosen-token' } })).status === 401);

    const edited = JSON.parse(JSON.stringify(cfg));
    edited.audit.developerId = 'test-dev-2';
    const ok = await jpost(`${BASE}/admin/api/config`, edited, AUTH);
    const onDisk = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    check('config edits apply live and persist', ok.status === 200 && onDisk.audit.developerId === 'test-dev-2');

    if (process.platform !== 'win32') {
      const perms = (fs.statSync(CONFIG_PATH).mode & 0o777).toString(8);
      check('config.json is written owner-only (0600), not world-readable', perms === '600', perms);
    }

    // CSRF hardening: a malicious page you have open can't rewrite the
    // gateway config or trigger the login endpoint's terminal-launch just by
    // getting your browser to POST here. (Even a request that somehow had
    // the token would still need to clear this layer too.)
    const csrf1 = await fetch(`${BASE}/admin/api/config`, {
      method: 'POST', headers: { 'content-type': 'text/plain', ...AUTH }, body: JSON.stringify(cfg),
    });
    check('CORS-safelisted content-type (text/plain) is rejected on config writes', csrf1.status === 415);

    const csrf2 = await fetch(`${BASE}/admin/api/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://evil.example.com', ...AUTH },
      body: JSON.stringify(cfg),
    });
    check('forged cross-origin Origin header is rejected on config writes', csrf2.status === 403);

    const csrf3 = await fetch(`${BASE}/admin/api/lanes/fclaude/login`, {
      method: 'POST', headers: { origin: 'http://evil.example.com', ...AUTH },
    });
    check('forged cross-origin Origin header is rejected on the login endpoint', csrf3.status === 403);

    const legit = await fetch(`${BASE}/admin/api/config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${PORT}`, ...AUTH },
      body: JSON.stringify(edited),
    });
    check('a same-origin request (Origin matching Host) is still allowed', legit.status === 200);

    // DNS-rebinding hardening: a page whose hostname resolves to 127.0.0.1 is
    // same-origin in the browser (CORS never applies, responses readable), but
    // it can't avoid sending its own hostname in Host — the gateway rejects
    // any Host that isn't its own address, on every route including the
    // token-free chat lanes. fetch() forbids overriding Host, so use raw http.
    const rawStatus = (headers, reqPath) => new Promise((resolve, reject) => {
      // setHost:false — only the Host header explicitly passed (if any) is
      // sent, so the no-Host case genuinely sends none.
      const rq = http.request({ host: '127.0.0.1', port: PORT, path: reqPath, headers, setHost: false }, (rs) => {
        rs.resume();
        resolve(rs.statusCode);
      });
      rq.on('error', reject);
      rq.end();
    });
    check('DNS rebinding: a non-local Host header is rejected on a chat lane',
      await rawStatus({ host: 'evil.example.com' }, '/mock/v1/models') === 421);
    check('DNS rebinding: a non-local Host header is rejected on /healthz too',
      await rawStatus({ host: 'evil.example.com:4999' }, '/healthz') === 421);
    check('...while "localhost" as Host is accepted',
      await rawStatus({ host: `localhost:${PORT}` }, '/healthz') === 200);
    // Node rejects HTTP/1.1 without Host at the parser (400), before the
    // gateway's check runs — so the "no Host at all" case only exists for
    // HTTP/1.0 clients, which needs a raw socket to reproduce.
    const http10Status = await new Promise((resolve, reject) => {
      const sock = require('net').connect(PORT, '127.0.0.1', () => {
        sock.end('GET /healthz HTTP/1.0\r\n\r\n');
      });
      let data = '';
      sock.on('data', (c) => { data += c; });
      sock.on('end', () => resolve(parseInt(data.split(' ')[1], 10)));
      sock.on('error', reject);
    });
    check('...and a missing Host header (bare HTTP/1.0 client) is tolerated',
      http10Status === 200);
  }

  section('Proxy lanes');
  {
    const r = await chat('/mock', { model: 'm1', messages: [{ role: 'user', content: 'hi' }] });
    const echoed = JSON.parse(r.body.choices[0].message.content);
    check('proxied request reaches the backend', r.status === 200);
    check('audit headers injected (hot-reloaded value)', echoed.dev === 'test-dev-2' && echoed.proj === 'test-proj');
    check('lane API key attached as Bearer token', echoed.auth === 'Bearer sekret');
    check('path prefix stripped before forwarding', echoed.path === '/v1/chat/completions');

    const d = await chat('', { model: 'm1', messages: [{ role: 'user', content: 'hi' }] }); // bare /v1
    const echoed2 = JSON.parse(d.body.choices[0].message.content);
    check('bare /v1 falls through to the default lane', d.status === 200 && echoed2.path === '/v1/chat/completions');

    const nf = await fetch(`${BASE}/nope`);
    const nfBody = await nf.json();
    check('unknown path returns 404 with lane hints', nf.status === 404 && /No lane matches/.test(nfBody.error));

    const dead = await chat('/dead', { messages: [] });
    check('unreachable backend returns 502 with hint', dead.status === 502 && /unreachable/.test(dead.body.error));

    const sse = await fetch(`${BASE}/mock/v1/sse`);
    const sseText = await sse.text();
    check('SSE streams pass through untouched',
      (sse.headers.get('content-type') || '').includes('text/event-stream')
      && sseText.includes('chunk1') && sseText.includes('chunk3'));

    const log = fs.readFileSync(path.join(LOG_DIR, 'audit.jsonl'), 'utf8');
    check('JSONL audit log written with model name', log.split('\n').some((l) => l.includes('"lane":"mock"') && l.includes('"model":"m1"')));

    // A target URL that already includes a path (e.g. ".../v1") must not
    // double into /v1/v1/... — this must match checkLane's URL-resolution
    // semantics exactly, or "Test connection" can report healthy while real
    // requests 404.
    const v1Models = await fetch(`${BASE}/mockv1/v1/models`);
    const v1ModelsBody = await v1Models.json();
    check('a target with /v1 baked in: GET /v1/models does not double the path',
      v1Models.status === 200 && Array.isArray(v1ModelsBody.data) && v1ModelsBody.data[0]?.id === 'mock-1',
      JSON.stringify(v1ModelsBody));

    const v1Chat = await chat('/mockv1', { model: 'm1', messages: [{ role: 'user', content: 'hi' }] });
    const v1Echoed = JSON.parse(v1Chat.body.choices[0].message.content);
    check('a target with /v1 baked in: POST /v1/chat/completions does not double the path',
      v1Chat.status === 200 && v1Echoed.path === '/v1/chat/completions', v1Echoed.path);
  }

  section('Anthropic Messages API translation (Claude Code support)');
  {
    // Path-based detection: POST .../v1/messages gets rewritten to
    // .../v1/chat/completions on the upstream, request body translated.
    const anthroReq = {
      model: 'm1', max_tokens: 50, temperature: 0.5, stop_sequences: ['STOP'],
      system: 'Be terse.',
      messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }, { role: 'user', content: 'q2' }],
    };
    const anthro1 = await jpost(`${BASE}/mock/v1/messages`, anthroReq);
    check('POST /v1/messages is detected and returns 200 (not a raw upstream 404)', anthro1.status === 200, JSON.stringify(anthro1.body));
    check('response is reshaped into Anthropic\'s message format',
      anthro1.body.type === 'message' && anthro1.body.role === 'assistant' && Array.isArray(anthro1.body.content)
      && anthro1.body.content[0]?.type === 'text' && anthro1.body.stop_reason === 'end_turn'
      && typeof anthro1.body.usage?.input_tokens === 'number', JSON.stringify(anthro1.body));
    const anthroEchoed = JSON.parse(anthro1.body.content[0].text);
    check('...and the upstream actually received /v1/chat/completions, not /v1/messages',
      anthroEchoed.path === '/v1/chat/completions', anthroEchoed.path);
    check('system field translated to an OpenAI system message',
      anthroEchoed.receivedMessages?.[0]?.role === 'system' && anthroEchoed.receivedMessages[0].content === 'Be terse.',
      JSON.stringify(anthroEchoed.receivedMessages));
    check('user/assistant turns preserved in order after the system message',
      anthroEchoed.receivedMessages?.[1]?.content === 'hi' && anthroEchoed.receivedMessages?.[2]?.role === 'assistant'
      && anthroEchoed.receivedMessages?.[3]?.content === 'q2', JSON.stringify(anthroEchoed.receivedMessages));

    // Some clients (Claude Code included) embed extra role:"system" entries
    // inside "messages" itself, not just the top-level "system" field — even
    // though Anthropic's spec reserves "messages" for user/assistant turns.
    // OpenAI backends can strictly reject a system message that isn't first
    // (reproduced against a real vLLM deployment: "System message must be at
    // the beginning"), so these must be hoisted to the front, merged with
    // the top-level system text, not forwarded in their original position.
    const embeddedSystemReq = {
      model: 'm1', max_tokens: 20, system: 'Be terse.',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
        { role: 'system', content: 'extra reminder' },
        { role: 'user', content: 'q2' },
      ],
    };
    const embeddedSystem = await jpost(`${BASE}/mock/v1/messages`, embeddedSystemReq);
    const embeddedEchoed = JSON.parse(embeddedSystem.body.content[0].text);
    check('an embedded system-role message (not just the top-level field) is hoisted to the front',
      embeddedSystem.status === 200 && embeddedEchoed.receivedMessages[0].role === 'system'
      && embeddedEchoed.receivedMessages[0].content === 'Be terse.\nextra reminder',
      JSON.stringify(embeddedEchoed.receivedMessages));
    check('...and no other role:"system" entry remains anywhere else in the translated messages',
      embeddedEchoed.receivedMessages.slice(1).every((m) => m.role !== 'system'),
      JSON.stringify(embeddedEchoed.receivedMessages));
    check('...and the real user/assistant turns keep their original relative order',
      embeddedEchoed.receivedMessages[1].content === 'hi' && embeddedEchoed.receivedMessages[2].role === 'assistant'
      && embeddedEchoed.receivedMessages[3].content === 'q2', JSON.stringify(embeddedEchoed.receivedMessages));

    // Header-based detection: anthropic-version header alone (no /v1/messages
    // suffix) also triggers translation — this is Claude Code's actual wire
    // signature, so it must work even if a client hits a differently-named path.
    const anthro2 = await fetch(`${BASE}/mock/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': 'dummy' },
      body: JSON.stringify({ model: 'm1', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }),
    });
    check('anthropic-version + x-api-key headers are accepted (Claude Code\'s real request shape)', anthro2.status === 200);

    // Anthropic-only headers must not leak to an OpenAI-speaking upstream.
    const anthro2Body = await anthro2.json();
    const anthro2Echoed = JSON.parse(anthro2Body.content[0].text);
    check('anthropic-version and x-api-key headers are stripped before forwarding upstream',
      anthro2Echoed.anthropicVersionHeader === null && anthro2Echoed.xApiKeyHeader === null, JSON.stringify(anthro2Echoed));

    // Non-streaming usage/model/stop_reason mapping
    check('token usage mapped from the upstream OpenAI response',
      anthro1.body.usage.input_tokens === 11 && anthro1.body.usage.output_tokens === 3);
    check('requested model name is echoed back (not the upstream\'s own model field)', anthro1.body.model === 'm1');

    // Audit log: non-streaming requests get real usage from the upstream
    // response, and TTFT collapses to the full duration (the whole answer
    // arrives at once, so there's no earlier "first token" moment).
    const nonStreamEntry = await latestAuditEntry('/mock/v1/messages');
    check('audit log records real prompt/completion tokens for a non-streaming Anthropic request',
      nonStreamEntry?.promptTokens === 11 && nonStreamEntry?.completionTokens === 3, JSON.stringify(nonStreamEntry));
    check('...and TTFT equals the full duration for a non-streaming response',
      typeof nonStreamEntry?.ttftMs === 'number' && nonStreamEntry.ttftMs === nonStreamEntry.durationMs, JSON.stringify(nonStreamEntry));
    check('...and tokens/sec is a positive number or null (never NaN/undefined)',
      nonStreamEntry?.tokensPerSec === null || (typeof nonStreamEntry?.tokensPerSec === 'number' && nonStreamEntry.tokensPerSec > 0),
      JSON.stringify(nonStreamEntry));

    // Streaming: Anthropic SSE event sequence built from real upstream SSE chunks
    const streamRes = await fetch(`${BASE}/mock/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'm1', max_tokens: 10, stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    });
    const streamText = await streamRes.text();
    check('streaming Anthropic response uses SSE content-type', (streamRes.headers.get('content-type') || '').includes('text/event-stream'));
    check('streaming response includes the full Anthropic event sequence',
      streamText.includes('event: message_start') && streamText.includes('event: content_block_start')
      && streamText.includes('event: content_block_delta') && streamText.includes('"text":"Hi"')
      && streamText.includes('event: content_block_stop') && streamText.includes('event: message_delta')
      && streamText.includes('event: message_stop'), streamText);

    // Audit log: streaming requests get a real completion-token count from
    // the upstream's final usage chunk, plus a genuine time-to-first-token
    // measured from the first content delta actually sent to the client.
    const streamEntry = await latestAuditEntry('/mock/v1/messages');
    check('audit log records real completion tokens for a streaming Anthropic request',
      streamEntry?.completionTokens === 2, JSON.stringify(streamEntry));
    check('...and a numeric time-to-first-token no greater than the total duration',
      typeof streamEntry?.ttftMs === 'number' && streamEntry.ttftMs >= 0 && streamEntry.ttftMs <= streamEntry.durationMs,
      JSON.stringify(streamEntry));
    check('...and tokens/sec is a positive number or null (never NaN/undefined)',
      streamEntry?.tokensPerSec === null || (typeof streamEntry?.tokensPerSec === 'number' && streamEntry.tokensPerSec > 0),
      JSON.stringify(streamEntry));

    // A multi-byte UTF-8 character split across two separate network chunks
    // must reassemble correctly, not corrupt into garbage/replacement
    // characters — the exact bug class that produced garbled foreign-script
    // text mid-response for a real user.
    const splitRes = await fetch(`${BASE}/mock/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'force-split-utf8-test', max_tokens: 10, stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    });
    const splitText = await splitRes.text();
    const deltas = [...splitText.matchAll(/"text_delta","text":"([^"]*)"/g)].map((m) => m[1]);
    check('a multi-byte UTF-8 character split across two network chunks reassembles correctly, not corrupted',
      deltas.join('') === '日本語', JSON.stringify({ deltas, raw: splitText }));

    // A lane with no Anthropic traffic at all must be completely unaffected —
    // this is a routing detour, not a rewrite of every request.
    const plainChat = await chat('/mock', { model: 'm1', messages: [{ role: 'user', content: 'hi' }] });
    const plainEchoed = JSON.parse(plainChat.body.choices[0].message.content);
    check('plain OpenAI-format requests are completely untouched by the Anthropic path',
      plainChat.body.object === 'chat.completion' && plainEchoed.path === '/v1/chat/completions');

    // Tool-calling: without this, Claude Code has no structured way to read
    // files or run commands at all — this is what made the CLI exit after a
    // couple of seconds with garbled pseudo-tool-call text.
    const toolsReq = {
      model: 'm1', max_tokens: 50,
      tools: [{ name: 'Read', description: 'Read a file', input_schema: { type: 'object', properties: { file_path: { type: 'string' } } } }],
      tool_choice: { type: 'auto' },
      messages: [
        { role: 'user', content: 'read a file' },
        { role: 'assistant', content: [{ type: 'text', text: 'Sure' }, { type: 'tool_use', id: 'call_1', name: 'Read', input: { file_path: '/tmp/x.txt' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'file contents here' }] },
      ],
    };
    const toolsRes = await jpost(`${BASE}/mock/v1/messages`, toolsReq);
    const toolsEchoed = JSON.parse(toolsRes.body.content[0].text);
    check('tools/tool_choice are translated to OpenAI format and reach the upstream',
      toolsEchoed.receivedTools?.[0]?.type === 'function' && toolsEchoed.receivedTools[0].function.name === 'Read'
      && toolsEchoed.receivedTools[0].function.parameters.properties.file_path
      && toolsEchoed.receivedToolChoice === 'auto', JSON.stringify(toolsEchoed.receivedTools));
    check('an assistant tool_use block becomes an OpenAI tool_calls entry',
      toolsEchoed.receivedMessages.some((m) => m.role === 'assistant'
        && m.tool_calls?.[0]?.function?.name === 'Read'
        && JSON.parse(m.tool_calls[0].function.arguments).file_path === '/tmp/x.txt'), JSON.stringify(toolsEchoed.receivedMessages));
    check('a user tool_result block becomes an OpenAI role:"tool" message with matching tool_call_id',
      toolsEchoed.receivedMessages.some((m) => m.role === 'tool' && m.tool_call_id === 'call_1' && m.content === 'file contents here'),
      JSON.stringify(toolsEchoed.receivedMessages));

    // Non-streaming: the model deciding to call a tool must come back as a
    // proper Anthropic tool_use content block, not lost/flattened to text.
    const toolCallResp = await jpost(`${BASE}/mock/v1/messages`, { model: 'return-tool-call-test', max_tokens: 20, messages: [{ role: 'user', content: 'hi' }] });
    const toolUseBlock = toolCallResp.body.content?.find((b) => b.type === 'tool_use');
    check('a non-streaming OpenAI tool_calls response becomes an Anthropic tool_use content block',
      !!toolUseBlock && toolUseBlock.name === 'Read' && toolUseBlock.input.file_path === '/tmp/x.txt' && !!toolUseBlock.id,
      JSON.stringify(toolCallResp.body));
    check('stop_reason is "tool_use" (not "end_turn") so Claude Code knows to execute the tool',
      toolCallResp.body.stop_reason === 'tool_use');

    // Streaming: tool_calls deltas (id/name on the first chunk, arguments
    // fragments on later ones) must become a proper Anthropic tool_use
    // content_block_start + input_json_delta sequence, concurrent with the
    // separate text block that preceded it.
    const streamToolRes = await fetch(`${BASE}/mock/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'stream-tool-call-test', max_tokens: 20, stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    });
    const streamToolText = await streamToolRes.text();
    // Parse real SSE events (not regex over raw text, which mishandles
    // JSON-escaped quotes inside partial_json fragments) into {event, data}.
    const sseEvents = streamToolText.split('\n\n').filter((b) => b.includes('data: ')).map((block) => {
      const dataLine = block.split('\n').find((l) => l.startsWith('data: '));
      return JSON.parse(dataLine.slice(6));
    });
    const toolBlockStart = sseEvents.find((e) => e.type === 'content_block_start' && e.content_block?.type === 'tool_use');
    const argFragments = sseEvents
      .filter((e) => e.type === 'content_block_delta' && e.delta?.type === 'input_json_delta' && e.index === toolBlockStart?.index)
      .map((e) => e.delta.partial_json);
    check('streaming tool_calls produce a content_block_start with type tool_use and the right id/name',
      toolBlockStart?.content_block?.id === 'call_xyz' && toolBlockStart?.content_block?.name === 'Bash', JSON.stringify(toolBlockStart));
    check('...at a different block index than the text block that preceded it (both stream concurrently)',
      toolBlockStart && toolBlockStart.index !== 0, JSON.stringify(sseEvents));
    check('streamed argument fragments concatenate into the complete tool call JSON',
      argFragments.join('') === '{"command":"ls"}', JSON.stringify(argFragments));
    const messageDelta = sseEvents.find((e) => e.type === 'message_delta');
    check('streaming response also ends with stop_reason "tool_use"',
      messageDelta?.delta?.stop_reason === 'tool_use', JSON.stringify(messageDelta));
  }

  section('CLI lanes (built-in subscription wrappers)');
  {
    const models = await (await fetch(`${BASE}/fclaude/v1/models`)).json();
    check('CLI lane lists its models (for VS Code Manage Models)',
      models.data.map((m) => m.id).join(',') === 'sonnet,opus');

    const r1 = await chat('/fclaude', { model: 'opus', messages: [{ role: 'user', content: 'hello world' }] });
    const c1 = r1.body.choices[0].message.content;
    check('claude-cli lane returns the CLI reply', r1.status === 200 && c1.includes('PROMPT=hello world'));
    check('requested model passed to the CLI', c1.includes('--model opus'));
    check('token usage mapped from CLI output', r1.body.usage && r1.body.usage.total_tokens === 12);

    // Audit log: CLI lanes report the CLI's own usage numbers, and TTFT
    // equals the full run time — the CLI computes the whole answer before
    // the gateway starts faking SSE chunks, so there's no earlier moment.
    const cliEntry = await latestAuditEntry('/fclaude/v1/chat/completions');
    check('audit log records the CLI\'s real prompt/completion tokens',
      cliEntry?.promptTokens + cliEntry?.completionTokens === 12, JSON.stringify(cliEntry));
    check('...and TTFT equals the full duration for a CLI lane',
      typeof cliEntry?.ttftMs === 'number' && cliEntry.ttftMs === cliEntry.durationMs, JSON.stringify(cliEntry));

    const r2 = await chat('/fclaude', { model: 'harness-whatever', messages: [{ role: 'user', content: 'x' }] });
    check('unknown model alias maps to lane default', r2.body.choices[0].message.content.includes('--model sonnet'));

    const r3 = await chat('/fclaude', {
      model: 'sonnet',
      messages: [{ role: 'system', content: 'be nice' }, { role: 'user', content: 'q1' },
                 { role: 'assistant', content: 'a1' }, { role: 'user', content: 'q2' }],
    });
    const c3 = r3.body.choices[0].message.content;
    check('system message passed via --append-system-prompt', c3.includes('--append-system-prompt be nice'));
    check('multi-turn history flattened into the prompt', c3.includes('User: q1') && c3.includes('Assistant: a1') && c3.includes('User: q2'));

    // spawn() is called without shell:true, so shell metacharacters in a
    // prompt can never be interpreted — they can only ever arrive at the CLI
    // as literal argv/stdin bytes. Prove it: if a shell were ever involved,
    // this payload would be split/expanded and the fake CLI would NOT see
    // it back verbatim (and a real shell would have created the marker file).
    const marker = path.join(WORK, 'shell-injection-marker');
    const payload = `hi"; touch ${marker}; echo "pwned\`whoami\`$(id) | rm -rf /tmp/x &`;
    const inj = await chat('/fclaude', { model: 'sonnet', messages: [{ role: 'user', content: payload }] });
    const injContent = inj.body.choices[0].message.content;
    check('shell metacharacters in a prompt reach the CLI as literal, unmangled text (no shell involved)',
      injContent.includes(payload));
    check('...and no shell command was ever actually executed', !fs.existsSync(marker));

    const sres = await fetch(`${BASE}/fclaude/v1/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'sonnet', stream: true, messages: [{ role: 'user', content: 'streamme' }] }),
    });
    const stext = await sres.text();
    check('stream:true produces OpenAI SSE framing',
      (sres.headers.get('content-type') || '').includes('text/event-stream')
      && stext.includes('"chat.completion.chunk"') && stext.includes('"finish_reason":"stop"')
      && stext.trim().endsWith('data: [DONE]'));

    const g = await chat('/fgemini', { messages: [{ role: 'user', content: 'gtest' }] });
    const gc = g.body.choices[0].message.content;
    check('gemini-cli lane parses plain-text CLI output', g.status === 200 && gc.includes('GEMINI'));
    check('gemini lane delivers the prompt via -p argv, not stdin', gc.includes('"-p"') && gc.includes('"gtest"'));
    check('gemini lane uses its default model flag', gc.includes('"-m"') && gc.includes('"g-pro"'));

    const b = await chat('/fbroken', { messages: [{ role: 'user', content: 'x' }] });
    check('failing CLI returns 502 with stderr detail', b.status === 502 && /please login/.test(b.body.detail || ''));
    check('auth-looking failures include a login hint', typeof b.body.hint === 'string' && b.body.hint.length > 0);
  }

  section('Health, logs, stats, login endpoint');
  {
    const h = await (await fetch(`${BASE}/admin/api/health`, { headers: AUTH })).json();
    const byId = Object.fromEntries(h.lanes.map((l) => [l.id, l]));
    check('proxy lane health: reachable backend is up', byId.mock.up === true);
    check('proxy lane health: dead backend is down', byId.dead.up === false);
    check('CLI lane health: version + login status reported',
      byId.fclaude.up === true && byId.fclaude.version.includes('9.9.9') && 'loggedIn' in byId.fclaude);
    check('CLI lane health: broken CLI reported down', byId.fbroken.up === false);

    const logs = await (await fetch(`${BASE}/admin/api/logs?limit=50`, { headers: AUTH })).json();
    check('logs API returns recent entries', logs.entries.length >= 5);

    const stats = await (await fetch(`${BASE}/admin/api/stats`, { headers: AUTH })).json();
    check('stats API aggregates per lane', stats.lanes.mock.requests >= 2 && stats.lanes.fclaude.requests >= 3);

    const l1 = await jpost(`${BASE}/admin/api/lanes/mock/login`, {}, AUTH);
    check('login endpoint rejects non-CLI lanes', l1.status === 404);
    const l2 = await jpost(`${BASE}/admin/api/lanes/doesnotexist/login`, {}, AUTH);
    check('login endpoint rejects unknown lanes', l2.status === 404);
    const l3 = await jpost(`${BASE}/admin/api/lanes/fclaude/login`, {});
    check('login endpoint also requires the admin token', l3.status === 401);
  }

  finish();
}

function finish(err) {
  if (gateway) gateway.kill();
  mock.close();
  try { fs.rmSync(WORK, { recursive: true, force: true }); } catch { /* best effort */ }
  if (err) {
    console.error(`\nSuite aborted: ${err.message}`);
    process.exit(2);
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(failed ? 1 : 0);
}

main().catch(finish);
