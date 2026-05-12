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

import type { ClientLocation, FileMetricEventProperties } from './types'
/**
 * Name of the PostHog event emitted whenever a user opens a file in the portal viewer.
 * Keeping the event name in one constant prevents accidental spelling drift between releases.
 */
const FILE_VIEWED_EVENT_NAME: string = 'File Viewed'

/**
 * Default PostHog API base URL used when POSTHOG_HOST is not explicitly configured.
 * Cloudflare Pages production deployments should still provide POSTHOG_HOST through the deploy workflow.
 */
const DEFAULT_POSTHOG_HOST: string = 'https://app.posthog.com'

/**
 * HTTP headers returned by every response from this endpoint.
 * The endpoint is same-origin for the SPA, but JSON headers keep local and production behavior explicit.
 */
const JSON_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
}

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

  if (!env.POSTHOG_PROJECT_TOKEN) {
    return jsonResponse({ error: 'POSTHOG_PROJECT_TOKEN is not configured.' }, 500)
  }

  const payload = await readJsonBody(request)
  if (!payload) {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400)
  }

  const normalizedEvent = normalizeFileViewPayload(payload)
  if (!normalizedEvent) {
    return jsonResponse({ error: 'Invalid file view payload.' }, 400)
  }

  const posthogHost = normalizePostHogHost(env.POSTHOG_HOST)
  const posthogResponse = await fetch(`${posthogHost}/capture/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      api_key: env.POSTHOG_PROJECT_TOKEN,
      event: FILE_VIEWED_EVENT_NAME,
      distinct_id: normalizedEvent.user_public_key || normalizedEvent.username,
      properties: {
        file: normalizedEvent.file,
        language: normalizedEvent.language,
        username: normalizedEvent.username,
        user_public_key: normalizedEvent.user_public_key,
        from_cache: normalizedEvent.from_cache,
        virtual_path: normalizedEvent.virtual_path,
        crypted_path: normalizedEvent.crypted_path,
        client_real_ip: getClientRealIp(request),
        client_location: getClientLocation(request),
      } as FileMetricEventProperties,
    }),
  })

  if (!posthogResponse.ok) {
    return jsonResponse({ error: 'PostHog capture failed.' }, 502)
  }

  return jsonResponse({ ok: true }, 202)
}

/**
 * Safely parses a request body as JSON.
 * The function returns `null` on malformed bodies so the request handler can respond with a clean 400
 * instead of leaking parser exceptions to Cloudflare logs and users.
 *
 * @param {Request} request - Incoming Cloudflare Pages request.
 * @returns {Promise<Record<string, unknown> | null>} Parsed JSON object, or `null` when parsing fails.
 */
async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value = await request.json()
    return isPlainObject(value) ? value : null
  } catch {
    return null
  }
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

/**
 * Reads a required non-empty string field from an unknown value.
 * Leading and trailing whitespace is removed so analytics records are stable across user input variants.
 *
 * @param {unknown} value - Candidate value from the request payload.
 * @returns {string | null} Trimmed string, or `null` when the value is missing or empty.
 */
function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Reads an optional string field from an unknown value.
 * `null` and `undefined` are preserved as `null`; non-empty strings are trimmed; all other values are rejected.
 *
 * @param {unknown} value - Candidate optional string value from the request payload.
 * @returns {string | null} Trimmed string or `null`.
 */
function readNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return readNonEmptyString(value)
}

/**
 * Validates the language code sent by the frontend against the portal-supported locales.
 *
 * @param {unknown} value - Candidate language value from the request payload.
 * @returns {'fr' | 'en' | 'zh' | null} Supported language code, or `null` when invalid.
 */
function readAllowedLanguage(value: unknown): 'fr' | 'en' | 'zh' | null {
  if (value === 'fr' || value === 'en' || value === 'zh') return value
  return null
}

/**
 * Returns the visitor IP address provided by Cloudflare.
 * The standard `CF-Connecting-IP` header is preferred; `X-Forwarded-For` is used as a conservative fallback.
 *
 * @param {Request} request - Incoming Cloudflare Pages request.
 * @returns {string | null} Client IP address when available.
 */
function getClientRealIp(request: Request): string | null {
  const cloudflareIp = request.headers.get('CF-Connecting-IP')
  if (cloudflareIp) return cloudflareIp

  const forwardedFor = request.headers.get('X-Forwarded-For')
  if (!forwardedFor) return null

  return forwardedFor.split(',')[0]?.trim() || null
}

/**
 * Extracts city and country details from Cloudflare request metadata.
 * Cloudflare may omit location fields for privacy, local development, or internal traffic, so the response
 * uses nullable properties instead of inventing placeholder locations.
 *
 * @param {Request & {cf?: {city?: string, country?: string}}} request - Incoming request with optional Cloudflare metadata.
 * @returns {{city: string | null, country: string | null}} Location object formatted for PostHog properties.
 */
function getClientLocation(request: Request & { cf?: { city?: string; country?: string } }): ClientLocation {
  return {
    city: request.cf?.city ?? null,
    country: formatCountryName(request.cf?.country),
  }
}

/**
 * Converts Cloudflare's ISO country code into a human-readable English country name.
 * PostHog receives `France` instead of `FR`, matching the analytics property shape expected by the portal owner.
 *
 * @param {unknown} countryCode - ISO 3166-1 alpha-2 country code from Cloudflare request metadata.
 * @returns {string | null} Human-readable country name, original code fallback, or `null` when unavailable.
 */
function formatCountryName(countryCode: unknown): string | null {
  if (typeof countryCode !== 'string' || countryCode.trim().length === 0) return null

  const normalizedCountryCode = countryCode.trim().toUpperCase()
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(normalizedCountryCode) ?? normalizedCountryCode
  } catch {
    return normalizedCountryCode
  }
}

/**
 * Normalizes the PostHog host configured through Cloudflare Pages environment variables.
 * Trailing slashes are removed so endpoint concatenation always produces a single `/capture/` suffix.
 *
 * @param {unknown} host - Raw POSTHOG_HOST environment value.
 * @returns {string} PostHog host URL without trailing slash.
 */
function normalizePostHogHost(host: unknown): string {
  const rawHost = typeof host === 'string' && host.trim().length > 0 ? host.trim() : DEFAULT_POSTHOG_HOST
  return rawHost.replace(/\/+$/, '')
}

/**
 * Checks whether a parsed JSON value is a non-null object and not an array.
 * Pages Functions receive untyped JSON, so this guard keeps validation helpers simple and predictable.
 *
 * @param {unknown} value - Candidate JSON value.
 * @returns {value is Record<string, unknown>} True when the value can be treated as a plain object.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Builds a JSON response with the shared endpoint headers.
 *
 * @param {Record<string, unknown>} body - JSON-serializable response body.
 * @param {number} [status=200] - HTTP status code.
 * @param {Record<string, string>} [headers={}] - Extra headers to merge into the response.
 * @returns {Response} Cloudflare-compatible JSON response.
 */
function jsonResponse(body: Record<string, unknown>, status: number = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...headers,
    },
  })
}

