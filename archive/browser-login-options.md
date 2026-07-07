# Browser-login options (archived)

Two integrations that reuse a **browser session cookie** instead of an
official CLI or API key. Both were previously guided cards in the dashboard's
"More options" section and recipes in the main README; they're parked here
because they carry meaningfully more risk than everything else in this
project (a full-account credential handed to unofficial, separately-maintained
code) and most people don't need them.

If you revive these, prefer a **dedicated low-value account** for whichever
service you're wrapping, and know your kill switch is that service's
"sign out of all sessions" setting — **stopping the container does not
invalidate the cookie**, sessions live server-side.

---

## Perplexity — search tool for VS Code

Perplexity is both an AI chat interface and a real-time web search engine. It
has no official CLI or subscription-backed login, so it integrates as a tool
Copilot can call autonomously in VS Code's **Agent mode**, reaching for
current web information mid-task. This bypasses the gateway entirely — MCP
servers are per-editor, so this traffic won't appear in `logs/audit.jsonl`.

1. Get the search server and build it into a container. It's unofficial
   community code that will hold a full-account cookie, so skim what you
   cloned before building — and re-skim the diff whenever you `git pull` and
   rebuild (that's the only way updates reach you, which is the point):
   ```bash
   git clone https://github.com/helallao/perplexity-ai.git && cd perplexity-ai
   printf 'FROM python:3.12-slim\nWORKDIR /app\nCOPY . .\nRUN pip install --no-cache-dir ".[mcp]"\nENTRYPOINT ["perplexity-mcp"]\n' > Dockerfile
   docker build -t perplexity-mcp:local .
   ```
   (No Docker? `pip install -e ".[mcp]"` in that folder works too, but then the
   code runs directly as you, outside any container.)
2. Copy [`vscode-mcp-perplexity.json`](vscode-mcp-perplexity.json) into
   `.vscode/mcp.json` in whatever project you want it in. It runs the
   container with `--rm -i` (exists only while VS Code uses the tool, deleted
   after) and passes the cookie as `-e PERPLEXITY_COOKIES` *without a value* —
   forwarded from the environment, so it never appears on a command line.
3. Open Copilot Chat in **Agent mode**. On first use it prompts (in a masked
   box that VS Code keeps in your OS keychain — never written to the file) for
   your Perplexity cookie: from perplexity.ai → DevTools → Application →
   Cookies, enter `{"next-auth.session-token": "<value>"}`.
4. Now ask Copilot something that needs current web info and it reaches for
   the search tool on its own.

No cookie yet? It still works in a free, anonymous mode — a safe way to try it
before trusting it with a login.

> ⚠️ That cookie is a **full-account, likely 2FA-bypassing** credential, not a
> scoped key.
>
> ⚠️ In Agent mode Copilot invokes this tool **autonomously**: text it reads (a
> file in your repo, a fetched webpage) can steer it into sending fragments of
> your code to Perplexity — and since this path bypasses the gateway, there's
> no line in `logs/audit.jsonl` to tell you it happened. Enable it per-project,
> only where that trade is acceptable.

---

## Gemini via browser session

*Only relevant if the official Gemini CLI genuinely won't work for an
account — e.g. it can't complete Google's "Code Assist onboarding" step
(common for Workspace/company-managed accounts).*

If you specifically need the literal **gemini.google.com web app** as a
backend, there's no official way to script it — the only path is unofficial
software that replays your live browser session **cookie**. This was
deliberately **never built into the gateway itself**: copying a live session
cookie into the trusted routing layer is exactly the kind of risky dependency
this project avoids. Instead you run a small wrapper yourself, and the gateway
just proxies to it as an ordinary custom HTTP connection (Advanced settings →
Raw connections).

1. **Put the cookies in a private env file** — open gemini.google.com →
   DevTools → Application → Cookies, copy `__Secure-1PSID` and
   `__Secure-1PSIDTS` (leave the latter blank if your account doesn't have
   one — some accounts simply aren't issued it), then:
   ```bash
   umask 177 && cat > gemini-web.env <<'EOF'
   CONFIG_GEMINI__CLIENTS__0__ID=main
   CONFIG_GEMINI__CLIENTS__0__SECURE_1PSID=your-value
   CONFIG_GEMINI__CLIENTS__0__SECURE_1PSIDTS=your-value-or-blank
   CONFIG_SERVER__API_KEY=pick-a-random-string
   EOF
   ```
   A file (created owner-only by `umask 177`) keeps the cookies out of your
   shell history and `ps` output — don't pass them as `-e KEY=value` on the
   command line. `CONFIG_SERVER__API_KEY` makes the wrapper refuse any client
   that doesn't present that string as a Bearer token — put the same value in
   the raw lane's API-key field so the gateway is the only thing that can use
   it. **The cookies go into the wrapper — never into this gateway or anywhere
   in local-harness.**
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
   build the image from a clone you've reviewed instead of pulling `latest`:
   ```bash
   git clone https://github.com/Nativu5/Gemini-FastAPI.git && cd Gemini-FastAPI
   docker build -t gemini-fastapi:local .   # then use gemini-fastapi:local above
   ```
3. **Add it as a raw connection** in the dashboard's Advanced settings — type
   "HTTP backend", target `http://127.0.0.1:8000`, health path `/health`, API
   key matching `CONFIG_SERVER__API_KEY` above. Then use it in your tools like
   any local model, at `http://localhost:<port>/<your-prefix>/v1`.

**Known fragility, from direct experience running this:**

- Without `__Secure-1PSIDTS`, the library has nothing to auto-refresh in the
  background, so the session's lifetime depends entirely on how long
  `__Secure-1PSID` alone stays valid to this *unofficial* client — often much
  shorter than it stays valid in a real browser tab, even though it's the same
  cookie value. Expect to re-copy it more often than you'd like.
- The wrapper emulates OpenAI-style tool-calling by dumping the full JSON
  schema of every registered tool as raw text into the prompt (Gemini's web
  chat has no real function-calling API). Copilot's **Agent mode** registers
  its whole toolset on every request regardless of what you ask, which can
  produce large, unusual-looking prompts against a reverse-engineered chat
  session. Set `toolCalling: false` on the model registration unless you've
  verified it doesn't destabilize the session — this trades away autonomous
  tool use for reliability.
- Google's backend can return internal error codes the underlying library
  doesn't recognize (seen in practice: `1096`, `1097`, undocumented even by
  the library's own maintainers) — retries can escalate to a full connection
  failure and, in one observed case, the session going fully unauthenticated
  within minutes even on an account with no visible security challenge in a
  normal browser tab. This looks like anti-automation behavior on Google's
  side, not a config bug — treat repeated failures as a signal to back off,
  not to retry harder, especially on a non-spare account.
- Stopping the helper does **not** sign you out — the session stays valid at
  Google until it expires or you revoke it via Google Account → Security →
  "sign out of all sessions".

Given all of the above, this route is best treated as an occasional fallback,
not a primary driver for agentic coding sessions.
