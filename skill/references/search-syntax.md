# Search Query Syntax Reference

## Gmail Search Syntax

Gmail uses a powerful query language for searching emails.

### Basic Operators

- `from:sender@example.com` - Emails from specific sender
- `to:recipient@example.com` - Emails to specific recipient
- `subject:keyword` - Search in subject line
- `has:attachment` - Emails with attachments
- `filename:report.pdf` - Specific attachment filename
- `is:unread` - Unread emails
- `is:read` - Read emails
- `is:starred` - Starred emails
- `is:important` - Important emails
- `label:work` - Emails with specific label

### Date Operators

- `after:2024/01/01` - After specific date
- `before:2024/12/31` - Before specific date
- `newer_than:7d` - Newer than 7 days (d=days, m=months, y=years)
- `older_than:1m` - Older than 1 month

### Logical Operators

- `keyword1 OR keyword2` - Either keyword
- `keyword1 AND keyword2` - Both keywords (default behavior)
- `-keyword` - Exclude keyword
- `"exact phrase"` - Exact phrase match

### Examples

```bash
# Unread emails from boss
cli-mail msg search --query "from:boss@company.com is:unread"

# Emails with PDF attachments from last week
cli-mail msg search --query "has:attachment filename:pdf newer_than:7d"

# Important emails not yet read
cli-mail msg search --query "is:important is:unread"

# Emails about project excluding meetings
cli-mail msg search --query "subject:project -meeting"
```

## Outlook Search Syntax

Outlook uses OData query syntax (similar but different from Gmail).

### Basic Filters

- `from/emailAddress/address eq 'sender@example.com'` - From specific sender
- `toRecipients/any(r:r/emailAddress/address eq 'recipient@example.com')` - To specific recipient
- `subject eq 'Meeting'` - Exact subject match
- `contains(subject, 'keyword')` - Subject contains keyword
- `hasAttachments eq true` - Has attachments
- `isRead eq false` - Unread emails
- `importance eq 'high'` - High importance

### Date Filters

- `receivedDateTime ge 2024-01-01T00:00:00Z` - After date (ge = greater or equal)
- `receivedDateTime le 2024-12-31T23:59:59Z` - Before date (le = less or equal)

### Logical Operators

- `and` - Both conditions
- `or` - Either condition
- `not` - Negate condition

### Examples

```bash
# Unread emails from boss
cli-mail msg search --query "from/emailAddress/address eq 'boss@company.com' and isRead eq false"

# Emails with attachments received today
cli-mail msg search --query "hasAttachments eq true and receivedDateTime ge 2024-03-27T00:00:00Z"

# High importance unread emails
cli-mail msg search --query "importance eq 'high' and isRead eq false"

# Emails containing keyword in subject
cli-mail msg search --query "contains(subject, 'urgent')"
```

## Quick Reference Table

| Need | Gmail | Outlook |
|------|-------|---------|
| Unread | `is:unread` | `isRead eq false` |
| Has attachment | `has:attachment` | `hasAttachments eq true` |
| From sender | `from:email@example.com` | `from/emailAddress/address eq 'email@example.com'` |
| Subject contains | `subject:keyword` | `contains(subject, 'keyword')` |
| After date | `after:2024/01/01` | `receivedDateTime ge 2024-01-01T00:00:00Z` |
| High importance | `is:important` | `importance eq 'high'` |

## Tips for AI Assistants

1. **Detect provider first**: Check which account the user is using (Gmail or Outlook) before constructing queries
2. **Simplify for users**: When user says "unread emails from boss", translate to appropriate syntax
3. **Combine filters**: Users often want multiple conditions - use AND/OR appropriately
4. **Date handling**: Convert relative dates ("last week", "yesterday") to absolute dates in queries
5. **Test queries**: If a query fails, try simplifying it or breaking it into parts
