import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
})
