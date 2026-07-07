# local-harness

Think of local-harness as a **power strip for AI models**. You plug models in
on one side — a model running on your own PC, your Claude subscription, your
Gemini subscription — and plug your coding tools in on the other — VS Code /
Copilot Chat, Claude Code, OpenCode. Every tool can then use every model,
through one single address on your machine.

**Why?**

- **Privacy** — everything runs on `127.0.0.1` (your own machine). Nothing is
  reachable from your network, and no third-party proxy ever holds your
  passwords or session tokens.
- **No API bills** — your flat-rate subscriptions (claude.ai Pro/Max, Gemini
  Pro/Ultra) are used through their official command-line apps, not through
  pay-per-token API keys.
- **One audit trail** — every request from every tool is recorded to
  `logs/audit.jsonl`, so you always know what was asked and where it went.

**Zero dependencies** — nothing to `npm install`. The gateway uses only Node's
built-in modules, so the supply-chain attack surface is zero. Streaming (SSE)
passes through untouched, so live token-by-token chat works in every client.

> **If you can copy-paste into a terminal, you can do this.** This guide
> assumes no prior knowledge. There's a [glossary](#glossary) at the end for
> any unfamiliar words.

---

## Contents

- [What you need](#what-you-need)
- [Quick start](#quick-start-two-steps) — start the gateway, open the dashboard
- **Dashboard sections** — mirrors the GUI:
  - [Your AI subscriptions](#your-ai-subscriptions) — Claude, Gemini
  - [Your local model](#your-local-model) — Ollama, vLLM, LM Studio
  - [Claude Code with a local model as its brain](#claude-code-with-a-local-model-as-its-brain)
- [How do I know it's working?](#how-do-i-know-its-working)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Security](#security)
- [Glossary](#glossary) · [Files](#files)

---

## What you need

1. **Node.js 18 or newer.** Check with `node --version` in a terminal. Install
   from [nodejs.org](https://nodejs.org) if you don't have it.
2. At least one model source:
   - a **Claude subscription** (claude.ai Pro or Max), and/or
   - a **Gemini subscription** / Google account, and/or
   - a **local model** via [Ollama](https://ollama.com) (free, runs on your PC),
     [vLLM](https://docs.vllm.ai), LM Studio, or anything OpenAI-compatible.

The gateway itself has zero npm dependencies — `node gateway.js` just works.
To use Claude or Gemini subscription lanes, you install their CLIs once; the
dashboard shows the exact command and checks it off automatically. For a local
model only, there is truly nothing else to install.

---

## Quick start (two steps)

### Step 1 — Start the gateway

**Option A — foreground** (simplest; you see the logs live; Ctrl+C to stop):

```bash
node gateway.js
```

**Option B — background** (recommended for daily use — survives closing the
terminal):

```bash
./start.sh              # start in the background, port from config.json
./start.sh 4500         # custom port for this run only (won't change saved settings)
./stop.sh               # stop it
./restart.sh            # stop + start — use this after editing gateway.js,
                        # since Node doesn't hot-reload
```

`./start.sh` refuses to start a second instance by accident, confirms the
gateway is actually answering before printing success, and never touches
`config.json`. Logs go to `logs/gateway.log`; the PID lives in `.gateway.pid`.
(Equivalent npm scripts: `npm run start:bg`, `npm run stop`, `npm run
restart`; custom port with `npm run start:bg -- 4500`.)

Either way, you'll see something like:

```
  local-harness gateway
  Admin GUI : http://127.0.0.1:4000/admin?token=a1b2c3...
  [on ] /local    -> http://127.0.0.1:11434  (Local model (Ollama))
  [off] /claude   -> cli:claude              (Claude subscription)
  [off] /gemini   -> cli:gemini              (Gemini subscription)
```

### Step 2 — Open the dashboard

Open the URL from the startup banner — **the whole thing, `?token=...`
included.** That token is a password for the dashboard: without it, anyone (or
any webpage) that tries to open the admin page or its API is rejected. This is
what stops a malicious website you happen to have open in another tab from
silently reconfiguring your gateway. Once you've opened it correctly, the page
remembers the token — you only need the full link the first time. Lost it?
It's always in `logs/gateway.log`, or run `./restart.sh` to print it again.

This page is your control room. It has four sections:

| Section | What it's for |
|---|---|
| **Your AI subscriptions** | Guided 3-step setup for Claude and Gemini. Start here. |
| **Your local model** | A simple form — name, address, and which models it serves — for a model on your own machine (Ollama, LM Studio, vLLM). |
| **Advanced settings** (collapsed) | Everything technical, hidden until you expand it: an all-in-one config bundle, request logging, the gateway port, and a raw route editor. Most people never open this. |
| **Recent activity** | A live table of each request as it flows through the gateway. |

`config.json` is created on first run with sensible defaults. Change the port
under **Advanced settings** (applied live) — the `PORT`/`HOST` env vars that
`start.sh` uses only override it for that one run.

---

## Your AI subscriptions

The dashboard's **Your AI subscriptions** section has a guided 3-step card for
each provider.

> **Copilot?** GitHub Copilot already works natively inside VS Code — no lane
> or setup needed for it here. local-harness is for adding *other* models
> alongside it.

### Claude

On the dashboard, find the **Claude** card. Three steps tick themselves green
as you go:

**① Install the Claude app.** If the step already shows a green ✓, skip ahead.
Otherwise copy the command shown and run it in a terminal:

```bash
npm install -g @anthropic-ai/claude-code --ignore-scripts
```

(`--ignore-scripts` is a safety habit: it stops any package from running hidden
code during installation.)

**② Sign in to Claude.** Click **"Sign in to Claude"**. A terminal window
opens running `claude`. Type `/login` in it and finish signing in in your
browser with your claude.ai account. Within a few seconds the card shows
**"signed in as you@example.com — ready to use"**.

> The dashboard never sees your password — the official Claude app holds your
> login; the gateway just checks whether you're signed in.

**③ Use it in your tools.** Flip the **turn on** switch, then select the tab
for your tool:

- **VS Code:** open **Copilot Chat**, click the **model picker** →
  **"Manage Models…"** (some versions: **"Other Models"**) → **"Custom
  endpoint"**. VS Code opens a JSON entry for you to fill in — it does **not**
  discover models from the address on its own, so **replace it entirely**
  with the JSON block the dashboard shows (`copy` button included), which
  already has one entry per model (`sonnet`, `opus`, `haiku`) with a real `id`
  pointed at `http://localhost:4000/claude/v1`. This matters: a blank or
  made-up `id` is silently left out of the chat model picker with no error —
  confirmed directly, not a guess. Your Claude models then appear in Copilot's
  picker **next to** the ones you already had — nothing is replaced.

- **OpenCode:** click the **OpenCode** tab, copy the block into `opencode.json`
  in your project (or `~/.config/opencode/opencode.json`), run `opencode`, then
  `/models`.

---

### Gemini

Same three steps, on the **Gemini** card:

1. **Install:** `npm install -g @google/gemini-cli --ignore-scripts`
2. **Sign in:** click **"Sign in to Gemini"** — a terminal opens running
   `gemini` and sends you to your browser. **Use the Google account that holds
   your subscription.** The CLI uses your Google AI Pro/Ultra quota
   automatically; otherwise it falls back to the free tier.
3. **Use it:** flip the switch on, then in VS Code add a **Custom endpoint**
   with the JSON block the card shows — same as the Claude card, one entry
   per model (`gemini-2.5-pro` / `gemini-2.5-flash`) with a real `id` pointed
   at `http://localhost:4000/gemini/v1` (edit the model list on the card if
   your CLI offers different ones). For OpenCode, click the **OpenCode** tab.

> **Heads up — Gemini's sign-in can fail even after you complete it.** The
> `gemini` CLI has an internal "Code Assist onboarding" step that some accounts
> don't have access to — commonly Workspace/company-managed accounts, or when
> you signed in with a different Google account than the one holding the
> subscription. Symptoms: `FatalCancellationError`, an `onboardUser` 429/403, a
> bare "Not logged in", or the card flickering. **Diagnose it outside the
> gateway first:** run `gemini -p "say hi"` in your own terminal. If it fails
> there too, it's a Google account/policy issue this project can't work around
> for that account.
>
> Google is also mid-rollout on a replacement CLI called `antigravity`. If
> `gemini` stops resolving, change the lane's **CLI command** field to
> `antigravity`.

> ⚠️ **Terms of Service:** routing a consumer subscription through third-party
> tools generally violates Anthropic's and Google's ToS, even via their
> official CLIs, and could in theory get an account flagged. The `local` lane
> has no such issue.

---

## Your local model

No subscription needed, and nothing leaves your machine.

1. Start a model server. For example:
   ```bash
   ollama pull llama3.1 && ollama serve      # Ollama, port 11434
   # or
   vllm serve <model> --port 8000            # vLLM, port 8000
   ```
2. On the dashboard's **Your local model** card, enter a **name** and the
   **address** of your server (common ones are shown on the card:
   Ollama `http://localhost:11434`, LM Studio `http://localhost:1234`,
   vLLM `http://localhost:8000`). Click **Test connection** — it turns green
   when reachable and auto-discovers the model name(s) via `/v1/models`.
   Servers that don't support that endpoint won't auto-fill — type the model
   names into the **Models** field yourself (comma-separated); once there's
   more than one, a **Default model** dropdown appears to pick which one the
   curl snippet uses and which one the gateway falls back to if a tool
   requests a model this server doesn't have.
3. Flip it on, then add it to your tool:
   - **VS Code:** add a **Custom endpoint** with the JSON block the card
     shows — one entry per model you listed above, `id` set to the exact
     model name and `url` pointed at e.g. `http://localhost:4000/local/v1`,
     same as the subscription cards. VS Code does not discover models from
     the address itself, so the JSON's own `models` array is the complete,
     final list — a placeholder or mismatched `id` just won't appear in the
     chat picker, with no error.
   - **OpenCode:** click the **OpenCode** tab on the card — for a local model
     it defaults to a config that points *directly* at your server's own
     address (OpenCode already speaks OpenAI's API natively, so it has no
     real need for the gateway), with the gateway-routed config offered as a
     fallback underneath if you'd rather have it in the audit log.

> If your server's address already ends in `/v1` (some hosted vLLM gateways
> do), that's fine — the gateway handles it without doubling the path.

**VS Code alternative — skip the gateway entirely.** Ollama, vLLM, and LM
Studio already speak OpenAI's API on their own, so you can point VS Code
straight at your server's own address instead of the gateway's — e.g.
`http://localhost:11434/v1` for Ollama. Use your server's real API key if it
needs one (there's no gateway left to inject one for you). You lose the
shared port, the audit log, and bundling with your other lanes/subscriptions
in one config — worth it only if this is the sole model you'll ever add to VS
Code. The local model card shows this exact direct config (with a copy
button) right under the normal gateway instructions.

**A note on `vision`, wherever this JSON appears:** the dashboard always
generates `vision: false`. For the Claude/Gemini CLI lanes this isn't a
default to override — the gateway's CLI wrapper only forwards message
*text* to the underlying `claude`/`gemini` process, so any image content is
silently dropped before it ever reaches the CLI. For a local-model lane,
flip it to `true` only once you've confirmed that specific backend model
actually accepts image input — the gateway has no way to know either way.

---

## Claude Code with a local model as its brain

This is the way to make **Claude Code** (the `claude` CLI coding assistant) run
entirely on your own model — full agentic coding, file reads, tool calls and
all, bypassing Anthropic's cloud and usage limits.

It works because the gateway speaks **Anthropic's Messages API** natively on
proxy lanes: it translates Anthropic-format requests (including tool calls,
streaming, everything) into the OpenAI Chat Completions format your model
speaks, and translates the responses back. (Claude *Desktop* can't do this —
it hardcodes its connection to Anthropic's servers with no way to swap the
model. Claude Code is fully headless, so its model is simply whatever
`ANTHROPIC_BASE_URL` points at.)

Add to `~/.claude/settings.json` (create it if it doesn't exist):

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:4000/local",
    "ANTHROPIC_API_KEY": "local-key"
  }
}
```

Then run `claude` and it uses your local model for every message.

- Replace `/local` with the address prefix of whichever **local model lane**
  you want. This works only for plain HTTP backends — **not** the built-in
  `claude`/`gemini` subscription lanes, which
  only speak OpenAI's format (and routing Claude Code through the lane that
  launches the real `claude` CLI would be circular anyway). The dashboard's
  Claude/Gemini subscription cards deliberately don't offer a "Claude Code"
  tab for this reason.
- `ANTHROPIC_API_KEY` is ignored by the gateway but required by Claude Code —
  any non-empty string works. **If your real backend needs a key, put it in the
  lane's API-key field in the dashboard, not here.**
- Prefer to keep your global config clean? Set the two variables per-session
  instead, or in a project-local `~/.claude/settings.local.json` (which
  `.gitignore` already excludes so you don't leak a key):
  ```bash
  ANTHROPIC_BASE_URL=http://localhost:4000/local ANTHROPIC_API_KEY=local-key claude
  ```

> **Note:** your model needs tool-calling support server-side for Claude Code
> to read files and run commands (e.g. vLLM started with
> `--enable-auto-tool-choice` and a matching `--tool-call-parser`). Without it,
> Claude Code can chat but can't act on your repo.

---

## How do I know it's working?

Three ways, easiest first:

1. **Recent activity table** (bottom of the dashboard). Send a message from any
   tool and a row appears within seconds: which lane, which model, how long,
   and — when the backend reports it — tokens, tokens/sec, and time-to-first-token.
   These three are best-effort: a dash means the backend never told the
   gateway, not that nothing happened. Streaming requests get a real
   completion-token count and TTFT from the backend's own usage data when it
   reports one (the gateway asks for it via `stream_options.include_usage` on
   Anthropic-translated traffic); non-streaming requests show TTFT equal to
   the total duration, since the whole answer arrives at once.
2. **curl test** — click the **Test with curl** tab on any card, copy, paste
   into a terminal, and you should get a JSON answer back. Or directly:
   ```bash
   curl -s http://localhost:4000/local/v1/chat/completions \
     -H 'content-type: application/json' \
     -d '{"model":"MODEL","messages":[{"role":"user","content":"hi"}]}'
   ```
   (Swap `MODEL` for one your backend serves — the curl tab fills this in for
   you once a model is discovered.)
3. **The audit log** — `logs/audit.jsonl` keeps one line per request forever.
   Open it in any text editor.

---

## Testing

```bash
npm test
```

Runs the regression suite ([test/regression.js](test/regression.js), also
zero-dependency). It boots an isolated gateway on port 4999 with a mock HTTP
backend and fake `claude`/`gemini` CLIs — **your real config, logins, and
subscription quota are never touched** — and verifies dozens of behaviors
across routing, audit-header injection, SSE streaming, the built-in CLI
wrappers, config validation, health checks, and the full Anthropic Messages
API translation (including tool-calling, both directions, streaming and
non-streaming). All checks pass in a few seconds. macOS/Linux only (the fake
CLIs are POSIX scripts).

---

## Troubleshooting

| Symptom | Cause & fix |
|---|---|
| Dashboard won't load | The gateway isn't running. Run `node gateway.js`, or `./start.sh`. |
| "Missing or invalid admin token" | You opened `/admin` without the `?token=...` part, or the wrong one. Find the full link in `logs/gateway.log` or run `./restart.sh`. |
| You edited `gateway.js` and nothing changed | Node doesn't hot-reload. Run `./restart.sh` (or Ctrl+C and re-run). |
| `port 4000 is already in use` | Something else owns the port. Change **Gateway port** under **Advanced settings** (then restart), or stop the other program. |
| Local model card says "not reachable" | The model server isn't running. Start it (`ollama serve`, etc.), or fix the **address** on the card. |
| Card says "app not installed" | The CLI isn't on your PATH. Run the install command shown, then reload the dashboard. |
| Gemini: `FatalCancellationError` / "Not logged in" / flickering, even after signing in | A Google-side Code Assist limitation, not a gateway bug. Test with `gemini -p "say hi"` in your own terminal — if it fails there too, that account can't use the CLI right now. |
| Claude Code exits after a couple seconds / garbled tool text | Your model backend needs tool-calling enabled server-side (e.g. vLLM `--enable-auto-tool-choice`). Without it, Claude Code can chat but can't read files. |
| Claude Code: `API Error 400 System message must be at the beginning` | Fixed in the gateway — restart it (`./restart.sh`) if you're on an old process. |
| VS Code shows no models after adding the URL | Make sure the lane is **turned on** and the address ends in `/v1`. Test with the curl tab. |
| A model added via VS Code's **Custom endpoint** never shows up in the chat picker | Check the JSON's `id` field — it has to be the exact model name the endpoint serves (`sonnet`/`opus`/`haiku` for Claude, whatever your local model calls itself), not a label like "Claude subscription". VS Code doesn't query the address to discover models; a blank or mismatched `id` is silently dropped with no error. Copy the JSON straight from the card rather than hand-typing it. |
| Reply arrives all at once, not word-by-word | Normal for the Claude/Gemini subscription lanes (the CLI produces the full answer first). Local models stream token-by-token. |
| A lane answers `502` with a login hint | The CLI's session expired. Sign in again on that card. |
| Everything answers `421` "blocked: Host header …" | The request reached the gateway under a hostname that isn't `localhost`/`127.0.0.1` (DNS-rebinding protection). Address the gateway as `http://localhost:<port>` or `http://127.0.0.1:<port>`, not via some other alias. |

---

## Security

This is a **localhost-only, single-user tool.** The realistic threats are a
malicious website open in your browser while the gateway runs, other local
users/processes on the same machine, and the third-party CLIs/wrappers you
point lanes at — not the network.

This project has been through an automated security scan (SAST + an LLM-based
deep review), and every finding was individually re-verified against the actual
code/runtime behavior rather than taken at face value. Both the confirmed
issues and the false positives are recorded below with evidence, so this
doesn't need re-litigating on the next scan.

**What's covered:**

- Binds to `127.0.0.1` only; the admin API refuses to rebind off localhost, and
  a startup warning fires if you ever override that.
- **Zero npm dependencies** in `gateway.js` — no transitive dependency tree to
  audit for the code that actually runs your traffic.
- **The entire admin surface (`/admin` page + `/admin/api/*`) requires a random
  per-install token** (via `X-Admin-Token` header or `?token=` query param,
  checked with a constant-time comparison). Without it, anything that can reach
  `localhost:<port>` — another local user, a compromised dependency in an
  unrelated project, a malicious webpage — could read or rewrite your config,
  including a lane's `command` field (which is arbitrary code execution). The
  token is in the startup banner and `logs/gateway.log`; `/healthz` stays
  unauthenticated as a liveness probe. **This does not affect chat traffic** —
  lane routes need no token, only configuration does.
- On top of the token, the admin API requires **same-origin** requests: any
  non-`GET` call is rejected unless its `Origin` matches the gateway's host,
  and config writes require `Content-Type: application/json` (closing the
  "CORS-safelisted content type" bypass). The admin token can't be rotated
  through the config-write endpoint, so a caller with one valid token can't
  lock out the real user.
- **Every route rejects requests whose `Host` header isn't this gateway's own
  address** (421). This closes DNS rebinding: a malicious site can point its
  own hostname at 127.0.0.1, making its requests *same-origin* in your browser
  — CORS never applies, so without this check the page could not only send
  requests to token-free chat lanes but **read the responses**. The rebound
  request necessarily carries the attacker's hostname in `Host`, which is
  exactly what's rejected.
- CLI lanes `spawn()` with an argv array, **never a shell**, so prompts can't be
  interpreted as shell syntax — verified directly (a prompt containing
  `; rm -rf ~` reaches the CLI as inert literal text). The `command` field also
  rejects shell metacharacters as hygiene.
- `config.json` is written `0600` (owner-only), since lane API keys live there
  in plaintext. Logs, `config.json`, and project-local Claude keys are all in
  `.gitignore` so they can't be committed.
- The audit log records **metadata only** — lane, model, status, timing, byte
  counts, and (best-effort) token/throughput counts — never prompt or response
  bodies. Token counts come from the backend's own reported usage, not from
  reading the actual message content.
- Sign-ins happen inside the official CLIs; the gateway never sees your
  password. Every dynamic value in the GUI is HTML-escaped before rendering.

**What's *not* covered, by design or by nature of the problem:**

- **A local user with the admin token can set a lane's `command` to anything** —
  that's the feature (build your own lanes), so the token is the whole trust
  boundary. Treat it like a password to a root shell for this tool.
- **No TLS.** Fine on loopback; do **not** rebind `host` to `0.0.0.0` — that
  would expose the admin API, in plaintext, on your network.
- **Consumer subscriptions in third-party tools generally violate the
  provider's ToS** and can get an account flagged — a policy risk, not a code
  one.

**Automated-scan findings that did not hold up, with evidence:**

- *"Critical: Command Injection — user prompts can be escalated to code
  execution"* — **false.** `spawn()` is called without `shell: true` anywhere,
  so there is no shell for metacharacters to be interpreted by; args reach the
  OS as a literal array. Reproduced directly: a destructive-looking prompt
  creates no file and runs no command (see the regression test).
- *"High: XSS via `innerHTML` in `script.js:120`"* — `script.js` doesn't exist
  (the scanner mislabeled inline `<script>` in `admin.html`). Every `innerHTML`
  assignment was checked: all dynamic values pass through an `esc()` helper first.

---

## Glossary

| Term | Meaning |
|---|---|
| **Gateway** | The small program (`gateway.js`) that receives all requests and forwards them to the right place. |
| **Lane** | One named route through the gateway (`/claude`, `/local`, …), leading to one model source. (In the dashboard these show up as your subscriptions, your local model, etc.) |
| **Address / Base URL** | The web address a tool sends requests to, e.g. `http://localhost:4000/claude/v1`. |
| **OpenAI-compatible** | The de-facto standard request format most AI tools speak. |
| **Anthropic Messages API** | Claude's own request format. The gateway translates it to/from OpenAI-compatible so Claude Code can drive a local model. |
| **CLI** | Command-line interface — a program you run in a terminal, like `claude` or `gemini`. |
| **MCP** | Model Context Protocol — how tools like VS Code Copilot connect to external tools. |
| **SSE / streaming** | The technique that makes replies appear word-by-word instead of all at once. |
| **`localhost` / `127.0.0.1`** | Your own computer. Addresses starting with this are unreachable from outside. |
| **Audit log** | `logs/audit.jsonl` — one line per request: when, which lane, which model, how big, how long, and (best-effort) tokens/throughput/TTFT. |

---

## Files

```
gateway.js               the proxy + admin API + Anthropic translation (zero deps)
public/admin.html        the dashboard (GUI)
start.sh / stop.sh       background start/stop, supports a custom port
restart.sh               stop + start, for picking up source edits
config.json              created on first run; edited by the GUI (gitignored — holds secrets)
logs/gateway.log         gateway output from start.sh (gitignored)
logs/audit.jsonl         append-only request audit trail (gitignored)
templates/               agent-instruction templates for OpenCode
archive/                 parked features not currently documented — see archive/README.md
test/regression.js       self-contained regression suite (npm test)
```
