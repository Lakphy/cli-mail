// CLI command registration using Commander.js

import { Command, InvalidArgumentError, Option } from 'commander'
import { setGlobalFormat, type OutputFormat } from './output/formatter.js'
import { setConfigPath } from './config/store.js'
import { setGlobalAccount } from './config/context.js'
import { CliMailError, ConfigError } from './utils/error.js'

// Preserve the existing helper exports without making commands depend on this module.
export {
  getGlobalAccount,
  resetGlobalAccount as _resetGlobalAccount,
} from './config/context.js'

// Commands
import { accountAdd, accountRemove, accountList, accountSwitch, accountInfo, accountRename, accountValidate, accountTag, accountReauth, accountMigrationStatus, accountMigrationFinalize } from './commands/account.js'
import { messageList, messageGet, messageRaw, messageSend, messageReply, messageForward, messageDelete, messageMove, messageMark, messageSearch, messageUntrash, messageBatchDelete, messageImport, messageCopy, messageTrash, messageBatchModify, messageInsert, messageRecent, messageAll } from './commands/message.js'
import { draftList, draftGet, draftCreate, draftUpdate, draftSend, draftDelete } from './commands/draft.js'
import { folderList, folderGet, folderCreate, folderUpdate, folderDelete, folderMessages, folderMove, folderCopy } from './commands/folder.js'
import { attachmentList, attachmentGet, attachmentDownload, attachmentAdd, attachmentDelete } from './commands/attachment.js'
import { ruleList, ruleGet, ruleCreate, ruleUpdate, ruleDelete } from './commands/rule.js'
import { settingsGet, settingsUpdate, vacationGet, vacationSet, autoReplyGet, autoReplySet, forwardingGet, mailTipsGet, focusedInboxList, focusedInboxAdd, focusedInboxDelete } from './commands/settings.js'
import { threadList, threadGet, threadModify, threadTrash, threadUntrash, threadDelete } from './commands/thread.js'
import { categoryList, categoryCreate, categoryUpdate, categoryDelete } from './commands/category.js'
import { profileGet } from './commands/profile.js'
import { historyList } from './commands/history.js'
import { sendAsList, sendAsGet } from './commands/send-as.js'
import { fwdAddrList } from './commands/forwarding-address.js'
import { groupList, groupShow } from './commands/group.js'


export function createCli(): Command {
  const program = new Command()
    .name('cli-mail')
    .description('AI-oriented CLI email management tool for Gmail and Outlook')
    .version(__VERSION__)
    .addOption(new Option('-f, --format <format>', 'Output format').choices(['markdown', 'json']).default('markdown'))
    .option('-a, --account <alias>', 'Account alias to use')
    .option('-c, --config <path>', 'Path to config file (default: ~/.cli-mail/accounts.json)')
    .hook('preAction', (thisCommand) => {
      const opts = thisCommand.opts()
      if (opts.config) {
        setConfigPath(opts.config)
      }
      if (opts.format) {
        setGlobalFormat(opts.format as OutputFormat)
      }
      if (opts.account) {
        setGlobalAccount(opts.account)
      }
    })

  // ==================== Account ====================
  const account = program.command('account').description('Manage email accounts')

  account
    .command('add <provider>')
    .description('Add a new email account (gmail or outlook)')
    .option('--alias <alias>', 'Custom alias for the account')
    .option('--tag <tag>', 'Tag for grouping accounts (e.g. work, personal)')
    .option('--credentials-file <path>', 'Gmail Desktop OAuth client credentials JSON')
    .option('--client-id <id>', 'Outlook public client application ID')
    .option('--full-access', 'Request Gmail full mailbox access (enables permanent delete)')
    .action((provider: string, opts) => accountAdd(provider, opts))

  account
    .command('reauth [alias]')
    .description('Re-authorize an existing account')
    .option('--credentials-file <path>', 'Gmail Desktop OAuth client credentials JSON')
    .option('--client-id <id>', 'Outlook public client application ID')
    .option('--full-access', 'Request Gmail full mailbox access (enables permanent delete)')
    .action((alias: string | undefined, opts) => accountReauth(alias, opts))

  account
    .command('remove <alias>')
    .description('Remove a saved account')
    .requiredOption('--yes', 'Confirm removal without an interactive prompt')
    .action((alias: string, opts) => {
      requireYes(opts, 'remove this account')
      return accountRemove(alias)
    })

  account
    .command('list')
    .description('List all configured accounts')
    .option('--tag <tag>', 'Filter accounts by tag')
    .action((opts: { tag?: string }) => accountList(opts))

  account
    .command('switch <alias>')
    .description('Set the default account')
    .action((alias: string) => accountSwitch(alias))

  account
    .command('info [alias]')
    .description('Show account details')
    .action((alias?: string) => accountInfo(alias))

  account
    .command('rename <old-alias> <new-alias>')
    .description('Rename an account alias')
    .action((oldAlias: string, newAlias: string) => accountRename(oldAlias, newAlias))

  account
    .command('validate [alias]')
    .description('Validate account configuration and tokens')
    .action((alias?: string) => accountValidate(alias))

  account
    .command('tag <alias> [tag]')
    .description('Set, show, or remove a tag on an account')
    .option('--remove', 'Remove the tag from the account')
    .action((alias: string, tag?: string, opts?: { remove?: boolean }) => accountTag(alias, tag, opts?.remove))

  const migration = account.command('migration').description('Inspect or finalize config migration')
  migration.command('status').description('Show config migration status').action(() => accountMigrationStatus())
  migration
    .command('finalize')
    .description('Delete the v1 migration backup after all accounts are rebound')
    .requiredOption('--yes', 'Confirm permanent backup removal')
    .action((opts) => {
      requireYes(opts, 'delete the migration backup')
      return accountMigrationFinalize()
    })

  // ==================== Message ====================
  const message = program.command('message').alias('msg').description('Email message operations')

  message
    .command('list')
    .description('List messages')
    .option('--folder <id>', 'Folder/Label ID to list from')
    .option('--query <query>', 'Search query')
    .option('--top <n>', 'Number of messages to return', positiveInteger, '20')
    .option('--skip <n>', 'Number of messages to skip', nonNegativeInteger)
    .option('--page-token <token>', 'Opaque token returned in meta.nextToken')
    .addOption(accountOption())
    .action((opts) => messageList(opts))

  message
    .command('get <id>')
    .description('Get a message by ID')
    .addOption(accountOption())
    .action((id: string, opts) => messageGet(id, opts))

  message
    .command('raw <id>')
    .description('Get raw MIME content of a message')
    .addOption(accountOption())
    .action((id: string, opts) => messageRaw(id, opts))

  message
    .command('send')
    .description('Send a new message')
    .requiredOption('--to <addresses...>', 'Recipient email addresses')
    .requiredOption('--subject <subject>', 'Message subject')
    .option('--body <body>', 'Message body text')
    .option('--body-file <path>', 'Read body from file')
    .option('--cc <addresses...>', 'CC recipients')
    .option('--bcc <addresses...>', 'BCC recipients')
    .option('--attach <files...>', 'File paths to attach')
    .option('--body-type <type>', 'Body type: text or html', choice(['text', 'html'], 'body type'), 'text')
    .option('--importance <level>', 'Importance: low, normal, high', choice(['low', 'normal', 'high'], 'importance'), 'normal')
    .requiredOption('--yes', 'Confirm sending the message')
    .addOption(accountOption())
    .action((opts) => messageSend(opts))

  message
    .command('reply <id>')
    .description('Reply to a message')
    .requiredOption('--body <body>', 'Reply body')
    .option('--reply-all', 'Reply to all recipients')
    .requiredOption('--yes', 'Confirm sending the reply')
    .addOption(accountOption())
    .action((id: string, opts) => messageReply(id, opts))

  message
    .command('forward <id>')
    .description('Forward a message')
    .requiredOption('--to <addresses...>', 'Forward to addresses')
    .option('--body <body>', 'Additional message body')
    .requiredOption('--yes', 'Confirm forwarding the message')
    .addOption(accountOption())
    .action((id: string, opts) => messageForward(id, opts))

  message
    .command('delete <id>')
    .description('Delete a message (move to trash by default)')
    .option('--permanent', 'Permanently delete')
    .option('--yes', 'Confirm permanent deletion')
    .addOption(accountOption())
    .action((id: string, opts) => {
      if (opts.permanent) requireYes(opts, 'permanently delete this message')
      return messageDelete(id, opts)
    })

  message
    .command('move <id>')
    .description('Move a message to a folder')
    .requiredOption('--to-folder <id>', 'Destination folder/label ID')
    .addOption(accountOption())
    .action((id: string, opts) => messageMove(id, opts))

  message
    .command('mark <id>')
    .description('Mark a message (read/unread/flagged/unflagged)')
    .option('--read', 'Mark as read')
    .option('--unread', 'Mark as unread')
    .option('--flagged', 'Mark as flagged/starred')
    .option('--unflagged', 'Remove flag/star')
    .addOption(accountOption())
    .action((id: string, opts) => messageMark(id, opts))

  message
    .command('search')
    .description('Search messages')
    .requiredOption('--query <query>', 'Search query')
    .option('--top <n>', 'Number of results', positiveInteger, '20')
    .option('--page-token <token>', 'Opaque token returned in meta.nextToken')
    .addOption(accountOption())
    .action((opts) => messageSearch(opts))

  message
    .command('untrash <id>')
    .description('Restore a message from trash (Gmail only)')
    .addOption(accountOption())
    .action((id: string, opts) => messageUntrash(id, opts))

  message
    .command('batch-delete')
    .description('Move messages to trash by default')
    .requiredOption('--ids <ids...>', 'Message IDs to delete')
    .option('--permanent', 'Permanently delete messages')
    .option('--yes', 'Confirm permanent deletion')
    .addOption(accountOption())
    .action((opts) => {
      if (opts.permanent) requireYes(opts, 'permanently delete these messages')
      return messageBatchDelete(opts)
    })

  message
    .command('import')
    .description('Import a raw MIME message (Gmail only)')
    .requiredOption('--file <path>', 'Path to raw MIME file')
    .addOption(accountOption())
    .action((opts) => messageImport(opts))

  message
    .command('copy <id>')
    .description('Copy a message to a folder (Outlook only)')
    .requiredOption('--to-folder <id>', 'Destination folder ID')
    .addOption(accountOption())
    .action((id: string, opts) => messageCopy(id, opts))

  message
    .command('trash <id>')
    .description('Move a message to trash')
    .addOption(accountOption())
    .action((id: string, opts) => messageTrash(id, opts))

  message
    .command('batch-modify')
    .description('Batch modify labels on messages (Gmail only)')
    .requiredOption('--ids <ids...>', 'Message IDs')
    .option('--add-labels <labels...>', 'Labels to add')
    .option('--remove-labels <labels...>', 'Labels to remove')
    .addOption(accountOption())
    .action((opts) => messageBatchModify(opts))

  message
    .command('insert')
    .description('Insert a raw MIME message without scanning (Gmail only)')
    .requiredOption('--file <path>', 'Path to raw MIME file')
    .addOption(accountOption())
    .action((opts) => messageInsert(opts))

  message
    .command('recent')
    .description('List recent messages by time range')
    .option('--hours <n>', 'Number of hours to look back (default: 24)', positiveInteger)
    .option('--since <date>', 'ISO 8601 date to start from')
    .option('--top <n>', 'Number of messages to return', positiveInteger, '20')
    .option('--page-token <token>', 'Opaque token returned in meta.nextToken')
    .addOption(accountOption())
    .action((opts) => messageRecent(opts))

  // ==================== Inbox All (cross-account) ====================
  program
    .command('inbox')
    .description('Cross-account inbox aggregation')
    .option('--hours <n>', 'Number of hours to look back (default: 24)', positiveInteger)
    .option('--since <date>', 'ISO 8601 date to start from')
    .option('--top <n>', 'Messages per account', positiveInteger, '10')
    .option('--tag <tag>', 'Filter by account tag (e.g. work, personal)')
    .action((opts) => messageAll(opts))

  // ==================== Group ====================
  const group = program.command('group').description('View accounts organized by tags')

  group
    .command('list')
    .description('List all account groups/tags')
    .action(() => groupList())

  group
    .command('show <tag>')
    .description('Show accounts in a specific group/tag')
    .action((tag: string) => groupShow(tag))

  // ==================== Draft ====================
  const draft = program.command('draft').description('Draft operations')

  draft
    .command('list')
    .description('List drafts')
    .option('--top <n>', 'Number of drafts', positiveInteger, '20')
    .option('--page-token <token>', 'Opaque token returned in meta.nextToken')
    .addOption(accountOption())
    .action((opts) => draftList(opts))

  draft
    .command('get <id>')
    .description('Get a draft by ID')
    .addOption(accountOption())
    .action((id: string, opts) => draftGet(id, opts))

  draft
    .command('create')
    .description('Create a new draft')
    .requiredOption('--to <addresses...>', 'Recipient addresses')
    .requiredOption('--subject <subject>', 'Subject')
    .option('--body <body>', 'Body text')
    .option('--cc <addresses...>', 'CC recipients')
    .option('--bcc <addresses...>', 'BCC recipients')
    .option('--body-type <type>', 'Body type: text or html', choice(['text', 'html'], 'body type'), 'text')
    .addOption(accountOption())
    .action((opts) => draftCreate(opts))

  draft
    .command('update <id>')
    .description('Update a draft')
    .option('--to <addresses...>', 'Recipient addresses')
    .option('--subject <subject>', 'Subject')
    .option('--body <body>', 'Body text')
    .option('--cc <addresses...>', 'CC recipients')
    .option('--bcc <addresses...>', 'BCC recipients')
    .option('--body-type <type>', 'Body type: text or html', choice(['text', 'html'], 'body type'))
    .addOption(accountOption())
    .action((id: string, opts) => draftUpdate(id, opts))

  draft
    .command('send <id>')
    .description('Send a draft')
    .requiredOption('--yes', 'Confirm sending the draft')
    .addOption(accountOption())
    .action((id: string, opts) => draftSend(id, opts))

  draft
    .command('delete <id>')
    .description('Delete a draft')
    .requiredOption('--yes', 'Confirm permanent draft deletion')
    .addOption(accountOption())
    .action((id: string, opts) => {
      requireYes(opts, 'delete this draft')
      return draftDelete(id, opts)
    })

  // ==================== Folder/Label ====================
  const folder = program.command('folder').alias('label').description('Folder (Outlook) / Label (Gmail) operations')

  folder
    .command('list')
    .description('List folders/labels')
    .option('--parent <id>', 'Parent folder ID (Outlook only)')
    .option('--top <n>', 'Number of folders', positiveInteger, '100')
    .option('--page-token <token>', 'Opaque token returned in meta.nextToken')
    .addOption(accountOption())
    .action((opts) => folderList(opts))

  folder
    .command('get <id>')
    .description('Get a folder/label by ID')
    .addOption(accountOption())
    .action((id: string, opts) => folderGet(id, opts))

  folder
    .command('create')
    .description('Create a new folder/label')
    .requiredOption('--name <name>', 'Folder/label name')
    .option('--parent <id>', 'Parent folder ID')
    .addOption(accountOption())
    .action((opts) => folderCreate(opts))

  folder
    .command('update <id>')
    .description('Update a folder/label name')
    .requiredOption('--name <name>', 'New name')
    .addOption(accountOption())
    .action((id: string, opts) => folderUpdate(id, opts))

  folder
    .command('delete <id>')
    .description('Delete a folder/label')
    .requiredOption('--yes', 'Confirm folder/label deletion')
    .addOption(accountOption())
    .action((id: string, opts) => {
      requireYes(opts, 'delete this folder or label')
      return folderDelete(id, opts)
    })

  folder
    .command('messages <id>')
    .description('List messages in a folder/label')
    .option('--top <n>', 'Number of messages', positiveInteger, '20')
    .option('--page-token <token>', 'Opaque token returned in meta.nextToken')
    .addOption(accountOption())
    .action((id: string, opts) => folderMessages(id, opts))

  folder
    .command('move <id>')
    .description('Move a folder as child of another (Outlook only)')
    .requiredOption('--to-folder <id>', 'Destination parent folder ID')
    .addOption(accountOption())
    .action((id: string, opts) => folderMove(id, opts))

  folder
    .command('copy <id>')
    .description('Copy a folder (Outlook only)')
    .requiredOption('--to-folder <id>', 'Destination parent folder ID')
    .addOption(accountOption())
    .action((id: string, opts) => folderCopy(id, opts))

  // ==================== Attachment ====================
  const attachment = program.command('attachment').alias('att').description('Attachment operations')

  attachment
    .command('list <message-id>')
    .description('List attachments of a message')
    .addOption(accountOption())
    .action((messageId: string, opts) => attachmentList(messageId, opts))

  attachment
    .command('get <message-id> <attachment-id>')
    .description('Get attachment info')
    .addOption(accountOption())
    .action((messageId: string, attachmentId: string, opts) => attachmentGet(messageId, attachmentId, opts))

  attachment
    .command('download <message-id> <attachment-id>')
    .description('Download an attachment')
    .option('-o, --output <path>', 'Output file path')
    .option('--force', 'Overwrite an existing file')
    .addOption(accountOption())
    .action((messageId: string, attachmentId: string, opts) => attachmentDownload(messageId, attachmentId, opts))

  attachment
    .command('add <message-id>')
    .description('Add an attachment to a draft/message (Outlook only)')
    .requiredOption('--file <path>', 'File path to attach')
    .option('--name <name>', 'Override file name')
    .addOption(accountOption())
    .action((messageId: string, opts) => attachmentAdd(messageId, opts))

  attachment
    .command('delete <message-id> <attachment-id>')
    .description('Delete an attachment from a message (Outlook only)')
    .requiredOption('--yes', 'Confirm attachment deletion')
    .addOption(accountOption())
    .action((messageId: string, attachmentId: string, opts) => {
      requireYes(opts, 'delete this attachment')
      return attachmentDelete(messageId, attachmentId, opts)
    })

  // ==================== Rule/Filter ====================
  const rule = program.command('rule').alias('filter').description('Mail rules (Outlook) / Filters (Gmail)')

  rule
    .command('list')
    .description('List rules/filters')
    .addOption(accountOption())
    .action((opts) => ruleList(opts))

  rule
    .command('get <id>')
    .description('Get a rule/filter by ID')
    .addOption(accountOption())
    .action((id: string, opts) => ruleGet(id, opts))

  rule
    .command('create')
    .description('Create a rule/filter from JSON')
    .requiredOption('--json <json>', 'Rule definition as JSON string')
    .option('--yes', 'Confirm a rule with permanent-delete actions')
    .addOption(accountOption())
    .action((opts) => ruleCreate(opts))

  rule
    .command('update <id>')
    .description('Update a rule (Outlook only)')
    .requiredOption('--json <json>', 'Rule update as JSON string')
    .option('--yes', 'Confirm a rule with permanent-delete actions')
    .addOption(accountOption())
    .action((id: string, opts) => ruleUpdate(id, opts))

  rule
    .command('delete <id>')
    .description('Delete a rule/filter')
    .requiredOption('--yes', 'Confirm rule/filter deletion')
    .addOption(accountOption())
    .action((id: string, opts) => {
      requireYes(opts, 'delete this rule or filter')
      return ruleDelete(id, opts)
    })

  // ==================== Settings ====================
  const settings = program.command('settings').description('Mailbox settings')

  settings
    .command('get')
    .description('Get mailbox settings')
    .addOption(accountOption())
    .action((opts) => settingsGet(opts))

  settings
    .command('update')
    .description('Update mailbox settings')
    .requiredOption('--json <json>', 'Settings as JSON string')
    .addOption(accountOption())
    .action((opts) => settingsUpdate(opts))

  const vacation = settings.command('vacation').description('Vacation/auto-reply settings')

  vacation
    .command('get')
    .description('Get vacation settings')
    .addOption(accountOption())
    .action((opts) => vacationGet(opts))

  vacation
    .command('set')
    .description('Set vacation auto-reply')
    .option('--enabled', 'Enable auto-reply')
    .option('--disabled', 'Disable auto-reply')
    .option('--message <message>', 'Auto-reply message')
    .option('--start <date>', 'Start date (ISO format)')
    .option('--end <date>', 'End date (ISO format)')
    .addOption(accountOption())
    .action((opts: { enabled?: boolean; disabled?: boolean; message?: string; start?: string; end?: string; account?: string }) => {
      if (Boolean(opts.enabled) === Boolean(opts.disabled)) {
        throw new ConfigError('Specify exactly one of --enabled or --disabled')
      }
      return vacationSet({
        enabled: opts.enabled === true && !opts.disabled,
        message: opts.message,
        start: opts.start,
        end: opts.end,
        account: opts.account,
      })
    })

  const autoReply = settings.command('auto-reply').description('Auto-reply settings')

  autoReply
    .command('get')
    .description('Get auto-reply settings')
    .addOption(accountOption())
    .action((opts) => autoReplyGet(opts))

  autoReply
    .command('set')
    .description('Set auto-reply from JSON')
    .requiredOption('--json <json>', 'Auto-reply settings as JSON string')
    .addOption(accountOption())
    .action((opts) => autoReplySet(opts))

  const forwarding = settings.command('forwarding').description('Forwarding settings (Gmail)')

  forwarding
    .command('get')
    .description('Get forwarding settings')
    .addOption(accountOption())
    .action((opts) => forwardingGet(opts))

  forwarding
    .command('set', { hidden: true })
    .description('Removed in 0.2: consumer OAuth cannot safely manage forwarding')
    .requiredOption('--json <json>', 'Forwarding settings as JSON string')
    .addOption(accountOption())
    .action(() => removedCommand('settings forwarding set', 'Configure forwarding in Gmail settings.'))

  // ==================== Thread (Gmail-specific) ====================
  const thread = program.command('thread').description('Thread operations (Gmail only)')

  thread
    .command('list')
    .description('List threads')
    .option('--query <query>', 'Search query')
    .option('--top <n>', 'Number of threads', positiveInteger, '20')
    .option('--page-token <token>', 'Opaque token returned in meta.nextToken')
    .addOption(accountOption())
    .action((opts) => threadList(opts))

  thread
    .command('get <id>')
    .description('Get a thread by ID')
    .addOption(accountOption())
    .action((id: string, opts) => threadGet(id, opts))

  thread
    .command('modify <id>')
    .description('Modify thread labels')
    .option('--add-labels <labels...>', 'Labels to add')
    .option('--remove-labels <labels...>', 'Labels to remove')
    .addOption(accountOption())
    .action((id: string, opts) => threadModify(id, opts))

  thread
    .command('trash <id>')
    .description('Move thread to trash')
    .addOption(accountOption())
    .action((id: string, opts) => threadTrash(id, opts))

  thread
    .command('untrash <id>')
    .description('Restore thread from trash')
    .addOption(accountOption())
    .action((id: string, opts) => threadUntrash(id, opts))

  thread
    .command('delete <id>')
    .description('Permanently delete a thread')
    .requiredOption('--yes', 'Confirm permanent thread deletion')
    .addOption(accountOption())
    .action((id: string, opts) => {
      requireYes(opts, 'permanently delete this thread')
      return threadDelete(id, opts)
    })

  // ==================== Category (Outlook-specific) ====================
  const category = program.command('category').description('Category operations (Outlook only)')

  category
    .command('list')
    .description('List categories')
    .addOption(accountOption())
    .action((opts) => categoryList(opts))

  category
    .command('create')
    .description('Create a category')
    .requiredOption('--name <name>', 'Category name')
    .option('--color <color>', 'Category color preset')
    .addOption(accountOption())
    .action((opts) => categoryCreate(opts))

  category
    .command('update <id>')
    .description('Update a category')
    .option('--name <name>', 'New name')
    .option('--color <color>', 'New color preset')
    .addOption(accountOption())
    .action((id: string, opts) => categoryUpdate(id, opts))

  category
    .command('delete <id>')
    .description('Delete a category')
    .requiredOption('--yes', 'Confirm category deletion')
    .addOption(accountOption())
    .action((id: string, opts) => {
      requireYes(opts, 'delete this category')
      return categoryDelete(id, opts)
    })

  // ==================== Mail Tips (Outlook) ====================
  program
    .command('mail-tips')
    .description('Get mail tips for addresses (Outlook only)')
    .requiredOption('--addresses <addresses...>', 'Email addresses to check')
    .addOption(accountOption())
    .action((opts) => mailTipsGet(opts))

  // ==================== Focused Inbox (Outlook) ====================
  const focusedInbox = program.command('focused-inbox').description('Focused Inbox overrides (Outlook only)')

  focusedInbox
    .command('list')
    .description('List Focused Inbox overrides')
    .addOption(accountOption())
    .action((opts) => focusedInboxList(opts))

  focusedInbox
    .command('add')
    .description('Add a Focused Inbox override')
    .requiredOption('--email <email>', 'Sender email address')
    .requiredOption('--classify <classify>', 'Classify as: focused or other', choice(['focused', 'other'], 'classification'))
    .addOption(accountOption())
    .action((opts) => focusedInboxAdd(opts))

  focusedInbox
    .command('delete <id>')
    .description('Delete a Focused Inbox override')
    .requiredOption('--yes', 'Confirm Focused Inbox override deletion')
    .addOption(accountOption())
    .action((id: string, opts) => {
      requireYes(opts, 'delete this Focused Inbox override')
      return focusedInboxDelete(id, opts)
    })

  // ==================== Profile ====================
  program
    .command('profile')
    .description('Show user profile info')
    .addOption(accountOption())
    .action((opts) => profileGet(opts))

  // ==================== History (Gmail) ====================
  program
    .command('history')
    .description('List mailbox change history (Gmail only)')
    .requiredOption('--start-history-id <id>', 'History ID to start from')
    .option('--label-id <id>', 'Filter by label ID')
    .option('--types <types...>', 'History types: messageAdded, messageDeleted, labelAdded, labelRemoved', choice([
      'messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved',
    ], 'history type'))
    .option('--top <n>', 'Max results', positiveInteger)
    .option('--page-token <token>', 'Page token')
    .addOption(accountOption())
    .action((opts) => historyList(opts))

  // ==================== Send-As (Gmail) ====================
  const sendAs = program.command('send-as').description('Send-as alias management (Gmail only)')

  sendAs
    .command('list')
    .description('List send-as aliases')
    .addOption(accountOption())
    .action((opts) => sendAsList(opts))

  sendAs
    .command('get <email>')
    .description('Get a send-as alias')
    .addOption(accountOption())
    .action((email: string, opts) => sendAsGet(email, opts))

  sendAs
    .command('create', { hidden: true })
    .description('Removed in 0.2: consumer OAuth cannot create send-as aliases')
    .requiredOption('--email <email>', 'Email address')
    .option('--display-name <name>', 'Display name')
    .option('--reply-to <email>', 'Reply-to address')
    .addOption(accountOption())
    .action(() => removedCommand('send-as create', 'Create the alias in Gmail settings.'))

  sendAs
    .command('delete <email>', { hidden: true })
    .description('Removed in 0.2: consumer OAuth cannot delete send-as aliases')
    .addOption(accountOption())
    .action(() => removedCommand('send-as delete', 'Delete the alias in Gmail settings.'))

  // ==================== Delegate (Gmail) ====================
  const delegate = program
    .command('delegate', { hidden: true })
    .description('Removed in 0.2: delegate management requires administrative authorization')

  delegate
    .command('list')
    .description('Removed in 0.2')
    .addOption(accountOption())
    .action(() => removedCommand('delegate', 'Manage delegates from Gmail or Google Workspace Admin.'))

  delegate
    .command('add')
    .description('Removed in 0.2')
    .requiredOption('--email <email>', 'Delegate email address')
    .addOption(accountOption())
    .action(() => removedCommand('delegate', 'Manage delegates from Gmail or Google Workspace Admin.'))

  delegate
    .command('remove <email>')
    .description('Removed in 0.2')
    .addOption(accountOption())
    .action(() => removedCommand('delegate', 'Manage delegates from Gmail or Google Workspace Admin.'))

  // ==================== Forwarding Address (Gmail) ====================
  const fwdAddr = program.command('forwarding-address').alias('fwd-addr').description('Forwarding address management (Gmail only)')

  fwdAddr
    .command('list')
    .description('List forwarding addresses')
    .addOption(accountOption())
    .action((opts) => fwdAddrList(opts))

  fwdAddr
    .command('add', { hidden: true })
    .description('Removed in 0.2: consumer OAuth cannot add forwarding addresses')
    .requiredOption('--email <email>', 'Forwarding email address')
    .addOption(accountOption())
    .action(() => removedCommand('forwarding-address add', 'Add the address in Gmail settings.'))

  fwdAddr
    .command('remove <email>', { hidden: true })
    .description('Removed in 0.2: consumer OAuth cannot remove forwarding addresses')
    .addOption(accountOption())
    .action(() => removedCommand('forwarding-address remove', 'Remove the address in Gmail settings.'))

  return program
}

function positiveInteger(value: string): string {
  if (!/^\d+$/.test(value) || Number(value) < 1 || !Number.isSafeInteger(Number(value))) {
    throw new InvalidArgumentError('must be a positive integer')
  }
  return value
}

function nonNegativeInteger(value: string): string {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new InvalidArgumentError('must be a non-negative integer')
  }
  return value
}

function choice<const T extends string>(values: readonly T[], label: string): (value: string) => T {
  return (value: string) => {
    if (!values.includes(value as T)) {
      throw new InvalidArgumentError(`${label} must be one of: ${values.join(', ')}`)
    }
    return value as T
  }
}

function accountOption(): Option {
  return new Option('-a, --account <alias>', 'Account alias')
}

function requireYes(options: { yes?: boolean }, operation: string): void {
  if (!options.yes) {
    throw new ConfigError(`Refusing to ${operation} without explicit --yes confirmation`)
  }
}

function removedCommand(command: string, replacement: string): never {
  throw new CliMailError(
    `Command "${command}" was removed in cli-mail 0.2 because it requires unsupported administrative authorization. ${replacement}`,
    'COMMAND_REMOVED',
  )
}
