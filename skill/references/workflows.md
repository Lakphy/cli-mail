# Workflow Decision Guide

## Decision Trees for Common Tasks

### 1. User Wants to Check Emails

**Step 1: Determine what they want to see**

- "最新的邮件" / "recent emails" → `msg list --top 10`
- "未读邮件" / "unread emails" → `msg search --query "is:unread"` (Gmail) or `msg search --query "isRead eq false"` (Outlook)
- "来自某人的邮件" / "emails from someone" → `msg search --query "from:email@example.com"`
- "特定主题" / "specific subject" → `msg search --query "subject:keyword"`

**Step 2: Check account**
```bash
cli-mail account list
```

**Step 3: Execute appropriate command**
```bash
cli-mail msg list --account <alias> --top <n>
# or
cli-mail msg search --query "<query>" --account <alias>
```

**Step 4: Show results to user**
- Use default text format for human-readable output
- Parse JSON if you need to process results

---

### 2. User Wants to Send Email

**Step 1: Gather information (REQUIRED)**
- ✅ Recipient(s): to, cc, bcc
- ✅ Subject
- ✅ Body content
- ✅ Attachments (if any)
- ✅ Which account to use

**Step 2: Confirm with user (MANDATORY)**
Show them:
```
准备发送邮件：
账号: user@gmail.com (Gmail)
收件人: recipient@example.com
主题: Meeting Tomorrow
正文: Hi, let's meet at 3pm.
附件: 无

确认发送吗？
```

**Step 3: Execute only after confirmation**
```bash
cli-mail msg send \
  --account personal \
  --to recipient@example.com \
  --subject "Meeting Tomorrow" \
  --body "Hi, let's meet at 3pm."
```

**Step 4: Verify sent**
```bash
cli-mail msg search --query "in:sent" --account personal --top 1
```

---

### 3. User Wants to Read Specific Email

**Step 1: Get message ID**

If user provides ID directly:
```bash
cli-mail msg get <message-id> --account <alias>
```

If user describes email ("最新的邮件", "来自老板的邮件"):
1. Search first: `cli-mail -f json msg search --query "..." --account <alias>`
2. Parse JSON to get message ID
3. Then get full message: `cli-mail msg get <id> --account <alias>`

**Step 2: Show content**
- Display subject, from, date, body
- List attachments if any
- Ask if they want to download attachments

---

### 4. User Wants to Download Attachment

**Step 1: List attachments**
```bash
cli-mail att list <message-id> --account <alias>
```

**Step 2: Get attachment ID**
- If user specifies which one, use that ID
- If only one attachment, use it directly
- If multiple, ask user which one

**Step 3: Download**
```bash
cli-mail att download <message-id> <attachment-id> -o ~/Downloads/ --account <alias>
```

**Step 4: Confirm location**
Tell user where file was saved

---

### 5. User Wants to Manage Folders/Labels

**Gmail (Labels)**:
```bash
# List labels
cli-mail folder list --account <alias>

# Add label to message
cli-mail msg batch-modify --ids <id> --add-labels "Work" --account <alias>
```

**Outlook (Folders)**:
```bash
# List folders
cli-mail folder list --account <alias>

# Move message to folder
cli-mail msg move <id> --to-folder <folder-id> --account <alias>
```

---

## When to Use Which Command

### Listing vs Searching

**Use `msg list`** when:
- User wants recent emails (no specific criteria)
- Listing emails in a specific folder
- Simple pagination needed

**Use `msg search`** when:
- User has specific criteria (from, subject, date, etc.)
- Looking for unread/starred/important emails
- Need to filter by multiple conditions

### Get vs Raw

**Use `msg get`** when:
- User wants to read email content
- Need formatted, human-readable output
- Standard use case

**Use `msg raw`** when:
- User needs original MIME source
- Debugging email issues
- Exporting for backup

### Delete vs Trash

**Use `msg trash`** when:
- User wants to delete (default, safer)
- Can be recovered later
- Recommended for most cases

**Use `msg delete --permanent`** when:
- User explicitly wants permanent deletion
- Cleaning up trash folder
- **Always confirm first!**

---

## Output Format Selection

**Use default text format** when:
- Showing results directly to user
- User wants to read content
- Human-readable output needed

**Use JSON format (`-f json`)** when:
- You need to parse results
- Extracting specific fields
- Processing multiple items
- Counting or filtering

Example:
```bash
# Get unread count
cli-mail -f json msg search --query "is:unread" --account personal | jq 'length'

# Extract message IDs
cli-mail -f json msg list --account personal | jq '.[].id'
```

---

## Multi-Account Scenarios

**When user has multiple accounts:**

1. **Always ask which account** if not specified
2. **List accounts first** to show options:
   ```bash
   cli-mail account list
   ```
3. **Use explicit `--account` flag** in every command
4. **Remember context**: If user is working with one account, continue using it

**Example conversation:**
```
User: 查看邮件
AI: 你有两个账号：user@gmail.com (Gmail) 和 user@company.com (Outlook)。要查看哪个账号的邮件？
User: Gmail
AI: [runs] cli-mail msg list --account user@gmail.com --top 10
```

---

## Tips for AI Assistants

1. **Always verify account exists** before running commands
2. **Confirm before sending/deleting** - show details and wait for approval
3. **Use JSON for processing** - easier to parse and extract data
4. **Handle errors gracefully** - check references/error-handling.md
5. **Provide context** - tell user what you're doing and why
6. **Be specific with queries** - use appropriate search syntax for provider
7. **Remember the conversation** - if user is working with one account, keep using it
