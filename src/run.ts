import { Command, CommanderError } from 'commander'
import { createCli } from './cli.js'
import { output, outputFailure, setGlobalFormat, type OutputFormat } from './output/formatter.js'
import { errorMessage, HandledCliError, toErrorPayload } from './utils/error.js'
import { resetConfigPath } from './config/store.js'
import { resetGlobalAccount } from './config/context.js'

export async function runCli(argv: readonly string[] = process.argv): Promise<void> {
  // runCli is also a programmatic entry point. Keep repeated invocations
  // independent instead of inheriting a previous command's mutable globals.
  process.exitCode = undefined
  resetConfigPath()
  resetGlobalAccount()
  const format = detectFormat(argv)
  setGlobalFormat(format)

  let commanderError = ''
  let commanderOutput = ''
  const program = createCli()
  configureCommandTree(program, (text) => {
    commanderError += text
  }, format === 'json' ? (text) => {
    commanderOutput += text
  } : undefined)

  try {
    await program.parseAsync([...argv])
  } catch (error) {
    if (error instanceof HandledCliError) {
      process.exitCode = error.exitCode
      return
    }
    if (isCommanderFailure(error) && error.exitCode === 0) {
      if (format === 'json') {
        output({
          type: error.code === 'commander.version' ? 'version' : 'help',
          text: commanderOutput.trimEnd(),
        })
      }
      return
    }

    const message = commanderError.trim().replace(/^error:\s*/i, '')
      || errorMessage(error)
    outputFailure(isCommanderFailure(error)
      ? {
          code: 'CLI_USAGE_ERROR',
          message,
          details: { commanderCode: error.code },
          suggestion: 'Run "cli-mail --help" to see valid commands and options.',
        }
      : toErrorPayload(error))
    process.exitCode = 1
  }
}

function configureCommandTree(
  command: Command,
  writeErr: (text: string) => void,
  writeOut?: (text: string) => void,
): void {
  command.exitOverride().configureOutput({ writeErr, ...(writeOut ? { writeOut } : {}) })
  for (const child of command.commands) configureCommandTree(child, writeErr, writeOut)
}

function isCommanderFailure(error: unknown): error is CommanderError {
  return error instanceof CommanderError
    || (error instanceof Error
      && typeof (error as Partial<CommanderError>).code === 'string'
      && (error as Partial<CommanderError>).code?.startsWith('commander.') === true
      && typeof (error as Partial<CommanderError>).exitCode === 'number')
}

export function detectFormat(argv: readonly string[]): OutputFormat {
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--format' || value === '-f') {
      return argv[index + 1] === 'json' ? 'json' : 'markdown'
    }
    if (value?.startsWith('--format=')) {
      return value.slice('--format='.length) === 'json' ? 'json' : 'markdown'
    }
    if (value?.startsWith('-f') && value.length > 2) {
      const inline = value.slice(2).replace(/^=/, '')
      return inline === 'json' ? 'json' : 'markdown'
    }
  }
  return 'markdown'
}
