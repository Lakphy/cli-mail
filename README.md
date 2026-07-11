# cli-mail

[English](#english) · [中文](#中文)

`cli-mail` is a local, AI-friendly CLI for Gmail and Outlook. It provides Markdown for humans and a stable JSON contract for automation, without a TUI or a hosted relay.

## English

### Requirements

- Node.js 22.12 or newer
- A Gmail Desktop OAuth client or Microsoft Entra public/native client
- The Gmail API or Microsoft Graph delegated permissions enabled for that client

### Install

```bash
npm install -g @lakphy/cli-mail

# From source
pnpm install
pnpm build
npm link
```

### Account setup

#### Gmail

Create an OAuth client with application type **Desktop app** in Google Cloud, enable the Gmail API, and download its credentials JSON. Web OAuth clients are intentionally rejected. Desktop authorization uses the system browser, a random loopback port, `state`, and S256 PKCE.

```bash
cli-mail account add gmail --credentials-file ./gmail-desktop-client.json

# Optional alias/tag
cli-mail account add gmail \
  --credentials-file ./gmail-desktop-client.json \
  --alias personal --tag personal
```

The default grant is least-privilege: `gmail.modify` plus `gmail.settings.basic`. Permanent deletion is unavailable unless you explicitly bind or reauthorize with full mailbox access:

```bash
cli-mail account reauth personal \
  --credentials-file ./gmail-desktop-client.json \
  --full-access
```

See Google's [OAuth for desktop apps](https://developers.google.com/identity/protocols/oauth2/native-app).

#### Outlook

Register a Microsoft Entra desktop/mobile application, configure it as a **public client**, and add `http://localhost` as the system-browser redirect URI. Add delegated permissions `Mail.ReadWrite`, `Mail.Send`, `MailboxSettings.ReadWrite`, and `User.Read`. Do not create or pass a client secret.

```bash
cli-mail account add outlook --client-id <application-client-id> --alias work
```

See Microsoft's [desktop app configuration](https://learn.microsoft.com/entra/identity-platform/scenario-desktop-app-configuration).

### Config migration from 0.1

The first 0.2 read migrates v1 config to v2, writes a `0600` `.v1.bak`, preserves aliases/tags/stable metadata, discards old tokens, and marks accounts `needs_reauth`.

```bash
cli-mail account migration status
cli-mail account reauth <alias> --credentials-file ./gmail-desktop-client.json
cli-mail account reauth <alias> --client-id <outlook-public-client-id>
cli-mail account migration finalize --yes
```

### Common commands

```bash
cli-mail account list
cli-mail account switch <alias>
cli-mail account info [alias]

cli-mail message list --top 20
cli-mail message get <message-id>
cli-mail message search --query 'from:boss@example.com'
cli-mail message raw <message-id>

# Sending is irreversible and requires confirmation
cli-mail message send \
  --to bob@example.com --subject 'Hello' --body 'Hi Bob' --yes
cli-mail message reply <message-id> --body 'Thanks' --yes
cli-mail message forward <message-id> --to team@example.com --yes

# Recoverable by default
cli-mail message delete <message-id>
cli-mail message batch-delete --ids <id-1> <id-2>

# Permanent deletion requires both flags; Gmail also requires --full-access auth
cli-mail message delete <message-id> --permanent --yes
cli-mail message batch-delete --ids <id-1> <id-2> --permanent --yes
```

All irreversible deletes, sends, and config-backup removal require `--yes`. Attachment downloads refuse to overwrite by default; use `--force` only when replacement is intended.

### JSON contract

Use `--format json` for automation. JSON mode writes exactly one document to stdout.

Success (exit `0`):

```json
{
  "ok": true,
  "data": [{ "id": "message-id" }],
  "meta": { "nextToken": "opaque-token" },
  "warnings": []
}
```

Partial success (exit `2`):

```json
{
  "ok": false,
  "partial": true,
  "data": [{ "id": "message-id" }],
  "meta": {},
  "warnings": [],
  "errors": [{ "code": "MESSAGE_FETCH_FAILED", "message": "...", "item": { "id": "..." } }]
}
```

Failure (exit `1`):

```json
{
  "ok": false,
  "error": {
    "code": "CONFIG_ERROR",
    "message": "...",
    "suggestion": "..."
  }
}
```

Continue pagination only with the opaque token returned by the same operation and account:

```bash
cli-mail --format json message list --top 20
cli-mail --format json message list --top 20 --page-token '<data-from-meta.nextToken>'
```

Raw MIME is emitted as exact bytes in the default mode. JSON mode returns `{content, encoding:"base64", mediaType, byteLength}`.

Examples with `jq`:

```bash
cli-mail --format json message list | jq '.data | length'
cli-mail --format json message list | jq -r '.data[].id'
```

### Provider notes

- Gmail search accepts Gmail search syntax.
- Outlook message search uses Graph `$search`/KQL. It is separate from OData filters.
- Outlook IDs use `Prefer: IdType="ImmutableId"`, so moves keep stable IDs.
- Gmail send-as and forwarding-address list/get remain read-only.
- Delegate operations, send-as create/delete, forwarding-address add/remove, and forwarding writes are unsupported by the user OAuth model. Hidden 0.2 migration stubs explain the replacement; they will be removed in 0.3.

### Local security

Configuration lives at `~/.cli-mail/accounts.json` by default. Writes use a cross-process lock, a same-directory temporary file, `fsync`, atomic rename, `0600` permissions, and a `.last-good` recovery copy. OAuth tokens and credentials are redacted from structured API error details.

### Development

```bash
pnpm lint
pnpm typecheck
pnpm test:run
pnpm test:cov
pnpm build

# All local checks
pnpm check
```

## 中文

`cli-mail` 是一个本地运行、面向 AI Agent 的 Gmail / Outlook 命令行客户端。默认输出 Markdown；自动化场景使用稳定的 JSON envelope。工具不提供 TUI，也不会把邮件或令牌转发到中心服务器。

### 环境要求与安装

- Node.js 22.12 及以上
- Gmail 桌面 OAuth 客户端，或 Microsoft Entra 公共/原生客户端

```bash
npm install -g @lakphy/cli-mail
```

### 绑定账号

Gmail 必须使用 Google Cloud 中创建的 **Desktop app** 凭证 JSON；不支持 Web OAuth 客户端：

```bash
cli-mail account add gmail --credentials-file ./gmail-desktop-client.json

# 只有明确需要永久删除能力时才申请完整邮箱权限
cli-mail account reauth <alias> \
  --credentials-file ./gmail-desktop-client.json \
  --full-access
```

Outlook 必须使用 Entra 桌面/移动公共客户端，系统浏览器重定向 URI 为 `http://localhost`，无需也不应传 client secret：

```bash
cli-mail account add outlook --client-id <application-client-id>
```

两家授权流程都会使用系统浏览器、随机 loopback 端口、`state` 和 S256 PKCE。

### 从 0.1 迁移

0.2 会自动把 v1 配置迁移为 v2，备份为权限 `0600` 的 `.v1.bak`。旧 token 不会复制；账号会进入 `needs_reauth`，必须重新绑定：

```bash
cli-mail account migration status
cli-mail account reauth <alias> --credentials-file ./gmail-desktop-client.json
cli-mail account reauth <alias> --client-id <outlook-public-client-id>
cli-mail account migration finalize --yes
```

### 常用操作与安全语义

```bash
cli-mail message list --top 20
cli-mail message get <message-id>
cli-mail message search --query 'from:boss@example.com'

# 发送、回复、转发必须明确确认
cli-mail message send --to bob@example.com --subject '你好' --body '正文' --yes
cli-mail message reply <message-id> --body '收到' --yes

# 普通删除默认进入垃圾箱，可恢复
cli-mail message delete <message-id>
cli-mail message batch-delete --ids <id-1> <id-2>

# 永久删除必须同时提供 --permanent --yes
cli-mail message delete <message-id> --permanent --yes
```

其他不可逆删除同样需要 `--yes`。附件下载默认禁止覆盖已有文件，需要覆盖时显式传 `--force`。

### JSON 输出

```bash
cli-mail --format json message list
```

- 成功：`{ok:true,data,meta,warnings}`，退出码 `0`
- 部分成功：`{ok:false,partial:true,data,meta,warnings,errors}`，退出码 `2`
- 失败：`{ok:false,error:{code,message,...}}`，退出码 `1`
- JSON 模式 stdout 始终只有一个 JSON 文档
- 下一页使用 `meta.nextToken`，并原样传给同一账号、同一命令的 `--page-token`
- raw MIME 在 JSON 中以 base64 和字节数返回；默认模式输出原始字节

### 权限边界

Gmail 普通用户 OAuth 只保留 send-as 查询、forwarding-address 列表和 forwarding 查询等只读能力。delegate、send-as 创建/删除、forwarding-address 添加/移除、forwarding 写入均不在 0.2 的支持范围内；隐藏迁移命令会给出替代操作说明，并将在 0.3 删除。

### 本地安全

默认配置位于 `~/.cli-mail/accounts.json`。写入过程使用跨进程目录锁、临时文件、`fsync`、原子 rename、`0600` 权限与 `.last-good` 恢复副本；结构化错误会隐藏 token、Authorization 和 secret。
