# Archive

Parked features — not wired into the dashboard or documented in the main
README, but kept here in case they're worth reviving later.

- **[browser-login-options.md](browser-login-options.md)** — guided setup for
  Perplexity's search tool and a Gemini-via-browser-session fallback, both
  built on unofficial wrappers that hold a full-account cookie. Removed from
  the GUI and README to keep the main path simple; the security tradeoffs are
  real (see the doc), which is exactly why this isn't front-and-center.
- **[vscode-mcp-perplexity.json](vscode-mcp-perplexity.json)** — the VS Code
  MCP config referenced by that doc.

The dashboard's raw connections editor (Advanced settings) can still proxy to
a hand-run helper if you set one up from the doc above — it just won't hold
your hand through it or show a card for it.

To resurrect the full guided GUI card, `git log -- public/admin.html` before
this archive was created has the working implementation.
