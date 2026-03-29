# cli-mail

[English](#english) | [中文](#中文)

---

<a name="english"></a>
## English

AI-oriented CLI email management tool for Gmail and Outlook. Designed as a bridge between AI agents and email platforms — outputs raw terminal text (markdown/JSON) with no interactive TUI.

### Design Philosophy

- **AI-first**: Default output is markdown text — tables, key-value pairs, structured data that AI agents parse easily.
- **No TUI**: No colors, spinners, or interactive prompts during operation (only during initial OAuth setup).
- **Multi-account**: Manage N accounts across Gmail and Outlook. Each account uses its email address as the default identifier; custom aliases are optional.
- **Full API coverage**: Comprehensive REST API capabilities exposed as CLI commands.
- **Dependency Minimalist**: Only `commander` at runtime; everything else uses Node.js built-ins.

### Prerequisites / 获取 API 凭证 (Client ID)

因为 `cli-mail` 是一个纯本地无服务器的工具，它会直接连接到 Google / Microsoft 的接口。所以你需要去云控制台创建一个“应用”，并获取它的“身份证”（即 **Client ID** 和 **Client Secret**）。

#### Gmail
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project → Enable the **Gmail API**
3. Create OAuth 2.0 credentials (Application type must be **Desktop app** or **Web application**).
   - *If using Web application, set the Authorized redirect URI EXACTLY to: `http://localhost:4088/callback`*
4. Note your `Client ID` and `Client Secret`.

#### Outlook (Microsoft Graph)
1. Go to [Azure Portal → App Registrations](https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps)
2. Register a new application. **IMPORTANT**: For "Supported account types", you MUST choose the 3rd option: *"Accounts in any organizational directory and personal Microsoft accounts"*.
3. Add a Redirect URI: Select **Web** platform and set it EXACTLY to `http://localhost:4088/callback`
4. Under API Permissions, add: `Mail.ReadWrite`, `Mail.Send`, `MailboxSettings.ReadWrite`, `User.Read`
5. Create a client secret in "Certificates & secrets".
6. Note your `Application (client) ID` and the Secret `Value`.

### Installation

```bash
# Install globally via npm
npm install -g @lakphy/cli-mail

# Or build and run from source
git clone https://github.com/Lakphy/cli-mail.git
cd cli-mail
pnpm install
pnpm run build
npm link    # makes `cli-mail` available globally
```

### Configuration & Security

Accounts are securely stored in a local JSON file at `~/.cli-mail/accounts.json`. The file permissions are strictly set to `0600` (read/write by owner only) to protect OAuth tokens.

### AI Skill for Claude Code

We provide a Claude Code skill that teaches AI assistants how to help you use cli-mail effectively. The skill includes:

- Step-by-step setup guidance
- Smart command suggestions based on your intent
- Automatic account management
- Safety confirmations for sensitive operations

**Install the skill:**

```bash
# Install from GitHub repository
npx skills add https://github.com/Lakphy/cli-mail/tree/main/skill

# Or install from local path if you cloned the repo
npx skills add ./cli-mail/skill
```

Once installed, you can simply ask Claude in natural language:
- "帮我查看最新的邮件"
- "发邮件给 bob@example.com"
- "搜索来自老板的未读邮件"

The AI will handle the commands for you with proper confirmations.

---

<a name="中文"></a>
## 中文

面向 AI Agent 设计的 CLI 邮箱管理工具，支持 Gmail 和 Outlook。作为 AI 和邮箱平台之间的桥梁，输出纯净的终端文本（Markdown / JSON），不含任何交互式 TUI。

### 设计理念

- **AI 优先**: 默认输出为 Markdown 格式（表格、键值对等），方便 AI 代理精准解析。
- **无 TUI 干扰**: 运行过程中没有颜色代码、加载动画或交互式提示（仅在初始 OAuth 登录时除外）。
- **多账号支持**: 跨 Gmail 和 Outlook 灵活管理任意数量的账号，默认使用邮箱地址作为标识，也可自定义别名。
- **全量 API 覆盖**: 将两大平台 REST API 的核心功能以原生的 CLI 命令全量暴露。
- **极简依赖**: 运行时仅依赖 `commander`，其余全部使用 Node.js 原生模块实现。

### 前置准备 / 获取 API 凭证 (Client ID)

因为 `cli-mail` 是纯本地运行的命令行工具，没有中心服务器做数据中转，所以需要你自己去官方平台申请一个“应用身份证”（也就是下文提到的 **Client ID** 和 **Client Secret**）。

#### Gmail
1. 访问 [Google Cloud Console](https://console.cloud.google.com/)
2. 创建项目 → 启用 **Gmail API**
3. 创建 OAuth 2.0 凭证（应用类型选择“桌面应用”或“Web 应用”）。
   - *如果是 Web 应用类型，务必将“已授权的重定向 URI”精确设置为: `http://localhost:4088/callback`*
4. 生成后，记录下你的 `Client ID` 和 `Client Secret`。

#### Outlook (Microsoft Graph)
1. 访问 [Azure Portal → App Registrations (应用注册)](https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps)
2. 注册一个新应用。**极其重要**：在“受支持的帐户类型”项，必须选择第 3 项：*“任何组织目录中的帐户和个人 Microsoft 帐户(例如 Skype、Xbox)”*，否则个人邮箱无法登录。
3. 添加重定向 URI: 类型选择 **Web**，地址精确填写为 `http://localhost:4088/callback`
4. 在 API 权限 (API Permissions) 中添加所需权限: `Mail.ReadWrite`, `Mail.Send`, `MailboxSettings.ReadWrite`, `User.Read`
5. 在左侧“证书和密码”中，创建新的客户端密码 (Client secret)。
6. 记录下概览页的 `应用程序(客户端) ID`，以及刚才密码表格里生成的密码 `值 (Value)`。

### 安装指南

```bash
# 全局安装
npm install -g @lakphy/cli-mail

# 或从源码构建运行
git clone https://github.com/Lakphy/cli-mail.git
cd cli-mail
pnpm install
pnpm run build
npm link    # 将 `cli-mail` 命令链接到全局
```

### 配置与安全

账号信息安全地存储在本地 JSON 文件中：`~/.cli-mail/accounts.json`。为保护敏感的 OAuth 令牌，该文件权限会被严格设置为 `0600`（仅所有者可读写）。

### Claude Code AI 技能

我们提供了一个 Claude Code 技能，可以教会 AI 助手如何帮你高效使用 cli-mail。该技能包含：

- 分步安装和配置指导
- 根据你的意图智能推荐命令
- 自动管理多账号
- 敏感操作的安全确认机制

**安装技能：**

```bash
# 从 GitHub 仓库安装
npx skills add https://github.com/Lakphy/cli-mail/tree/main/skill

# 或从本地路径安装（如果你已克隆仓库）
npx skills add ./cli-mail/skill
```

安装后，你可以直接用自然语言向 Claude 提问：
- "帮我查看最新的邮件"
- "发邮件给 bob@example.com"
- "搜索来自老板的未读邮件"

AI 会自动帮你执行相应的命令，并在必要时进行确认。

---

## 🚀 Quick Start / 快速开始

无论是 AI 还是人类，上手都非常简单。
*(💡 提示：如果你还在本地开发阶段没有全局安装，请把下面所有的 `cli-mail` 替换成 `node ./dist/index.mjs`)*

```bash
# 1. Add an account (Browser will open & ask for your Client ID)
# 1. 绑定账号 (终端会要求输入你的 Client ID，并将自动打开浏览器授权)
cli-mail account add gmail          # alias defaults to your email address
cli-mail account add outlook        # same — email address as alias

# Optional: set a custom alias for convenience
# 可选：设置自定义别名
# cli-mail account add gmail --alias personal
# cli-mail account add outlook --alias work

# Optional: tag accounts for grouping
# 可选：为账号添加标签以实现分组
# cli-mail account add gmail --tag work
# cli-mail account add outlook --tag personal
# cli-mail account tag <alias> <tag>       # tag an existing account / 为已有账号设置标签

# 2. List your emails (Markdown table output)
# 2. 查看邮件列表 (输出 Markdown 表格)
cli-mail message list

# 3. Read a specific email
# 3. 阅读指定邮件内容
cli-mail message get <message-id>

# 4. Search emails
# 4. 搜索邮件
cli-mail message search --query "from:boss@company.com is:unread"

# 5. Send an email
# 5. 发送邮件
cli-mail message send --to bob@example.com --subject "Hello" --body "Hi Bob!"

# 6. Read emails as JSON (Ideal for structured AI parsing)
# 6. 以 JSON 格式读取邮件 (非常适合 AI 结构化解析)
cli-mail -f json message list --top 5

# 7. View inbox by group (cross-account)
# 7. 按分组查看收件箱（跨账号）
cli-mail inbox --tag work              # only work-tagged accounts / 仅 work 标签的账号
cli-mail group list                    # list all groups / 列出所有分组
```

---

## 📚 Command Reference / 命令参考

### Global Options / 全局选项

| Flag / 标识 | Description / 描述 |
|---|---|
| `-f, --format <text\|json>` | Output format / 输出格式 (默认 `text` = markdown) |
| `-a, --account <alias>` | Account alias to use / 指定操作的账号别名 |
| `-V, --version` | Show version / 显示版本号 |
| `-h, --help` | Show help / 显示帮助文档 |

### 👤 Account / 账号管理

```bash
cli-mail account add <gmail|outlook>                  # Add / 添加账号 (默认使用邮箱地址作为别名)
cli-mail account add <gmail|outlook> --alias <name>   # Add with custom alias / 添加并自定义别名
cli-mail account add <gmail|outlook> --tag <tag>      # Add with tag for grouping / 添加并设置分组标签
cli-mail account list                                 # List / 列出所有账号
cli-mail account list --tag <tag>                     # List by tag / 按标签筛选账号
cli-mail account remove <alias>                       # Remove / 移除账号
cli-mail account switch <alias>                       # Set default / 设置默认账号
cli-mail account info [alias]                         # Info / 查看账号详情
cli-mail account rename <old-alias> <new-alias>       # Rename / 重命名别名
cli-mail account tag <alias> [tag]                    # Set/show tag / 设置或查看标签
cli-mail account tag <alias> --remove                 # Remove tag / 移除标签
```

### ✉️ Messages / 邮件操作 (Alias: `msg`)

```bash
cli-mail msg list [--folder <id>] [--query <q>] [--top <n>] [--skip <n>] [--page-token <t>]
cli-mail msg get <id>
cli-mail msg raw <id>                # Get raw MIME / 获取原始 MIME 源码
cli-mail msg send --to <addr...> --subject <s> [--body <b>] [--body-file <f>] [--cc <addr...>] [--bcc <addr...>] [--attach <file...>] [--body-type text|html] [--importance low|normal|high]
cli-mail msg reply <id> --body <b> [--reply-all]
cli-mail msg forward <id> --to <addr...> [--body <b>]
cli-mail msg delete <id> [--permanent]
cli-mail msg batch-delete --ids <id1> <id2>...  # Delete multiple / 批量删除
cli-mail msg move <id> --to-folder <folder-id>
cli-mail msg mark <id> [--read] [--unread] [--flagged] [--unflagged]
cli-mail msg search --query <q> [--top <n>]
cli-mail msg trash <id>                # Move to trash / 移入垃圾箱
cli-mail msg untrash <id>              # Restore / 从垃圾箱恢复
cli-mail msg copy <id> --to-folder <id>     # Copy (Outlook only) / 复制邮件
cli-mail msg batch-modify --ids <id...> --add-labels <l...> --remove-labels <l...>  # Gmail only
cli-mail msg import --file <path>      # Import raw MIME (Gmail only) / 导入原始邮件
cli-mail msg insert --file <path>      # Insert without scanning (Gmail only) / 直接插入邮件
```

### 📝 Drafts / 草稿箱

```bash
cli-mail draft list [--top <n>]
cli-mail draft get <id>
cli-mail draft create --to <addr...> --subject <s> [--body <b>] [--cc <addr...>] [--bcc <addr...>] [--body-type text|html]
cli-mail draft update <id> [--to <addr...>] [--subject <s>] [--body <b>] [--cc <addr...>] [--bcc <addr...>] [--body-type text|html]
cli-mail draft send <id>
cli-mail draft delete <id>
```

### 📁 Folders & Labels / 文件夹与标签 (Alias: `label`)

```bash
cli-mail folder list [--parent <id>]
cli-mail folder get <id>
cli-mail folder create --name <n> [--parent <id>]
cli-mail folder update <id> --name <n>
cli-mail folder delete <id>
cli-mail folder messages <id> [--top <n>] # List msgs in folder / 查看文件夹内邮件
cli-mail folder move <id> --to-folder <id>    # Move folder (Outlook only) / 移动文件夹
cli-mail folder copy <id> --to-folder <id>    # Copy folder (Outlook only) / 复制文件夹
```

### 📎 Attachments / 附件 (Alias: `att`)

```bash
cli-mail att list <message-id>
cli-mail att get <message-id> <attachment-id>
cli-mail att download <message-id> <attachment-id> [-o <path>]
cli-mail att add <message-id> --file <path>    # Add to draft (Outlook only)
cli-mail att delete <msg-id> <att-id>          # Delete (Outlook only)
```

### ⚙️ Settings / 设置

```bash
cli-mail settings get
cli-mail settings update --json '<json>'
cli-mail settings vacation get                 # Auto-reply status / 自动回复状态
cli-mail settings vacation set [--enabled] [--disabled] [--message <m>] [--start <d>] [--end <d>]
cli-mail settings forwarding get               # Forwarding / 转发规则 (Gmail only)
cli-mail settings forwarding set --json '<json>'
```

### 🛡️ Rules & Filters / 规则与过滤器 (Alias: `filter`)

```bash
cli-mail rule list
cli-mail rule get <id>
cli-mail rule create --json '<rule-json>'
cli-mail rule update <id> --json '<json>'      # Outlook only
cli-mail rule delete <id>
```

### 🧵 Threads / 会话 (Gmail only)

```bash
cli-mail thread list [--query <q>] [--top <n>]
cli-mail thread get <id>
cli-mail thread modify <id> [--add-labels <l>] [--remove-labels <l>]
cli-mail thread trash <id>
cli-mail thread untrash <id>
cli-mail thread delete <id>
```

### 🏷️ Categories & Features / 分类与其他功能 (Outlook only)

```bash
cli-mail category list                  # List categories / 列出分类
cli-mail category create --name <n> [--color <c>]
cli-mail category update <id> [--name <n>] [--color <c>]
cli-mail category delete <id>

cli-mail focused-inbox list             # Focused inbox rules / 焦点收件箱规则
cli-mail focused-inbox add --email <e> --classify <focused|other>
cli-mail focused-inbox delete <id>

cli-mail mail-tips --addresses <addr...> # Mail tips / 邮件提示信息
```

### 👤 Profile / 用户资料

```bash
cli-mail profile                        # Show profile / 显示用户资料 (email, displayName, etc.)
```

### 📜 History / 邮箱变更记录 (Gmail only)

```bash
cli-mail history --start-history-id <id> [--label-id <id>] [--types <t...>] [--top <n>]
```

### 🔀 Send-As Aliases / 发件别名 (Gmail only)

```bash
cli-mail send-as list                   # List aliases / 列出发件别名
cli-mail send-as get <email>            # Get alias details / 查看别名详情
cli-mail send-as create --email <e> [--display-name <n>] [--reply-to <e>]
cli-mail send-as delete <email>         # Delete alias / 删除别名
```

### 🤝 Delegates / 邮箱委托 (Gmail only)

```bash
cli-mail delegate list                  # List delegates / 列出委托人
cli-mail delegate add --email <e>       # Add delegate / 添加委托人
cli-mail delegate remove <email>        # Remove delegate / 移除委托人
```

### 📨 Forwarding Addresses / 转发地址 (Gmail only, Alias: `fwd-addr`)

```bash
cli-mail forwarding-address list        # List addresses / 列出转发地址
cli-mail forwarding-address add --email <e>  # Add address / 添加转发地址
cli-mail forwarding-address remove <email>   # Remove address / 移除转发地址
```

### 🏷️ Groups / 账号分组

Organize accounts into groups using tags. Accounts without a tag belong to the `default` group.
使用标签将账号组织到不同分组中。没有标签的账号属于 `default` 默认分组。

```bash
cli-mail group list                     # List all groups / 列出所有分组
cli-mail group show <tag>               # Show accounts in a group / 查看分组下的账号
```

### 📥 Inbox / 跨账号收件箱

```bash
cli-mail inbox [--hours <n>] [--since <date>] [--top <n>]                  # All accounts / 所有账号
cli-mail inbox --tag <tag> [--hours <n>] [--since <date>] [--top <n>]      # Filter by tag / 按标签筛选
```

---

## 🛠 Output Format Examples / 输出格式示例

### Text (Markdown) — Default

Lists are rendered as clean markdown tables:
列表会渲染为简洁的 Markdown 表格：

```markdown
| ID | From | Subject | Date | Read |
| --- | --- | --- | --- | --- |
| abc123def | alice@example.com | Project Update | 2024-03-27 | yes |
```

Objects are rendered as bold key-value pairs:
对象会渲染为加粗的键值对：

```markdown
**id**: abc123def
**subject**: Project Update
**from**: alice@example.com
**body**: Hi team, here is the latest update...
```

### JSON

Perfect for AI parsing. Triggered via `-f json` or `--format json`:
支持严格的 JSON 输出，极度适合 AI / 脚本解析调用：

```bash
cli-mail -f json message list
```

```json
[
  {
    "id": "abc123def",
    "from": "alice@example.com",
    "subject": "Project Update",
    "date": "2024-03-27T10:00:00Z",
    "read": "yes"
  }
]
```

Errors are also output as standard JSON to `stderr`:
发生异常时，错误信息会以 JSON 格式输出至 `stderr`：

```json
{
  "error": "Account not found: work",
  "code": "CONFIG_ERROR"
}
```

---

## License

MIT
