import { beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import { createMockHttpClient } from '../../helpers'
import { getAutoReply, getSettings, setAutoReply } from '../../../src/providers/outlook/settings'

describe('Outlook automatic replies', () => {
  const mockClient = createMockHttpClient()

  beforeEach(() => vi.clearAllMocks())

  test('uses alwaysEnabled when no schedule is provided', async () => {
    await setAutoReply(mockClient, { enabled: true, internalMessage: 'Away' })
    expect(mockClient.patch).toHaveBeenCalledWith('/mailboxSettings', {
      automaticRepliesSetting: {
        status: 'alwaysEnabled',
        internalReplyMessage: 'Away',
      },
    })
  })

  test('omits unspecified messages and external audience so Graph preserves them', async () => {
    await setAutoReply(mockClient, { enabled: false })

    expect(mockClient.patch).toHaveBeenCalledWith('/mailboxSettings', {
      automaticRepliesSetting: { status: 'disabled' },
    })
  })

  test.each(['none', 'contactsOnly', 'all'] as const)(
    'passes through the supported external audience value %s',
    async (externalAudience) => {
      await setAutoReply(mockClient, { enabled: true, externalAudience })
      expect(mockClient.patch).toHaveBeenCalledWith('/mailboxSettings', {
        automaticRepliesSetting: {
          status: 'alwaysEnabled',
          externalAudience,
        },
      })
    },
  )

  test('returns externalAudience from focused and full settings reads', async () => {
    const automaticRepliesSetting = {
      status: 'alwaysEnabled',
      internalReplyMessage: 'Internal',
      externalReplyMessage: 'External',
      externalAudience: 'contactsOnly',
    }
    ;(mockClient.get as Mock)
      .mockResolvedValueOnce(automaticRepliesSetting)
      .mockResolvedValueOnce({ automaticRepliesSetting })

    await expect(getAutoReply(mockClient)).resolves.toMatchObject({
      externalAudience: 'contactsOnly',
    })
    await expect(getSettings(mockClient)).resolves.toMatchObject({
      automaticReplies: { externalAudience: 'contactsOnly' },
    })
  })

  test('uses scheduled only when both valid dates are provided', async () => {
    await setAutoReply(mockClient, {
      enabled: true,
      startDateTime: '2026-08-01T00:00:00Z',
      endDateTime: '2026-08-02T00:00:00Z',
    })
    const body = (mockClient.patch as Mock).mock.calls[0][1]
    expect(body.automaticRepliesSetting.status).toBe('scheduled')
    expect(body.automaticRepliesSetting.scheduledStartDateTime).toEqual({
      dateTime: '2026-08-01T00:00:00.000', timeZone: 'UTC',
    })
  })

  test('normalizes offset-bearing schedules to UTC dateTimeTimeZone values', async () => {
    await setAutoReply(mockClient, {
      enabled: true,
      startDateTime: '2026-08-01T08:30:00+08:00',
      endDateTime: '2026-08-01T18:45:00+08:00',
    })
    const automaticReplies = (mockClient.patch as Mock).mock.calls[0][1].automaticRepliesSetting
    expect(automaticReplies.scheduledStartDateTime).toEqual({
      dateTime: '2026-08-01T00:30:00.000', timeZone: 'UTC',
    })
    expect(automaticReplies.scheduledEndDateTime).toEqual({
      dateTime: '2026-08-01T10:45:00.000', timeZone: 'UTC',
    })
  })

  test('encodes focused-inbox override IDs as path segments', async () => {
    const { deleteFocusedInboxOverride } = await import('../../../src/providers/outlook/settings')
    await deleteFocusedInboxOverride(mockClient, 'id/with+reserved=chars')
    expect(mockClient.delete).toHaveBeenCalledWith(
      '/inferenceClassification/overrides/id%2Fwith%2Breserved%3Dchars',
    )
  })

  test('rejects incomplete, invalid, and reversed schedules locally', async () => {
    await expect(setAutoReply(mockClient, {
      enabled: true, startDateTime: '2026-08-01T00:00:00Z',
    })).rejects.toThrow('require both')
    await expect(setAutoReply(mockClient, {
      enabled: true, startDateTime: 'nope', endDateTime: 'also-nope',
    })).rejects.toThrow('valid ISO')
    await expect(setAutoReply(mockClient, {
      enabled: true,
      startDateTime: '2026-08-02T00:00:00Z',
      endDateTime: '2026-08-01T00:00:00Z',
    })).rejects.toThrow('later than')
    expect(mockClient.patch).not.toHaveBeenCalled()
  })

  test('strictly validates the auto-reply shape inside the provider', async () => {
    await expect(setAutoReply(mockClient, {
      enabled: 'yes',
    })).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      message: 'Invalid Outlook auto-reply settings',
    })
    await expect(setAutoReply(mockClient, {
      enabled: true,
      automaticRepliesSetting: { status: 'alwaysEnabled' },
    })).rejects.toMatchObject({ code: 'CONFIG_ERROR' })
    await expect(setAutoReply(mockClient, {
      enabled: true,
      externalAudience: 'everyone',
    })).rejects.toMatchObject({ code: 'CONFIG_ERROR' })
    expect(mockClient.patch).not.toHaveBeenCalled()
  })
})
