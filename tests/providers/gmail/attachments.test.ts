import { lstat, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, test, vi, type Mock } from 'vitest'
import { createMockHttpClient } from '../../helpers'
import {
  downloadAttachment,
  getAttachment,
  getAttachmentInfo,
  listAttachments,
} from '../../../src/providers/gmail/attachments'

describe('Gmail attachments provider', () => {
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    vi.clearAllMocks()
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, {
      recursive: true,
      force: true,
    })))
  })

  test('lists each attachment id once from a full MIME part tree', async () => {
    const client = createMockHttpClient()
    ;(client.get as Mock).mockResolvedValue({
      payload: {
        parts: [
          {
            filename: 'invoice.pdf',
            mimeType: 'application/pdf',
            body: { attachmentId: 'a1', size: 12 },
          },
          {
            filename: 'duplicate.pdf',
            mimeType: 'application/pdf',
            body: { attachmentId: 'a1', size: 12 },
          },
        ],
      },
    })

    const result = await listAttachments(client, 'm1')
    expect(client.get).toHaveBeenCalledWith('/messages/m1', { format: 'full' })
    expect(result).toEqual([{
      id: 'a1',
      name: 'invoice.pdf',
      contentType: 'application/pdf',
      size: 12,
      isInline: false,
    }])
  })

  test('normalizes Gmail base64url content to standard base64', async () => {
    const client = createMockHttpClient()
    const bytes = Buffer.from([0xfb, 0xff, 0x00])
    ;(client.get as Mock)
      .mockResolvedValueOnce({ size: bytes.length, data: bytes.toString('base64url') })
      .mockResolvedValueOnce({
        payload: {
          parts: [{
            filename: 'binary.bin',
            mimeType: 'application/octet-stream',
            body: { attachmentId: 'a1', size: bytes.length },
          }],
        },
      })

    const result = await getAttachment(client, 'm1', 'a1')
    expect(result.content).toBe(bytes.toString('base64'))
    expect(client.get).toHaveBeenCalledWith('/messages/m1', { format: 'full' })
  })

  test('gets attachment metadata without fetching attachment content', async () => {
    const client = createMockHttpClient()
    ;(client.get as Mock).mockResolvedValue({
      payload: {
        parts: [{
          filename: 'invoice.pdf',
          mimeType: 'application/pdf',
          body: { attachmentId: 'a1', size: 4_096 },
        }],
      },
    })

    await expect(getAttachmentInfo(client, 'm1', 'a1')).resolves.toEqual({
      id: 'a1',
      name: 'invoice.pdf',
      contentType: 'application/pdf',
      size: 4_096,
      isInline: false,
    })
    expect(client.get).toHaveBeenCalledTimes(1)
    expect(client.get).toHaveBeenCalledWith('/messages/m1', { format: 'full' })
    expect(client.get).not.toHaveBeenCalledWith('/messages/m1/attachments/a1')
  })

  test('metadata lookup reports a missing attachment without a content request', async () => {
    const client = createMockHttpClient()
    ;(client.get as Mock).mockResolvedValue({ payload: { parts: [] } })

    await expect(getAttachmentInfo(client, 'm1', 'missing')).rejects.toMatchObject({
      code: 'API_ERROR',
      statusCode: 404,
    })
    expect(client.get).toHaveBeenCalledTimes(1)
    expect(client.get).not.toHaveBeenCalledWith('/messages/m1/attachments/missing')
  })

  test('download fetches attachment bytes only once without metadata lookup', async () => {
    const client = createMockHttpClient()
    const bytes = Buffer.from([0, 1, 2, 0xff])
    ;(client.get as Mock).mockResolvedValue({
      size: bytes.length,
      data: bytes.toString('base64url'),
    })
    const directory = await mkdtemp(join(tmpdir(), 'cli-mail-attachment-'))
    temporaryDirectories.push(directory)
    const output = join(directory, 'file.bin')

    await downloadAttachment(client, 'm1', 'a1', output)
    await expect(readFile(output)).resolves.toEqual(bytes)
    expect(client.get).toHaveBeenCalledTimes(1)
    expect(client.get).toHaveBeenCalledWith('/messages/m1/attachments/a1')
  })

  test('download refuses to overwrite unless force is explicit', async () => {
    const client = createMockHttpClient()
    ;(client.get as Mock).mockResolvedValue({
      size: 3,
      data: Buffer.from('new').toString('base64url'),
    })
    const directory = await mkdtemp(join(tmpdir(), 'cli-mail-attachment-'))
    temporaryDirectories.push(directory)
    const output = join(directory, 'file.bin')
    await writeFile(output, 'old')

    await expect(downloadAttachment(client, 'm1', 'a1', output)).rejects.toMatchObject({
      code: 'EEXIST',
    })
    await downloadAttachment(client, 'm1', 'a1', output, { force: true })
    await expect(readFile(output, 'utf8')).resolves.toBe('new')
  })

  test('force replaces a destination symlink without modifying its target', async () => {
    const client = createMockHttpClient()
    ;(client.get as Mock).mockResolvedValue({
      size: 3,
      data: Buffer.from('new').toString('base64url'),
    })
    const directory = await mkdtemp(join(tmpdir(), 'cli-mail-attachment-'))
    temporaryDirectories.push(directory)
    const target = join(directory, 'target.bin')
    const output = join(directory, 'output.bin')
    await writeFile(target, 'old')
    await symlink(target, output)

    await expect(downloadAttachment(client, 'm1', 'a1', output)).rejects.toMatchObject({
      code: 'EEXIST',
    })
    await expect(readFile(target, 'utf8')).resolves.toBe('old')

    await downloadAttachment(client, 'm1', 'a1', output, { force: true })
    await expect(readFile(target, 'utf8')).resolves.toBe('old')
    await expect(readFile(output, 'utf8')).resolves.toBe('new')
    await expect(lstat(output)).resolves.toMatchObject({})
    expect((await lstat(output)).isSymbolicLink()).toBe(false)
    expect((await readdir(directory)).some((name) => name.includes('.cli-mail-'))).toBe(false)
  })

  test('encodes both message and attachment ids in the content path', async () => {
    const client = createMockHttpClient()
    ;(client.get as Mock).mockResolvedValue({
      size: 1,
      data: Buffer.from('x').toString('base64url'),
    })
    const directory = await mkdtemp(join(tmpdir(), 'cli-mail-attachment-'))
    temporaryDirectories.push(directory)

    await downloadAttachment(
      client,
      '../message%2Fid?x#y',
      '../attachment%2Fid?x#y',
      join(directory, 'file.bin'),
    )
    expect(client.get).toHaveBeenCalledWith(
      '/messages/..%2Fmessage%252Fid%3Fx%23y/attachments/..%2Fattachment%252Fid%3Fx%23y',
    )
  })
})
