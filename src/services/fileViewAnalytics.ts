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

import { identityToRecipient } from 'age-encryption'
import type { Language } from '../types'

/** Backend route that receives minimal file-view telemetry and forwards enriched events to PostHog. */
const FILE_VIEW_ANALYTICS_ENDPOINT = '/api/file-viewed'

/** Backend route that receives batch-download telemetry and forwards enriched events to PostHog. */
const FILES_DOWNLOADING_ANALYTICS_ENDPOINT = '/api/files-downloading'

/** Prefix used by native X25519 AGE private keys accepted by the portal login form. */
const AGE_PRIVATE_KEY_PREFIX = 'AGE-SECRET-KEY-1'

/** Cache of private-key-to-public-recipient derivations for the current browser session. */
const publicKeyCache = new Map<string, string | null>()

/**
 * Minimal browser-side payload sent to the Cloudflare Pages Function.
 * The backend enriches this shape with request-derived IP and Cloudflare location data before
 * posting the final `File Viewed` event to PostHog.
 */
export interface FileViewAnalyticsInput {
  username: string
  privateKey: string
  file: string
  language: Language
  fromCache: boolean
  virtualPath: string
  cryptedPath: string
}

/**
 * Describes one file included in a batch-download analytics event.
 * Each entry carries both the user-facing virtual path and the encrypted asset path so backend
 * monitoring can correlate downloads with either the original repository hierarchy or stored ciphertext.
 */
export interface FilesDownloadingAnalyticsFile {
  file: string
  virtualPath: string
  cryptedPath: string
}

/**
 * Browser-side payload for the `Files Downloading` monitoring event.
 * The payload intentionally mirrors the identity and language fields used by file-view events while moving
 * per-file metadata into the `files` array required for batch downloads.
 */
export interface FilesDownloadingAnalyticsInput {
  username: string
  privateKey: string
  language: Language
  files: FilesDownloadingAnalyticsFile[]
}

/**
 * Network payload posted by the browser to the Cloudflare Pages Function.
 * It intentionally contains the public AGE recipient, not the private key, so analytics can
 * attribute access without disclosing client-side decryption credentials to the backend.
 */
interface FileViewAnalyticsPayload {
  username: string
  file: string
  language: Language
  from_cache: boolean
  user_public_key: string | null
  virtual_path: string
  crypted_path: string
}

/**
 * Network payload posted by the browser to the batch-download Cloudflare Pages Function.
 * `user_public_key` is derived client-side from the private AGE identity, while every file entry keeps
 * snake_case field names to match the PostHog property contract.
 */
interface FilesDownloadingAnalyticsPayload {
  username: string
  language: Language
  user_public_key: string | null
  files: Array<{
    file: string
    virtual_path: string
    crypted_path: string
  }>
}

/**
 * Derives the public AGE recipient for a private identity string.
 * Invalid, empty, or unsupported identities resolve to `null` because telemetry must never block
 * file viewing; the backend will still receive and forward the rest of the event.
 *
 * @param privateKey - AGE private identity entered by the authenticated user.
 * @returns The matching public AGE recipient, or `null` when it cannot be derived.
 */
export async function deriveAgePublicKey(privateKey: string): Promise<string | null> {
  const trimmedPrivateKey = privateKey.trim()
  if (!trimmedPrivateKey.startsWith(AGE_PRIVATE_KEY_PREFIX)) return null

  if (publicKeyCache.has(trimmedPrivateKey)) {
    return publicKeyCache.get(trimmedPrivateKey) ?? null
  }

  try {
    const publicKey = await identityToRecipient(trimmedPrivateKey)
    publicKeyCache.set(trimmedPrivateKey, publicKey)
    return publicKey
  } catch {
    publicKeyCache.set(trimmedPrivateKey, null)
    return null
  }
}

/**
 * Sends a best-effort file-view event to the backend analytics endpoint.
 * The function deliberately catches all errors because analytics failures must not interrupt the
 * document viewer, decryption flow, or user navigation.
 *
 * @param input - Browser-side file-view details collected when a user opens a file for viewing.
 */
export async function trackFileViewed(input: FileViewAnalyticsInput): Promise<void> {
  try {
    const payload: FileViewAnalyticsPayload = {
      username: input.username,
      file: input.file,
      language: input.language,
      from_cache: input.fromCache,
      user_public_key: await deriveAgePublicKey(input.privateKey),
      virtual_path: input.virtualPath,
      crypted_path: input.cryptedPath,
    }

    await fetch(FILE_VIEW_ANALYTICS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      keepalive: true,
    })
  } catch {
    // Best-effort analytics only; file viewing must remain independent from monitoring delivery.
  }
}

/**
 * Sends a best-effort batch-download event to the backend analytics endpoint.
 * The event is emitted when the user starts a ZIP download, before file decryption begins, so monitoring
 * captures intent even if one selected file later fails to decrypt.
 *
 * @param input - Browser-side batch-download details collected from the selected file tree nodes.
 */
export async function trackFilesDownloading(input: FilesDownloadingAnalyticsInput): Promise<void> {
  if (input.files.length === 0) return

  try {
    const payload: FilesDownloadingAnalyticsPayload = {
      username: input.username,
      language: input.language,
      user_public_key: await deriveAgePublicKey(input.privateKey),
      files: input.files.map((file) => ({
        file: file.file,
        virtual_path: file.virtualPath,
        crypted_path: file.cryptedPath,
      })),
    }

    await fetch(FILES_DOWNLOADING_ANALYTICS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      keepalive: true,
    })
  } catch {
    // Best-effort analytics only; ZIP generation must not depend on monitoring delivery.
  }
}
