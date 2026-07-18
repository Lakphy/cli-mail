# Search syntax

Determine the account provider before constructing a query. Gmail and Outlook queries are not interchangeable.

## Gmail

Pass Gmail search syntax to `message search --query`.

| Intent | Query |
|---|---|
| Sender | `from:sender@example.com` |
| Recipient | `to:recipient@example.com` |
| Subject | `subject:invoice` |
| Unread | `is:unread` |
| Starred | `is:starred` |
| Attachment | `has:attachment` |
| Filename | `filename:report.pdf` |
| Newer than seven days | `newer_than:7d` |
| Date range | `after:2026/01/01 before:2026/02/01` |
| Exclusion | `subject:project -meeting` |

Example:

```bash
cli-mail message search \
  --account personal \
  --query 'from:boss@example.com is:unread has:attachment'
```

## Outlook

`message search` uses Microsoft Graph `$search` with Keyword Query Language (KQL), not OData `$filter`. Unqualified text searches the default message fields (`from`, `subject`, and `body`). Useful property queries include:

| Intent | KQL query |
|---|---|
| Sender | `from:sender@example.com` |
| Subject | `subject:invoice` |
| Attachment | `hasAttachments:true` |
| Exact phrase | `"quarterly report"` |
| Combine criteria | `from:sender@example.com subject:invoice` |

Example:

```bash
cli-mail message search \
  --account work \
  --query 'from:boss@example.com subject:budget'
```

Do not pass expressions such as `isRead eq false` or `contains(subject, ...)` to `message search`; those are OData filter expressions and are not this command's contract. If the requested Outlook property is not supported by KQL, explain the limitation and narrow the result with a supported query rather than inventing syntax.

Provider references: [Gmail search and filtering](https://developers.google.com/workspace/gmail/api/guides/filtering) and [Microsoft Graph `$search` for messages](https://learn.microsoft.com/en-us/graph/search-query-parameter#use-search-on-message-collections).

## Query failure workflow

1. Confirm the provider.
2. Remove syntax from the other provider.
3. Simplify to one supported criterion.
4. Add criteria back one at a time.
5. Preserve `meta.nextToken` pagination only with the exact same query and account.
