import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import { ConfigError, errorMessage } from './error.js'

export function getRegularFileSize(path: string, label: string, maxBytes: number): number {
  let descriptor: number | undefined
  try {
    descriptor = openSync(path, 'r')
    const stats = fstatSync(descriptor)
    if (!stats.isFile()) throw new ConfigError(`${label} must be a regular file: ${path}`)
    if (stats.size > maxBytes) {
      throw new ConfigError(`${label} must not exceed ${formatBytes(maxBytes)}: ${path}`)
    }
    return stats.size
  } catch (error) {
    if (error instanceof ConfigError) throw error
    throw new ConfigError(`Unable to read ${label.toLowerCase()}: ${path}`, {
      reason: errorMessage(error),
    })
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

export function readRegularFile(path: string, label: string, maxBytes: number): Buffer {
  let descriptor: number | undefined
  try {
    descriptor = openSync(path, 'r')
    const stats = fstatSync(descriptor)
    if (!stats.isFile()) throw new ConfigError(`${label} must be a regular file: ${path}`)
    if (stats.size > maxBytes) {
      throw new ConfigError(`${label} must not exceed ${formatBytes(maxBytes)}: ${path}`)
    }

    const buffer = Buffer.allocUnsafe(stats.size)
    let offset = 0
    while (offset < stats.size) {
      const count = readSync(descriptor, buffer, offset, stats.size - offset, offset)
      if (count === 0) break
      offset += count
    }
    return offset === buffer.length ? buffer : buffer.subarray(0, offset)
  } catch (error) {
    if (error instanceof ConfigError) throw error
    throw new ConfigError(`Unable to read ${label.toLowerCase()}: ${path}`, {
      reason: errorMessage(error),
    })
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function formatBytes(bytes: number): string {
  return `${Math.floor(bytes / (1024 * 1024))} MiB`
}
