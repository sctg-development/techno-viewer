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

import type { ClientLocation } from './types'

export const DEFAULT_POSTHOG_HOST: string = 'https://app.posthog.com'

export const JSON_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
}

export function jsonResponse(
  body: Record<string, unknown>,
  status: number = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...headers,
    },
  })
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value = await request.json()
    return isPlainObject(value) ? value : null
  } catch {
    return null
  }
}

export function normalizePostHogHost(host: unknown): string {
  const rawHost = typeof host === 'string' && host.trim().length > 0 ? host.trim() : DEFAULT_POSTHOG_HOST
  return rawHost.replace(/\/+$/, '')
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function readNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return readNonEmptyString(value)
}

export function readAllowedLanguage(value: unknown): 'fr' | 'en' | 'zh' | null {
  if (value === 'fr' || value === 'en' || value === 'zh') return value
  return null
}

export function getClientRealIp(request: Request): string | null {
  const cloudflareIp = request.headers.get('CF-Connecting-IP')
  if (cloudflareIp) return cloudflareIp

  const forwardedFor = request.headers.get('X-Forwarded-For')
  if (!forwardedFor) return null

  return forwardedFor.split(',')[0]?.trim() || null
}

export function getClientLocation(request: Request & { cf?: { city?: string; country?: string } }): ClientLocation {
  return {
    city: request.cf?.city ?? null,
    country: formatCountryName(request.cf?.country),
  }
}

export function formatCountryName(countryCode: unknown): string | null {
  if (typeof countryCode !== 'string' || countryCode.trim().length === 0) return null

  const normalizedCountryCode = countryCode.trim().toUpperCase()
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(normalizedCountryCode) ?? normalizedCountryCode
  } catch {
    return normalizedCountryCode
  }
}

export async function capturePostHogEvent(
  request: Request,
  env: Record<string, string>,
  eventName: string,
  distinctId: string,
  properties: Record<string, unknown>,
): Promise<Response> {
  if (!env.POSTHOG_PROJECT_TOKEN) {
    return jsonResponse({ error: 'POSTHOG_PROJECT_TOKEN is not configured.' }, 500)
  }

  const posthogHost = normalizePostHogHost(env.POSTHOG_HOST)
  const posthogResponse = await fetch(`${posthogHost}/capture/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      api_key: env.POSTHOG_PROJECT_TOKEN,
      event: eventName,
      distinct_id: distinctId,
      properties,
    }),
  })

  if (!posthogResponse.ok) {
    return jsonResponse({ error: 'PostHog capture failed.' }, 502)
  }

  return jsonResponse({ ok: true }, 202)
}
