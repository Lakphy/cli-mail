# Simplification instructions

Whole-repo cleanup review (reuse / simplification / efficiency / altitude), 2026-07-11.
No correctness bugs are listed here — these are quality, performance, and layering fixes
only. Items are ordered by impact within each section. None of these should change
user-visible behavior except where explicitly noted.

---

## 0. Execution protocol (read first)

1. **Verify before acting.** Every finding here came from a one-pass review and may be
   stale or wrong. Before deleting or refactoring anything, confirm the claim yourself:
   grep for callers of a symbol before deleting it (including in `tests/` and `src/cli.ts`),
   confirm "byte-identical" duplicates really are identical, confirm "unreachable" branches
   really are unreachable. If a claim doesn't hold, **skip the item and note it in your
   final report** — do not force the fix.
2. **Locate by symbol, not by line.** Line numbers below are approximate and will drift as
   you edit. Find code by the named function/constant/file.
3. **One section = one commit.** Work in the order given in "Suggested order of attack".
   After each numbered section (§2, §1.1, §3.x, …), run `pnpm check` (lint + typecheck +
   tests) and commit with a message naming the section. Never batch unrelated sections
   into one commit. Do not push unless asked.
4. **Tests:** when a change breaks tests that exercise removed/legacy paths, rewrite the
   tests against the real call path (CLAUDE.md: 0.1 shapes need not be preserved). When a
   change alters a public 0.2 contract, update the contract tests deliberately — never
   weaken a security-boundary test (MIME Buffer handling, page-token scoping, `--yes`
   gates, config file permissions) to make it pass.
5. **Items marked `[APPROVED BEHAVIOR CHANGE]` are deliberate contract changes.** The user
   approved them on 2026-07-11 — apply them, and update the affected contract tests in the
   same commit. Call them out explicitly in your final report.
6. **§1.2 (Gmail batch endpoint) is feature work, not cleanup.** Treat it as an optional
   separate task: it needs a design (multipart/mixed encoding, per-part status parsing,
   mapping onto `GmailItemError`), new tests, and its own commit series. Do it last or
   not at all in this pass.
7. **Final report:** list per section — applied / skipped (with reason) / decision-required
   items awaiting approval, plus the `pnpm check` result.

---

## 1. Performance (highest payoff)

### 1.1 Lazy-load mailparser / nodemailer / open (~150–200 ms off every invocation)
- **Where:** `src/utils/mime.ts:3-10`, `src/auth/browser.ts:1`
- **Problem:** `src/cli.ts` statically imports all commands → gmail providers → `utils/mime.ts`,
  so `mailparser` (~133 ms), `nodemailer` MailComposer (~27 ms), and `open` (~21 ms) load on
  every command — including `account list`, all Outlook commands, and anything that never
  touches MIME or OAuth.
- **Fix:** Convert to dynamic `import()` at the call sites, caching the module promise in a
  module-level variable:
  - `await import('mailparser')` inside `parseMimeMessage`
  - `await import('nodemailer/lib/mail-composer/index.js')` inside `buildMimeMessage`
  - `await import('open')` inside `launchSystemBrowser`
  - `nodemailer/lib/addressparser` used by `parseEmailAddress(es)`: either make those
    functions async or measure it separately — it may be cheap once nodemailer core isn't
    pulled in.

### 1.2 Use the Gmail batch endpoint for list commands (21 round trips → 2)
- **Where:** `src/providers/gmail/messages.ts:85-96`, `threads.ts:86-97`, `drafts.ts:88-99`,
  `labels.ts:39-49` (`includeCounts`)
- **Problem:** Each list command issues 1 list call + one GET per item (default 20, concurrency 8).
  Gmail supports multipart batch (`POST /batch/gmail/v1`, up to 100 sub-requests).
  Additionally, the per-item GET uses `format: 'full'` with `fields` including `payload`,
  which downloads full body data just to compute headers and `hasAttachments`.
- **Fix:** Build a Gmail batch helper on top of `HttpClient.postRaw` (multipart/mixed);
  per-sub-request errors map onto the existing `GmailItemError` partial-result shape.
  Independently, narrow the fields mask to exclude `payload.body.data` on list fetches.

### 1.3 Stop downloading attachment content for metadata-only operations
- **Where:** `src/providers/gmail/attachments.ts:27-71`, `src/commands/attachment.ts:63-70, 95-106`
- **Problem:**
  - `attachment get` (Gmail) fetches the full attachment body (up to 25 MiB) plus a
    `format: 'full'` message fetch, then discards the content and prints 4 metadata fields —
    all of which (including `size`) are already in the message payload.
  - `attachment download` without `-o` calls `getAttachment` (full content download) just to
    learn the filename, then `downloadAttachment` re-fetches the same content — the bytes
    transfer twice.
  - The Outlook download path has a milder version: `getAttachment` for the name, then
    `downloadAttachment` re-fetches metadata (1–2 redundant round trips).
- **Fix:** Add a metadata-only `getAttachmentInfo` (reuse `extractGmailAttachments`, which
  already carries `size`). Use it in `attachment get` and for default-filename resolution in
  `attachment download`; only hit the content endpoint on the actual download path. For
  Outlook, pass the already-fetched detail into the download helper.

### 1.4 Parallelize independent round trips
- **Gmail reply** — `src/commands/message.ts:153-161`, `src/providers/gmail/messages.ts:149-156`:
  `getSendAsAliases` is awaited before `replyToMessage`, which awaits its own `getMessage`.
  These are independent — `Promise.all` them (add an optional prefetched-message parameter to
  `replyToMessage`, or move the alias fetch inside it).
- **Gmail `settings update`** — `src/providers/gmail/settings.ts:176-187`: vacation/imap/pop/
  language PUTs run sequentially; run them with `Promise.allSettled` and report per-section
  failures, like `getSettings` already does for reads.

### 1.5 Don't reload config that's already in hand
- **Where:** `src/commands/message.ts:506-512` (`messageAll`), `src/commands/group.ts:36-38`
  (`groupShow`), `src/commands/account.ts:188-189` (`accountValidate`)
- **Problem:** `loadConfig()` is called, then `getAccountsByTag()`/`getAccount()` reload and
  re-validate the same file (readFileSync + JSON.parse + full Zod pass).
- **Fix:** Give `getAccountsByTag` an overload accepting an `AppConfig` (or filter
  `config.accounts` in place) so each command loads config once.

---

## 2. Dead code — delete outright

### 2.1 The "removed command" double layer (~200 lines unreachable)
- **Where:**
  - `src/commands/delegate.ts` — entire file
  - `src/commands/send-as.ts:53-82` — `sendAsCreate`, `sendAsDelete`
  - `src/commands/forwarding-address.ts:34-54` — `fwdAddrAdd`, `fwdAddrRemove`
  - `src/commands/settings.ts:170-184` — `forwardingSet`
  - `src/providers/gmail/settings.ts` — throw-only stubs: `setAutoForwarding`,
    `createSendAs`, `deleteSendAs`, `listDelegates`, `addDelegate`, `removeDelegate`,
    `createForwardingAddress`, `deleteForwardingAddress`
- **Problem:** `cli.ts` routes all removed commands to `removedCommand()` and never imports
  these; the stubs even resolve accounts and build HTTP clients before throwing.
- **Fix:** Delete all of it. `removedCommand()` already does the whole job.

### 2.2 Legacy dual call signatures with no legacy callers
- **Where:** `src/providers/gmail/auth.ts:86-98, 116-127`, `src/providers/outlook/auth.ts:20-38`,
  `src/providers/gmail/drafts.ts:70-77`, `src/providers/outlook/drafts.ts:38-44`,
  `src/providers/outlook/folders.ts:63-69` (`listFolders` — zero callers), `folders.ts:155-162`
- **Problem:** Overloads accepting legacy positional forms (`clientId, legacyClientSecret?`,
  `top, pageToken?`) exist only for tests; all production callers use the options-object form.
- **Fix:** Collapse to the single options-object signature; delete `normalizeOptions`/`typeof`
  branches, the overload declarations, and the unused `listFolders` wrapper. Update tests —
  CLAUDE.md says 0.1 shapes need not be preserved.

### 2.3 Test-only exports posing as production API
- **Where:** `src/providers/outlook/messages.ts:228-255` (`createMessage` — also duplicates
  `buildGraphMessage` line-for-line), `src/utils/http.ts:229-231, 249-255` (`postRaw` — keep if
  used by the batch helper from 1.2, `getRawUnauthenticated`), `src/providers/outlook/attachments.ts:107-114`
  (`downloadAttachmentBuffer`), `src/utils/mime.ts:282-289` (`bufferToBase64Url`, `fromBase64Url`),
  `mime.ts:327-330` (`extractTextFromPayload`), `src/config/store.ts:714-727` (deprecated
  `addAccount`), `src/output/formatter.ts:35-37` (`getGlobalFormat`)
- **Fix:** Delete and point tests at the real call paths (`toBase64Url`,
  `extractBodyFromPayload().body`, `createAccount`/`reauthorizeAccount`, `buildGraphMessage`
  via `sendMessage`). Keep `putRawUnauthenticated` (used by upload sessions).

### 2.4 Phantom capability interface
- **Where:** `src/providers/outlook/attachments.ts:50-56, 220-223`
- **Problem:** `uploadLargeAttachment` casts `client as UploadCapableHttpClient` and
  runtime-checks for `putRawUnauthenticated`, but that method is declared on `HttpClient`
  itself (`src/utils/http.ts:257`). The error branch is unreachable.
- **Fix:** Delete the interface, cast, and check; call `client.putRawUnauthenticated` directly.

### 2.5 Redundant derived state: `default_account`
- **Where:** `src/config/types.ts` (~40), `src/config/store.ts:404, 420-424, 664-667, 738-740, 749`,
  reader at `src/commands/group.ts:714`
- **Problem:** Documented as "derived from defaultAccountId, never persisted", yet manually
  recomputed in six mutation/hydration points.
- **Fix:** Remove `default_account` from `AppConfig`; in `groupShow`, compare
  `a.id === config.defaultAccountId`. Keep the alias only in `dehydrate`'s migration input
  handling if genuinely needed; otherwise delete that branch too.

### 2.6 Micro dead code
- `src/commands/message.ts:109-111` — `if (!body) { body = '' }` is unreachable; delete.
- `src/commands/message.ts:222-240` (`messageMove`) — Outlook branch outputs and early-returns
  while Gmail falls through to a trailing `outputSuccess`; give each branch its own output (or
  compute per-branch and output once) so the control flow is symmetric.

---

## 3. Deduplication — extract shared helpers

### 3.1 Shared Outlook Graph module
- **Where:** `src/providers/outlook/messages.ts:18-51, 360-421`, `drafts.ts:7-27, 82-97, 169-180`,
  `folders.ts:22-42, 192-214`
- **Problem:** `GraphEmailAddress`/`GraphMessage`/`GraphMessageList` types plus
  `toGraphAddress`/`fromGraphAddress(es)` are copy-pasted verbatim in three files;
  `folders.ts:normalizeMessage` is byte-identical to `messages.ts:normalizeMessageSummary`;
  `createMessage` and `drafts.createDraft` inline the payload assembly that
  `buildGraphMessage` already implements.
- **Fix:** Create `src/providers/outlook/graph.ts` (or extend `pagination.ts`) exporting the
  Graph types, address converters, `normalizeMessageSummary`, and `buildGraphMessage`;
  import from messages.ts, drafts.ts, and folders.ts. (Precedent: `src/providers/gmail/helpers.ts`.)

### 3.2 Consolidate Gmail helpers into `src/providers/gmail/helpers.ts`
- **Where:** duplicated across `gmail/messages.ts`, `gmail/drafts.ts`, `gmail/threads.ts`:
  - `normalizeInternalDate` — 3 copies (already drifted: `''` vs `undefined` on failure)
  - `headersToRecord` — 2 copies
  - `sanitizeRemoteFilename` — 2 copies (security-relevant CR/LF filtering)
  - RFC 5322 display-name quoting (`formatAddress` in messages.ts:460 vs `addressTexts` in
    drafts.ts:283) — security-relevant (header injection); move to `src/utils/mime.ts` as
    `formatEmailAddress`, next to `parseEmailAddress(es)`
  - parsed-attachment → `MimeAttachment` mapping — 2 copies
  - `threads.ts:normalizeThreadMessage` is identical to `messages.ts:normalizeMessageSummary`
- **Fix:** Move all of the above into `gmail/helpers.ts` (address formatting into `utils/mime.ts`)
  and import everywhere. Pick one failure convention for `normalizeInternalDate`.

### 3.3 Shared paginated partial-success output helper
- **Where:** `src/commands/message.ts:654-674` (`outputMessagePage`), `draft.ts:33-49`,
  `thread.ts:46-62`, `folder.ts:135-166`
- **Problem:** The exit-code-2 partial contract (a documented 0.2 contract) is hand-rolled in
  four copies: throw `*_PAGE_FAILED` if all items failed, else `outputPartial` with
  `{code: '*_FETCH_FAILED', message, item: {id}}`, else `outputList` with `{meta: {nextToken}}`.
  `folderMessages`' Gmail branch has already drifted (drops snippet/attachments columns).
- **Fix:** Extract `outputPageResult(items, columns, {meta, errors, failCode, itemCode})` in a
  new `src/commands/shared.ts` (or next to `outputPartial` in the formatter) and use it at all
  four sites. Have `folderMessages` reuse message.ts's row mapping/columns.

### 3.4 `requireProvider` / capability guards in one place
- **Where:** local guards in `thread.ts:10-17`, `send-as.ts:8-12`, `forwarding-address.ts:8-12`,
  `category.ts:8-15`, plus inline checks in `message.ts:364-366, 381-383, 418-420`,
  `history.ts:19-21`, `settings.ts:205, 233, 247`, `folder.ts:199-201, 215-217` (~13 copies);
  permanent-delete capability block copy-pasted at `message.ts:196-203` and `315-322`
  (plus variant in `thread.ts:123-128`)
- **Fix:** Add `requireProvider(account, provider, explanation)` and
  `requireCapability(account, capability)` to `src/commands/resolve.ts` (every command already
  imports it); replace all copies.
- **[APPROVED BEHAVIOR CHANGE]** `settings.ts` `mailTipsGet`/`forwardingSet` currently emit
  *success* (exit 0) with an "only available for Outlook" message where every sibling throws
  `ProviderError` (exit 1). Make them throw `ProviderError` via the shared `requireProvider`
  helper so unsupported-provider is always exit 1. Update the tests covering these two
  commands in the same commit.

### 3.5 `errorMessage(unknown): string` utility
- **Where:** `gmail/helpers.ts:57`, `commands/message.ts:677`, `utils/files.ts:17, 45`,
  `utils/input.ts:12`, `gmail/settings.ts:313`, `gmail/auth.ts:51`, `config/store.ts:381`,
  `run.ts:37` — nine copies of `error instanceof Error ? error.message : String(error)`.
- **Fix:** Export `errorMessage(error: unknown): string` from `src/utils/error.ts`; replace all
  nine, deleting the two private named helpers.

### 3.6 Smaller dedups
- **`vacationGet` ≡ `autoReplyGet`** — `src/commands/settings.ts:61-74, 118-131`: byte-identical
  bodies. Keep one, `export const autoReplyGet = vacationGet` (or wire both cli.ts actions to it).
- **`openOrShowUrl`** — `src/providers/gmail/auth.ts:100-114` has the helper;
  `src/providers/outlook/auth.ts:61-69` re-inlines it. Move it to `src/auth/browser.ts` and
  import from both. (The post-exchange profile `fetch` at gmail/auth.ts:167-179 and
  outlook/auth.ts:85-93 is a similar near-duplicate worth sharing while there.)
- **`attachmentList` branch collapse** — `src/commands/attachment.ts:17-49`: both provider
  branches map identical rows and columns; select the list via ternary, map/output once.
  Same collapse applies to the trivially-branched functions in `message.ts:43-79, 279-285`,
  `draft.ts:58-64, 92-98, 134-140`, `folder.ts:66-73`, `rule.ts` (ruleGet) —
  `draft.ts:16-18` (`draftList`) shows the target style.
- **`accountList` tag filter** — `src/commands/account.ts:109-113` re-implements
  `getAccountsByTag` (`config/store.ts:839`), including the reserved-`'default'` = untagged
  rule. Use the store function (with the config-passing overload from 1.5).
- **`accountReauth` identity pre-check** — `account.ts:74-78` duplicates the guard inside
  `store.reauthorizeAccount` (`store.ts:685-689`). Drop the pre-check; let the store be the
  single enforcement point.
- **`messageRecent` / `messageAll` since-logic** — `message.ts:469-494, 520-551`: both parse
  `--since`/`--hours` independently (already drifted: `ConfigError` vs `ProviderError`) and
  both build the provider time queries inline. Extract `resolveSinceDate(opts)`; the query
  building moves into providers per 4.1.

---

## 4. Altitude — move logic to the right layer

### 4.1 Provider query syntax out of the command layer
- **Where:** `src/commands/message.ts:479-494` (Gmail `after:<epoch>` / Graph
  `receivedDateTime ge <iso>`), `229-236` (Gmail move = add label + remove INBOX),
  `301-303, 400-404` (Outlook `'deleteditems'`/`'Inbox'` well-known folder IDs),
  duplicated again in `messageAll` (`message.ts:540-551`)
- **Fix:** Add to each provider's messages module: `listMessagesSince(client, sinceDate, top,
  pageToken?)`, `trashMessage`/`untrashMessage`, `moveMessage(id, folderId)`. Commands call
  those; provider dialects live beside the REST calls.

### 4.2 `createClientForAccount` helper
- **Where:** `src/commands/message.ts:540-551` (`messageAll`) duplicates `resolveAccount`'s
  gmail/outlook client dispatch.
- **Fix:** Add `createClientForAccount(account: AccountConfig)` to `src/commands/resolve.ts`
  and use it in both places.

### 4.3 Break the cli.ts ↔ commands import cycle
- **Where:** `src/commands/resolve.ts:8, 17` imports the global `--account` flag state from
  `src/cli.ts:8-17`, while cli.ts imports the commands.
- **Problem:** The cycle only works by accident of ESM evaluation order; the command layer
  can't be tested without loading the whole command tree.
- **Fix:** Move the `_globalAccountAlias` getter/setter into a small context module (e.g.
  `src/config/context.ts` or alongside `setConfigPath` in `config/store.ts`). cli.ts's
  preAction hook sets it; resolve.ts reads it; dependency arrows point down only.

### 4.4 Provider payload shaping out of `commands/settings.ts`
- **Where:** `src/commands/settings.ts:12-18, 89-104, 138-148`
- **Problem:** The Outlook auto-reply zod schema and the Gmail vacation wire format
  (`enableAutoReply`, epoch-millis-as-string) are built in the command layer; validation is
  asymmetric (Outlook schema-checked, Gmail passed raw).
- **Fix:** Move `outlookAutoReplySchema` into `src/providers/outlook/settings.ts` (validate
  inside `setAutoReply`); give `gmailSettings.setVacation` a neutral signature
  (`{enabled, message, start?: Date, end?: Date}`) that converts internally.

### 4.5 Provider size limits belong to providers
- **Where:** `src/commands/message.ts:17-20, 113-121` — `MAX_GMAIL_ATTACHMENT_BYTES`,
  `MAX_OUTLOOK_ATTACHMENT_BYTES`, and the Gmail combined-size rule.
- **Fix:** Export limits (and the combined-size check) from the respective provider messages
  modules or a per-provider limits object; the command consumes them generically.

### 4.6 Provider-specific error knowledge out of shared utils
- **`utils/http.ts:323-328`** (`isQuotaError`): Gmail quota reason strings sniffed via
  `JSON.stringify(body).includes(...)` in the shared retry loop. Make retryable-403 detection
  a client option (`isRetryableForbidden?: (body) => boolean` in `HttpClientOptions`) supplied
  by `src/providers/gmail/client.ts`.
- **`utils/error.ts:75-82`** (`getSuggestion`): Graph `$orderby`+`$search` trivia
  string-matched in the shared suggestion generator. Let providers attach an optional
  `suggestion` on `ApiError` where the quirk is actually known; keep `getSuggestion` for
  provider-neutral cases (401/404/429/503).

### 4.7 OAuth provider quirks into the auth config objects
- **Where:** `src/auth/token-store.ts:75-77, 138-140, 194-199` — `provider === 'gmail'`
  branches for client-secret inclusion and `access_type=offline&prompt=consent` vs
  `prompt=select_account`.
- **Fix:** Extend `GMAIL_AUTH`/`OUTLOOK_AUTH` in `src/config/types.ts` with `extraAuthParams`
  and `allowsClientSecret`; `buildAuthUrl`/token exchange read those.

### 4.8 Presentation strings leaking into JSON `data`
- **Where:** `src/commands/attachment.ts:157-161` (`formatSize` → `"1.2 KB"` strings),
  `src/commands/rule.ts:20-21, 35-37` (pre-`JSON.stringify`ed objects, `'yes'/'no'` booleans)
- **Problem:** Commands pass the same items to Markdown and JSON envelopes, so display strings
  end up in the stable JSON `data` — and `formatCellValue` (`formatter.ts:242`) already
  JSON-encodes objects and renders booleans.
- **Fix:** Keep raw numbers/objects/booleans in item records; if pretty sizes are wanted, add
  an optional per-column cell formatter to the column definition in `formatter.ts` so Markdown
  gets display values while JSON keeps raw data. **[APPROVED BEHAVIOR CHANGE]:** this changes
  the stable JSON `data` shape (sizes become numbers, rule fields become objects/booleans).
  Apply it, keep Markdown output human-readable via the per-column formatter, and update the
  contract tests in the same commit.

### 4.9 Structured error code for reauth
- **Where:** `src/config/store.ts:631-635` (`getActiveAccount`)
- **Problem:** `ACCOUNT_REAUTH_REQUIRED` is smuggled inside the message string of a generic
  `ConfigError` (`code: "CONFIG_ERROR"`), forcing automation to parse message text.
- **Fix:** Throw with the real structured code (`ACCOUNT_REAUTH_REQUIRED`) and add a reauth
  suggestion in `getSuggestion` keyed on it.

### 4.10 Gmail label nesting into the provider
- **Where:** `src/commands/folder.ts:83-85` joins `parent/name` in the command layer.
- **Fix:** `gmailLabels.createLabel(client, name, parent?)` does the joining, mirroring
  `outlookFolders.createFolder`.

---

## 5. API/ergonomics cleanup (low priority)

- **Drop the positional `format` param from `output`/`outputList`**
  (`src/output/formatter.ts:39-43, 58-62`): no production caller passes it, but a dozen call
  sites must write `outputList(items, columns, undefined, { meta })`. Move it into `options`
  (or delete), matching `outputSuccess`/`outputPartial`.
- **`-a, --account` option factory in cli.ts**: the identical `.option('-a, --account <alias>',
  'Account alias')` line is repeated ~77 times. Add a `withAccount(cmd)` helper or
  `accountOption()` factory using Commander's `.addOption`.

---

## Deliberately not flagged

- `validateUploadUrl` in `outlook/attachments.ts` vs `HttpClient`'s host check — intentional
  defense-in-depth with different strictness.
- Email-mismatch check appearing at both the account-command boundary and the store — layered
  authority is fine (except the exact-duplicate pre-check noted in 3.6).
- JSON envelopes, config locking/atomic writes/0600/.last-good, OAuth state+PKCE+random port,
  page-token codec, `--yes` gates, raw-MIME Buffer handling — documented contracts, all clean.
- Clean modules with no findings: `utils/page-token.ts`, `utils/redact.ts`, `utils/files.ts`,
  `utils/input.ts`, `run.ts`, `auth/oauth-server.ts`, `output/formatter.ts` core,
  `outlook/pagination.ts`, `outlook/rules.ts`, `outlook/categories.ts`, `gmail/helpers.ts`.

## Suggested order of attack

1. §2 dead-code deletions (safe, shrinks everything that follows)
2. §1.1 lazy imports and §1.3/1.4 round-trip fixes (biggest user-visible wins, small diffs)
3. §3.1–3.5 helper extractions (mechanical, test-covered)
4. §4 layering moves (do §4.3 cycle-break and §4.1/4.2 together with §3.6's since-logic dedup)
5. §1.2 Gmail batch endpoint (largest new code; do last, on top of the cleaned-up providers)
6. §5 ergonomics

Run `pnpm check` after each section; update tests per CLAUDE.md (0.1 shapes need not be
preserved).
