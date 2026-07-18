# Workflow guide

## Read and select messages

1. Run `cli-mail account list` if the account is unclear.
2. Use `message list` for recent mail or a folder; use `message search` for provider-specific criteria.
3. Use JSON when selecting IDs:

```bash
cli-mail --format json message list --account <alias> --top 10
cli-mail --format json message search --account <alias> --query '<query>'
```

Read items from `.data`, not the JSON root. Fetch the selected message with:

```bash
cli-mail message get <id> --account <alias>
```

## Pagination

Read `.meta.nextToken`. If present, pass it unchanged to the same command and account:

```bash
cli-mail --format json message list --account <alias> --page-token '<token>'
```

Do not reuse tokens across accounts, providers, commands, folders, or searches. The token restores omitted continuation options; if an option is repeated, it must match the context saved in the token.

## Partial success

Exit code 2 means some items or accounts succeeded. Present `.data`, summarize `.errors`, and retry only failed items when that is safe. Do not describe exit 2 as a complete failure.

For cross-account inbox:

```bash
cli-mail --format json inbox --hours 24 --top 10
```

If one account fails, successful accounts remain in `.data` and the account failure appears in `.errors`.

## Send, reply, or forward

1. Collect account, To/Cc/Bcc, subject, body, and attachments.
2. Show the exact send summary.
3. Wait for explicit approval.
4. Run with `--yes`.

```bash
cli-mail message send \
  --account <alias> \
  --to recipient@example.com \
  --subject 'Subject' \
  --body 'Body' \
  --yes
```

Never infer approval from the original request when required details changed during preparation.

If Outlook reports `SEND_OUTCOME_UNKNOWN`, read `details.draftId` and check Sent Items before retrying. An immediate retry can create a duplicate message.

## Delete

Choose recoverable deletion unless the user explicitly requests permanence:

```bash
# Move to trash / Deleted Items
cli-mail message delete <id> --account <alias>

# Irreversible: confirm, then use both flags
cli-mail message delete <id> --account <alias> --permanent --yes
```

If Gmail reports `CAPABILITY_REQUIRED`, explain that permanent delete needs reauthorization with `--full-access`. Do not silently broaden scopes.

All other destructive delete commands require `--yes`.

## Download attachments

1. List attachments.
2. Resolve the intended attachment by ID.
3. Choose an explicit safe path, or let cli-mail sanitize the provider filename.
4. Do not use `--force` unless the user asks to overwrite.

```bash
cli-mail attachment list <message-id> --account <alias>
cli-mail attachment download <message-id> <attachment-id> \
  --output /safe/path/file --account <alias>
```

## Account migration

Run `account migration status`. Reauthorize every pending alias using a new Desktop/public client. Finalize only when `canFinalize` is true and the user approves deleting the v1 backup.

## Validate accounts

Use `cli-mail account validate [alias]` for an online identity check. Exit `0` means all selected accounts succeeded (or none exist), exit `2` means partial success, and exit `1` means the selected account or every account failed. Preserve successful results when handling exit `2`.
