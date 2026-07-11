// Process-local CLI context shared by command resolution without importing the CLI tree.

let globalAccountAlias: string | undefined

export function getGlobalAccount(): string | undefined {
  return globalAccountAlias
}

export function setGlobalAccount(alias: string | undefined): void {
  globalAccountAlias = alias
}

/** @internal Reset process-local state for tests and repeated programmatic runs. */
export function resetGlobalAccount(): void {
  globalAccountAlias = undefined
}
