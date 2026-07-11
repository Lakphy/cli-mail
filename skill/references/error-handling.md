# Error handling

Run automation commands with `--format json`. JSON is written to stdout as exactly one document.

## Exit codes

- `0`: success; consume `.data` and `.meta`.
- `1`: failure; inspect `.error`.
- `2`: partial success; consume `.data` and report `.errors`.

Failure example:

```json
{
  "ok": false,
  "error": {
    "code": "AUTH_ERROR",
    "message": "...",
    "statusCode": 401,
    "suggestion": "Re-authenticate with: cli-mail account reauth [alias]"
  }
}
```

## Common codes

### `CONFIG_ERROR`

- List accounts with `cli-mail account list`.
- Inspect the selected account with `cli-mail account info <alias>`.
- Correct invalid JSON, tags, page tokens, or missing confirmation flags.

### `ACCOUNT_REAUTH_REQUIRED` in a config message or `AUTH_ERROR`

Do not remove migrated account metadata. Reauthorize the existing alias:

```bash
cli-mail account reauth <gmail-alias> --credentials-file <desktop-json>
cli-mail account reauth <outlook-alias> --client-id <public-client-id>
```

### `CAPABILITY_REQUIRED`

For Gmail permanent deletion, explain the scope expansion and obtain user approval before running:

```bash
cli-mail account reauth <alias> --credentials-file <desktop-json> --full-access
```

Do not request full access for ordinary reading, sending, trashing, or settings-basic operations.

### `CLI_USAGE_ERROR`

Correct the command, enum, integer, or required option. Use `cli-mail <command> --help`; do not retry unchanged.

### `COMMAND_REMOVED`

Do not bypass it. Delegate and Gmail sharing writes are outside the user OAuth model. Direct the user to Gmail or Google Workspace administration.

### `API_ERROR` / `RATE_LIMIT_ERROR`

Use `statusCode`, `details`, and `suggestion`. Safe GETs already receive bounded retries. Avoid automatically repeating writes because their outcome may be ambiguous.

### `REQUEST_TIMEOUT`

Check connectivity and provider status, then retry a read. Ask before retrying an irreversible action.

## Partial errors

For exit 2, correlate each `.errors[].item` with the requested message/account. Keep and present successful `.data`; retry only failed reads or explicitly approved writes.

## Sensitive details

Do not ask users to paste tokens or client credential JSON content. Request only a local credentials-file path or public client ID. cli-mail redacts common secret fields, but still avoid relaying provider error details unnecessarily.
