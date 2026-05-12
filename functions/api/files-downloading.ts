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

import type { FilesMetricEventProperties } from './types'
import {
  capturePostHogEvent,
  getClientLocation,
  getClientRealIp,
  isPlainObject,
  readAllowedLanguage,
  readJsonBody,
  readNonEmptyString,
  readNullableString,
  jsonResponse,
} from './common'

/**
 * Name of the PostHog event emitted whenever a user starts downloading a ZIP of selected files.
 * The present participle reflects that the event is fired at download start, before ZIP generation completes.
 */
const FILES_DOWNLOADING_EVENT_NAME: string = 'Files Downloading'

/**
 * Handles POST requests from the React application and forwards enriched `Files Downloading` events to PostHog.
 * The browser sends user/language/public-key context plus a per-file array; this function adds Cloudflare-derived
 * network context and keeps the PostHog project token server-side.
 *
 * @param {EventContext<Record<string, string>, string, Record<string, unknown>>} context - Cloudflare Pages Function context.
 * @returns {Promise<Response>} JSON response describing whether the monitoring event was accepted.
 */
export async function onRequestPost(context: { request: Request; env: Record<string, string> }): Promise<Response> {
  const { request, env } = context

  const payload = await readJsonBody(request)
  if (!payload) {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400)
  }

  const normalizedEvent = normalizeFilesDownloadingPayload(payload)
  if (!normalizedEvent) {
    return jsonResponse({ error: 'Invalid files downloading payload.' }, 400)
  }

  return capturePostHogEvent(request, env, FILES_DOWNLOADING_EVENT_NAME, normalizedEvent.user_public_key || normalizedEvent.username, {
    language: normalizedEvent.language,
    username: normalizedEvent.username,
    user_public_key: normalizedEvent.user_public_key,
    files: normalizedEvent.files,
    file_count: normalizedEvent.files.length,
    client_real_ip: getClientRealIp(request),
    client_location: getClientLocation(request),
  } as FilesMetricEventProperties)
}

/**
 * Normalizes and validates the browser-sent batch-download payload.
 * The `files` array must contain at least one object with `file`, `virtual_path`, and `crypted_path` strings.
 *
 * @param {Record<string, unknown>} payload - Raw JSON object received from the browser.
 * @returns {{username: string, language: string, user_public_key: string | null, files: Array<{file: string, virtual_path: string, crypted_path: string}>} | null} Normalized event fields, or `null` if invalid.
 */
function normalizeFilesDownloadingPayload(payload: Record<string, unknown>): {
  username: string;
  language: string;
  user_public_key: string | null;
  files: Array<{ file: string; virtual_path: string; crypted_path: string }>;
} | null {
  const username = readNonEmptyString(payload.username)
  const language = readAllowedLanguage(payload.language)
  const userPublicKey = readNullableString(payload.user_public_key)
  const files = readFilesArray(payload.files)

  if (!username || !language || !files) {
    return null
  }

  return {
    username,
    language,
    user_public_key: userPublicKey,
    files,
  }
}

/**
 * Validates and normalizes the per-file array included in a `Files Downloading` payload.
 * Every entry is trimmed and rewritten into a predictable shape for PostHog.
 *
 * @param {unknown} value - Candidate files array from the request payload.
 * @returns {Array<{file: string, virtual_path: string, crypted_path: string}> | null} Normalized files array, or `null` when invalid.
 */
function readFilesArray(value: unknown): Array<{ file: string; virtual_path: string; crypted_path: string }> | null {
  if (!Array.isArray(value) || value.length === 0) return null

  const files: Array<{ file: string; virtual_path: string; crypted_path: string }> = []
  for (const entry of value) {
    if (!isPlainObject(entry)) return null

    const file = readNonEmptyString(entry.file)
    const virtualPath = readNonEmptyString(entry.virtual_path)
    const cryptedPath = readNonEmptyString(entry.crypted_path)

    if (!file || !virtualPath || !cryptedPath) return null

    files.push({
      file,
      virtual_path: virtualPath,
      crypted_path: cryptedPath,
    })
  }

  return files
}

