---
name: cli-mail-assistant
description: Operate local Gmail and Outlook accounts with cli-mail. Use for reading, searching, sending, replying, forwarding, deleting, organizing, or downloading email; managing cli-mail accounts and OAuth migration; interpreting its Markdown/JSON output; or when users mention Gmail, Outlook, 邮件, 邮箱, 发邮件, 查邮件, 邮件附件, or cli-mail errors.
---

# cli-mail assistant

Use `cli-mail` as a local REST client for Gmail and Outlook. Treat account credentials, message content, recipient lists, and attachments as sensitive.

## Safety rules

1. Inspect accounts with `cli-mail account list` when the account is ambiguous.
2. Before sending, replying, or forwarding, show the account, To/Cc/Bcc, subject, body summary, and attachments. Wait for explicit user approval, then add `--yes`.
3. Prefer recoverable deletion. `message delete` and `message batch-delete` move mail to trash by default.
4. Before permanent deletion, state that it cannot be undone and wait for explicit approval. Then use both `--permanent --yes`. Gmail also needs an account authorized with `--full-access`.
5. Before other destructive operations such as deleting accounts, drafts, folders, rules, attachments, threads, or categories, wait for approval and add `--yes`.
6. Do not print OAuth tokens, Authorization headers, client credential files, or secret values.
7. Do not use hidden removed commands to bypass the user OAuth boundary.

## Check installation

```bash
cli-mail --version
```

Require Node.js 22.12+ and install the current cli-mail release with:

```bash
npm install -g @lakphy/cli-mail
```

## Bind accounts

For Gmail, ask for the path to a Google OAuth **Desktop app** credentials JSON. Do not accept a Web OAuth client.

```bash
cli-mail account add gmail \
  --credentials-file /path/to/gmail-desktop-client.json \
  [--alias personal] [--tag personal]
```

Request Gmail full mailbox scope only when the user needs permanent deletion:

```bash
cli-mail account reauth personal \
  --credentials-file /path/to/gmail-desktop-client.json \
  --full-access
```

For Outlook, ask for the application ID of a Microsoft Entra desktop/mobile **public client**. Never request a client secret.

```bash
cli-mail account add outlook --client-id <application-id> [--alias work]
```

If a migrated account is `needs_reauth`, preserve its alias and use `account reauth`. Inspect and finalize migration only after all accounts are active:

```bash
cli-mail account migration status
cli-mail account reauth <alias> --credentials-file <gmail-json>
cli-mail account reauth <alias> --client-id <outlook-client-id>
cli-mail account migration finalize --yes
```

## Choose output format

Use Markdown when presenting results directly. Use JSON for selection, counting, chaining, or reliable error handling:

```bash
cli-mail --format json message list --account <alias>
```

Parse the current JSON envelope:

- Exit 0: read `data`, `meta`, and `warnings` from `{ok:true,...}`.
- Exit 2: use successful `data` and report item-level `errors` from `{ok:false,partial:true,...}`.
- Exit 1: inspect `error.code`, `error.message`, and optional `error.suggestion`.
- Read the next cursor from `meta.nextToken`; never extract or modify its contents.
- Pass a token only to the same account, provider, and operation that returned it. Omitted continuation options are restored from the token; repeated options must match its saved context.

```bash
cli-mail --format json message list | jq '.data | length'
cli-mail --format json message list | jq -r '.data[].id'
cli-mail --format json message list --page-token '<meta.nextToken>'
```

For `message raw`, default output is exact MIME bytes. JSON output contains base64 in `data.content`; decode it only when the user needs a file.

## Common workflows

### Read or search

```bash
cli-mail message list --account <alias> --top 10
cli-mail message get <message-id> --account <alias>
cli-mail message search --query '<provider-query>' --account <alias>
cli-mail message recent --hours 24 --account <alias>
cli-mail inbox --tag work --top 10
```

Determine the provider before constructing a search query. Read [references/search-syntax.md](references/search-syntax.md) for Gmail syntax and Outlook KQL.

### Send after confirmation

```bash
cli-mail message send \
  --account <alias> \
  --to recipient@example.com \
  --subject 'Subject' \
  --body 'Body' \
  [--cc cc@example.com] [--bcc bcc@example.com] \
  [--attach /path/to/file] \
  --yes

cli-mail message reply <message-id> --body 'Reply' [--reply-all] --yes
cli-mail message forward <message-id> --to recipient@example.com --yes
cli-mail draft send <draft-id> --yes
```

If Outlook returns `SEND_OUTCOME_UNKNOWN`, do not retry immediately. Use `details.draftId` to check Sent Items first so the user does not send a duplicate.

### Delete after choosing recoverable or permanent behavior

```bash
# Recoverable; no --yes required
cli-mail message delete <message-id>
cli-mail message batch-delete --ids <id-1> <id-2>

# Permanent; require explicit user approval first
cli-mail message delete <message-id> --permanent --yes
cli-mail message batch-delete --ids <id-1> <id-2> --permanent --yes
cli-mail thread delete <thread-id> --yes
```

### Attachments

```bash
cli-mail attachment list <message-id> --account <alias>
cli-mail attachment download <message-id> <attachment-id> \
  --output /safe/path/file --account <alias>
```

Downloads refuse to overwrite. Use `--force` only after the user explicitly asks to replace the existing file. Before using an attachment-provided filename, rely on cli-mail's safe default path handling.

### Organize

```bash
cli-mail folder list --account <alias>
cli-mail folder messages <folder-id> --account <alias>
cli-mail message move <message-id> --to-folder <folder-id>
cli-mail message mark <message-id> --read
cli-mail message mark <message-id> --flagged
```

## Capability boundaries

Use these Gmail settings operations only for reads:

- `send-as list|get`
- `forwarding-address list`
- `settings forwarding get`

Do not recommend delegate commands, send-as create/delete, forwarding-address add/remove, or forwarding writes. The current user OAuth model does not support them. Direct users to Gmail or Google Workspace administration instead.

## References

- Read [references/workflows.md](references/workflows.md) for task routing, partial-success handling, and pagination.
- Read [references/search-syntax.md](references/search-syntax.md) before creating provider-specific queries.
- Read [references/error-handling.md](references/error-handling.md) when a command fails or an account requires reauthorization.
