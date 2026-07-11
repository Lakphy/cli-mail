import { describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const message = {
    keepBcc: false,
    build: vi.fn().mockResolvedValue(Buffer.from('mime')),
  }
  const compile = vi.fn(() => message)
  const MailComposer = vi.fn(function (this: { compile: typeof compile }) {
    this.compile = compile
  })

  return {
    mailComposerFactory: vi.fn(),
    mailParserFactory: vi.fn(),
    MailComposer,
    message,
    simpleParser: vi.fn().mockResolvedValue({ subject: 'parsed' }),
  }
})

vi.mock('nodemailer/lib/mail-composer/index.js', () => {
  mocks.mailComposerFactory()
  return { default: mocks.MailComposer }
})

vi.mock('mailparser', () => {
  mocks.mailParserFactory()
  return { simpleParser: mocks.simpleParser }
})

import { buildMimeMessage, parseMimeMessage } from '../../src/utils/mime'

describe('lazy MIME dependencies', () => {
  test('loads each heavy module on first use and reuses the cached import', async () => {
    expect(mocks.mailComposerFactory).not.toHaveBeenCalled()
    expect(mocks.mailParserFactory).not.toHaveBeenCalled()

    await parseMimeMessage('Subject: parsed\r\n\r\nbody')
    await parseMimeMessage('Subject: parsed again\r\n\r\nbody')
    expect(mocks.mailParserFactory).toHaveBeenCalledTimes(1)
    expect(mocks.simpleParser).toHaveBeenCalledTimes(2)

    await buildMimeMessage({
      to: ['recipient@example.com'],
      subject: 'Subject',
      body: 'Body',
    })
    await buildMimeMessage({
      to: ['recipient@example.com'],
      subject: 'Another subject',
      body: 'Another body',
    })
    expect(mocks.mailComposerFactory).toHaveBeenCalledTimes(1)
    expect(mocks.MailComposer).toHaveBeenCalledTimes(2)
    expect(mocks.message.keepBcc).toBe(true)
  })
})
