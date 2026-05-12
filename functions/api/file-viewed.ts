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

import type { FileMetricEventProperties } from './types'
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
 * Name of the PostHog event emitted whenever a user opens a file in the portal viewer.
 * Keeping the event name in one constant prevents accidental spelling drift between releases.
 */
const FILE_VIEWED_EVENT_NAME: string = 'File Viewed'

/**
 * Handles POST requests from the React application and forwards enriched `File Viewed` events to PostHog.
 * The browser sends only user/file/cache/public-key context; this function adds Cloudflare-derived network
 * context and keeps the PostHog project token server-side.
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

  const normalizedEvent = normalizeFileViewPayload(payload)
  if (!normalizedEvent) {
    return jsonResponse({ error: 'Invalid file view payload.' }, 400)
  }

  return capturePostHogEvent(request, env, FILE_VIEWED_EVENT_NAME, normalizedEvent.user_public_key || normalizedEvent.username, {
    file: normalizedEvent.file,
    language: normalizedEvent.language,
    username: normalizedEvent.username,
    user_public_key: normalizedEvent.user_public_key,
    from_cache: normalizedEvent.from_cache,
    virtual_path: normalizedEvent.virtual_path,
    crypted_path: normalizedEvent.crypted_path,
    client_real_ip: getClientRealIp(request),
    client_location: getClientLocation(request),
  } as FileMetricEventProperties)
}

/**
 * Normalizes and validates the browser-sent file-view payload.
 * Empty strings are rejected for required attribution fields, while `user_public_key` may be null when
 * the browser cannot derive it from a supported AGE identity.
 *
 * @param {Record<string, unknown>} payload - Raw JSON object received from the browser.
 * @returns {{username: string, file: string, language: string, user_public_key: string | null, from_cache: boolean, virtual_path: string, crypted_path: string} | null} Normalized event fields, or `null` if invalid.
 */
function normalizeFileViewPayload(payload: Record<string, unknown>): {
  username: string;
  file: string;
  language: string;
  user_public_key: string | null;
  from_cache: boolean;
  virtual_path: string;
  crypted_path: string;
} | null {
  const username = readNonEmptyString(payload.username)
  const file = readNonEmptyString(payload.file)
  const language = readAllowedLanguage(payload.language)
  const userPublicKey = readNullableString(payload.user_public_key)
  const virtualPath = readNonEmptyString(payload.virtual_path)
  const cryptedPath = readNonEmptyString(payload.crypted_path)

  if (!username || !file || !language || !virtualPath || !cryptedPath || typeof payload.from_cache !== 'boolean') {
    return null
  }

  return {
    username,
    file,
    language,
    user_public_key: userPublicKey,
    from_cache: payload.from_cache,
    virtual_path: virtualPath,
    crypted_path: cryptedPath,
  }
}

