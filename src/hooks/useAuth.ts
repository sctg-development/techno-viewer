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

import { useState, useCallback, useEffect } from 'react'
import type { AuthSession } from '../types'

/** Session storage key used to persist the user authentication session across page reloads within the same tab. */
const SESSION_KEY = 'spot_analyzer_session'

/**
 * Loads the authentication session from sessionStorage.
 * @returns The parsed {@link AuthSession}, or `null` if none is stored or parsing fails.
 */
function loadSession(): AuthSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    return JSON.parse(raw) as AuthSession
  } catch {
    return null
  }
}

/**
 * Persists an authentication session to sessionStorage.
 * @param session - The session to persist.
 */
function saveSession(session: AuthSession): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

/** Removes the authentication session from sessionStorage, effectively logging the user out. */
function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY)
}

/** Return value of the {@link useAuth} hook. */
interface UseAuthReturn {
  session: AuthSession | null
  isAuthenticated: boolean
  login: (username: string, privateKey: string) => void
  logout: () => void
}

/**
 * Manages authentication state backed by sessionStorage.
 * Restores an existing session on mount and exposes login/logout helpers.
 * @returns The current session, an `isAuthenticated` flag, and login/logout handlers.
 */
export function useAuth(): UseAuthReturn {
  const [session, setSession] = useState<AuthSession | null>(loadSession)

  useEffect(() => {
    const stored = loadSession()
    if (stored) setSession(stored)
  }, [])

  const login = useCallback((username: string, privateKey: string) => {
    const s: AuthSession = { username: username.trim(), privateKey: privateKey.trim() }
    saveSession(s)
    setSession(s)
  }, [])

  const logout = useCallback(() => {
    clearSession()
    setSession(null)
  }, [])

  return {
    session,
    isAuthenticated: session !== null && session.privateKey.length > 0,
    login,
    logout,
  }
}
