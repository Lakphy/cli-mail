# Error Handling Guide

## Common Errors and Solutions

### Authentication Errors

**Error**: `Authentication failed` or `Invalid credentials`

**Causes**:
- OAuth tokens expired
- Invalid Client ID/Secret
- Account was removed from cloud console

**Solutions**:
1. Check if account still exists: `cli-mail account list`
2. Remove and re-add account:
   ```bash
   cli-mail account remove <alias>
   cli-mail account add <provider> --alias <alias>
   ```
3. Verify Client ID/Secret are correct
4. Check OAuth app is still active in cloud console

---

**Error**: `Account not found: <alias>`

**Causes**:
- Typo in account alias
- Account was never added
- Account was removed

**Solutions**:
1. List available accounts: `cli-mail account list`
2. Use correct alias or add account if missing
3. Check if default account is set: `cli-mail account info`

---

### Permission Errors

**Error**: `Insufficient permissions` or `Access denied`

**Causes**:
- Missing API permissions in cloud console
- User denied permissions during OAuth

**Solutions**:
1. **Gmail**: Check Gmail API is enabled in Google Cloud Console
2. **Outlook**: Verify these permissions in Azure Portal:
   - `Mail.ReadWrite`
   - `Mail.Send`
   - `MailboxSettings.ReadWrite`
   - `User.Read`
3. Re-authenticate: Remove and re-add account

---

### Network Errors

**Error**: `Network request failed` or `Connection timeout`

**Causes**:
- No internet connection
- Firewall blocking requests
- API service temporarily down

**Solutions**:
1. Check internet connection
2. Verify firewall allows outbound HTTPS
3. Try again after a few minutes
4. Check provider status pages

---

### Message Not Found

**Error**: `Message not found` or `Invalid message ID`

**Causes**:
- Message was deleted
- Wrong message ID
- Message in different account

**Solutions**:
1. Verify message ID is correct
2. Check if using correct account: `--account <alias>`
3. Search for message: `cli-mail msg search --query "..."`

---

### Attachment Errors

**Error**: `Attachment not found` or `Failed to download attachment`

**Causes**:
- Invalid attachment ID
- Attachment was removed
- Insufficient disk space

**Solutions**:
1. List attachments first: `cli-mail att list <message-id>`
2. Verify attachment ID is correct
3. Check disk space: `df -h`
4. Try different output path

---

### Rate Limiting

**Error**: `Rate limit exceeded` or `Too many requests`

**Causes**:
- Too many API calls in short time
- Gmail: 250 quota units per user per second
- Outlook: Varies by operation

**Solutions**:
1. Wait a few seconds and retry
2. Reduce batch operation size
3. Add delays between operations
4. For bulk operations, process in smaller chunks

---

## Error Response Format

Errors are output as JSON to stderr:

```json
{
  "error": "Error message here",
  "code": "ERROR_CODE"
}
```

**Common error codes**:
- `CONFIG_ERROR` - Configuration issue
- `AUTH_ERROR` - Authentication failed
- `PROVIDER_ERROR` - API error from Gmail/Outlook
- `NETWORK_ERROR` - Network/connection issue
- `NOT_FOUND` - Resource not found

---

## Troubleshooting Workflow

When a command fails:

1. **Check account**: `cli-mail account list` - Does account exist?
2. **Check account info**: `cli-mail account info <alias>` - Is it configured correctly?
3. **Test simple command**: `cli-mail profile --account <alias>` - Can we connect?
4. **Check error message**: Look for specific error code
5. **Re-authenticate if needed**: Remove and re-add account
6. **Verify permissions**: Check cloud console settings

---

## Tips for AI Assistants

1. **Parse error messages**: Extract error code and message from JSON stderr
2. **Suggest specific solutions**: Based on error code, provide targeted fix
3. **Guide step-by-step**: Don't just say "re-authenticate", show the exact commands
4. **Verify before retry**: After fixing, test with simple command first
5. **Explain why**: Help user understand what went wrong and how to prevent it
