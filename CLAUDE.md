# Project guidance

## Project

`@lakphy/cli-mail` is a Node.js 22.12+ CLI for Gmail and Outlook. It uses direct REST calls, no provider SDKs, and exposes Markdown plus a stable JSON envelope. Read the current package version from `package.json`; do not duplicate it in long-lived documentation.

## Commands

```bash
pnpm lint
pnpm typecheck
pnpm test:run
pnpm test:cov
pnpm build
pnpm check
```

The project is ESM and uses pnpm. `dist/index.mjs` is bundled by tsdown with a Node shebang.

## Architecture

```text
src/index.ts                  executable entry
src/run.ts                    parseAsync/error/exit-code boundary
src/cli.ts                    Commander command tree and validation
src/commands/                 provider-neutral command orchestration
src/config/                   versioned config, migration, locking, atomic storage
src/auth/                     state + PKCE OAuth and loopback callback server
src/providers/gmail/          Gmail REST/MIME implementation
src/providers/outlook/        Microsoft Graph implementation
src/output/formatter.ts       Markdown and JSON envelopes
src/utils/http.ts             auth, timeout, retry, raw responses, host validation
src/utils/mime.ts             Nodemailer/MailParser MIME boundary
src/utils/page-token.ts       account/provider/operation-bound opaque cursors
```

Command flow: Commander validates input → command resolves an active account → provider client performs REST calls → formatter writes one result. Provider list functions expose raw cursors and per-item errors; the command layer wraps cursors and emits partial success.

## Contracts

- JSON success: `{ok:true,data,meta,warnings}`, exit 0.
- JSON partial: `{ok:false,partial:true,data,meta,warnings,errors}`, exit 2.
- JSON failure: `{ok:false,error}`, exit 1.
- JSON stdout contains exactly one document. Do not write diagnostics to stdout before formatting.
- Raw MIME uses `Buffer`; do not decode/re-encode it through UTF-8.
- Message delete defaults to trash. Permanent delete requires `--permanent --yes` and provider capability.
- Sends and other irreversible commands require `--yes` at the CLI boundary.
- Provider cursors never go directly to users; encode/decode them with `utils/page-token.ts`. Only v2 tokens are accepted. They bind the full operation context (`folder`, `query`, `parent`, `label`, history `types`, `startHistoryId`, `since`, and `top` as applicable); omitted continuation options are restored from the token and explicit mismatches must fail.
- Gmail `--skip` must fail explicitly, and `--skip` cannot be combined with `--page-token` for any provider.
- `inbox` is Inbox-scoped; `message recent` remains mailbox-wide.
- `account validate` performs online Gmail profile/Outlook `/me` checks with concurrency 4 and exits 0/2/1 for all-or-zero success/partial success/all-or-selected failure.
- Outlook vacation `externalAudience` is `none`, `contactsOnly`, or `all`; omission preserves the remote setting, while Gmail rejects the option.
- Draft body type cannot be changed without replacement body content.
- An ambiguous Outlook send after `/send` starts uses `SEND_OUTCOME_UNKNOWN`, includes `draftId`, and directs the caller to check Sent Items before retrying.

## OAuth and config

- Gmail accepts Desktop credentials JSON only. Default scopes are `gmail.modify` and `gmail.settings.basic`; `--full-access` requests `mail.google.com`.
- Outlook is a public/native client and never uses a client secret.
- OAuth requires random state, S256 PKCE, and a random loopback port.
- v1 migration preserves account metadata, backs up the source, discards old tokens, and requires reauthentication.
- Config writes must remain lock-protected, atomic, `0600`, and recoverable from `.last-good`. A missing or corrupt primary is restored automatically from a valid recovery copy; preserve corrupt input as a `0600` `.corrupt-<timestamp>-<uuid>` file and never overwrite an invalid recovery copy silently.

## Testing

Tests mirror `src/` under `tests/`. Provider tests must not call real APIs. Cover REST paths/query/header behavior, raw responses, pagination, partial failure, output/exit contracts, and security boundaries. Update tests deliberately when changing the public CLI contract; retain legacy behavior only where the current migration path requires it.

## Documentation

- Keep `README.md` focused on current installation, behavior, and operational guidance; release history belongs in Git history or release notes.
- Keep `skill/` aligned with the current command tree, output envelopes, safety gates, and provider capability boundaries.
- Delete one-off plans and completed audit instructions instead of letting stale file paths or line numbers become project guidance.
