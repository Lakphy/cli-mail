---
name: cli-mail-assistant
description: Help users manage Gmail and Outlook emails using the cli-mail command-line tool. Use this skill when users want to check emails, send emails, manage email accounts, search messages, handle attachments, or perform any email-related operations. Also trigger when users mention "邮件", "邮箱", "Gmail", "Outlook", "发邮件", "查看邮件", or need help with email authentication and setup.
---

# CLI Mail Assistant

This skill helps users interact with their Gmail and Outlook accounts through the `cli-mail` command-line tool (v0.1.1). The tool is designed for AI agents with clean markdown/JSON output.

## Core Principles

**Account awareness**: Always check which accounts exist before operations. Users may have multiple accounts with different aliases.

**Confirmation for sensitive actions**: Before sending emails or deleting messages, confirm the details with the user - especially verify the recipient addresses and account being used.

**Output format**: The default output is **markdown** (tables, key-value pairs with checkmarks for booleans). Use `-f json` when you need full structured data for programmatic parsing. The old `text` format name is accepted as an alias for backward compatibility.

**Error handling**: Errors now include **actionable suggestions** (e.g., "Re-authenticate with: cli-mail account add <provider>"). In markdown mode, errors render as blockquotes with icons. In JSON mode, errors include a `suggestion` field.

## How to Use This Skill

This skill is organized into sections:

1. **Installation & Setup Guide** - Help users get started
2. **Common Workflows** - Step-by-step guides for typical tasks
3. **Command Reference** - Complete command list
4. **Reference Files** - Detailed guides (read when needed):
   - `references/workflows.md` - Decision trees and workflow logic
   - `references/search-syntax.md` - Gmail/Outlook search query syntax
   - `references/error-handling.md` - Common errors and solutions

**When to read reference files:**
- Read `workflows.md` when you need to decide which command to use or handle multi-step tasks
- Read `search-syntax.md` when constructing search queries (different syntax for Gmail vs Outlook)
- Read `error-handling.md` when a command fails or returns an error

## Installation & Setup Guide

### Step 1: Check if cli-mail is installed

```bash
cli-mail --version
```

If not installed, guide the user to install it:

```bash
# From npm
npm install -g @lakphy/cli-mail

# Or from source
git clone https://github.com/Lakphy/cli-mail.git
cd cli-mail
pnpm install
pnpm run build
npm link
```

### Step 2: Guide user to get API credentials

**For Gmail:**
1. Visit [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project and enable Gmail API
3. Create OAuth 2.0 credentials (Desktop app or Web application)
4. If Web app, set redirect URI to: `http://localhost:4088/callback`
5. Save the Client ID and Client Secret

**For Outlook:**
1. Visit [Azure Portal - App Registrations](https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps)
2. Register new application
3. **Important**: Choose "Accounts in any organizational directory and personal Microsoft accounts"
4. Add redirect URI (Web platform): `http://localhost:4088/callback`
5. Add API permissions: `Mail.ReadWrite`, `Mail.Send`, `MailboxSettings.ReadWrite`, `User.Read`
6. Create client secret in "Certificates & secrets"
7. Save the Application (client) ID and Secret Value

### Step 3: Add account

```bash
cli-mail account add gmail --alias personal
# or
cli-mail account add outlook --alias work
```

The command will prompt for Client ID and Client Secret, then open a browser for OAuth authorization.

### Step 4: Verify setup

```bash
cli-mail account list
cli-mail profile --account personal
```

## Quick Start: Typical User Interactions

### Example 1: User asks "帮我查看最新的邮件"

**Step 1**: Check accounts
```bash
cli-mail account list
```

**Step 2**: List recent emails
```bash
cli-mail msg list --account personal --top 5
```

**Step 3**: Show results to user in readable format

---

### Example 2: User asks "搜索来自老板的未读邮件"

**Step 1**: Identify account and provider (Gmail or Outlook)
```bash
cli-mail account info personal
```

**Step 2**: Construct appropriate search query
- Gmail: `from:boss@company.com is:unread`
- Outlook: `from/emailAddress/address eq 'boss@company.com' and isRead eq false`

**Step 3**: Execute search
```bash
cli-mail msg search --query "from:boss@company.com is:unread" --account personal
```

For complex queries, read `references/search-syntax.md`

---

### Example 3: User asks "发邮件给 bob@example.com"

**Step 1**: Gather all required information
- Ask for subject if not provided
- Ask for body content
- Ask which account to use
- Ask about attachments

**Step 2**: Show confirmation (MANDATORY)
```
准备发送邮件：
账号: personal (user@gmail.com)
收件人: bob@example.com
主题: Hello
正文: Hi Bob, how are you?
附件: 无

确认发送吗？[y/n]
```

**Step 3**: Only after user confirms, execute
```bash
cli-mail msg send --account personal --to bob@example.com --subject "Hello" --body "Hi Bob, how are you?"
```

---

### Example 4: User asks "下载这封邮件的附件"

**Step 1**: Get message ID (from context or ask user)

**Step 2**: List attachments
```bash
cli-mail att list <message-id> --account personal
```

**Step 3**: Download attachment
```bash
cli-mail att download <message-id> <attachment-id> -o ~/Downloads/ --account personal
```

**Step 4**: Confirm location to user

---

## Common Workflows

### Checking Emails

**List recent emails:**
```bash
cli-mail message list --account personal --top 10
```

**List emails by time range (new):**
```bash
cli-mail msg recent --hours 6 --account personal           # last 6 hours
cli-mail msg recent --since 2026-03-28T00:00:00Z --top 50  # since specific time
```

**Cross-account inbox (new):**
```bash
cli-mail inbox                    # last 24h from all accounts
cli-mail inbox --hours 12         # last 12h from all accounts
cli-mail inbox --top 5            # 5 messages per account
```
The `inbox` command aggregates messages across all configured accounts, sorted by date. If one account fails, it continues with the rest.

**Read specific email:**
```bash
cli-mail message get <message-id> --account personal
```

**Search emails:**
```bash
cli-mail message search --query "from:boss@company.com is:unread" --account personal
```

**Check unread count:**
```bash
cli-mail -f json message list --query "is:unread" --account personal | jq 'length'
```

### Sending Emails

**Important**: Always confirm with user before sending:
- Recipient addresses (to, cc, bcc)
- Subject and body content
- Which account to use
- Any attachments

**Send simple email:**
```bash
cli-mail message send \
  --account personal \
  --to recipient@example.com \
  --subject "Meeting Tomorrow" \
  --body "Hi, let's meet at 3pm."
```

**Send with attachments:**
```bash
cli-mail message send \
  --account work \
  --to team@company.com \
  --subject "Q1 Report" \
  --body "Please review the attached report." \
  --attach /path/to/report.pdf \
  --attach /path/to/data.xlsx
```

**Send HTML email:**
```bash
cli-mail message send \
  --account personal \
  --to friend@example.com \
  --subject "Newsletter" \
  --body-file newsletter.html \
  --body-type html
```

**Reply to email:**
```bash
cli-mail message reply <message-id> \
  --account personal \
  --body "Thanks for your email. I'll get back to you soon."
```

**Reply all:**
```bash
cli-mail message reply <message-id> \
  --account personal \
  --body "Agreed with the plan." \
  --reply-all
```

### Managing Accounts

**List all accounts:**
```bash
cli-mail account list
```

**Switch default account:**
```bash
cli-mail account switch work
```

**View account info:**
```bash
cli-mail account info personal
```

**Remove account:**
```bash
cli-mail account remove old-account
```

**Rename account alias:**
```bash
cli-mail account rename old-alias new-alias
```

**Validate account tokens:**
```bash
cli-mail account validate          # validate all accounts
cli-mail account validate personal  # validate specific account
```

### Working with Folders/Labels

**List folders:**
```bash
cli-mail folder list --account personal
```

**View messages in folder:**
```bash
cli-mail folder messages <folder-id> --account personal
```

**Move message to folder:**
```bash
cli-mail message move <message-id> --to-folder <folder-id> --account personal
```

**Create new folder:**
```bash
cli-mail folder create --name "Projects" --account work
```

### Attachments

**List attachments in email:**
```bash
cli-mail attachment list <message-id> --account personal
```

**Download attachment:**
```bash
cli-mail attachment download <message-id> <attachment-id> -o ~/Downloads/file.pdf --account personal
```

### Drafts

**Create draft:**
```bash
cli-mail draft create \
  --account personal \
  --to recipient@example.com \
  --subject "Draft Subject" \
  --body "Draft content here"
```

**List drafts:**
```bash
cli-mail draft list --account personal
```

**Send draft:**
```bash
cli-mail draft send <draft-id> --account personal
```

## Account Selection Logic

The tool uses this priority order to determine which account to use:

1. `--account <alias>` flag in the command
2. Default account (set via `cli-mail account switch`)
3. First account in the config file

Always specify `--account` when the user has multiple accounts to avoid confusion.

## Output Formats

**Markdown (default)**: Clean markdown tables and key-value pairs, optimized for AI consumption.
- Boolean values render as checkmarks (not `true`/`false`)
- Success messages render as `> ✓ Message sent`
- Errors render as blockquotes with actionable suggestions
- The old `-f text` flag is accepted as an alias for backward compatibility

**JSON**: Use `-f json` for programmatic parsing:
```bash
cli-mail -f json message list --account personal
```

This outputs structured JSON that you can parse with `jq` or in your code. Error responses in JSON mode include a `suggestion` field with actionable remediation steps.

## Common Issues & Solutions

**"Account not found" error:**
- Run `cli-mail account list` to see available accounts
- Check if the alias is correct
- User may need to add the account first

**"Authentication failed" error:**
- Tokens may have expired
- Ask user to remove and re-add the account:
  ```bash
  cli-mail account remove <alias>
  cli-mail account add <provider> --alias <alias>
  ```

**"Client ID required" during setup:**
- User needs to create OAuth credentials first (see Setup Guide above)
- Make sure they're using the correct redirect URI: `http://localhost:4088/callback`

**Browser doesn't open during OAuth:**
- The tool will print a URL - ask user to open it manually
- Make sure port 4088 is not blocked

## Safety Guidelines

**Before sending emails:**
1. Show the user exactly what will be sent (to, subject, body, attachments)
2. Confirm the account being used
3. Wait for explicit user approval

**Before deleting:**
1. Show what will be deleted
2. Explain that `--permanent` cannot be undone
3. Suggest using trash instead: `cli-mail message trash <id>`

**Handling sensitive data:**
- Never log or display full email content unless requested
- Be careful with attachment contents
- Remind users that OAuth tokens are stored locally in `~/.cli-mail/accounts.json`

## Command Reference Quick Guide

### Account Commands
- `account add <gmail|outlook> [--alias <name>]` - Add account
- `account list` - List all accounts
- `account remove <alias>` - Remove account
- `account switch <alias>` - Set default account
- `account info [alias]` - View account details
- `account rename <old-alias> <new-alias>` - Rename account alias
- `account validate [alias]` - Validate account configuration and tokens

### Message Commands (alias: `msg`)
- `msg list [--folder <id>] [--query <q>] [--top <n>] [--skip <n>] [--page-token <t>]` - List messages
- `msg get <id>` - Read message
- `msg raw <id>` - Get raw MIME source
- `msg send --to <addr...> --subject <s> [--body <b>] [--body-file <f>] [--cc <addr...>] [--bcc <addr...>] [--attach <file...>] [--body-type text|html] [--importance low|normal|high]` - Send email
- `msg reply <id> --body <b> [--reply-all]` - Reply to email
- `msg forward <id> --to <addr...> [--body <b>]` - Forward email
- `msg delete <id> [--permanent]` - Delete message
- `msg batch-delete --ids <id1> <id2>...` - Delete multiple messages
- `msg move <id> --to-folder <folder-id>` - Move message
- `msg copy <id> --to-folder <id>` - Copy message (Outlook only)
- `msg mark <id> [--read] [--unread] [--flagged] [--unflagged]` - Mark message
- `msg search --query <q> [--top <n>]` - Search messages
- `msg trash <id>` - Move to trash
- `msg untrash <id>` - Restore from trash
- `msg batch-modify --ids <id...> --add-labels <l...> --remove-labels <l...>` - Batch modify labels (Gmail only)
- `msg import --file <path>` - Import raw MIME (Gmail only)
- `msg insert --file <path>` - Insert without scanning (Gmail only)
- `msg recent [--hours <n>] [--since <date>] [--top <n>]` - List recent messages by time range

### Draft Commands
- `draft list [--top <n>]` - List drafts
- `draft get <id>` - View draft
- `draft create --to <addr...> --subject <s> [--body <b>] [--cc <addr...>] [--bcc <addr...>] [--body-type text|html]` - Create draft
- `draft update <id> [--to <addr...>] [--subject <s>] [--body <b>] [--cc <addr...>] [--bcc <addr...>] [--body-type text|html]` - Update draft
- `draft send <id>` - Send draft
- `draft delete <id>` - Delete draft

### Folder Commands (alias: `label`)
- `folder list [--parent <id>]` - List folders/labels
- `folder get <id>` - View folder details
- `folder create --name <n> [--parent <id>]` - Create folder
- `folder update <id> --name <n>` - Update folder name
- `folder delete <id>` - Delete folder
- `folder messages <id> [--top <n>]` - List messages in folder
- `folder move <id> --to-folder <id>` - Move folder (Outlook only)
- `folder copy <id> --to-folder <id>` - Copy folder (Outlook only)

### Attachment Commands (alias: `att`)
- `att list <message-id>` - List attachments
- `att get <message-id> <attachment-id>` - Get attachment info
- `att download <message-id> <attachment-id> [-o <path>]` - Download attachment
- `att add <message-id> --file <path>` - Add to draft (Outlook only)
- `att delete <msg-id> <att-id>` - Delete attachment (Outlook only)

### Settings Commands
- `settings get` - View mailbox settings
- `settings update --json '<json>'` - Update settings
- `settings vacation get` - Get auto-reply status
- `settings vacation set [--enabled] [--disabled] [--message <m>] [--start <d>] [--end <d>]` - Set auto-reply
- `settings forwarding get` - Get forwarding rules (Gmail only)
- `settings forwarding set --json '<json>'` - Set forwarding (Gmail only)

### Rules & Filters Commands (alias: `filter`)
- `rule list` - List rules/filters
- `rule get <id>` - Get rule details
- `rule create --json '<rule-json>'` - Create rule
- `rule update <id> --json '<json>'` - Update rule (Outlook only)
- `rule delete <id>` - Delete rule

### Thread Commands (Gmail only)
- `thread list [--query <q>] [--top <n>]` - List threads
- `thread get <id>` - Get thread details
- `thread modify <id> [--add-labels <l>] [--remove-labels <l>]` - Modify thread labels
- `thread trash <id>` - Move thread to trash
- `thread untrash <id>` - Restore thread from trash
- `thread delete <id>` - Delete thread permanently

### Category Commands (Outlook only)
- `category list` - List categories
- `category create --name <n> [--color <c>]` - Create category
- `category update <id> [--name <n>] [--color <c>]` - Update category
- `category delete <id>` - Delete category

### Focused Inbox Commands (Outlook only)
- `focused-inbox list` - List focused inbox rules
- `focused-inbox add --email <e> --classify <focused|other>` - Add rule
- `focused-inbox delete <id>` - Delete rule

### Cross-Account Commands
- `inbox [--hours <n>] [--since <date>] [--top <n>]` - Cross-account inbox aggregation

### Other Commands
- `profile` - Show user profile (email, displayName, etc.)
- `history --start-history-id <id> [--label-id <id>] [--types <t...>] [--top <n>]` - Mailbox history (Gmail only)
- `mail-tips --addresses <addr...>` - Get mail tips (Outlook only)

### Send-As Aliases (Gmail only)
- `send-as list` - List send-as aliases
- `send-as get <email>` - Get alias details
- `send-as create --email <e> [--display-name <n>] [--reply-to <e>]` - Create alias
- `send-as delete <email>` - Delete alias

### Delegates (Gmail only)
- `delegate list` - List delegates
- `delegate add --email <e>` - Add delegate
- `delegate remove <email>` - Remove delegate

### Forwarding Addresses (Gmail only, alias: `fwd-addr`)
- `forwarding-address list` - List forwarding addresses
- `forwarding-address add --email <e>` - Add forwarding address
- `forwarding-address remove <email>` - Remove forwarding address

### Global Options
- `-f, --format <markdown|json>` - Output format (default: markdown; `text` accepted as alias)
- `-a, --account <alias>` - Specify account
- `-h, --help` - Show help
- `-V, --version` - Show version

## Examples for Common User Requests

**"帮我查看最新的邮件"**
```bash
cli-mail message list --account personal --top 5
# Or use the new time-based recent command:
cli-mail msg recent --hours 6 --account personal
```

**"查看所有邮箱的最新邮件"**
```bash
cli-mail inbox --hours 12
```

**"发一封邮件给 bob@example.com"**
First confirm details, then:
```bash
cli-mail message send --account personal --to bob@example.com --subject "..." --body "..."
```

**"搜索来自老板的未读邮件"**
```bash
cli-mail message search --query "from:boss@company.com is:unread" --account work
```

**"下载这封邮件的附件"**
```bash
# First list attachments
cli-mail att list <message-id> --account personal
# Then download
cli-mail att download <message-id> <attachment-id> -o ~/Downloads/ --account personal
```

**"把这封邮件移到归档"**
```bash
# First find the archive folder ID
cli-mail folder list --account personal
# Then move
cli-mail message move <message-id> --to-folder <archive-folder-id> --account personal
```

**"重命名邮箱别名"**
```bash
cli-mail account rename old-name new-name
```

**"检查邮箱配置是否正常"**
```bash
cli-mail account validate
```

## Tips for AI Assistants

1. **Always check account status first** when helping with email operations
2. **Use JSON format** when you need to parse and process results
3. **Confirm before sending** - show the full email details and wait for approval
4. **Be specific with accounts** - use `--account` flag when user has multiple accounts
5. **Handle errors gracefully** - guide users through re-authentication if needed
6. **Respect privacy** - don't display full email content unless explicitly requested
7. **Use appropriate commands** - prefer `trash` over `delete --permanent` for safety

## Execution Checklist

Before running any command:

- [ ] Verify account exists: `cli-mail account list`
- [ ] Use correct account alias with `--account` flag
- [ ] For sensitive operations (send/delete), confirm with user first
- [ ] Choose appropriate output format (`-f json` for parsing, markdown for display)
- [ ] If command fails, check the suggestion in the error output for actionable remediation
- [ ] If suggestion is insufficient, read `references/error-handling.md` for solutions

When constructing search queries:

- [ ] Check provider type (Gmail vs Outlook)
- [ ] Use correct syntax (read `references/search-syntax.md` if unsure)
- [ ] Test with simple query first, then add complexity

When helping users:

- [ ] Understand their intent (read `references/workflows.md` for decision trees)
- [ ] Gather all required information before executing
- [ ] Show what you're doing and why
- [ ] Verify results and confirm with user

Remember: This tool is designed for AI-first interaction with clean, parseable output. Take advantage of the structured data formats to provide intelligent assistance.
