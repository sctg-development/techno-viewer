/**
 * Copyright (c) Ronan Le Meillat - SCTG Development 2008-2026
 * Licensed under the MIT License
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { Decrypter } from 'age-encryption'
import type { DecryptState } from '../types'
import { encryptedFileCache, type EncryptedCacheStats } from '../services/encryptedFileCache'

/** localStorage key storing whether persistent encrypted caching is enabled. */
const PERSISTENT_CACHE_ENABLED_KEY = 'techno_viewer_persistent_encrypted_cache_enabled'

/** Returns `true` when persistent encrypted caching should be enabled by default. */
function loadPersistentCacheEnabled(): boolean {
  try {
    const raw = localStorage.getItem(PERSISTENT_CACHE_ENABLED_KEY)
    if (raw === null) return true
    return raw !== '0'
  } catch {
    return true
  }
}

/** Stores the persistent encrypted cache preference in localStorage. */
function savePersistentCacheEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(PERSISTENT_CACHE_ENABLED_KEY, enabled ? '1' : '0')
  } catch {
    // Non-blocking preference persistence.
  }
}

/** Runtime metrics exposed to the UI for persistent encrypted cache observability. */
interface PersistentCacheMetrics extends EncryptedCacheStats {
  hits: number
  misses: number
  enabled: boolean
}

/**
 * Describes the source used to satisfy an encrypted file read before decrypting it.
 * `memory` means the already decrypted bytes were reused from the in-memory session cache,
 * `persistent` means encrypted bytes were read from IndexedDB, and `network` means encrypted
 * bytes had to be fetched from the deployed asset URL.
 */
type DecryptSource = 'memory' | 'persistent' | 'network'

/**
 * Wraps decrypted bytes with telemetry metadata that callers can use for analytics.
 * The bytes remain the same value returned by {@link UseAgeDecryptReturn.decrypt}; the
 * extra fields only describe whether the user-visible view was backed by any cache layer.
 */
interface DecryptResult {
  data: Uint8Array
  fromCache: boolean
  source: DecryptSource
}

const EMPTY_CACHE_STATS: EncryptedCacheStats = {
  entries: 0,
  sizeBytes: 0,
  usageBytes: null,
  quotaBytes: null,
  persisted: null,
  limitBytes: 0,
}

/** Return value of the {@link useAgeDecrypt} hook. */
interface UseAgeDecryptReturn {
  decrypt: (url: string) => Promise<Uint8Array | null>
  decryptWithMetadata: (url: string) => Promise<DecryptResult | null>
  decryptBytes: (bytes: Uint8Array) => Promise<Uint8Array | null>
  state: DecryptState
  error: string | null
  reset: () => void
  persistentCacheMetrics: PersistentCacheMetrics
  setPersistentCacheEnabled: (enabled: boolean) => void
  clearPersistentCache: () => Promise<void>
  refreshPersistentCacheMetrics: () => Promise<void>
}

/**
 * Provides AGE decryption utilities with an in-memory URL-keyed cache.
 * @param privateKey - The AGE secret key (must start with `AGE-SECRET-KEY-1`).
 * @returns Decryption functions, the current decryption state, any error message, and a reset helper.
 */
export function useAgeDecrypt(privateKey: string): UseAgeDecryptReturn {
  const [state, setState] = useState<DecryptState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [persistentCacheEnabled, setPersistentCacheEnabledState] = useState<boolean>(loadPersistentCacheEnabled)
  const [persistentCacheStats, setPersistentCacheStats] = useState<EncryptedCacheStats>(EMPTY_CACHE_STATS)
  const persistentCacheHitsRef = useRef(0)
  const persistentCacheMissesRef = useRef(0)
  // Cache decrypted files in memory by URL to avoid repeated decryption in the same session.
  const cache = useRef<Map<string, Uint8Array>>(new Map())

  const refreshPersistentCacheMetrics = useCallback(async (): Promise<void> => {
    const stats = await encryptedFileCache.getStats()
    setPersistentCacheStats(stats)
  }, [])

  useEffect(() => {
    void refreshPersistentCacheMetrics()
  }, [refreshPersistentCacheMetrics])

  const setPersistentCacheEnabled = useCallback((enabled: boolean) => {
    setPersistentCacheEnabledState(enabled)
    savePersistentCacheEnabled(enabled)
  }, [])

  const clearPersistentCache = useCallback(async (): Promise<void> => {
    await encryptedFileCache.clear()
    await refreshPersistentCacheMetrics()
  }, [refreshPersistentCacheMetrics])

  const decryptBytes = useCallback(
    async (bytes: Uint8Array): Promise<Uint8Array | null> => {
      if (!privateKey.trim()) {
        setError('No private key provided')
        setState('error')
        return null
      }
      setState('loading')
      setError(null)
      try {
        const decrypter = new Decrypter()
        decrypter.addIdentity(privateKey.trim())
        const result = await decrypter.decrypt(bytes, 'uint8array')
        setState('success')
        return result
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Decryption failed'
        setError(msg)
        setState('error')
        return null
      }
    },
    [privateKey]
  )

  const decryptWithMetadata = useCallback(
    async (url: string): Promise<DecryptResult | null> => {
      if (cache.current.has(url)) {
        setState('success')
        return {
          data: cache.current.get(url)!,
          fromCache: true,
          source: 'memory',
        }
      }
      if (!privateKey.trim()) {
        setError('No private key provided')
        setState('error')
        return null
      }
      setState('loading')
      setError(null)
      try {
        let encryptedBytes: Uint8Array | null = null
        let source: DecryptSource = 'network'

        if (persistentCacheEnabled) {
          encryptedBytes = await encryptedFileCache.get(url)
          if (encryptedBytes) {
            persistentCacheHitsRef.current += 1
            source = 'persistent'
          }
        }

        if (!encryptedBytes) {
          if (persistentCacheEnabled) {
            persistentCacheMissesRef.current += 1
          }
          const response = await fetch(url)
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
          }
          encryptedBytes = new Uint8Array(await response.arrayBuffer())
          if (persistentCacheEnabled) {
            await encryptedFileCache.set(url, encryptedBytes)
          }
        }

        const decrypter = new Decrypter()
        decrypter.addIdentity(privateKey.trim())
        const result = await decrypter.decrypt(encryptedBytes, 'uint8array')
        cache.current.set(url, result)
        if (persistentCacheEnabled) {
          void refreshPersistentCacheMetrics()
        }
        setState('success')
        return {
          data: result,
          fromCache: source !== 'network',
          source,
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Decryption failed'
        setError(msg)
        setState('error')
        return null
      }
    },
    [privateKey, persistentCacheEnabled, refreshPersistentCacheMetrics]
  )

  const decrypt = useCallback(
    async (url: string): Promise<Uint8Array | null> => {
      const result = await decryptWithMetadata(`${import.meta.env.BASE_URL}${url}`)
      return result?.data ?? null
    },
    [decryptWithMetadata]
  )

  const reset = useCallback(() => {
    setState('idle')
    setError(null)
  }, [])

  return {
    decrypt,
    decryptWithMetadata,
    decryptBytes,
    state,
    error,
    reset,
    persistentCacheMetrics: {
      ...persistentCacheStats,
      enabled: persistentCacheEnabled,
      hits: persistentCacheHitsRef.current,
      misses: persistentCacheMissesRef.current,
    },
    setPersistentCacheEnabled,
    clearPersistentCache,
    refreshPersistentCacheMetrics,
  }
}
