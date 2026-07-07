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
- **Recipes** — how to actually use it:
  - [Claude subscription in VS Code](#recipe-1--your-claude-subscription-in-vs-code)
  - [Gemini subscription in VS Code](#recipe-2--your-gemini-subscription-in-vs-code)
  - [A local model (Ollama / vLLM / LM Studio)](#recipe-3--a-local-model-ollama--vllm--lm-studio)
  - [Claude Code with a local model as its brain](#recipe-4--claude-code-with-a-local-model-as-its-brain)
  - [OpenCode (terminal)](#recipe-5--opencode-terminal)
  - [Perplexity search tool in VS Code](#recipe-6--perplexity-as-a-search-tool-in-vs-code)
- [How the Claude & Gemini sign-ins work (and Gemini's catch)](#how-the-claude--gemini-sign-ins-work)
- [Advanced: the browser-session route (Gemini web app)](#advanced-the-browser-session-route)
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

That's it. There is nothing to `npm install`.

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

This page is your control room. It has five sections:

| Section | What it's for |
|---|---|
| **Your AI subscriptions** | Guided 3-step setup for Claude and Gemini, plus a note that Copilot already works natively in VS Code. Start here. |
| **Your local model** | A simple form — name + address — for a model on your own machine (Ollama, LM Studio, vLLM). |
| **More options (advanced)** | The Gemini/Perplexity paths that reuse a browser login. Higher risk; step-by-step included. |
| **Advanced settings** (collapsed) | Everything technical, hidden until you expand it: an all-in-one config bundle, request logging, the gateway port, and a raw route editor. Most people never open this. |
| **Recent activity** | A live table of each request as it flows through the gateway. |

`config.json` is created on first run with sensible defaults. Change the port
under **Advanced settings** (applied live) — the `PORT`/`HOST` env vars that
`start.sh` uses only override it for that one run.

---

## Recipe 1 — Your Claude subscription in VS Code

On the dashboard, find the **Claude** card at the top. It has three numbered
steps that tick themselves green as you go:

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

**③ Use it in your tools.** Flip the **turn on** switch, keep the **VS Code**
tab selected, then in VS Code:

1. Open **Copilot Chat** (the chat icon in the sidebar).
2. Click the **model picker** at the top and choose **"Manage Models…"** (some
   versions call it **"Other Models"**).
3. Pick **"Add a custom OpenAI-compatible model"** and paste the two values the
   dashboard shows (each has a `copy` button):
   - **Address:** `http://localhost:4000/claude/v1`
   - **API key:** `dummy` (the gateway ignores it; any text works)
4. VS Code lists the models — `sonnet`, `opus`, `haiku`. Tick the ones you want.

Done. Your Claude models now appear in Copilot's picker **next to** the ones
you already had — GPT-4o and everything else still work unchanged.

---

## Recipe 2 — Your Gemini subscription in VS Code

Same three steps, on the **Gemini** card:

1. **Install:** `npm install -g @google/gemini-cli --ignore-scripts`
2. **Sign in:** click **"Sign in to Gemini"** — a terminal opens running
   `gemini` and sends you to your browser. **Use the Google account that holds
   your subscription.**
3. **Use it:** flip the switch on, then add a custom model in VS Code exactly
   as in Recipe 1 but with **Address** `http://localhost:4000/gemini/v1`. You'll
   get `gemini-2.5-pro` / `gemini-2.5-flash` (edit the model list on the card if
   your CLI offers different ones).

> **Heads up:** Gemini's CLI sign-in has a known catch — some accounts can't
> use it at all. See [the next section](#how-the-claude--gemini-sign-ins-work)
> before spending too long troubleshooting.

---

## Recipe 3 — A local model (Ollama / vLLM / LM Studio)

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
   when reachable and auto-discovers the model name(s).
3. Flip it on, then add it to VS Code exactly as in Recipe 1, with the
   **Address** shown on the card (e.g. `http://localhost:4000/local/v1`).

> If your server's address already ends in `/v1` (some hosted vLLM gateways
> do), that's fine — the gateway handles it without doubling the path.

---

## Recipe 4 — Claude Code with a local model as its brain

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

- Replace `/local` with the address prefix of whichever **local model or
  browser-session lane** you want. This works only for those (plain HTTP
  backends) — **not** the built-in `claude`/`gemini` subscription lanes, which
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

## Recipe 5 — OpenCode (terminal)

On any card, click the **OpenCode** tab, copy the block into `opencode.json` in
your project (or `~/.config/opencode/opencode.json`), run `opencode`, then
`/models` and pick the model. It appears as an extra provider next to your
existing ones. Use an `AGENTS.md` file to assign models to agents (e.g. a local
"worker" and a subscription "architect").

---

## Recipe 6 — Perplexity as a search tool in VS Code

Perplexity is different: it has no official CLI or subscription-backed login,
and it's a **search tool**, not a chat model — so instead of a lane in the
dashboard, it becomes a tool Copilot can call on its own in VS Code's **Agent
mode**. (This one bypasses the gateway entirely — MCP servers are configured
per-editor, so its traffic won't appear in `logs/audit.jsonl`.)

1. Get the search server and build it into a container. It's unofficial
   community code that will hold a full-account cookie, so skim what you
   cloned before building — and re-skim the diff whenever you `git pull` and
   rebuild (that's the only way updates reach you, which is the point):
   ```bash
   git clone https://github.com/helallao/perplexity-ai.git && cd perplexity-ai
   printf 'FROM python:3.12-slim\nWORKDIR /app\nCOPY . .\nRUN pip install --no-cache-dir ".[mcp]"\nENTRYPOINT ["perplexity-mcp"]\n' > Dockerfile
   docker build -t perplexity-mcp:local .
   ```
   (No Docker? `pip install -e ".[mcp]"` in that folder works too and the
   template says how to adapt — but then the code runs directly as you,
   outside any container.)
2. Copy [`templates/vscode-mcp-perplexity.json`](templates/vscode-mcp-perplexity.json)
   into `.vscode/mcp.json` in whatever project you want it in. It runs the
   container with `--rm -i` (exists only while VS Code uses the tool, deleted
   after) and passes the cookie as `-e PERPLEXITY_COOKIES` *without a value* —
   forwarded from the environment, so it never appears on a command line.
3. Open Copilot Chat in **Agent mode**. On first use it prompts (in a masked
   box that VS Code keeps in your OS keychain — never written to the file) for
   your Perplexity cookie: from perplexity.ai → DevTools → Application →
   Cookies, enter `{"next-auth.session-token": "<value>"}`.
4. Now ask Copilot something that needs current web info and it reaches for the
   search tool on its own.

No cookie yet? It still works in a free, anonymous mode — a safe way to try it
before trusting it with a login.

> ⚠️ That cookie is a **full-account, likely 2FA-bypassing** credential, not a
> scoped key. Prefer a dedicated low-value Perplexity account; your kill switch
> is "sign out of all sessions" on perplexity.ai — **stopping the container
> does not invalidate the cookie**, sessions live server-side.
>
> ⚠️ In Agent mode Copilot invokes this tool **autonomously**: text it reads (a
> file in your repo, a fetched webpage) can steer it into sending fragments of
> your code to Perplexity — and since this path bypasses the gateway, there's
> no line in `logs/audit.jsonl` to tell you it happened. Enable it per-project,
> only where that trade is acceptable.

---

## How the Claude & Gemini sign-ins work

The **Claude** and **Gemini** cards don't use a third-party proxy — the gateway
spawns the *official* `claude` / `gemini` CLI per request, so your session
token never leaves the official app. A few things worth knowing:

- **What you get:** the `claude` lane exposes `sonnet`/`opus`/`haiku`; the
  `gemini` lane exposes `gemini-2.5-pro`/`gemini-2.5-flash`. Edit the model
  list on the card to match your CLI version.
- **How it behaves:** chat history is flattened into a single prompt per
  request (the CLIs are single-shot), the answer is returned complete and then
  re-framed as streaming if your tool asked for it, and each CLI runs with its
  working directory in a temp dir so it never sees your project files.
- **Gemini uses your real paid quota** if you sign in with the Google account
  that holds your AI Pro/Ultra subscription — it's not a separate free tier.
  Google is mid-rollout on a replacement CLI called `antigravity`; if `gemini`
  stops resolving, just change the lane's **CLI command** field to
  `antigravity`.

**Gemini's catch — it can fail even after you sign in.** The `gemini` CLI's
"Login with Google" has an internal step ("Code Assist onboarding") that some
accounts simply don't have access to — commonly Workspace/company-managed
accounts, or when you signed in with a different Google account than the one
holding the subscription. Symptoms: `FatalCancellationError`, an `onboardUser`
429/403, a bare "Not logged in", or the card flickering between signed-in and
not. **Diagnose it outside the gateway:** run `gemini -p "say hi"` in your own
terminal. If it fails there too, it's a Google account/policy issue, not a
gateway bug — use the [browser-session route](#advanced-the-browser-session-route)
below instead, which sidesteps Code Assist entirely.

> **Copilot?** GitHub Copilot already works natively inside VS Code's chat —
> you don't need this tool for it. local-harness is for adding *other* models
> next to it.

> ⚠️ **Terms of Service:** routing a consumer subscription into third-party
> tools generally violates the provider's ToS (Anthropic, Google), even via
> their official CLIs, and could in theory get an account flagged or suspended.
> The `local` model lane has no such issue. Decide with open eyes.

---

## Advanced: the browser-session route

*Skip this unless the official CLI genuinely won't work for you (e.g. your
Google account can't use the Gemini CLI, per the catch above).*

If you specifically need the literal **gemini.google.com web app** as a
backend, there's no official way to script it — the only path is unofficial
software that replays your live browser session **cookie**. This is
deliberately **not built into the gateway**: copying a live session cookie into
the trusted routing layer is exactly the kind of risky dependency this project
avoids. Instead you run a small wrapper yourself, and the gateway just proxies
to it.

The dashboard's **More options** section has a guided **Gemini — browser
login** card that walks you through it (with copy buttons and a per-install
helper password filled in — prefer the card over retyping from here):

1. **Put the cookies in a private env file** — open gemini.google.com →
   DevTools → Application → Cookies, copy `__Secure-1PSID` and
   `__Secure-1PSIDTS`, then:
   ```bash
   umask 177 && cat > gemini-web.env <<'EOF'
   CONFIG_GEMINI__CLIENTS__0__ID=main
   CONFIG_GEMINI__CLIENTS__0__SECURE_1PSID=your-value
   CONFIG_GEMINI__CLIENTS__0__SECURE_1PSIDTS=your-value
   CONFIG_SERVER__API_KEY=pick-a-random-string
   EOF
   ```
   A file (created owner-only by `umask 177`) keeps the cookies out of your
   shell history and `ps` output — don't pass them as `-e KEY=value` on the
   command line. `CONFIG_SERVER__API_KEY` makes the wrapper refuse any client
   that doesn't present that string as a Bearer token; the dashboard card
   generates one and wires it into the gateway lane for you (in the raw lane
   editor it's the lane's API-key field). **The cookies go into the wrapper —
   never into this gateway or anywhere in local-harness.**
2. **Start the helper** — [Nativu5/Gemini-FastAPI](https://github.com/Nativu5/Gemini-FastAPI)
   (check it's still maintained before trusting it with your session). With
   Docker, in the same folder:
   ```bash
   docker run --rm -p 127.0.0.1:8000:8000 --env-file gemini-web.env ghcr.io/nativu5/gemini-fastapi
   ```
   `127.0.0.1:8000:8000` matters: plain `-p 8000:8000` publishes on all
   interfaces and would hand your Google session to anyone on your network.
   `--rm` deletes the container — including the session cache and stored
   conversations it accumulates — every time you stop it. Safest of all,
   build the image from a clone you've reviewed instead of pulling `latest`
   (updates then only happen when you choose to rebuild):
   ```bash
   git clone https://github.com/Nativu5/Gemini-FastAPI.git && cd Gemini-FastAPI
   docker build -t gemini-fastapi:local .   # then use gemini-fastapi:local above
   ```
3. **Turn it on** — flip the toggle on the card. Its dot turns green once the
   helper answers on port 8000. Then use it in your tools like any local model,
   at `http://localhost:4000/gemini-web/v1`.

Two things worth understanding about session lifetime, in opposite directions:
the helper actively *renews* the short-lived `__Secure-1PSIDTS` cookie while it
runs (calling Google's rotate endpoint), so while it's up your session never
lapses; and **stopping the helper does not sign you out** — the session stays
valid at Google until it expires or you revoke it. So expect to re-copy cookies
after the helper has been stopped a while (the rotated value went stale — the
security-friendly failure), and know your kill switch is Google Account →
Security → "sign out of all sessions". This route is more fragile than the CLI
route and a clearer ToS risk, since it impersonates your live web session
rather than using a scoped login. Prefer a dedicated low-value account.

---

## How do I know it's working?

Three ways, easiest first:

1. **Recent activity table** (bottom of the dashboard). Send a message from any
   tool and a row appears within seconds: which lane, which model, how long.
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
| Gemini: `FatalCancellationError` / "Not logged in" / flickering, even after signing in | A Google-side Code Assist limitation, not a gateway bug. Test with `gemini -p "say hi"` in your own terminal; if it fails there too, use the [browser-session route](#advanced-the-browser-session-route). |
| Claude Code exits after a couple seconds / garbled tool text | Your model backend needs tool-calling enabled server-side (e.g. vLLM `--enable-auto-tool-choice`). Without it, Claude Code can chat but can't read files. |
| Claude Code: `API Error 400 System message must be at the beginning` | Fixed in the gateway — restart it (`./restart.sh`) if you're on an old process. |
| VS Code shows no models after adding the URL | Make sure the lane is **turned on** and the address ends in `/v1`. Test with the curl tab. |
| Reply arrives all at once, not word-by-word | Normal for the Claude/Gemini subscription lanes (the CLI produces the full answer first). Local models stream token-by-token. |
| A lane answers `502` with a login hint | The CLI's session expired. Sign in again on that card. |
| Everything answers `421` "blocked: Host header …" | The request reached the gateway under a hostname that isn't `localhost`/`127.0.0.1` (DNS-rebinding protection). Address the gateway as `http://localhost:<port>` or `http://127.0.0.1:<port>`, not via some other alias. |
| Gemini browser login: helper answers `401`/`403` | The helper's `CONFIG_SERVER__API_KEY` and the lane's API-key field don't match. Re-copy the key from step 1's env file into the lane (raw editor → API key), or re-run the card's guided steps. |

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
  requests to token-free chat lanes but **read the responses** (worst on a
  browser-session lane, where responses come from your live Google session).
  The rebound request necessarily carries the attacker's hostname in `Host`,
  which is exactly what's rejected.
- CLI lanes `spawn()` with an argv array, **never a shell**, so prompts can't be
  interpreted as shell syntax — verified directly (a prompt containing
  `; rm -rf ~` reaches the CLI as inert literal text). The `command` field also
  rejects shell metacharacters as hygiene.
- `config.json` is written `0600` (owner-only), since lane API keys live there
  in plaintext. Logs, `config.json`, and project-local Claude keys are all in
  `.gitignore` so they can't be committed.
- The audit log records **metadata only** — lane, model, status, timing, byte
  counts — never prompt or response bodies.
- Sign-ins happen inside the official CLIs; the gateway never sees your
  password. Every dynamic value in the GUI is HTML-escaped before rendering.

**What's *not* covered, by design or by nature of the problem:**

- **A local user with the admin token can set a lane's `command` to anything** —
  that's the feature (build your own lanes), so the token is the whole trust
  boundary. Treat it like a password to a root shell for this tool.
- **Third-party browser-session wrappers are outside these guarantees.** They
  hold a full-account cookie inside separately-maintained code. The guided
  steps now containerize both, bind them to loopback, keep cookies in
  owner-only env files, put a required API key on the Gemini helper, and
  recommend building from a reviewed clone instead of pulling `latest` — but
  none of that audits the code itself, and an update you pull is code you
  haven't read. Prefer a dedicated low-value account, treat `git pull` /
  re-pull as a re-review event, and know the sign-out kill switch. **Stopping
  a helper does not invalidate its cookie** — sessions live server-side; only
  "sign out of all sessions" revokes them.
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
| **MCP** | Model Context Protocol — how tools like VS Code Copilot connect to external tools (e.g. the Perplexity search tool in Recipe 6). |
| **SSE / streaming** | The technique that makes replies appear word-by-word instead of all at once. |
| **`localhost` / `127.0.0.1`** | Your own computer. Addresses starting with this are unreachable from outside. |
| **Audit log** | `logs/audit.jsonl` — one line per request: when, which lane, which model, how big, how long. |

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
templates/               agent-instruction templates + the Perplexity MCP config (Recipe 6)
test/regression.js       self-contained regression suite (npm test)
```
