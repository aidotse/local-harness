# local-harness

One local endpoint for many AI model sources (Claude CLI, Gemini CLI, local
OpenAI-compatible servers like Ollama/vLLM/LM Studio), usable from tools like
VS Code/Copilot Chat, Claude Code, and OpenCode.

## Start here (2 minutes)

1. Start the gateway:
   ```bash
   node gateway.js
   # or run in background:
   ./start.sh
   ```
2. Open the **Admin GUI** URL printed in the terminal (includes `?token=...`).
3. In the dashboard, configure one lane (Claude, Gemini, or Local), then copy
   the generated client JSON into your tool.

If you want details for each step, continue with [Quick start](#quick-start-two-steps)
and the lane sections below.

## Why local-harness

- **Private by default**: binds to `127.0.0.1` only.
- **No API key billing required** for Claude/Gemini subscription lanes.
- **Single audit log** in `logs/audit.jsonl` across all tools.
- **Zero npm dependencies** in the gateway itself (Node built-ins only).

---

## Contents

- [Quick start](#quick-start-two-steps) — start the gateway, open the dashboard
- [What you need](#what-you-need)
- **Dashboard sections** — mirrors the GUI:
  - [Your AI subscriptions](#your-ai-subscriptions) — Claude, Gemini
  - [Your local model](#your-local-model) — Ollama, vLLM, LM Studio
  - [Claude Code with a local model as its brain](#claude-code-with-a-local-model-as-its-brain)
- [Local models without the gateway](#local-models-without-the-gateway) — skip local-harness entirely
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
For Claude/Gemini lanes, install each CLI once. For local-only usage, there is
nothing else to install.

---

## Quick start (two steps)

### Step 1 — Start the gateway

**Option A — foreground** (live logs, Ctrl+C to stop):

```bash
node gateway.js
```

**Option B — background** (recommended for daily use):

```bash
./start.sh              # start in the background, port from config.json
./start.sh 4500         # custom port for this run only (won't change saved settings)
./stop.sh               # stop it
./restart.sh            # stop + start — use this after editing gateway.js,
                        # since Node doesn't hot-reload
```

`./start.sh` prevents duplicate instances, waits for health, and does not edit
`config.json`.

- Logs: `logs/gateway.log`
- PID file: `.gateway.pid`
- npm equivalents: `npm run start:bg`, `npm run stop`, `npm run restart`
- Custom port (npm): `npm run start:bg -- 4500`

Either way, you'll see something like:

```
  local-harness gateway
  Admin GUI : http://127.0.0.1:4000/admin?token=a1b2c3...
  [on ] /local    -> http://127.0.0.1:11434  (Local model (Ollama))
  [off] /claude   -> cli:claude              (Claude subscription)
  [off] /gemini   -> cli:gemini              (Gemini subscription)
```

### Step 2 — Open the dashboard

Open the full Admin GUI URL, including `?token=...`.

- The token protects admin endpoints.
- The browser remembers it after first open.
- If lost, get it from `logs/gateway.log` or run `./restart.sh`.

This page is your control room. It has four sections:

| Section | What it's for |
|---|---|
| **Your AI subscriptions** | Guided 3-step setup for Claude and Gemini. Start here. |
| **Your local model** | A simple form — name, address, and which models it serves — for a model on your own machine (Ollama, LM Studio, vLLM). |
| **Advanced settings** (collapsed) | Everything technical, hidden until you expand it: an all-in-one config bundle, request logging, the gateway port, and a raw route editor. Most people never open this. |
| **Recent activity** | A live table of each request as it flows through the gateway. |

`config.json` is created on first run. Change port in **Advanced settings**.
`PORT`/`HOST` from `start.sh` are one-run overrides.

---

## Your AI subscriptions

The **Your AI subscriptions** section has one 3-step card per provider.

> **Copilot?** GitHub Copilot already works natively inside VS Code — no lane
> or setup needed for it here. local-harness is for adding *other* models
> alongside it.

### Claude

Use the **Claude** card and complete these three steps.

**① Install the Claude app.** If the step already shows a green ✓, skip ahead.
Otherwise copy the command shown and run it in a terminal:

```bash
npm install -g @anthropic-ai/claude-code --ignore-scripts
```

`--ignore-scripts` prevents install-time package scripts.

**② Sign in to Claude.** Click **"Sign in to Claude"**, run `/login` in the
opened terminal, and complete browser auth.

> The dashboard never sees your password — the official Claude app holds your
> login; the gateway just checks whether you're signed in.

**③ Use it in your tools.** Turn the lane on, then use one of these tabs:

- **VS Code:** Copilot Chat → model picker → **Manage Models…** (or
  **Other Models**) → **Custom endpoint**. Replace the JSON with the card's
  full block.
  VS Code does not auto-discover models from URL. Each model needs a real `id`,
  or it will not appear in the picker.

- **OpenCode:** copy the OpenCode tab block into `opencode.json` (project or
  `~/.config/opencode/opencode.json`), run `opencode`, then `/models`.

---

### Gemini

Same three steps on the **Gemini** card:

1. **Install:** `npm install -g @google/gemini-cli --ignore-scripts`
2. **Sign in:** click **"Sign in to Gemini"**, complete browser auth, and use
  the Google account that holds your subscription.
3. **Use it:** turn the lane on and copy the card JSON into VS Code Custom
  endpoint (or use the OpenCode tab). Keep model `id` values exact.

> **Heads up:** Gemini sign-in can fail on some account types.
> If you see `FatalCancellationError`, `onboardUser` 429/403, or "Not logged
> in", test directly first: `gemini -p "say hi"`. If that fails too, the issue
> is account/policy-side.
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

No subscription needed. Traffic stays on your machine.

1. Start a model server. For example:
   ```bash
   ollama pull llama3.1 && ollama serve      # Ollama, port 11434
   # or
   vllm serve <model> --port 8000            # vLLM, port 8000
   ```
2. In **Your local model**, enter a name and server address
  (Ollama `http://localhost:11434`, LM Studio `http://localhost:1234`,
  vLLM `http://localhost:8000`). Click **Test connection**.
  If `/v1/models` is unsupported, enter model names manually (comma-separated).
  If multiple models are set, choose a **Default model**.
3. Turn the lane on, then add it to your tool:
  - **VS Code:** paste the card JSON into **Custom endpoint**.
    Use exact model names in `id`; mismatches are silently skipped.
  - **OpenCode:** use the OpenCode tab. It defaults to direct backend config,
    with gateway-routed config as an optional fallback.

> If your server's address already ends in `/v1` (some hosted vLLM gateways
> do), that's fine — the gateway handles it without doubling the path.

**Prefer to skip the gateway?** See
[Local models without the gateway](#local-models-without-the-gateway).

**Vision setting:**

- Dashboard JSON defaults to `vision: false`.
- Claude/Gemini CLI lanes are text-only.
- For local models, set `vision: true` only if that backend/model supports images.

---

## Local models without the gateway

You can connect VS Code and OpenCode directly to Ollama/vLLM/LM Studio.
Use this if you do not want to run the gateway.

Trade-offs:

- No shared gateway port across tools
- No entries in `logs/audit.jsonl`
- No centralized model routing/config
- You manage API keys per tool

**Find the exact model id first:**

```bash
curl -s http://localhost:11434/v1/models   # Ollama — replace the port for vLLM/LM Studio
```

Use that `id` exactly. Near matches are silently skipped by clients.

### VS Code

Copilot Chat → model picker → **"Manage Models…"** (some versions: **"Other
Models"**) → **"Custom endpoint"**. Replace VS Code's blank JSON entry
entirely with this, filling in your real model id and address:

```json
{
  "name": "My local model",
  "vendor": "customendpoint",
  "apiKey": "dummy",
  "apiType": "chat-completions",
  "models": [
    {
      "id": "llama3.1",
      "name": "My local model — llama3.1",
      "url": "http://localhost:11434/v1",
      "toolCalling": true,
      "vision": false,
      "maxInputTokens": 200000,
      "maxOutputTokens": 8192
    }
  ]
}
```

Add one object per model if needed. If your server requires an API key, set it
here. Keep `vision` false unless image input is confirmed.

### OpenCode

Save as `opencode.json` in your project root (or
`~/.config/opencode/opencode.json` for every project):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "my-local-model": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "My local model",
      "options": { "baseURL": "http://localhost:11434/v1" },
      "models": { "default": { "name": "My local model" } }
    }
  }
}
```

Run `opencode` → `/models` → pick it. Add `"apiKey": "..."` inside `options`
if your server needs one.

---

## Claude Code with a local model as its brain

Use this to run **Claude Code** against your own local model.

How it works: the gateway translates between Anthropic Messages API and
OpenAI-compatible chat format for your backend.

Add to `~/.claude/settings.json` (create it if it doesn't exist):

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:4000/local",
    "ANTHROPIC_API_KEY": "local-key"
  }
}
```

Run `claude` after saving this.

- Replace `/local` with your local lane prefix.
  This does not work with built-in Claude/Gemini subscription lanes.
- `ANTHROPIC_API_KEY` is required by Claude Code but ignored by the gateway.
  If the backend needs a real key, set it in the lane config.
- Alternative: set variables per session (or in `~/.claude/settings.local.json`):
  ```bash
  ANTHROPIC_BASE_URL=http://localhost:4000/local ANTHROPIC_API_KEY=local-key claude
  ```

> **Note:** Claude Code needs server-side tool-calling support to read files
> and run commands. Without it, chat works but repo actions do not.

---

## How do I know it's working?

Three quick checks:

1. **Recent activity table:** send a request and check lane/model/duration.
  Token and TTFT fields are best-effort and depend on backend reporting.
2. **curl test** — click the **Test with curl** tab on any card, copy, paste
   into a terminal, and you should get a JSON answer back. Or directly:
   ```bash
   curl -s http://localhost:4000/local/v1/chat/completions \
     -H 'content-type: application/json' \
     -d '{"model":"MODEL","messages":[{"role":"user","content":"hi"}]}'
   ```
   (Swap `MODEL` for one your backend serves — the curl tab fills this in for
   you once a model is discovered.)
3. **Audit log:** check `logs/audit.jsonl` (one line per request).

---

## Testing

```bash
npm test
```

Runs the zero-dependency regression suite in `test/regression.js`.

- Uses an isolated gateway on port 4999
- Uses mock backend + fake CLIs
- Does not touch your real logins/config/quota
- Covers routing, streaming, wrappers, config validation, and translation
- macOS/Linux only (fake CLIs are POSIX scripts)

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

local-harness is localhost-only and intended for one user on one machine.

**Built-in protections:**

- Binds to `127.0.0.1` by default
- Admin UI/API requires per-install token (`?token=` or `X-Admin-Token`)
- Admin writes require same-origin + `application/json`
- Host header validation blocks DNS rebinding (`421`)
- CLI lanes use argv `spawn()` (no shell interpretation)
- `config.json` is owner-only (`0600`)
- Audit log stores metadata only (not prompts/responses)
- GUI escapes dynamic values before rendering, and never renders a saved API
  key back into the page — the field starts blank; leaving it blank on save
  keeps the existing key rather than clearing it
- The "sign in to a CLI" login button quotes the lane's command at both the
  AppleScript-literal level and the shell level (`quoted form of`), not just
  the former

**Important limits:**

- Anyone with your admin token can modify lane commands
- No TLS on loopback (do not expose by rebinding host)
- Provider ToS may disallow routing consumer subscriptions through third-party tools

**On automated scans:** this project has been through a SAST + AI deep-review
pass. Every finding was individually re-verified against actual code/runtime
behavior — including live-testing the one that looked most serious (a claimed
SSRF via URL manipulation, disproven by running the exact attack against the
real gateway with a throwaway listener: the proxy's outbound host comes from
the admin-configured lane target, never from the request path, so there was
nothing to redirect). Most findings were generic pattern-matches that don't
hold up once you check what the flagged code actually does — a `command`
field that's already blocklisted for shell metacharacters and never reaches a
shell, a `process.env` passthrough with no attacker-controlled input, a test
fixture literally named `test-admin-token-not-secret`. Take any single
automated scan's severity labels with real skepticism; re-verify before
acting on them.

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
