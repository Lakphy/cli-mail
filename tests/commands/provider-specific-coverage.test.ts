import { beforeEach, describe, expect, test, vi } from 'vitest'
import { profileGet } from '../../src/commands/profile'
import {
  categoryCreate,
  categoryDelete,
  categoryList,
  categoryUpdate,
} from '../../src/commands/category'
import { sendAsGet, sendAsList } from '../../src/commands/send-as'
import { fwdAddrList } from '../../src/commands/forwarding-address'
import * as resolveModule from '../../src/commands/resolve'
import * as formatter from '../../src/output/formatter'
import * as gmailProfile from '../../src/providers/gmail/profile'
import * as gmailSettings from '../../src/providers/gmail/settings'
import * as outlookCategories from '../../src/providers/outlook/categories'

vi.mock('../../src/commands/resolve', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/commands/resolve')>(),
  resolveAccount: vi.fn(),
}))
vi.mock('../../src/output/formatter', () => ({
  output: vi.fn(),
  outputList: vi.fn(),
  outputSuccess: vi.fn(),
}))
vi.mock('../../src/providers/gmail/profile', () => ({ getProfile: vi.fn() }))
vi.mock('../../src/providers/gmail/settings', () => ({
  listSendAs: vi.fn(),
  getSendAs: vi.fn(),
  listForwardingAddresses: vi.fn(),
}))
vi.mock('../../src/providers/outlook/categories', () => ({
  listCategories: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
}))
vi.mock('../../src/utils/error', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/utils/error')>(),
  handleError: vi.fn((error: unknown) => { throw error }),
}))

describe('profile command', () => {
  const client = { get: vi.fn() } as never

  beforeEach(() => vi.clearAllMocks())

  test('formats the Gmail profile', async () => {
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({
      account: { provider: 'gmail' } as never,
      client,
    })
    vi.mocked(gmailProfile.getProfile).mockResolvedValue({
      emailAddress: 'me@gmail.test',
      messagesTotal: 42,
      threadsTotal: 17,
      historyId: '1000',
    })

    await profileGet({ account: 'work' })

    expect(resolveModule.resolveAccount).toHaveBeenCalledWith('work')
    expect(gmailProfile.getProfile).toHaveBeenCalledWith(client)
    expect(formatter.output).toHaveBeenCalledWith({
      provider: 'gmail',
      email: 'me@gmail.test',
      totalMessages: 42,
      totalThreads: 17,
      historyId: '1000',
    })
  })

  test.each([
    [{ displayName: 'Alex', mail: 'mail@example.test', userPrincipalName: 'upn@example.test' }, 'mail@example.test'],
    [{ displayName: 'Alex', mail: '', userPrincipalName: 'upn@example.test' }, 'upn@example.test'],
  ])('formats the Outlook profile and email fallback', async (user, email) => {
    const get = vi.fn().mockResolvedValue(user)
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({
      account: { provider: 'outlook' } as never,
      client: { get } as never,
    })

    await profileGet({})

    expect(get).toHaveBeenCalledWith('')
    expect(formatter.output).toHaveBeenCalledWith({
      provider: 'outlook',
      displayName: 'Alex',
      email,
    })
  })

  test('rethrows provider failures through the command error boundary', async () => {
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({
      account: { provider: 'gmail' } as never,
      client,
    })
    vi.mocked(gmailProfile.getProfile).mockRejectedValue(new Error('profile unavailable'))

    await expect(profileGet({})).rejects.toThrow('profile unavailable')
  })
})

describe('Outlook category commands', () => {
  const client = {} as never

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({
      account: { id: 'outlook', provider: 'outlook' } as never,
      client,
    })
  })

  test('lists categories and normalizes an absent color', async () => {
    vi.mocked(outlookCategories.listCategories).mockResolvedValue([
      { id: 'c1', displayName: 'Blue', color: 'preset0' },
      { id: 'c2', displayName: 'No color' },
    ])

    await categoryList({})

    expect(outlookCategories.listCategories).toHaveBeenCalledWith(client)
    expect(formatter.outputList).toHaveBeenCalledWith(
      [
        { id: 'c1', name: 'Blue', color: 'preset0' },
        { id: 'c2', name: 'No color', color: '' },
      ],
      expect.any(Array),
    )
  })

  test('creates, updates, and deletes categories', async () => {
    vi.mocked(outlookCategories.createCategory).mockResolvedValue({
      id: 'c1', displayName: 'Created', color: 'preset1',
    })
    vi.mocked(outlookCategories.updateCategory).mockResolvedValue({
      id: 'c1', displayName: 'Updated', color: 'preset2',
    })

    await categoryCreate({ name: 'Created', color: 'preset1' })
    await categoryUpdate('c1', { name: 'Updated', color: 'preset2' })
    await categoryDelete('c1', {})

    expect(outlookCategories.createCategory).toHaveBeenCalledWith(client, 'Created', 'preset1')
    expect(outlookCategories.updateCategory).toHaveBeenCalledWith(client, 'c1', 'Updated', 'preset2')
    expect(outlookCategories.deleteCategory).toHaveBeenCalledWith(client, 'c1')
    expect(formatter.outputSuccess).toHaveBeenNthCalledWith(
      1,
      'Category created: Created (id: c1)',
    )
    expect(formatter.outputSuccess).toHaveBeenNthCalledWith(2, 'Category updated: Updated')
    expect(formatter.outputSuccess).toHaveBeenNthCalledWith(3, 'Category deleted: c1')
  })

  test('rejects Gmail for category operations', async () => {
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({
      account: { id: 'gmail', provider: 'gmail' } as never,
      client,
    })

    await expect(categoryList({})).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
      provider: 'gmail',
    })
    expect(outlookCategories.listCategories).not.toHaveBeenCalled()
  })
})

describe('Gmail settings helper commands', () => {
  const client = {} as never

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({
      account: { id: 'gmail', provider: 'gmail' } as never,
      client,
    })
  })

  test('lists send-as aliases with stable table values', async () => {
    vi.mocked(gmailSettings.listSendAs).mockResolvedValue([
      {
        sendAsEmail: 'primary@example.test',
        displayName: 'Primary',
        isPrimary: true,
        isDefault: true,
        replyToAddress: 'reply@example.test',
        verificationStatus: 'accepted',
      },
      { sendAsEmail: 'alias@example.test' },
    ])

    await sendAsList({})

    expect(gmailSettings.listSendAs).toHaveBeenCalledWith(client)
    expect(formatter.outputList).toHaveBeenCalledWith(
      [
        {
          email: 'primary@example.test',
          displayName: 'Primary',
          isPrimary: 'yes',
          isDefault: 'yes',
          replyTo: 'reply@example.test',
          verification: 'accepted',
        },
        {
          email: 'alias@example.test',
          displayName: '',
          isPrimary: 'no',
          isDefault: 'no',
          replyTo: '',
          verification: '',
        },
      ],
      expect.any(Array),
    )
  })

  test('gets a send-as alias without reshaping provider data', async () => {
    const alias = { sendAsEmail: 'alias@example.test', isDefault: false }
    vi.mocked(gmailSettings.getSendAs).mockResolvedValue(alias)

    await sendAsGet('alias@example.test', {})

    expect(gmailSettings.getSendAs).toHaveBeenCalledWith(client, 'alias@example.test')
    expect(formatter.output).toHaveBeenCalledWith(alias)
  })

  test('lists forwarding addresses and supplies the unknown status fallback', async () => {
    vi.mocked(gmailSettings.listForwardingAddresses).mockResolvedValue([
      { forwardingEmail: 'verified@example.test', verificationStatus: 'accepted' },
      { forwardingEmail: 'pending@example.test' },
    ])

    await fwdAddrList({})

    expect(gmailSettings.listForwardingAddresses).toHaveBeenCalledWith(client)
    expect(formatter.outputList).toHaveBeenCalledWith(
      [
        { email: 'verified@example.test', status: 'accepted' },
        { email: 'pending@example.test', status: 'unknown' },
      ],
      expect.any(Array),
    )
  })

  test('rejects Outlook for send-as and forwarding commands', async () => {
    vi.mocked(resolveModule.resolveAccount).mockReturnValue({
      account: { id: 'outlook', provider: 'outlook' } as never,
      client,
    })

    await expect(sendAsList({})).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })
    await expect(sendAsGet('alias@example.test', {})).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })
    await expect(fwdAddrList({})).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })
    expect(gmailSettings.listSendAs).not.toHaveBeenCalled()
    expect(gmailSettings.getSendAs).not.toHaveBeenCalled()
    expect(gmailSettings.listForwardingAddresses).not.toHaveBeenCalled()
  })
})
