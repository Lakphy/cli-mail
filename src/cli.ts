// CLI command registration using Commander.js

import { Command } from 'commander'
import { setGlobalFormat, type OutputFormat } from './output/formatter.js'

// Module-level global account alias, set by the preAction hook
let _globalAccountAlias: string | undefined

export function getGlobalAccount(): string | undefined {
  return _globalAccountAlias
}

/** @internal Reset for testing */
export function _resetGlobalAccount(): void {
  _globalAccountAlias = undefined
}

// Commands
import { accountAdd, accountRemove, accountList, accountSwitch, accountInfo, accountRename, accountValidate } from './commands/account.js'
import { messageList, messageGet, messageRaw, messageSend, messageReply, messageForward, messageDelete, messageMove, messageMark, messageSearch, messageUntrash, messageBatchDelete, messageImport, messageCopy, messageTrash, messageBatchModify, messageInsert, messageRecent, messageAll } from './commands/message.js'
import { draftList, draftGet, draftCreate, draftUpdate, draftSend, draftDelete } from './commands/draft.js'
import { folderList, folderGet, folderCreate, folderUpdate, folderDelete, folderMessages, folderMove, folderCopy } from './commands/folder.js'
import { attachmentList, attachmentGet, attachmentDownload, attachmentAdd, attachmentDelete } from './commands/attachment.js'
import { ruleList, ruleGet, ruleCreate, ruleUpdate, ruleDelete } from './commands/rule.js'
import { settingsGet, settingsUpdate, vacationGet, vacationSet, autoReplyGet, autoReplySet, forwardingGet, forwardingSet, mailTipsGet, focusedInboxList, focusedInboxAdd, focusedInboxDelete } from './commands/settings.js'
import { threadList, threadGet, threadModify, threadTrash, threadUntrash, threadDelete } from './commands/thread.js'
import { categoryList, categoryCreate, categoryUpdate, categoryDelete } from './commands/category.js'
import { profileGet } from './commands/profile.js'
import { historyList } from './commands/history.js'
import { sendAsList, sendAsGet, sendAsCreate, sendAsDelete } from './commands/send-as.js'
import { delegateList, delegateAdd, delegateRemove } from './commands/delegate.js'
import { fwdAddrList, fwdAddrAdd, fwdAddrRemove } from './commands/forwarding-address.js'


export function createCli(): Command {
  const program = new Command()
    .name('cli-mail')
    .description('AI-oriented CLI email management tool for Gmail and Outlook')
    .version('0.1.0')
    .option('-f, --format <format>', 'Output format: markdown (default) or json', 'markdown')
    .option('-a, --account <alias>', 'Account alias to use')
    .hook('preAction', (thisCommand) => {
      const opts = thisCommand.opts()
      if (opts.format) {
        // Accept 'text' as alias for 'markdown' for backward compatibility
        const fmt = opts.format === 'text' ? 'markdown' : opts.format
        setGlobalFormat(fmt as OutputFormat)
      }
      if (opts.account) {
        _globalAccountAlias = opts.account
      }
    })

  // ==================== Account ====================
  const account = program.command('account').description('Manage email accounts')

  account
    .command('add <provider>')
    .description('Add a new email account (gmail or outlook)')
    .option('--alias <alias>', 'Custom alias for the account')
    .action((provider: string, opts: { alias?: string }) => accountAdd(provider, opts.alias))

  account
    .command('remove <alias>')
    .description('Remove a saved account')
    .action((alias: string) => accountRemove(alias))

  account
    .command('list')
    .description('List all configured accounts')
    .action(() => accountList())

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

  // ==================== Message ====================
  const message = program.command('message').alias('msg').description('Email message operations')

  message
    .command('list')
    .description('List messages')
    .option('--folder <id>', 'Folder/Label ID to list from')
    .option('--query <query>', 'Search query')
    .option('--top <n>', 'Number of messages to return', '20')
    .option('--skip <n>', 'Number of messages to skip')
    .option('--page-token <token>', 'Page token for next page (Gmail)')
    .option('-a, --account <alias>', 'Account alias')
    .action((opts) => messageList(opts))

  message
    .command('get <id>')
    .description('Get a message by ID')
    .option('-a, --account <alias>', 'Account alias')
    .action((id: string, opts) => messageGet(id, opts))

  message
    .command('raw <id>')
    .description('Get raw MIME content of a message')
    .option('-a, --account <alias>', 'Account alias')
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
    .option('--body-type <type>', 'Body type: text or html', 'text')
    .option('--importance <level>', 'Importance: low, normal, high', 'normal')
    .option('-a, --account <alias>', 'Account alias')
    .action((opts) => messageSend(opts))

  message
    .command('reply <id>')
    .description('Reply to a message')
    .requiredOption('--body <body>', 'Reply body')
    .option('--reply-all', 'Reply to all recipients')
    .option('-a, --account <alias>', 'Account alias')
    .action((id: string, opts) => messageReply(id, opts))

  message
    .command('forward <id>')
    .description('Forward a message')
    .requiredOption('--to <addresses...>', 'Forward to addresses')
    .option('--body <body>', 'Additional message body')
    .option('-a, --account <alias>', 'Account alias')
    .action((id: string, opts) => messageForward(id, opts))

  message
    .command('delete <id>')
    .description('Delete a message (move to trash by default)')
    .option('--permanent', 'Permanently delete')
    .option('-a, --account <alias>', 'Account alias')
    .action((id: string, opts) => messageDelete(id, opts))

  message
    .command('move <id>')
    .description('Move a message to a folder')
    .requiredOption('--to-folder <id>', 'Destination folder/label ID')
    .option('-a, --account <alias>', 'Account alias')
    .action((id: string, opts) => messageMove(id, opts))

  message
    .command('mark <id>')
    .description('Mark a message (read/unread/flagged/unflagged)')
    .option('--read', 'Mark as read')
    .option('--unread', 'Mark as unread')
    .option('--flagged', 'Mark as flagged/starred')
    .option('--unflagged', 'Remove flag/star')
    .option('-a, --account <alias>', 'Account alias')
    .action((id: string, opts) => messageMark(id, opts))

  message
    .command('search')
    .description('Search messages')
    .requiredOption('--query <query>', 'Search query')
    .option('--top <n>', 'Number of results', '20')
    .option('-a, --account <alias>', 'Account alias')
    .action((opts) => messageSearch(opts))

  message
    .command('untrash <id>')
    .description('Restore a message from trash (Gmail only)')
    .option('-a, --account <alias>', 'Account alias')
    .action((id: string, opts) => messageUntrash(id, opts))

  message
    .command('batch-delete')
    .description('Batch delete messages (Gmail only)')
    .requiredOption('--ids <ids...>', 'Message IDs to delete')
    .option('-a, --account <alias>', 'Account alias')
    .action((opts) => messageBatchDelete(opts))

  message
    .command('import')
    .description('Import a raw MIME message (Gmail only)')
    .requiredOption('--file <path>', 'Path to raw MIME file')
    .option('-a, --account <alias>', 'Account alias')
    .action((opts) => messageImport(opts))

  message
    .command('copy <id>')
    .description('Copy a message to a folder (Outlook only)')
    .requiredOption('--to-folder <id>', 'Destination folder ID')
    .option('-a, --account <alias>', 'Account alias')
    .action((id: string, opts) => messageCopy(id, opts))

  message
    .command('trash <id>')
    .description('Move a message to trash')
    .option('-a, --account <alias>', 'Account alias')
    .action((id: string, opts) => messageTrash(id, opts))

  message
    .command('batch-modify')
    .description('Batch modify labels on messages (Gmail only)')
    .requiredOption('--ids <ids...>', 'Message IDs')
    .option('--add-labels <labels...>', 'Labels to add')
    .option('--remove-labels <labels...>', 'Labels to remove')
    .option('-a, --account <alias>', 'Account alias')
    .action((opts) => messageBatchModify(opts))

  message
    .command('insert')
    .description('Insert a raw MIME message without scanning (Gmail only)')
    .requiredOption('--file <path>', 'Path to raw MIME file')
    .option('-a, --account <alias>', 'Account alias')
    .action((opts) => messageInsert(opts))

  message
    .command('recent')
    .description('List recent messages by time range')
    .option('--hours <n>', 'Number of hours to look back (default: 24)')
    .option('--since <date>', 'ISO 8601 date to start from')
    .option('--top <n>', 'Number of messages to return', '20')
    .option('-a, --account <alias>', 'Account alias')
    .action((opts) => messageRecent(opts))

  // ==================== Inbox All (cross-account) ====================
  program
    .command('inbox')
    .description('Cross-account inbox aggregation')
    .option('--hours <n>', 'Number of hours to look back (default: 24)')
    .option('--since <date>', 'ISO 8601 date to start from')
    .option('--top <n>', 'Messages per account', '10')
    .action((opts) => messageAll(opts))

  // ==================== Draft ====================
  const draft = program.command('draft').description('Draft operations')

  draft
    .command('list')
    .description('List drafts')
    .option('--top <n>', 'Number of drafts', '20')
    .option('-a, --account <alias>', 'Account alias')
    .action((opts) => draftList(opts))

  draft
    .command('get <id>')
    .description('Get a draft by ID')
    .option('-a, --account <alias>', 'Account alias')
    .action((id: string, opts) => draftGet(id, opts))

  draft
    .command('create')
    .description('Create a new draft')
    .requiredOption('--to <addresses...>', 'Recipient addresses')
    .requiredOption('--subject <subject>', 'Subject')
    .option('--body <body>', 'Body text')
    .option('--cc <addresses...>', 'CC recipients')
    .option('--bcc <addresses...>', 'BCC recipients')
    .option('--body-type <type>', 'Body type: text or html', 'text')
    .option('-a, --account <alias>', 'Account alias')
    .action((opts) => draftCreate(opts))

  draft
    .command('update <id>')
    .description('Update a draft')
    .option('--to <addresses...>', 'Recipient addresses')
    .option('--subject <subject>', 'Subject')
    .option('--body <body>', 'Body text')
    .option('--cc <addresses...>', 'CC recipients')
    .option('--bcc <addresses...>', 'BCC recipients')
    .option('--body-type <type>', 'Body type: text or html')
    .option('-a, --account <alias>', 'Account alias')
    .action((id: string, opts) => draftUpdate(id, opts))

  draft
    .command('send <id>')
    .description('Send a draft')
    .option('-a, --account <alias>', 'Account alias')
    .action((id: string, opts) => draftSend(id, opts))

  draft
    .command('delete <id>')
    .description('Delete a draft')
    .option('-a, --account <alias>', 'Account alias')
    .action((id: string, opts) => draftDelete(id, opts))

  // ==================== Folder/Label ====================
  const folder = program.command('folder').alias('label').description('Folder (Outlook) / Label (Gmail) operations')

  folder
    .command('list')
    .description('List folders/labels')
    .option('--parent <id>', 'Parent folder ID (Outlook only)')
    .option('-a, --account <alias>', 'Account alias')
    .action((opts) => folderList(opts))

  folder
    .command('get <id>')
    .description('Get a folder/label by ID')
    .option('-a, --account <alias>', 'Account alias')
    .action((id: string, opts) => folderGet(id, opts))

  folder
    .command('create')
    .description('Create a new folder/label')
    .requiredOption('--name <name>', 'Folder/label name')
    .option('--parent <id>', 'Parent folder ID')
    .option('-a, --account <alias>', 'Account alias')
    .action((opts) => folderCreate(opts))

  folder
    .command('update <id>')
    .description('Update a folder/label name')
    .requiredOption('--name <name>', 'New name')
    .option('-a, --account <alias>', 'Account alias')
    .action((id: string, opts) => folderUpdate(id, opts))

  folder
    .command('delete <id>')
    .description('Delete a folder/label')
    .option('-a, --account <alias>', 'Account alias')
    .action((id: string, opts) => folderDelete(id, opts))

  folder
    .command('messages <id>')
    .description('List messages in a folder/label')
    .option('--top <n>', 'Number of messages', '20')
    .option('-a, --account <alias>', 'Account alias')
    .action((id: string, opts) => folderMessages(id, opts))

  folder
    .command('move <id>')
    .description('Move a folder as child of another (Outlook only)')
    .requiredOption('--to-folder <id>', 'Destination parent folder ID')
    .option('-a, --account <alias>', 'Account alias')
    .action((id: string, opts) => folderMove(id, opts))

  folder
    .command('copy <id>')
    .description('Copy a folder (Outlook only)')
    .requiredOption('--to-folder <id>', 'Destination parent folder ID')
    .option('-a, --account <alias>', 'Account alias')
    .action((id: string, opts) => folderCopy(id, opts))

  // ==================== Attachment ====================
  const attachment = program.command('attachment').alias('att').description('Attachment operations')

  attachment
    .command('list <message-id>')
    .description('List attachments of a message')
    .option('-a, --account <alias>', 'Account alias')
    .action((messageId: string, opts) => attachmentList(messageId, opts))

  attachment
    .command('get <message-id> <attachment-id>')
    .description('Get attachment info')
    .option('-a, --account <alias>', 'Account alias')
    .action((messageId: string, attachmentId: string, opts) => attachmentGet(messageId, attachmentId, opts))

  attachment
    .command('download <message-id> <attachment-id>')
    .description('Download an attachment')
    .option('-o, --output <path>', 'Output file path')
    .option('-a, --account <alias>', 'Account alias')
    .action((messageId: string, attachmentId: string, opts) => attachmentDownload(messageId, attachmentId, opts))

  attachment
    .command('add <message-id>')
    .description('Add an attachment to a draft/message (Outlook only)')
    .requiredOption('--file <path>', 'File path to attach')
    .option('--name <name>', 'Override file name')
    .option('-a, --account <alias>', 'Account alias')
    .action((messageId: string, opts) => attachmentAdd(messageId, opts))

  attachment
    .command('delete <message-id> <attachment-id>')
    .description('Delete an attachment from a message (Outlook only)')
    .option('-a, --account <alias>', 'Account alias')
    .action((messageId: string, attachmentId: string, opts) => attachmentDelete(messageId, attachmentId, opts))

  // ==================== Rule/Filter ====================
  const rule = program.command('rule').alias('filter').description('Mail rules (Outlook) / Filters (Gmail)')

  rule
    .command('list')
    .description('List rules/filters')
    .option('-a, --account <alias>', 'Account alias')
    .action((opts) => ruleList(opts))

  rule
    .command('get <id>')
    .description('Get a rule/filter by ID')
    .option('-a, --account <alias>', 'Account alias')
    .action((id: string, opts) => ruleGet(id, opts))

  rule
    .command('create')
    .description('Create a rule/filter from JSON')
    .requiredOption('--json <json>', 'Rule definition as JSON string')
    .option('-a, --account <alias>', 'Account alias')
    .action((opts) => ruleCreate(opts))

  rule
    .command('update <id>')
    .description('Update a rule (Outlook only)')
    .requiredOption('--json <json>', 'Rule update as JSON string')
    .option('-a, --account <alias>', 'Account alias')
    .action((id: string, opts) => ruleUpdate(id, opts))

  rule
    .command('delete <id>')
    .description('Delete a rule/filter')
    .option('-a, --account <alias>', 'Account alias')
    .action((id: string, opts) => ruleDelete(id, opts))

  // ==================== Settings ====================
  const settings = program.command('settings').description('Mailbox settings')

  settings
    .command('get')
    .description('Get mailbox settings')
    .option('-a, --account <alias>', 'Account alias')
    .action((opts) => settingsGet(opts))

  settings
    .command('update')
    .description('Update mailbox settings')
    .requiredOption('--json <json>', 'Settings as JSON string')
    .option('-a, --account <alias>', 'Account alias')
    .action((opts) => settingsUpdate(opts))

  const vacation = settings.command('vacation').description('Vacation/auto-reply settings')

  vacation
    .command('get')
    .description('Get vacation settings')
    .option('-a, --account <alias>', 'Account alias')
    .action((opts) => vacationGet(opts))

  vacation
    .command('set')
    .description('Set vacation auto-reply')
    .option('--enabled', 'Enable auto-reply')
    .option('--disabled', 'Disable auto-reply')
    .option('--message <message>', 'Auto-reply message')
    .option('--start <date>', 'Start date (ISO format)')
    .option('--end <date>', 'End date (ISO format)')
    .option('-a, --account <alias>', 'Account alias')
    .action((opts: { enabled?: boolean; disabled?: boolean; message?: string; start?: string; end?: string; account?: string }) => {
      vacationSet({
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
    .option('-a, --account <alias>', 'Account alias')
    .action((opts) => autoReplyGet(opts))

  autoReply
    .command('set')
    .description('Set auto-reply from JSON')
    .requiredOption('--json <json>', 'Auto-reply settings as JSON string')
    .option('-a, --account <alias>', 'Account alias')
    .action((opts) => autoReplySet(opts))

  const forwarding = settings.command('forwarding').description('Forwarding settings (Gmail)')

  forwarding
    .command('get')
    .description('Get forwarding settings')
    .option('-a, --account <alias>', 'Account alias')
    .action((opts) => forwardingGet(opts))

  forwarding
    .command('set')
    .description('Set forwarding settings')
    .requiredOption('--json <json>', 'Forwarding settings as JSON string')
    .option('-a, --account <alias>', 'Account alias')
    .action((opts) => forwardingSet(opts))

  // ==================== Thread (Gmail-specific) ====================
  const thread = program.command('thread').description('Thread operations (Gmail only)')

  thread
    .command('list')
    .description('List threads')
    .option('--query <query>', 'Search query')
    .option('--top <n>', 'Number of threads', '20')
    .option('-a, --account <alias>', 'Account alias')
    .action((opts) => threadList(opts))

  thread
    .command('get <id>')
    .description('Get a thread by ID')
    .option('-a, --account <alias>', 'Account alias')
    .action((id: string, opts) => threadGet(id, opts))

  thread
    .command('modify <id>')
    .description('Modify thread labels')
    .option('--add-labels <labels...>', 'Labels to add')
    .option('--remove-labels <labels...>', 'Labels to remove')
    .option('-a, --account <alias>', 'Account alias')
    .action((id: string, opts) => threadModify(id, opts))

  thread
    .command('trash <id>')
    .description('Move thread to trash')
    .option('-a, --account <alias>', 'Account alias')
    .action((id: string, opts) => threadTrash(id, opts))

  thread
    .command('untrash <id>')
    .description('Restore thread from trash')
    .option('-a, --account <alias>', 'Account alias')
    .action((id: string, opts) => threadUntrash(id, opts))

  thread
    .command('delete <id>')
    .description('Permanently delete a thread')
    .option('-a, --account <alias>', 'Account alias')
    .action((id: string, opts) => threadDelete(id, opts))

  // ==================== Category (Outlook-specific) ====================
  const category = program.command('category').description('Category operations (Outlook only)')

  category
    .command('list')
    .description('List categories')
    .option('-a, --account <alias>', 'Account alias')
    .action((opts) => categoryList(opts))

  category
    .command('create')
    .description('Create a category')
    .requiredOption('--name <name>', 'Category name')
    .option('--color <color>', 'Category color preset')
    .option('-a, --account <alias>', 'Account alias')
    .action((opts) => categoryCreate(opts))

  category
    .command('update <id>')
    .description('Update a category')
    .option('--name <name>', 'New name')
    .option('--color <color>', 'New color preset')
    .option('-a, --account <alias>', 'Account alias')
    .action((id: string, opts) => categoryUpdate(id, opts))

  category
    .command('delete <id>')
    .description('Delete a category')
    .option('-a, --account <alias>', 'Account alias')
    .action((id: string, opts) => categoryDelete(id, opts))

  // ==================== Mail Tips (Outlook) ====================
  program
    .command('mail-tips')
    .description('Get mail tips for addresses (Outlook only)')
    .requiredOption('--addresses <addresses...>', 'Email addresses to check')
    .option('-a, --account <alias>', 'Account alias')
    .action((opts) => mailTipsGet(opts))

  // ==================== Focused Inbox (Outlook) ====================
  const focusedInbox = program.command('focused-inbox').description('Focused Inbox overrides (Outlook only)')

  focusedInbox
    .command('list')
    .description('List Focused Inbox overrides')
    .option('-a, --account <alias>', 'Account alias')
    .action((opts) => focusedInboxList(opts))

  focusedInbox
    .command('add')
    .description('Add a Focused Inbox override')
    .requiredOption('--email <email>', 'Sender email address')
    .requiredOption('--classify <classify>', 'Classify as: focused or other')
    .option('-a, --account <alias>', 'Account alias')
    .action((opts) => focusedInboxAdd(opts))

  focusedInbox
    .command('delete <id>')
    .description('Delete a Focused Inbox override')
    .option('-a, --account <alias>', 'Account alias')
    .action((id: string, opts) => focusedInboxDelete(id, opts))

  // ==================== Profile ====================
  program
    .command('profile')
    .description('Show user profile info')
    .option('-a, --account <alias>', 'Account alias')
    .action((opts) => profileGet(opts))

  // ==================== History (Gmail) ====================
  program
    .command('history')
    .description('List mailbox change history (Gmail only)')
    .requiredOption('--start-history-id <id>', 'History ID to start from')
    .option('--label-id <id>', 'Filter by label ID')
    .option('--types <types...>', 'History types: messageAdded, messageDeleted, labelAdded, labelRemoved')
    .option('--top <n>', 'Max results')
    .option('--page-token <token>', 'Page token')
    .option('-a, --account <alias>', 'Account alias')
    .action((opts) => historyList(opts))

  // ==================== Send-As (Gmail) ====================
  const sendAs = program.command('send-as').description('Send-as alias management (Gmail only)')

  sendAs
    .command('list')
    .description('List send-as aliases')
    .option('-a, --account <alias>', 'Account alias')
    .action((opts) => sendAsList(opts))

  sendAs
    .command('get <email>')
    .description('Get a send-as alias')
    .option('-a, --account <alias>', 'Account alias')
    .action((email: string, opts) => sendAsGet(email, opts))

  sendAs
    .command('create')
    .description('Create a send-as alias')
    .requiredOption('--email <email>', 'Email address')
    .option('--display-name <name>', 'Display name')
    .option('--reply-to <email>', 'Reply-to address')
    .option('-a, --account <alias>', 'Account alias')
    .action((opts) => sendAsCreate(opts))

  sendAs
    .command('delete <email>')
    .description('Delete a send-as alias')
    .option('-a, --account <alias>', 'Account alias')
    .action((email: string, opts) => sendAsDelete(email, opts))

  // ==================== Delegate (Gmail) ====================
  const delegate = program.command('delegate').description('Delegate management (Gmail only)')

  delegate
    .command('list')
    .description('List delegates')
    .option('-a, --account <alias>', 'Account alias')
    .action((opts) => delegateList(opts))

  delegate
    .command('add')
    .description('Add a delegate')
    .requiredOption('--email <email>', 'Delegate email address')
    .option('-a, --account <alias>', 'Account alias')
    .action((opts) => delegateAdd(opts))

  delegate
    .command('remove <email>')
    .description('Remove a delegate')
    .option('-a, --account <alias>', 'Account alias')
    .action((email: string, opts) => delegateRemove(email, opts))

  // ==================== Forwarding Address (Gmail) ====================
  const fwdAddr = program.command('forwarding-address').alias('fwd-addr').description('Forwarding address management (Gmail only)')

  fwdAddr
    .command('list')
    .description('List forwarding addresses')
    .option('-a, --account <alias>', 'Account alias')
    .action((opts) => fwdAddrList(opts))

  fwdAddr
    .command('add')
    .description('Add a forwarding address')
    .requiredOption('--email <email>', 'Forwarding email address')
    .option('-a, --account <alias>', 'Account alias')
    .action((opts) => fwdAddrAdd(opts))

  fwdAddr
    .command('remove <email>')
    .description('Remove a forwarding address')
    .option('-a, --account <alias>', 'Account alias')
    .action((email: string, opts) => fwdAddrRemove(email, opts))

  return program
}
