# local-harness

Think of local-harness as a **power strip for AI models**. You plug models in
on one side — a model running on your own PC, your Claude subscription, your
Gemini subscription — and plug your coding tools in on the other — VS Code /
Copilot Chat, OpenCode. Every tool can then use every model, through one
single address on your machine.

**Why?**

- **Privacy** — everything runs on `127.0.0.1`. Nothing is reachable from
  your network; no third-party proxy holds your passwords or session tokens.
- **No API bills** — flat-rate subscriptions (claude.ai Pro/Max, Gemini
  Pro/Ultra) go through their official CLIs, not pay-per-token API keys.
- **One audit trail** — every request from every tool is stamped with your
  developer ID and recorded to `logs/audit.jsonl`, so you always know what
  was asked and where it went.

**Zero dependencies** — no `npm install` needed. The gateway uses only Node's
built-in `http` module, so the supply-chain attack surface is zero. Streaming
(SSE) passes through untouched, so live token-by-token chat works in every
client.

---

## What you need

1. **Node.js 18 or newer** — check with `node --version`. Install from
   [nodejs.org](https://nodejs.org) if needed.
2. At least one model source:
   - a **Claude subscription** (claude.ai Pro or Max), and/or
   - a **Gemini subscription** / Google account, and/or
   - a **local model** via [Ollama](https://ollama.com) (free, runs on your PC)

That's it. There is nothing to `npm install`.

---

## Quick start

**Option A — foreground** (simplest; you see logs live; Ctrl+C to stop):

```bash
node gateway.js
```

**Option B — background** (recommended for daily use — survives closing the
terminal):

```bash
./start.sh              # start in the background, port from config.json
./start.sh 4500         # custom port for this run only (won't change your saved settings)
./stop.sh               # stop it
./restart.sh            # stop + start — use this after editing gateway.js,
                        # since Node doesn't hot-reload
```

`./start.sh` refuses to start a second instance, confirms the gateway is
actually answering before printing success, and never touches `config.json`.
Logs go to `logs/gateway.log`; the PID lives in `.gateway.pid`. Equivalent
npm scripts: `npm run start:bg`, `npm run stop`, `npm run restart` (custom
port: `npm run start:bg -- 4500`).

You'll see something like:

```
  local-harness gateway
  Admin GUI : http://127.0.0.1:4000/admin?token=a1b2c3...
  [on ] /local    -> http://127.0.0.1:11434  (Local model (Ollama))
  [off] /claude   -> cli:claude              (Claude subscription)
  [off] /gemini   -> cli:gemini              (Gemini subscription)
```

Then open the URL printed in the startup banner — **it includes an admin
token as `?token=...`, required to load the page or call its API** (this is
what stops any other local process, or a malicious webpage in another
browser tab, from reading or rewriting your config). Copy the full link, not
just `http://localhost:4000/admin`. Lost it? It's always in
`logs/gateway.log`, or run `./restart.sh` to print it again. The GUI is
where you configure everything:

- **Your AI subscriptions** — sign in to Claude/Gemini, live status, exactly
  how to use each in VS Code / Claude Code / OpenCode
- **Your local model** — name + address, and the same per-tool instructions
- **More options (advanced)** — the browser-login paths for Gemini/Perplexity
- **Advanced settings** — raw per-route config, request logging, the gateway
  port, and an all-in-one config bundle covering everything enabled at once
- **Recent activity** — watch requests flow through in real time

`config.json` is created on first run with sensible defaults. Edit the port
permanently in the GUI's Audit section (applied live) or by hand (restart
the gateway) — `PORT`/`HOST` env vars (what `start.sh` uses under the hood)
only override it for that one run.

## Default lanes

| Lane | Gateway URL | Backend |
|---|---|---|
| `local` | `http://localhost:4000/local/v1` | Ollama on `:11434` (edit for vLLM `:8000`) |
| `copilot` | `http://localhost:4000/copilot/v1` | Copilot subscription wrapper on `:4141` |
| `claude` | `http://localhost:4000/claude/v1` | **Built-in wrapper** driving the official `claude` CLI |
| `gemini` | `http://localhost:4000/gemini/v1` | **Built-in wrapper** driving the official `gemini` CLI |

Bare `http://localhost:4000/v1/...` falls through to the **default lane**
(`local`), so simple clients that can't take a path prefix still work.

Only `local` is enabled out of the box. Enable the others in the GUI once
their wrapper is running.

## Starting the backends

**Local model** (pick one):

```bash
ollama serve                                   # port 11434
# or
vllm serve <model> --port 8000                 # then set the lane target to :8000
```

**Claude / Gemini subscriptions (built-in wrappers)** — the gateway spawns
the *official* `claude` / `gemini` CLI per request; no third-party proxy ever
touches your session token. Don't do this by hand — open
**http://localhost:4000/admin** and use the **"Get started with a
subscription"** section at the top. It walks through 3 steps per provider:

1. **Install** — shows the exact `npm install -g ...` command, with a live
   checkmark once the CLI is found on your PATH.
2. **Sign in** — click **"Sign in to Claude/Gemini here"** and the gateway
   opens a real terminal window running the CLI's own login flow (browser
   OAuth). The gateway never sees your password; it just detects the signed-in
   account afterward (`~/.claude.json` / `~/.gemini/oauth_creds.json`) and
   shows "Signed in as you@example.com".
3. **Use it in your tools** — flips the lane on and shows tool-specific
   instructions (VS Code's "Manage Models" custom-endpoint fields, Claude
   Desktop's MCP config, OpenCode's provider block, or a `curl` test), all
   pre-filled with that lane's real URL. **This only adds the subscription as
   an extra model — every tool's native models keep working unchanged.**

Once logged in, the lane exposes `http://localhost:4000/claude/v1` (models
`sonnet`/`opus`/`haiku`) or `http://localhost:4000/gemini/v1`
(`gemini-2.5-pro`/`gemini-2.5-flash`) — edit the model list in the GUI to
match what your CLI version offers).

**Important nuance for Gemini:** signing in to the `gemini` CLI with the
Google account tied to your **Google AI Pro/Ultra** subscription uses that
paid quota — it's your real subscription, not a separate free tier. Google is
also mid-rollout on a replacement CLI called `antigravity`; if `gemini` stops
resolving, just change the lane's **CLI command** field to `antigravity` (no
code change needed — it's a plain text field). What the `gemini`/`claude`
CLIs do *not* give you is the literal `gemini.google.com`/`claude.ai` **web
app** as a product surface — see "Using the literal browser subscription"

**Known limitation — Gemini CLI's login can fail specifically when spawned
headlessly, separate from whether you've signed in.** `gemini`'s "Login with
Google" flow has an internal step (Code Assist "onboarding", tied to Google's
`onboardUser` endpoint) that's distinct from basic OAuth and can fail with
errors like `FatalCancellationError: Authentication cancelled by user`, an
`onboardUser` 429/403, or a bare "Not logged in" — even right after you've
completed the sign-in step in the GUI. This gateway invokes `gemini -p
"<prompt>"`, the CLI's own documented headless pattern, so the invocation
itself isn't the problem; what these errors mean is that whatever Google is
being asked to do on that account (verify the token, or provision Code
Assist) isn't completing — commonly because you're signed into a different
Google account than the one holding the subscription, or because the account
is a Workspace-managed one that Google restricts from personal Code Assist
regardless of a paid consumer subscription. **Diagnose it outside the gateway
first:** run `gemini -p "say hi"` directly in your own terminal. If it also
fails or re-prompts for a browser sign-in there, the gateway isn't the
problem — this is between you and Google's account/product policy. If Code
Assist genuinely isn't available for your account, skip the `gemini-cli` lane
and use "Using the literal browser subscription" below instead — it drives
the actual gemini.google.com web app, which sidesteps Code Assist entirely.
below if you specifically need that.

How the built-in wrappers behave: chat history is flattened into a single
prompt per request (the CLIs are single-shot), system messages are passed
through, responses are returned complete and then framed as OpenAI SSE when
the client asked for streaming, and each CLI runs with its working directory
set to the OS temp dir so an agentic CLI never sees your project files.
Closing the chat kills the CLI process so no quota is wasted.

**Copilot as a backend** (optional) — GitHub ships no CLI equivalent, so this
lane still needs a community wrapper (e.g. a `copilot-api` project) running on
`:4141`. Vet it before trusting it with your GitHub token.

### Using the literal browser subscription (advanced, higher risk)

The CLI-backed lanes above use the *official* Claude Code / Gemini CLI —
OAuth-scoped, sanctioned integration paths. If you specifically want the
**gemini.google.com web app itself** (e.g. because your account only has web
access, or you want the exact web-app behavior), that's a different, unofficial
integration: reverse-engineered clients that replay your live browser session
cookies (`__Secure-1PSID`) against Google's undocumented internal endpoints.

This is deliberately **not built into the gateway** — copying live session
cookies into the trusted routing layer is exactly the kind of heavy,
security-sensitive third-party dependency this project exists to avoid.
Instead, point a plain `proxy` lane at a separately-run wrapper:

1. **Get a wrapper.** [Nativu5/Gemini-FastAPI](https://github.com/Nativu5/Gemini-FastAPI)
   (674★, MIT, at the time this was written — re-check it's still maintained
   before trusting it with your session) exposes a genuine
   `POST /v1/chat/completions` + `GET /v1/models` + `GET /health` server on
   port 8000 by default. Clone it and either:
   ```bash
   docker run -p 8000:8000 \
     -e CONFIG_GEMINI__CLIENTS__0__SECURE_1PSID="your-value" \
     -e CONFIG_GEMINI__CLIENTS__0__SECURE_1PSIDTS="your-value" \
     ghcr.io/nativu5/gemini-fastapi
   ```
   ...or `uv sync && uv run python run.py` after filling in `config/config.yaml`.
2. **Get the cookies it needs.** Open gemini.google.com in your browser,
   DevTools → Application/Storage → Cookies, copy the `__Secure-1PSID` and
   `__Secure-1PSIDTS` values. **Put them straight into the wrapper's own
   config/env — never into this gateway or anywhere in local-harness.**
3. **Wire it up in the GUI.** Click **"+ Add 'Gemini Pro via your browser
   session' lane"** (under Lanes → advanced) — it inserts a disabled `proxy`
   lane already pointed at `http://127.0.0.1:8000` with these steps in its
   notes. Enable it once the lane's health dot goes green (it checks
   `/health`).

Cookies expire periodically and need re-extracting from your browser's
DevTools. This route is more fragile and a clearer Terms-of-Service risk than
the CLI route, since it impersonates your live web session rather than using
a scoped CLI login.

> ⚠️ **Fair warning:** routing a consumer subscription into third-party tools
> generally violates the provider's Terms of Service (GitHub, Anthropic, and
> Google all prohibit it) and can get the account suspended — even when the
> traffic goes through the official CLI. The `local` lane has no such issue.

## Path 1 — VS Code (Copilot Chat)

Open the GUI → **Connect your tools → VS Code** and copy the generated
settings. Depending on your VS Code/Copilot version, either merge the JSON
into your user `settings.json`, or use Copilot Chat's model picker →
**Manage models** → *OpenAI compatible* and paste the lane URL.

To keep local models disciplined about tool calls, add
`.github/agents/local-worker.agent.md` to your repo (template in
[templates/local-worker.agent.md](templates/local-worker.agent.md)).

## Path 2 — Claude Code

The gateway now speaks **Anthropic's Messages API** natively on every proxy
lane. Any client that uses the Anthropic SDK — including the `claude` CLI
coding assistant — can point straight at a lane and use local models as its
actual chat backend. Unlike Claude Desktop (which hardcodes its connection
to Anthropic's servers with no way to swap the model), Claude Code is fully
headless and its model is whatever you point `ANTHROPIC_BASE_URL` at — a
much better fit for routing to local inference.

Add to `~/.claude/settings.json` (create the file if it doesn't exist):

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:4000/local",
    "ANTHROPIC_API_KEY": "local-key"
  }
}
```

Replace `/local` with the prefix of whichever **proxy lane** you want to use
— your own local model, or a "browser session" lane like `gemini-web`. This
only works for proxy lanes (plain HTTP backends); it does **not** work for
the built-in `claude`/`gemini` CLI lanes, which only speak OpenAI's
`/v1/chat/completions` and have no reason to support Anthropic's format —
routing Claude Code through a lane that itself spawns the real `claude` CLI
would be circular. The `ANTHROPIC_API_KEY` value is ignored by the gateway
but required by the SDK — any non-empty string works.

Or set the variables in your shell profile instead:

```bash
export ANTHROPIC_BASE_URL=http://localhost:4000/local
export ANTHROPIC_API_KEY=local-key
```

How it works: the gateway detects any `POST /v1/messages` request (or the
presence of an `anthropic-version` header), translates the Anthropic-format
body to OpenAI Chat Completions, forwards it to the lane's upstream, then
translates the response back — including streaming SSE. The upstream never
sees Anthropic-format traffic.

## Path 3 — OpenCode (terminal)

Open the GUI → **Connect your tools → OpenCode** and save the generated
provider config as `opencode.json` in your project (or
`~/.config/opencode/opencode.json`). Every enabled lane appears as a
provider; pick one with `/models`. Use `AGENTS.md` to assign lanes to agents
(local "worker" vs. subscription "architect").

## Path 4 — Perplexity search tool (VS Code MCP, no gateway)

Perplexity doesn't fit the pattern above: there's no official CLI or
OAuth-backed subscription tier the way `claude`/`gemini` have (their official
MCP server is billed through the separate Sonar API — the API-key category
this whole project exists to avoid), and it's fundamentally a **search
tool**, not a chat model, so it doesn't belong in a model picker. The natural
integration point is VS Code Copilot's native MCP support in **Agent mode**
(since v1.99) — Copilot calls it mid-task when it needs current web info,
rather than you picking it as "the model."

This bypasses local-harness entirely: MCP servers are configured per-editor
in `.vscode/mcp.json`, not through the gateway, so **this traffic never
appears in `logs/audit.jsonl`**. It also carries a meaningfully different
risk than the CLI-backed lanes: auth is `PERPLEXITY_COOKIES`, specifically
your `next-auth.session-token` cookie — a full-account, likely
2FA-bypassing credential, same risk class as the Gemini browser-session
wrapper. Every caution from that conversation applies: prefer a dedicated
low-value account, and know that signing out of all sessions on
perplexity.ai is your kill switch.

1. Install [helallao/perplexity-ai](https://github.com/helallao/perplexity-ai)
   (1.7k★ — re-check it's still maintained):
   ```bash
   git clone https://github.com/helallao/perplexity-ai.git
   cd perplexity-ai
   pip install -e ".[mcp]"
   ```
2. Copy [templates/vscode-mcp-perplexity.json](templates/vscode-mcp-perplexity.json)
   to `.vscode/mcp.json` in whichever project you want this in (or your VS
   Code user-profile MCP config, to make it available everywhere).
3. In VS Code, open Copilot Chat's Agent mode — it will detect the new MCP
   server and prompt you once for the cookie value via a masked input box
   (VS Code's `inputs` mechanism: the value is stored by VS Code itself, not
   written into `mcp.json` in plaintext). Get the cookie from perplexity.ai
   in your browser: DevTools → Application → Cookies → copy
   `next-auth.session-token`, and enter it as
   `{"next-auth.session-token": "<value>"}` when prompted.
4. Agent mode now has a Perplexity search tool it can call on its own when a
   task needs current web results.

Without any cookie configured, the same server still works in a **free,
anonymous, auto-mode-only** capacity — a reasonable way to try the
integration shape before deciding whether the subscription-cookie trade-off
is worth it.

## Smoke test

```bash
curl -s http://localhost:4000/local/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"llama3.1","messages":[{"role":"user","content":"hi"}],"stream":false}'
```

The request appears in the GUI's **Live traffic** table and in
`logs/audit.jsonl` with your audit headers attached.

## Testing

```bash
npm test
```

Runs the regression suite ([test/regression.js](test/regression.js), also
zero-dependency): it boots an isolated gateway on port 4999 with a mock HTTP
backend and fake `claude`/`gemini` CLIs — your real config, logins, and
subscription quota are never touched — and verifies dozens of behaviors
across routing, audit-header injection, SSE streaming, the built-in CLI
wrappers, config validation/hot-reload, health checks, and the Anthropic
Messages API translation (including tool-calling, both directions,
streaming and non-streaming). macOS/Linux only (the fake CLIs are POSIX
scripts).

## Security

This is a localhost-only, single-user tool. The realistic threats are a
malicious website open in your browser while the gateway runs, other local
users/processes on the same machine, and the third-party CLIs/wrappers you
point lanes at — not the network.

This project has been through an automated security scan (SAST + an
LLM-based deep review) and every finding was individually re-verified against
the actual code/runtime behavior rather than taken at face value — automated
scanners, especially small self-hosted LLMs pattern-matching source code,
routinely flag things that don't hold up under an actual dataflow trace.
Both the confirmed issues and the false positives are recorded below with
the evidence, so this doesn't need re-litigating on the next scan.

**What's covered:**
- Binds to `127.0.0.1` only; the admin API refuses to rebind off localhost,
  and a startup warning fires if you ever override that.
- Zero npm dependencies in `gateway.js` — nothing to audit in a transitive
  dependency tree for the code that actually runs your traffic.
- **The entire admin surface (`/admin` page + `/admin/api/*`) requires a
  random per-install token**, generated on first run and required via
  `X-Admin-Token` header or `?token=` query param — checked with a
  constant-time comparison. Without this, anyone/anything that can reach
  `localhost:<port>` — another local user, a compromised dependency in an
  unrelated project, a malicious webpage — could read or rewrite your config,
  including a CLI lane's `command` field (arbitrary code execution the next
  time that lane runs). The token is printed in the startup banner and
  `logs/gateway.log`; `/healthz` stays unauthenticated on purpose as a
  liveness probe. **This does not affect actual chat traffic** — lane routes
  (`/local/v1/...`, `/claude/v1/...`, etc.) need no token, only configuration
  does.
- The admin API additionally requires same-origin requests on top of the
  token: any non-`GET` call is rejected unless its `Origin` header matches
  the gateway's own host, and `POST /admin/api/config` requires
  `Content-Type: application/json` (closing the "CORS-safelisted content
  type" bypass that lets a cross-site page skip the browser's preflight
  check). The admin token can't be rotated through the config-write endpoint
  itself, so a caller who already has one valid token can't lock out the
  real user by swapping it.
- CLI lanes `spawn()` with an argv array, never a shell, so prompts can't be
  interpreted as shell syntax — verified directly: a prompt containing
  `; rm -rf ~` and friends reaches the CLI as inert literal text (see
  `test/regression.js`, "shell metacharacters... reach the CLI as literal,
  unmangled text"). The `command` field is additionally validated to reject
  shell metacharacters as hygiene, in case a future refactor ever introduces
  a shell.
- `config.json` is written `0600` (owner read/write only), since lane API
  keys are stored there in plaintext.
- The audit log (`logs/audit.jsonl`) records metadata only — lane, model,
  status, timing, byte counts — never prompt or response bodies.
- Logging in happens inside the official `claude`/`gemini` CLIs; the gateway
  never sees your password.
- Every dynamic value interpolated into the GUI's HTML (lane names, notes,
  ids, live-traffic log entries) is HTML-escaped via a single `esc()` helper
  before reaching `innerHTML`.

**What's *not* covered, by design or by nature of the problem:**
- **A local user who already has the admin token can still set a CLI lane's
  `command` to anything** — that's the feature (build your own lanes), not a
  bug, but it means the token is the whole trust boundary. Treat it like a
  password to a root shell for this tool.
- **Third-party subscription wrappers are outside this project's guarantees.**
  The "browser session" lanes (e.g. Gemini-FastAPI) hold a live Google
  session cookie — a full-account, typically 2FA-bypassing credential, not a
  scoped token — inside separately-maintained code with its own dependency
  tree. If you use one, prefer a dedicated low-value account over your
  primary one, pin the image/commit you run, and know that Google Account →
  Security → "sign out of all sessions" is your kill switch.
- **No TLS.** Fine on loopback; do not rebind `host` in `config.json` to
  `0.0.0.0` — the startup warning exists because the admin token is the only
  thing standing between that and an open door, over plaintext, on whatever
  network you're on.
- **Consumer subscriptions used through third-party tools generally violate
  the provider's Terms of Service**, even via official CLIs, and can get an
  account flagged or suspended — a policy risk, not a code one.

**Automated-scan findings that did not hold up, with evidence:**
- *"Critical: Command Injection... user-provided prompts can be escalated
  into arbitrary code execution"* — false. `spawn()` is called without
  `shell: true` anywhere in this codebase, so there is no shell for
  metacharacters to be interpreted by; `args` reach the OS as a literal argv
  array. Reproduced directly: a prompt containing shell metacharacters and a
  destructive command arrives at the CLI as inert text and creates no file,
  runs no command (see the regression test referenced above).
- *"High: XSS via `innerHTML` in `script.js:120`"* — `script.js` doesn't
  exist in this project (likely an artifact of the scanner extracting inline
  `<script>` content from `admin.html` and mislabeling it). The actual
  concern — untrusted values reaching `innerHTML` unescaped — was checked
  across every `innerHTML` assignment in `admin.html`: all dynamic/config-
  derived values are passed through `esc()` first.

## Files

```
gateway.js               the proxy + admin API + Anthropic translation (zero deps)
public/admin.html        the GUI
start.sh / stop.sh        background start/stop, supports a custom port
restart.sh               stop.sh + start.sh, for picking up source edits
config.json              created on first run; edited by the GUI
logs/gateway.log         stdout/stderr from start.sh's background run
logs/audit.jsonl         append-only audit trail
.gateway.pid             written by start.sh, removed by stop.sh
templates/               agent-instruction templates for VS Code / OpenCode,
                         plus the Perplexity MCP config for VS Code (Path 4)
test/regression.js       self-contained regression suite (npm test)
docs/BEGINNERS-GUIDE.md  step-by-step guide for newcomers
```
