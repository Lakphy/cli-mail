import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pkg = require('../package.json')

// ==========================================================
// CLI Structure Tests
// ==========================================================

import { createCli } from '../src/cli'

describe('CLI', () => {
  test('creates program with correct name and version', () => {
    const program = createCli()
    expect(program.name()).toBe('cli-mail')
    expect(program.version()).toBe(pkg.version)
  })

  test('has --config option for custom config file path', () => {
    const program = createCli()
    const optionFlags = program.options.map((o) => o.long)
    expect(optionFlags).toContain('--config')
  })

  test('has all top-level commands', () => {
    const program = createCli()
    const names = program.commands.map((c) => c.name())
    const expected = [
      'account', 'message', 'draft', 'folder', 'attachment',
      'rule', 'settings', 'thread', 'category', 'mail-tips', 'focused-inbox',
      'profile', 'history', 'send-as', 'delegate', 'forwarding-address',
    ]
    for (const name of expected) {
      expect(names).toContain(name)
    }
  })

  test('command aliases work correctly', () => {
    const program = createCli()
    const aliases: Record<string, string> = {
      message: 'msg', folder: 'label', attachment: 'att', rule: 'filter',
    }
    for (const [cmdName, alias] of Object.entries(aliases)) {
      const cmd = program.commands.find((c) => c.name() === cmdName)
      expect(cmd?.aliases()).toContain(alias)
    }
  })

  test('message command has all subcommands including new ones', () => {
    const program = createCli()
    const msgCmd = program.commands.find((c) => c.name() === 'message')
    const subNames = msgCmd?.commands.map((c) => c.name()) || []
    const expected = [
      'list', 'get', 'raw', 'send', 'reply', 'forward', 'delete',
      'move', 'mark', 'search', 'untrash', 'batch-delete', 'import', 'copy',
      'trash', 'batch-modify', 'insert',
    ]
    for (const name of expected) {
      expect(subNames).toContain(name)
    }
  })

  test('account command has all subcommands', () => {
    const program = createCli()
    const accCmd = program.commands.find((c) => c.name() === 'account')
    const subNames = accCmd?.commands.map((c) => c.name()) || []
    for (const name of ['add', 'remove', 'list', 'switch', 'info']) {
      expect(subNames).toContain(name)
    }
  })

  test('draft command has all subcommands', () => {
    const program = createCli()
    const draftCmd = program.commands.find((c) => c.name() === 'draft')
    const subNames = draftCmd?.commands.map((c) => c.name()) || []
    for (const name of ['list', 'get', 'create', 'update', 'send', 'delete']) {
      expect(subNames).toContain(name)
    }
  })

  test('folder command has all subcommands including move/copy', () => {
    const program = createCli()
    const folderCmd = program.commands.find((c) => c.name() === 'folder')
    const subNames = folderCmd?.commands.map((c) => c.name()) || []
    for (const name of ['list', 'get', 'create', 'update', 'delete', 'messages', 'move', 'copy']) {
      expect(subNames).toContain(name)
    }
  })

  test('attachment command has all subcommands including add/delete', () => {
    const program = createCli()
    const attCmd = program.commands.find((c) => c.name() === 'attachment')
    const subNames = attCmd?.commands.map((c) => c.name()) || []
    for (const name of ['list', 'get', 'download', 'add', 'delete']) {
      expect(subNames).toContain(name)
    }
  })

  test('rule command has all subcommands', () => {
    const program = createCli()
    const ruleCmd = program.commands.find((c) => c.name() === 'rule')
    const subNames = ruleCmd?.commands.map((c) => c.name()) || []
    for (const name of ['list', 'get', 'create', 'update', 'delete']) {
      expect(subNames).toContain(name)
    }
  })

  test('thread command has all subcommands', () => {
    const program = createCli()
    const threadCmd = program.commands.find((c) => c.name() === 'thread')
    const subNames = threadCmd?.commands.map((c) => c.name()) || []
    for (const name of ['list', 'get', 'modify', 'trash', 'untrash', 'delete']) {
      expect(subNames).toContain(name)
    }
  })

  test('category command has all subcommands', () => {
    const program = createCli()
    const catCmd = program.commands.find((c) => c.name() === 'category')
    const subNames = catCmd?.commands.map((c) => c.name()) || []
    for (const name of ['list', 'create', 'update', 'delete']) {
      expect(subNames).toContain(name)
    }
  })

  test('settings command has nested subcommands', () => {
    const program = createCli()
    const settingsCmd = program.commands.find((c) => c.name() === 'settings')
    const subNames = settingsCmd?.commands.map((c) => c.name()) || []
    for (const name of ['get', 'update', 'vacation', 'auto-reply', 'forwarding']) {
      expect(subNames).toContain(name)
    }
  })

  test('focused-inbox command has all subcommands', () => {
    const program = createCli()
    const fiCmd = program.commands.find((c) => c.name() === 'focused-inbox')
    const subNames = fiCmd?.commands.map((c) => c.name()) || []
    for (const name of ['list', 'add', 'delete']) {
      expect(subNames).toContain(name)
    }
  })

  test('message list has --page-token option', () => {
    const program = createCli()
    const msgCmd = program.commands.find((c) => c.name() === 'message')
    const listCmd = msgCmd?.commands.find((c) => c.name() === 'list')
    const optionFlags = listCmd?.options.map((o) => o.long) || []
    expect(optionFlags).toContain('--page-token')
  })

  test('message send has all required and optional flags', () => {
    const program = createCli()
    const msgCmd = program.commands.find((c) => c.name() === 'message')
    const sendCmd = msgCmd?.commands.find((c) => c.name() === 'send')
    const optionFlags = sendCmd?.options.map((o) => o.long) || []
    for (const flag of ['--to', '--subject', '--body', '--body-file', '--cc', '--bcc', '--attach', '--body-type', '--importance']) {
      expect(optionFlags).toContain(flag)
    }
  })

  test('attachment download has -o shorthand for --output', () => {
    const program = createCli()
    const attCmd = program.commands.find((c) => c.name() === 'attachment')
    const dlCmd = attCmd?.commands.find((c) => c.name() === 'download')
    const shortFlags = dlCmd?.options.map((o) => o.short) || []
    expect(shortFlags).toContain('-o')
  })

  test('every data subcommand has -a/--account option', () => {
    const program = createCli()
    // Check a representative set of data-operation subcommands
    const cmdPairs = [
      ['message', 'list'], ['message', 'get'], ['message', 'send'],
      ['draft', 'list'], ['folder', 'list'], ['attachment', 'list'],
      ['rule', 'list'], ['thread', 'list'], ['category', 'list'],
      ['send-as', 'list'], ['delegate', 'list'], ['forwarding-address', 'list'],
    ]
    for (const [parent, child] of cmdPairs) {
      const parentCmd = program.commands.find((c) => c.name() === parent)
      const childCmd = parentCmd?.commands.find((c) => c.name() === child)
      const optionFlags = childCmd?.options.map((o) => o.long) || []
      expect(optionFlags).toContain('--account')
    }
  })

  // ---- New command group tests ----

  test('message trash command exists', () => {
    const program = createCli()
    const msgCmd = program.commands.find((c) => c.name() === 'message')
    const trashCmd = msgCmd?.commands.find((c) => c.name() === 'trash')
    expect(trashCmd).toBeDefined()
    expect(trashCmd?.options.map((o) => o.long)).toContain('--account')
  })

  test('message batch-modify has --ids, --add-labels, --remove-labels', () => {
    const program = createCli()
    const msgCmd = program.commands.find((c) => c.name() === 'message')
    const bmCmd = msgCmd?.commands.find((c) => c.name() === 'batch-modify')
    const flags = bmCmd?.options.map((o) => o.long) || []
    expect(flags).toContain('--ids')
    expect(flags).toContain('--add-labels')
    expect(flags).toContain('--remove-labels')
  })

  test('message insert has --file option', () => {
    const program = createCli()
    const msgCmd = program.commands.find((c) => c.name() === 'message')
    const insertCmd = msgCmd?.commands.find((c) => c.name() === 'insert')
    expect(insertCmd).toBeDefined()
    expect(insertCmd?.options.map((o) => o.long)).toContain('--file')
  })

  test('folder move/copy have --to-folder option', () => {
    const program = createCli()
    const folderCmd = program.commands.find((c) => c.name() === 'folder')
    for (const name of ['move', 'copy']) {
      const cmd = folderCmd?.commands.find((c) => c.name() === name)
      expect(cmd).toBeDefined()
      expect(cmd?.options.map((o) => o.long)).toContain('--to-folder')
    }
  })

  test('profile command exists with --account option', () => {
    const program = createCli()
    const profileCmd = program.commands.find((c) => c.name() === 'profile')
    expect(profileCmd).toBeDefined()
    expect(profileCmd?.options.map((o) => o.long)).toContain('--account')
  })

  test('history command has all required options', () => {
    const program = createCli()
    const histCmd = program.commands.find((c) => c.name() === 'history')
    expect(histCmd).toBeDefined()
    const flags = histCmd?.options.map((o) => o.long) || []
    expect(flags).toContain('--start-history-id')
    expect(flags).toContain('--label-id')
    expect(flags).toContain('--types')
    expect(flags).toContain('--top')
    expect(flags).toContain('--page-token')
  })

  test('send-as command has all subcommands', () => {
    const program = createCli()
    const saCmd = program.commands.find((c) => c.name() === 'send-as')
    const subNames = saCmd?.commands.map((c) => c.name()) || []
    for (const name of ['list', 'get', 'create', 'delete']) {
      expect(subNames).toContain(name)
    }
  })

  test('send-as create has --email, --display-name, --reply-to options', () => {
    const program = createCli()
    const saCmd = program.commands.find((c) => c.name() === 'send-as')
    const createCmd = saCmd?.commands.find((c) => c.name() === 'create')
    const flags = createCmd?.options.map((o) => o.long) || []
    expect(flags).toContain('--email')
    expect(flags).toContain('--display-name')
    expect(flags).toContain('--reply-to')
  })

  test('delegate command has all subcommands', () => {
    const program = createCli()
    const delCmd = program.commands.find((c) => c.name() === 'delegate')
    const subNames = delCmd?.commands.map((c) => c.name()) || []
    for (const name of ['list', 'add', 'remove']) {
      expect(subNames).toContain(name)
    }
  })

  test('delegate add has --email option', () => {
    const program = createCli()
    const delCmd = program.commands.find((c) => c.name() === 'delegate')
    const addCmd = delCmd?.commands.find((c) => c.name() === 'add')
    expect(addCmd?.options.map((o) => o.long)).toContain('--email')
  })

  test('forwarding-address command has all subcommands', () => {
    const program = createCli()
    const fwdCmd = program.commands.find((c) => c.name() === 'forwarding-address')
    const subNames = fwdCmd?.commands.map((c) => c.name()) || []
    for (const name of ['list', 'add', 'remove']) {
      expect(subNames).toContain(name)
    }
  })

  test('forwarding-address has fwd-addr alias', () => {
    const program = createCli()
    const fwdCmd = program.commands.find((c) => c.name() === 'forwarding-address')
    expect(fwdCmd?.aliases()).toContain('fwd-addr')
  })

  test('forwarding-address add has --email option', () => {
    const program = createCli()
    const fwdCmd = program.commands.find((c) => c.name() === 'forwarding-address')
    const addCmd = fwdCmd?.commands.find((c) => c.name() === 'add')
    expect(addCmd?.options.map((o) => o.long)).toContain('--email')
  })

  // ---- Tag / Group command tests ----

  test('group command exists at top level', () => {
    const program = createCli()
    const names = program.commands.map((c) => c.name())
    expect(names).toContain('group')
  })

  test('group command has list and show subcommands', () => {
    const program = createCli()
    const groupCmd = program.commands.find((c) => c.name() === 'group')
    const subNames = groupCmd?.commands.map((c) => c.name()) || []
    expect(subNames).toContain('list')
    expect(subNames).toContain('show')
  })

  test('group show takes <tag> argument', () => {
    const program = createCli()
    const groupCmd = program.commands.find((c) => c.name() === 'group')
    const showCmd = groupCmd?.commands.find((c) => c.name() === 'show')
    expect(showCmd).toBeDefined()
    const argNames = showCmd?.registeredArguments?.map((a: any) => a.name()) || []
    expect(argNames).toContain('tag')
  })

  test('account add has --tag option', () => {
    const program = createCli()
    const accCmd = program.commands.find((c) => c.name() === 'account')
    const addCmd = accCmd?.commands.find((c) => c.name() === 'add')
    const flags = addCmd?.options.map((o) => o.long) || []
    expect(flags).toContain('--tag')
  })

  test('account list has --tag option', () => {
    const program = createCli()
    const accCmd = program.commands.find((c) => c.name() === 'account')
    const listCmd = accCmd?.commands.find((c) => c.name() === 'list')
    const flags = listCmd?.options.map((o) => o.long) || []
    expect(flags).toContain('--tag')
  })

  test('account tag subcommand exists with <alias> [tag] and --remove', () => {
    const program = createCli()
    const accCmd = program.commands.find((c) => c.name() === 'account')
    const tagCmd = accCmd?.commands.find((c) => c.name() === 'tag')
    expect(tagCmd).toBeDefined()
    const argNames = tagCmd?.registeredArguments?.map((a: any) => a.name()) || []
    expect(argNames).toContain('alias')
    expect(argNames).toContain('tag')
    const flags = tagCmd?.options.map((o) => o.long) || []
    expect(flags).toContain('--remove')
  })

  test('inbox command has --tag option', () => {
    const program = createCli()
    const inboxCmd = program.commands.find((c) => c.name() === 'inbox')
    const flags = inboxCmd?.options.map((o) => o.long) || []
    expect(flags).toContain('--tag')
  })
})
