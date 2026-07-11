import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
  type Mock,
} from 'vitest'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMockHttpClient } from '../../helpers'
import {
  addAttachment,
  downloadAttachment,
  MAX_ATTACHMENT_SIZE,
  UPLOAD_CHUNK_SIZE,
} from '../../../src/providers/outlook/attachments'
import { sendMessage } from '../../../src/providers/outlook/messages'

describe('Outlook Attachments Provider', () => {
  const mockClient = createMockHttpClient()
  let directory: string

  beforeEach(() => {
    vi.clearAllMocks()
    directory = mkdtempSync(join(tmpdir(), 'cli-mail-outlook-'))
    Object.assign(mockClient, {
      getRaw: vi.fn(),
      putRawUnauthenticated: vi.fn(),
    })
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  test('downloads file attachments from /$value as raw bytes', async () => {
    ;(mockClient.get as Mock).mockResolvedValue({
      '@odata.type': '#microsoft.graph.fileAttachment',
      id: 'a1',
      name: 'photo.bin',
      contentType: 'application/octet-stream',
      size: 4,
    })
    ;(mockClient.getRaw as Mock).mockResolvedValue(new Response(Buffer.from([0, 1, 2, 255])))
    const output = join(directory, 'photo.bin')

    await downloadAttachment(mockClient, 'm1', 'a1', output)

    expect(mockClient.get).toHaveBeenCalledTimes(1)
    expect(mockClient.getRaw).toHaveBeenCalledWith('/messages/m1/attachments/a1/$value')
    expect(readFileSync(output)).toEqual(Buffer.from([0, 1, 2, 255]))
  })

  test('reuses prefetched detail without weakening safe-write checks', async () => {
    const detail = {
      id: 'a1',
      name: 'a',
      contentType: 'text/plain',
      size: 3,
      attachmentType: 'file' as const,
    }
    ;(mockClient.getRaw as Mock).mockImplementation(() => Promise.resolve(new Response('new')))
    const output = join(directory, 'exists.txt')
    writeFileSync(output, 'old')

    await expect(downloadAttachment(mockClient, 'm1', 'a1', output, {
      detail,
    })).rejects.toMatchObject({
      code: 'EEXIST',
    })
    await downloadAttachment(mockClient, 'm1', 'a1', output, {
      force: true,
      detail,
    })
    expect(readFileSync(output, 'utf8')).toBe('new')
    expect(mockClient.get).not.toHaveBeenCalled()
    expect(mockClient.getRaw).toHaveBeenCalledTimes(2)
  })

  test('downloads item attachments as MIME but rejects reference attachment links', async () => {
    ;(mockClient.get as Mock).mockResolvedValueOnce({
      '@odata.type': '#microsoft.graph.itemAttachment',
      id: 'item', name: 'mail.eml', contentType: 'message/rfc822', size: 4,
    })
    ;(mockClient.getRaw as Mock).mockResolvedValue(new Response('MIME'))
    const itemOutput = join(directory, 'mail.eml')
    await downloadAttachment(mockClient, 'm1', 'item', itemOutput)
    expect(readFileSync(itemOutput)).toEqual(Buffer.from('MIME'))

    await expect(downloadAttachment(
      mockClient,
      'm1',
      'ref',
      join(directory, 'cloud.docx'),
      {
        detail: {
          id: 'ref',
          name: 'cloud.docx',
          contentType: 'application/octet-stream',
          size: 0,
          attachmentType: 'reference',
          sourceUrl: 'https://contoso.example/file',
        },
      },
    )).rejects.toThrow(
      'Reference attachments cannot be downloaded',
    )
    expect(mockClient.get).toHaveBeenCalledTimes(1)
    expect(mockClient.getRaw).toHaveBeenCalledTimes(1)
  })

  test('rejects mismatched prefetched detail before fetching content', async () => {
    await expect(downloadAttachment(
      mockClient,
      'm1',
      'requested',
      join(directory, 'file.bin'),
      {
        detail: {
          id: 'different',
          name: 'file.bin',
          contentType: 'application/octet-stream',
          size: 1,
          attachmentType: 'file',
        },
      },
    )).rejects.toThrow('does not match the requested attachment')
    expect(mockClient.get).not.toHaveBeenCalled()
    expect(mockClient.getRaw).not.toHaveBeenCalled()
  })

  test('uses the simple attachment API for files smaller than 3 MiB', async () => {
    const file = join(directory, 'small.txt')
    writeFileSync(file, 'hello')
    ;(mockClient.post as Mock).mockResolvedValue({
      '@odata.type': '#microsoft.graph.fileAttachment',
      id: 'small-id', name: 'small.txt', contentType: 'text/plain', size: 5,
    })

    const result = await addAttachment(mockClient, 'm1', file, 'small.txt')

    expect(mockClient.post).toHaveBeenCalledWith('/messages/m1/attachments', {
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: 'small.txt',
      contentBytes: Buffer.from('hello').toString('base64'),
    })
    expect(result).toMatchObject({ id: 'small-id', attachmentType: 'file' })
  })

  test('sends attachments through a draft so the correct attachment API is used', async () => {
    const file = join(directory, 'mail.txt')
    writeFileSync(file, 'mail attachment')
    ;(mockClient.post as Mock)
      .mockResolvedValueOnce({ id: 'draft-id' })
      .mockResolvedValueOnce({
        '@odata.type': '#microsoft.graph.fileAttachment',
        id: 'attachment-id', name: 'mail.txt', contentType: 'text/plain', size: 15,
      })
      .mockResolvedValueOnce(undefined)

    await sendMessage(mockClient, {
      to: ['recipient@example.com'],
      subject: 'With attachment',
      body: 'Body',
      attachments: [{ path: file, name: 'mail.txt' }],
    })

    expect(mockClient.post).toHaveBeenNthCalledWith(1, '/messages', expect.objectContaining({
      subject: 'With attachment',
    }))
    expect(mockClient.post).toHaveBeenNthCalledWith(2, '/messages/draft-id/attachments', expect.any(Object))
    expect(mockClient.post).toHaveBeenNthCalledWith(3, '/messages/draft-id/send')
  })

  test('best-effort deletes the temporary draft when attachment send fails', async () => {
    const file = join(directory, 'broken.txt')
    writeFileSync(file, 'content')
    const sendError = new Error('attachment rejected')
    ;(mockClient.post as Mock)
      .mockResolvedValueOnce({ id: 'draft-to-clean' })
      .mockRejectedValueOnce(sendError)
    ;(mockClient.delete as Mock).mockResolvedValue(undefined)

    await expect(sendMessage(mockClient, {
      to: ['recipient@example.com'], subject: 'Cleanup', body: 'Body',
      attachments: [{ path: file, name: 'broken.txt' }],
    })).rejects.toBe(sendError)
    expect(mockClient.delete).toHaveBeenCalledWith('/messages/draft-to-clean')
  })

  test('reports the draft ID when send and cleanup both fail', async () => {
    const file = join(directory, 'broken.txt')
    writeFileSync(file, 'content')
    ;(mockClient.post as Mock)
      .mockResolvedValueOnce({ id: 'orphan-draft-id' })
      .mockRejectedValueOnce(new Error('attachment rejected'))
    ;(mockClient.delete as Mock).mockRejectedValue(new Error('cleanup denied'))

    let error: unknown
    try {
      await sendMessage(mockClient, {
        to: ['recipient@example.com'], subject: 'Cleanup', body: 'Body',
        attachments: [{ path: file, name: 'broken.txt' }],
      })
    } catch (caught) {
      error = caught
    }
    expect(error).toMatchObject({
      code: 'PROVIDER_ERROR',
      provider: 'outlook',
      details: {
        draftId: 'orphan-draft-id',
        sendError: { message: 'attachment rejected' },
        cleanupError: { message: 'cleanup denied' },
      },
    })
  })

  test('uploads large attachments in 3,276,800-byte sequential chunks', async () => {
    const size = UPLOAD_CHUNK_SIZE + 10
    const file = join(directory, 'large.bin')
    writeFileSync(file, '')
    truncateSync(file, size)
    const uploadUrl = "https://outlook.office.com/api/v2.0/Users('u')/AttachmentSessions('s')?authtoken=secret"
    ;(mockClient.post as Mock).mockResolvedValue({ uploadUrl })
    const put = mockClient.putRawUnauthenticated as unknown as Mock
    put
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response(null, {
        status: 201,
        headers: {
          Location: "https://outlook.office.com/api/v2.0/Users('u')/Messages('m')/Attachments('attachment-id')",
        },
      }))

    const result = await addAttachment(mockClient, 'm1', file, 'large.bin')

    expect(mockClient.post).toHaveBeenCalledWith('/messages/m1/attachments/createUploadSession', {
      AttachmentItem: { attachmentType: 'file', name: 'large.bin', size },
    })
    expect(put).toHaveBeenCalledTimes(2)
    expect(put.mock.calls[0][2]['Content-Range']).toBe(`bytes 0-${UPLOAD_CHUNK_SIZE - 1}/${size}`)
    expect(put.mock.calls[1][2]['Content-Range']).toBe(`bytes ${UPLOAD_CHUNK_SIZE}-${size - 1}/${size}`)
    expect(result).toMatchObject({ id: 'attachment-id', size, attachmentType: 'file' })
  })

  test('rejects an untrusted upload-session origin before uploading bytes', async () => {
    const file = join(directory, 'large.bin')
    writeFileSync(file, '')
    truncateSync(file, UPLOAD_CHUNK_SIZE)
    ;(mockClient.post as Mock).mockResolvedValue({
      uploadUrl: 'https://evil.example/upload?authtoken=secret',
    })

    await expect(addAttachment(mockClient, 'm1', file, 'large.bin')).rejects.toThrow(
      'untrusted attachment upload URL',
    )
    expect(mockClient.putRawUnauthenticated).not.toHaveBeenCalled()
  })

  test('rejects files larger than 150 MiB before making a request', async () => {
    const file = join(directory, 'too-large.bin')
    writeFileSync(file, '')
    truncateSync(file, MAX_ATTACHMENT_SIZE + 1)
    await expect(addAttachment(mockClient, 'm1', file, 'too-large.bin')).rejects.toThrow(
      'must not exceed 150 MiB',
    )
    expect(mockClient.post).not.toHaveBeenCalled()
  })
})
