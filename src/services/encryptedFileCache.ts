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


/** IndexedDB database name used for encrypted file caching. */
const DB_NAME = 'INDUSTRIAL-ANALYZER-encrypted-cache'
/** IndexedDB schema version. */
const DB_VERSION = 1
/** Object store name for encrypted file records. */
const STORE_NAME = 'encrypted-files'
/** Maximum cache budget for encrypted payloads (300 MiB). */
const CACHE_LIMIT_BYTES = 300 * 1024 * 1024
/** Required free headroom when checking global origin quota (10 MiB). */
const STORAGE_HEADROOM_BYTES = 10 * 1024 * 1024

interface EncryptedCacheRecord {
  url: string
  data: ArrayBuffer
  size: number
  updatedAt: number
  lastAccessedAt: number
}

/** Snapshot of persistent cache metrics and origin storage estimates. */
export interface EncryptedCacheStats {
  entries: number
  sizeBytes: number
  usageBytes: number | null
  quotaBytes: number | null
  persisted: boolean | null
  limitBytes: number
}

let dbPromise: Promise<IDBDatabase> | null = null
let persistAttempted = false

/** Wraps an IndexedDB request in a promise. */
function waitRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** Resolves when a transaction completes or rejects if it aborts/fails. */
function waitTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error)
    transaction.onerror = () => reject(transaction.error)
  })
}

/** Opens (or reuses) the IndexedDB database used by the encrypted file cache. */
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this environment'))
      return
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'url' })
        store.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

  return dbPromise
}

/** Best-effort request for persistent storage to reduce eviction risk under storage pressure. */
async function requestPersistentStorageOnce(): Promise<void> {
  if (persistAttempted) return
  persistAttempted = true

  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return
    await navigator.storage.persist()
  } catch {
    // Best effort only: cache must continue to work if persist is denied or unsupported.
  }
}

/**
 * Checks whether the origin appears to have enough global free space for a new cache write.
 * Uses StorageManager estimates as a conservative guardrail.
 */
async function hasEnoughGlobalHeadroom(incomingBytes: number): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return true
    const estimate = await navigator.storage.estimate()
    if (typeof estimate.quota !== 'number' || typeof estimate.usage !== 'number') return true
    return estimate.quota - estimate.usage > incomingBytes + STORAGE_HEADROOM_BYTES
  } catch {
    return true
  }
}

/** Recovers all records in the cache store. */
async function getAllRecords(store: IDBObjectStore): Promise<EncryptedCacheRecord[]> {
  const records = await waitRequest(store.getAll() as IDBRequest<EncryptedCacheRecord[]>)
  return records
}

/**
 * Persists encrypted payloads in IndexedDB and evicts least-recently-used entries
 * to stay under a fixed cache budget.
 */
export const encryptedFileCache = {
  /**
   * Reads encrypted bytes from the persistent cache.
   * @param url - Canonical encrypted file URL.
   * @returns Encrypted bytes, or `null` if not found/unavailable.
   */
  async get(url: string): Promise<Uint8Array | null> {
    try {
      const db = await openDb()
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const record = await waitRequest(store.get(url) as IDBRequest<EncryptedCacheRecord | undefined>)

      if (!record) {
        await waitTransaction(tx)
        return null
      }

      const now = Date.now()
      record.lastAccessedAt = now
      store.put(record)
      await waitTransaction(tx)
      return new Uint8Array(record.data)
    } catch {
      return null
    }
  },

  /**
   * Writes encrypted bytes to persistent cache.
   * Evicts least-recently-used entries when needed.
   * @param url - Canonical encrypted file URL.
   * @param bytes - Encrypted payload to persist.
   */
  async set(url: string, bytes: Uint8Array): Promise<void> {
    try {
      if (bytes.byteLength > CACHE_LIMIT_BYTES) return
      if (!(await hasEnoughGlobalHeadroom(bytes.byteLength))) return

      await requestPersistentStorageOnce()

      const db = await openDb()
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)

      const now = Date.now()
      const all = await getAllRecords(store)
      const existing = all.find((record) => record.url === url)

      let total = all.reduce((sum, record) => sum + record.size, 0)
      if (existing) total -= existing.size

      const candidates = all
        .filter((record) => record.url !== url)
        .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt)

      let idx = 0
      while (total + bytes.byteLength > CACHE_LIMIT_BYTES && idx < candidates.length) {
        const victim = candidates[idx]
        store.delete(victim.url)
        total -= victim.size
        idx += 1
      }

      const record: EncryptedCacheRecord = {
        url,
        data: new Uint8Array(bytes).buffer,
        size: bytes.byteLength,
        updatedAt: now,
        lastAccessedAt: now,
      }
      store.put(record)

      await waitTransaction(tx)
    } catch {
      // Best effort only: app behavior must not depend on persistence success.
    }
  },

  /**
   * Clears all entries from the encrypted file cache.
   */
  async clear(): Promise<void> {
    try {
      const db = await openDb()
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).clear()
      await waitTransaction(tx)
    } catch {
      // Best effort only.
    }
  },

  /**
   * Returns current cache metrics and origin storage quota estimates.
   */
  async getStats(): Promise<EncryptedCacheStats> {
    let entries = 0
    let sizeBytes = 0

    try {
      const db = await openDb()
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const all = await getAllRecords(store)
      await waitTransaction(tx)
      entries = all.length
      sizeBytes = all.reduce((sum, record) => sum + record.size, 0)
    } catch {
      // Keep zeroed cache metrics on failure.
    }

    let usageBytes: number | null = null
    let quotaBytes: number | null = null
    let persisted: boolean | null = null

    try {
      if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
        const estimate = await navigator.storage.estimate()
        usageBytes = typeof estimate.usage === 'number' ? estimate.usage : null
        quotaBytes = typeof estimate.quota === 'number' ? estimate.quota : null
      }
      if (typeof navigator !== 'undefined' && navigator.storage?.persisted) {
        persisted = await navigator.storage.persisted()
      }
    } catch {
      // Keep nullable storage-manager fields on failure.
    }

    return {
      entries,
      sizeBytes,
      usageBytes,
      quotaBytes,
      persisted,
      limitBytes: CACHE_LIMIT_BYTES,
    }
  },
}
