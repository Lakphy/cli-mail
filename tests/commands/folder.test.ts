import { describe, test, expect, beforeEach, vi } from 'vitest'
import { folderList, folderGet, folderMove, folderCopy } from '../../src/commands/folder'
import * as resolveModule from '../../src/commands/resolve'
import * as formatterModule from '../../src/output/formatter'
import * as gmailLabels from '../../src/providers/gmail/labels'
import * as outlookFolders from '../../src/providers/outlook/folders'

vi.mock('../../src/commands/resolve', () => ({ resolveAccount: vi.fn() }))
vi.mock('../../src/output/formatter', () => ({
  output: vi.fn(),
  outputList: vi.fn(),
  outputSuccess: vi.fn(),
}))
vi.mock('../../src/providers/gmail/labels', () => ({
  listLabels: vi.fn(),
  getLabel: vi.fn(),
}))
vi.mock('../../src/providers/outlook/folders', () => ({
  listFolders: vi.fn(),
  getFolder: vi.fn(),
  moveFolder: vi.fn(),
  copyFolder: vi.fn(),
}))
vi.mock('../../src/utils/error', () => ({
  handleError: vi.fn()
}))

describe('Folder Command Handlers', () => {
  const dummyClient = {} as any

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('folderList routes between labels and folders', async () => {
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({ account: { provider: 'gmail' } as any, client: dummyClient })
    vi.mocked(gmailLabels.listLabels).mockResolvedValue([])
    await folderList({})
    expect(gmailLabels.listLabels).toHaveBeenCalledWith(dummyClient)

    vi.mocked(resolveModule.resolveAccount).mockReturnValue({ account: { provider: 'outlook' } as any, client: dummyClient })
    vi.mocked(outlookFolders.listFolders).mockResolvedValue([])
    await folderList({ parent: 'p1' })
    expect(outlookFolders.listFolders).toHaveBeenCalledWith(dummyClient, 'p1')

    expect(formatterModule.outputList).toHaveBeenCalledTimes(2)
  })

  test('folderMove successfully routes to Outlook', async () => {
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({ account: { provider: 'outlook' } as any, client: dummyClient })
    vi.mocked(outlookFolders.moveFolder).mockResolvedValue({ id: 'f-m' } as any)
    
    await folderMove('f-old', { toFolder: 'f-dest' })
    expect(outlookFolders.moveFolder).toHaveBeenCalledWith(dummyClient, 'f-old', 'f-dest')
    expect(formatterModule.output).toHaveBeenCalled()
  })

  test('folderMove throws Error for Gmail', async () => {
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({ account: { provider: 'gmail' } as any, client: dummyClient })
    
    await folderMove('f-old', { toFolder: 'f-dest' })
    const { handleError } = await import('../../src/utils/error')
    expect(handleError).toHaveBeenCalled()
  })
})
