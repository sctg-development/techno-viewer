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

import { useState, useEffect, useCallback } from 'react'
import { Decrypter } from 'age-encryption'
import type { FileTree } from '../types'

/** URL of the encrypted file-tree manifest served alongside the application. */
const FILES_URL = '/files.json.age'

/** Return value of the {@link useFileTree} hook. */
interface UseFileTreeReturn {
  tree: FileTree | null
  loading: boolean
  error: string | null
  reload: () => void
}

/**
 * Fetches, decrypts, and parses the encrypted file-tree manifest.
 * Re-runs whenever `privateKey` changes or `reload` is called.
 * @param privateKey - The AGE secret key used to decrypt the manifest.
 * @returns The parsed {@link FileTree}, loading/error state, and a `reload` trigger.
 */
export function useFileTree(privateKey: string): UseFileTreeReturn {
  const [tree, setTree] = useState<FileTree | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)

  const reload = useCallback(() => setRevision((r) => r + 1), [])

  useEffect(() => {
    if (!privateKey.trim()) return

    let cancelled = false
    setLoading(true)
    setError(null)

    ;(async () => {
      try {
        const response = await fetch(FILES_URL)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const bytes = new Uint8Array(await response.arrayBuffer())
        const decrypter = new Decrypter()
        decrypter.addIdentity(privateKey.trim())
        const decrypted = await decrypter.decrypt(bytes, 'uint8array')
        const json = new TextDecoder().decode(decrypted)
        const data = JSON.parse(json) as FileTree
        if (!cancelled) setTree(data)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load file tree')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [privateKey, revision])

  return { tree, loading, error, reload }
}
