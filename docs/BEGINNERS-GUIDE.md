# local-harness — Beginner's Guide

*A step-by-step guide that assumes nothing. If you can copy-paste into a
terminal, you can do this.*

---

## What is this thing?

Think of local-harness as a **power strip for AI models**. You plug your
models in on one side — a model running on your own PC, your Claude
subscription, your Gemini subscription — and you plug your coding tools in on
the other side — VS Code, Claude Code, OpenCode. Every tool can then use
every model, through one single address on your computer.

Why bother?

- **Privacy** — everything runs on `127.0.0.1` (your own machine). Nothing is
  reachable from your network, and no third-party proxy software ever holds
  your passwords or session tokens.
- **No API bills** — your flat-rate subscriptions (claude.ai Pro/Max, Gemini)
  are used through their official command-line apps, not through pay-per-token
  API keys.
- **One audit trail** — every request from every tool is stamped with your
  developer ID and recorded to a log file, so you always know what was asked
  and where it went.

Words you'll see (full list in the [glossary](#glossary) at the end):

- **The gateway** — the traffic cop. One small program (`gateway.js`).
- **A lane** — one route through the gateway, like `/claude` or `/local`.
  Each lane leads to one model source.
- **The dashboard** — the web page where you configure everything.

---

## What you need

1. **Node.js 18 or newer.** Check with `node --version` in a terminal.
   If you don't have it, install it from [nodejs.org](https://nodejs.org).
2. At least one model source:
   - a **Claude subscription** (claude.ai Pro or Max), and/or
   - a **Gemini subscription** / Google account, and/or
   - a **local model** via [Ollama](https://ollama.com) (free, runs on your PC).

That's it. There is nothing to `npm install` — the gateway has zero
dependencies on purpose.

---

## Step 1 — Start the gateway

There are two ways to run it. Pick whichever fits how you work:

**Option A — foreground.** Simplest to understand: open a terminal, go to
this folder, and run:

```bash
node gateway.js
```

You'll see something like:

```
  local-harness gateway
  Admin GUI : http://127.0.0.1:4000/admin
  [on ] /local    -> http://127.0.0.1:11434  (Local model (Ollama))
  [off] /copilot  -> http://127.0.0.1:4141   (GitHub Copilot subscription)
  [on ] /claude   -> cli:claude              (Claude subscription (Claude Code CLI))
  [off] /gemini   -> cli:gemini              (Gemini subscription (Gemini CLI))
```

**Leave this terminal window open** — the gateway runs as long as it's open.
Closing the window (or Ctrl+C) stops it; nothing breaks, start it again
anytime.

**Option B — background, with start/stop scripts.** No terminal window to
babysit:

```bash
./start.sh          # starts it in the background
./stop.sh           # stops it
./restart.sh        # stops then starts — use this whenever you edit
                     # gateway.js yourself, since Node doesn't notice
                     # source changes on its own
```

Want a different port than the one saved in the dashboard? Add it as an
argument, just for that run — it won't change your saved settings:

```bash
./start.sh 4500
```

`start.sh` won't let you start a second copy by accident, and it tells you
the exact Admin GUI URL once the gateway has actually confirmed it's
answering (not just "probably started"). Its logs go to `logs/gateway.log`
if you ever need to see what happened.

## Step 2 — Open the dashboard

The terminal output from Step 1 (or `./start.sh`) printed a line like:

> **Admin GUI: http://localhost:4000/admin?token=a1b2c3...**

Open that **exact link**, `?token=...` included — copy-paste the whole thing.
The token is a password for the dashboard: without it, anyone (or any
webpage) that tries to open the admin page or its API gets rejected. This is
what stops a malicious website you happen to have open in another tab from
silently reconfiguring your gateway. Once you've opened it correctly, the
page remembers the token for you — you only need the full link the first
time in a browser (or after clearing site data). Lost the link? It's always
in `logs/gateway.log`, or just run `./restart.sh` to print it again.

This page is your control room. Everything in the rest of this guide happens
either here or inside your coding tool.

The page has five sections, top to bottom:

| Section | What it's for |
|---|---|
| **Your AI subscriptions** | Guided 3-step setup for Claude and Gemini, plus a note that Copilot already works natively. Start here. |
| **Your local model** | A simple form — name + address — for a model running on your own machine (Ollama, LM Studio, vLLM). |
| **More options (advanced)** | The Gemini and Perplexity paths that reuse a browser login. Higher risk; step-by-step included. |
| **Advanced settings** (collapsed) | Everything technical, hidden until you expand it: an all-in-one config bundle, request logging, the gateway port, and a raw editor for power users. Most people never open this. |
| **Recent activity** | A table showing each request as it flows through. |

---

## Recipe 1 — Use your Claude subscription in VS Code

Find the **"Claude subscription (Claude Code CLI)"** card at the top of the
dashboard. It shows three numbered steps that check themselves off as you go:

**Step ① Install the official Claude CLI.**
If the step already shows a green ✓ ("Found: …"), skip ahead. Otherwise copy
the command shown and run it in a terminal:

```bash
npm install -g @anthropic-ai/claude-code --ignore-scripts
```

(The `--ignore-scripts` part is a safety habit: it stops any package from
running hidden code during installation.)

**Step ② Sign in to Claude.**
Click the **"Sign in to Claude here"** button. A terminal window opens running
`claude`. Type `/login` in it and finish the sign-in in your browser using
your claude.ai account. Within a few seconds the dashboard shows
**"Signed in as you@example.com"** with a green ✓.

> The dashboard never sees your password. The official Claude app holds your
> login; the gateway just checks whether you're signed in.

**Step ③ Use it in your tools.**
Flip the **enable lane** switch on (if it isn't already). Make sure the
**VS Code** tab is selected, then in VS Code:

1. Open **Copilot Chat** (the chat icon in the sidebar).
2. Click the **model picker** at the top of the chat panel (it shows the
   current model's name) and choose **"Manage Models…"** — some versions call
   it **"Other Models"**.
3. Pick **"Add a custom OpenAI-compatible model"** and copy these two values
   from the dashboard (each has a `copy` button):
   - **Base URL:** `http://localhost:4000/claude/v1`
   - **API key:** `dummy` (the gateway doesn't need a key; any text works)
4. VS Code will list the models — `sonnet`, `opus`, `haiku`. Tick the ones
   you want.

Done. Open the model picker in Copilot Chat and your Claude subscription
models are there, **next to** the models you already had. Nothing was
replaced — GPT-4o and friends still work exactly as before; you just have
more choices in the same dropdown.

## Recipe 2 — Use your Gemini subscription in VS Code

Same three steps, on the **"Gemini subscription (Gemini CLI)"** card:

1. Install: `npm install -g @google/gemini-cli --ignore-scripts`
2. Click **"Sign in to Gemini here"** — a terminal opens running `gemini`,
   which sends you to your browser to sign in. **Use the Google account that
   holds your subscription** — if that account has Google AI Pro or Ultra,
   the CLI uses that paid quota automatically; otherwise it falls back to the
   free Gemini Code Assist tier. The card flips to "Signed in".
3. Enable the lane, then add a custom model in VS Code exactly as in Recipe 1
   but with **Base URL** `http://localhost:4000/gemini/v1`. You'll get
   `gemini-2.5-pro` and `gemini-2.5-flash` (edit the model list on the card if
   your CLI offers different ones).

> Google is currently replacing this CLI with a new one called `antigravity`.
> If step ① stops finding `gemini`, install/try `antigravity` instead and put
> that word in the lane's **CLI command** field — everything else stays the
> same.
>
> This recipe uses the *Gemini CLI's* access to your subscription — it is not
> literally the gemini.google.com website. If you specifically need the web
> app itself, that's a separate, more advanced, higher-risk path: see
> ["Advanced: the literal browser subscription"](#advanced-the-literal-browser-subscription)
> near the end of this guide.

## Recipe 3 — A free local model (no subscription at all)

1. Install [Ollama](https://ollama.com), then in a terminal:
   ```bash
   ollama pull llama3.1     # downloads a model (one time)
   ollama serve             # starts the model server
   ```
2. On the dashboard, the **Local model** lane's dot turns green.
3. Add it to VS Code like the recipes above, with **Base URL**
   `http://localhost:4000/local/v1`.

Everything stays on your machine — this lane never touches the internet.

## Recipe 4 — Claude Code (Anthropic API, local model as backend)

The gateway translates Anthropic's Messages API to OpenAI Chat Completions,
so you can point **Claude Code** (the `claude` CLI coding assistant) directly
at any **local model / raw connection** (a "proxy" lane, in the Advanced
section's terms). Claude Code then uses that model as its actual chat
backend — not as a side-tool, but as the model that answers every message.
This doesn't apply to the built-in `claude`/`gemini` subscription cards —
those only speak OpenAI's chat format, and there'd be no reason to route
Claude Code through a lane that itself launches the real `claude` CLI. (Claude
Desktop can't do this at all — it hardcodes its connection to Anthropic's
own servers with no way to swap the model; Claude Code is fully headless,
so its model is simply whatever `ANTHROPIC_BASE_URL` points at.)

1. Install Claude Code if you haven't already:
   ```bash
   npm install -g @anthropic-ai/claude-code --ignore-scripts
   ```
2. Create `~/.claude/settings.json` (or add to it if it already exists):
   ```json
   {
     "env": {
       "ANTHROPIC_BASE_URL": "http://localhost:4000/local",
       "ANTHROPIC_API_KEY": "local-key"
     }
   }
   ```
   Replace `/local` with the prefix of the lane you want to use. The API key
   value is ignored by the gateway — any non-empty string works.
3. Run `claude` — it will send requests to the gateway, which translates
   them to OpenAI format and forwards to your local model.

You can also set the variables per-session without editing settings:
```bash
ANTHROPIC_BASE_URL=http://localhost:4000/local ANTHROPIC_API_KEY=local-key claude
```

The gateway detects Anthropic format by the `/v1/messages` path or the
`anthropic-version` header and handles the translation transparently,
including streaming.

## Recipe 5 — OpenCode (terminal)

Click the **OpenCode** tab on a card, copy the block into a file called
`opencode.json` in your project folder, run `opencode`, then type `/models`
and pick the lane. It appears as an extra provider next to your existing ones.

## Recipe 6 — Perplexity as a search tool in VS Code (not through the dashboard)

Perplexity is different from everything above: it doesn't have an official
CLI or subscription-backed login like Claude/Gemini, and it's a **search
tool**, not a chat model — so instead of a lane in this dashboard, it becomes
a tool Copilot can call on its own in VS Code's **Agent mode**.

1. Get the search server running:
   ```bash
   git clone https://github.com/helallao/perplexity-ai.git
   cd perplexity-ai
   pip install -e ".[mcp]"
   ```
2. Copy [`templates/vscode-mcp-perplexity.json`](../templates/vscode-mcp-perplexity.json)
   from this repo into `.vscode/mcp.json` in whatever project you want it in.
3. Open Copilot Chat in Agent mode. VS Code notices the new tool and pops up
   a masked input box asking for your Perplexity cookie the first time it's
   used — type it as `{"next-auth.session-token": "..."}` (get the value
   from perplexity.ai in your browser: DevTools → Application → Cookies).
   VS Code stores it itself; it's never written into the config file.
4. From then on, ask Copilot something that needs current web info and
   watch it reach for the search tool on its own.

No cookie yet, or don't want to give one? It still works in a free,
anonymous mode — a safe way to try it before deciding.

**Two things worth knowing before you do this:**
- This is a full-account browser cookie, same risk class as the Gemini
  browser-session route from Recipe 2's advanced section — not a scoped API
  key. Prefer a dedicated, low-value Perplexity account if you can.
- This **doesn't go through the gateway at all** — MCP servers are set up
  per-editor, not per-lane, so none of this shows up in `logs/audit.jsonl`.

---

## Advanced: the literal browser subscription

*Skip this section unless you specifically need the actual gemini.google.com
or claude.ai website behavior, rather than what the official CLI gives you.*

Recipes 1 and 2 use the *official* `claude`/`gemini` command-line apps — this
is a sanctioned, OAuth-based way in, and it genuinely uses your paid quota.
What it does **not** give you is the literal web app itself. There's no
official way to script that; the only path in is unofficial community
projects that copy your live browser session cookies and replay them against
Google's/Anthropic's internal web endpoints. This is deliberately **not**
built into the gateway — copying live session cookies into the trusted
routing layer is exactly the kind of risky third-party code this project
exists to avoid.

If you still want it, the gateway leaves the door open without doing it for
you. For Gemini specifically, here's a concrete, tested path:

1. Scroll to **Lanes (advanced)** and click **"+ Add 'Gemini Pro via your
   browser session' lane."** This adds a disabled lane, already pointed at
   `http://127.0.0.1:8000` with setup steps in its notes — otherwise it's
   identical to any other lane on the dashboard. The gateway treats it as a
   normal backend; it just happens to be a community wrapper instead of an
   official CLI.
2. Get the wrapper running: [Nativu5/Gemini-FastAPI](https://github.com/Nativu5/Gemini-FastAPI)
   (674★ at the time of writing — check it's still maintained). Easiest path
   if you have Docker:
   ```bash
   docker run -p 8000:8000 \
     -e CONFIG_GEMINI__CLIENTS__0__SECURE_1PSID="your-value" \
     -e CONFIG_GEMINI__CLIENTS__0__SECURE_1PSIDTS="your-value" \
     ghcr.io/nativu5/gemini-fastapi
   ```
3. Open gemini.google.com in your browser, DevTools → Application →
   Cookies, and copy the `__Secure-1PSID` and `__Secure-1PSIDTS` values into
   the `docker run` command above (or the wrapper's `config/config.yaml` if
   you're not using Docker). **These go straight into the wrapper — never
   into this gateway or anywhere in local-harness.**
4. Back in the dashboard, the lane's dot turns green once the wrapper
   answers on port 8000. Enable it and you're done — same as any other lane.

Cookies expire periodically and need re-copying from DevTools when the lane
starts erroring again.

Trade-offs versus Recipes 1/2: cookies expire and need periodic
re-extraction, the unofficial endpoints can change without notice, and
impersonating a live web session is a clearer Terms-of-Service risk than an
OAuth-scoped CLI login.

---

## How do I know it's working?

Three ways, easiest first:

1. **Live traffic table** (bottom of the dashboard). Send a chat message from
   any tool and a row appears within seconds: which lane, which model, how
   long it took.
2. **curl test** — click the **curl test** tab on any card, copy, paste into a
   terminal. You should get a JSON answer back.
3. **The audit file** — `logs/audit.jsonl` in this folder keeps one line per
   request, forever. Open it in any text editor.

## Running the regression tests

To verify the whole system after any change (or just for peace of mind):

```bash
npm test
```

This starts a private test copy of the gateway on port 4999 with fake
backends and fake CLIs (it never touches your real config, your logins, or
your subscription quota) and checks ~40 behaviors: routing, header injection,
streaming, the CLI wrappers, health checks, the audit log, and the Claude
Desktop bridge. Expect `41 passed, 0 failed` in a few seconds.

---

## Troubleshooting

| Symptom | Cause & fix |
|---|---|
| Dashboard won't load | The gateway isn't running. Run `node gateway.js`, or `./start.sh`, in this folder. |
| Dashboard says "Missing or invalid admin token" | You opened `/admin` without the `?token=...` part, or with the wrong one. Find the correct full link in `logs/gateway.log` or by running `./restart.sh`. |
| You (or someone helping you) edited `gateway.js` and nothing changed | Node doesn't reload source files on its own. Run `./restart.sh` (or Ctrl+C and re-run `node gateway.js`). |
| `port 4000 is already in use` | Something else owns the port. Change **Gateway port** in the Audit section (then restart), or stop the other program. |
| Red dot on the Local model lane | Ollama/vLLM isn't running. Run `ollama serve`, or fix the lane's target URL if you use vLLM (`http://127.0.0.1:8000`). |
| Card says "CLI not found" | Step ① wasn't done, or the terminal you installed from uses a different Node. Run the install command again, then reload the dashboard. |
| Gemini card says "CLI not found" even though you just installed it | Google is rolling out a replacement CLI called `antigravity`. Try `npm install -g @google/antigravity-cli` (or whatever it's currently named) and set the lane's **CLI command** field (in Lanes → advanced) to `antigravity`. |
| Gemini seems to be using a free tier, not your paid Pro/Ultra subscription | Sign in (step ②) with the Google account your Pro/Ultra subscription is actually attached to — the CLI uses whichever tier that account has. |
| Gemini lane fails with `FatalCancellationError`, "Not logged in", or an `onboardUser` error, even right after signing in | This is a Google-side problem, not a gateway bug — `gemini`'s Code Assist login has a step beyond basic sign-in that can fail for accounts without Code Assist access (common on Workspace/company Google accounts). **Test outside the gateway first:** run `gemini -p "say hi"` yourself in a terminal. If it fails the same way there, Code Assist isn't working for that account — use the "Gemini Pro via your browser session" lane instead (see the [Beginner's Guide advanced section](#advanced-the-literal-browser-subscription)), which drives the real gemini.google.com web app and doesn't need Code Assist at all. |
| Card says "Not signed in yet" | Do step ② — click the sign-in button and finish the flow in the terminal + browser. |
| "Sign in" button opened nothing | Open any terminal yourself and run `claude` (then `/login`) or `gemini`. The dashboard will notice once you're signed in. |
| VS Code shows no models after adding the URL | Make sure the lane is **enabled** (step ③ switch) and the URL ends in `/v1`. Test with the curl tab. |
| Reply arrives all at once instead of word-by-word | Normal for subscription lanes: the CLI produces the full answer first, then the gateway streams it to the tool. Local (proxy) lanes stream token-by-token. |
| A lane answers with `502` and a login hint | The CLI's session expired. Redo step ② for that card. |
| Slow first answer on subscription lanes | Each request starts the CLI fresh; a few extra seconds is normal. |

## Is this safe / allowed?

- **Safe:** yes, by design. The gateway listens only on your own machine, has
  zero third-party dependencies, and sign-ins happen exclusively inside the
  providers' official apps.
- **Allowed:** the honest answer — using consumer subscriptions inside
  third-party tools generally goes against Anthropic's and Google's Terms of
  Service, even via their official CLIs, and could in theory get an account
  suspended. The local model lane has no such issue. Decide with open eyes.

## Glossary

| Term | Meaning |
|---|---|
| **Gateway** | The small program (`gateway.js`) that receives all requests and forwards them to the right place. |
| **Lane** | One named route through the gateway (`/claude`, `/local`, …), leading to one model source. |
| **Endpoint / Base URL** | The web address a tool sends requests to, e.g. `http://localhost:4000/claude/v1`. |
| **OpenAI-compatible** | The de-facto standard request format most AI tools speak. The gateway translates everything into/out of it. |
| **CLI** | Command-line interface — a program you run in a terminal, like `claude` or `gemini`. |
| **Wrapper** | Something that makes one interface look like another. The gateway's built-in wrappers make the Claude/Gemini CLIs look like OpenAI-compatible servers. |
| **MCP** | Model Context Protocol — how tools like VS Code Copilot connect to external tools, e.g. the Perplexity search tool in Recipe 6. |
| **SSE / streaming** | The technique that makes replies appear word-by-word instead of all at once. |
| **`localhost` / `127.0.0.1`** | Your own computer. Addresses starting with this are unreachable from outside. |
| **Audit log** | `logs/audit.jsonl` — one line per request: when, which lane, which model, how big, how long. |
