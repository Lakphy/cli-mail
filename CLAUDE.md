# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

cli-mail (`@lakphy/cli-mail`) — An AI-oriented CLI email client for Gmail and Outlook. Outputs clean markdown/JSON with no interactive TUI. Single runtime dependency: `commander`.

## Commands

```bash
pnpm run build        # Bundle with tsdown → dist/index.mjs
pnpm run dev          # Watch mode
pnpm run test         # Run vitest in watch mode
pnpm run test:cov     # Single run with coverage
pnpm run typecheck    # tsc --noEmit
npx vitest run tests/utils/error.test.ts   # Run a single test file
```

Package manager is **pnpm**. The output is ESM (`"type": "module"`). The built binary gets a `#!/usr/bin/env node` shebang via tsdown banner config.

## Architecture

```
src/index.ts            → entry point, calls createCli().parse()
src/cli.ts              → Commander program definition, all commands & global options
src/commands/resolve.ts → resolveAccount(): picks account by --account flag or default,
                          returns the right provider HttpClient
src/commands/*.ts       → thin command handlers: resolve account → call provider → format output
src/providers/types.ts  → unified interfaces shared across providers
src/providers/gmail/    → Gmail API implementation (messages, drafts, labels, threads, etc.)
src/providers/outlook/  → Outlook/Graph API implementation (messages, drafts, folders, rules, etc.)
src/config/store.ts     → reads/writes ~/.cli-mail/accounts.json (0600 perms)
src/auth/               → OAuth flows: local callback server on :4088, token refresh
src/output/formatter.ts → markdown tables (default) or JSON output
src/utils/http.ts       → HttpClient: auto token refresh, auth retry, rate limit handling
src/utils/error.ts      → typed error hierarchy with actionable suggestions
src/utils/mime.ts       → MIME building, base64url, payload extraction
```

**Data flow:** CLI command → `resolveAccount()` picks account config → creates provider-specific `HttpClient` (Gmail or Outlook base URL) → provider module calls API → `formatter` outputs markdown table or JSON.

**Provider pattern:** Gmail and Outlook have parallel module structures (`messages.ts`, `drafts.ts`, `folders.ts`/`labels.ts`, `attachments.ts`, etc.). Each exports functions taking an `HttpClient` and returning normalized types from `providers/types.ts`. Command handlers in `src/commands/` branch on `provider` field to call the right module.

## Testing

Tests use **Vitest** and live under `tests/` mirroring `src/` structure. `tests/helpers.ts` provides mock factories for `HttpClient` and `AccountConfig`. Tests are unit-level — no real API calls. No lint or format tooling is configured.

## Key Conventions

- Global `--format <markdown|json>` and `--account <alias>` options are captured in a `preAction` hook on the Commander program.
- Booleans render as `✓`/`✗` in markdown output.
- Config file path: `~/.cli-mail/accounts.json`.
- OAuth callback server binds to `127.0.0.1:4088`.
- The `skill/` directory contains Claude Code skill definitions for using this tool as an AI agent — not part of the library itself.
