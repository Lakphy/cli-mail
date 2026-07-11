export type BrowserLauncher = (url: string) => Promise<void>

let openModulePromise: Promise<typeof import('open')> | undefined

function loadOpen(): Promise<typeof import('open')> {
  return openModulePromise ??= import('open')
}

/** Open a URL using the platform browser without constructing a shell string. */
export const launchSystemBrowser: BrowserLauncher = async (url) => {
  const { default: open } = await loadOpen()
  await open(url, { wait: false })
}

/** Always show an authorization URL, then make a best-effort browser launch. */
export async function openOrShowUrl(
  url: string,
  launcher: BrowserLauncher,
  notify?: (url: string) => void,
): Promise<void> {
  const showUrl = notify ?? ((authorizationUrl: string) => {
    process.stderr.write(`\nAuthorize cli-mail in your browser:\n${authorizationUrl}\n`)
  })
  showUrl(url)
  try {
    await launcher(url)
  } catch {
    process.stderr.write('Could not open the system browser; use the authorization URL above.\n')
  }
}
