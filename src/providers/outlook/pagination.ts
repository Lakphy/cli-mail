// Microsoft Graph pagination helpers.

export interface OutlookPageMetadata {
  /** The Graph-provided continuation URL. Treat as opaque. */
  nextLink?: string
  /** Provider cursor consumed by the CLI's provider-neutral token codec. */
  nextPageToken?: string
}

/**
 * Graph continuation URLs carry the original query and cursor. Validate them
 * before handing them to the authenticated HTTP client so a caller cannot use
 * a page token to forward the account bearer token to another origin or API.
 */
export function validateGraphNextLink(
  nextLink: string,
  expectedResourcePath: string,
): string {
  let url: URL
  try {
    url = new URL(nextLink)
  } catch {
    throw new TypeError('Invalid Outlook page token: expected a Microsoft Graph continuation URL')
  }

  if (
    url.protocol !== 'https:'
    || url.hostname !== 'graph.microsoft.com'
    || url.port !== ''
    || url.username !== ''
    || url.password !== ''
  ) {
    throw new TypeError('Invalid Outlook page token: only https://graph.microsoft.com is allowed')
  }

  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    throw new TypeError('Invalid Outlook page token: malformed resource path')
  }

  let expectedPath: string
  try {
    expectedPath = `/v1.0/me${decodeURIComponent(expectedResourcePath)}`
  } catch {
    throw new TypeError('Invalid Outlook resource path')
  }
  if (pathname !== expectedPath) {
    throw new TypeError('Invalid Outlook page token: token does not match this operation')
  }

  return url.toString()
}

export function pageMetadata(nextLink?: string): OutlookPageMetadata {
  return nextLink ? { nextLink, nextPageToken: nextLink } : {}
}
