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

import { createContext, useContext, type ReactNode } from 'react'
import type { AuthSession } from '../types'
import { useAuth } from '../hooks/useAuth'

/** Shape of the value provided by {@link AuthContext} to all consumers in the tree. */
interface AuthContextValue {
  session: AuthSession | null
  isAuthenticated: boolean
  login: (username: string, privateKey: string) => void
  logout: () => void
}

/** React context holding the authentication state and control functions. Initialized to `null`; always consumed via {@link useAuthContext}. */
const AuthContext = createContext<AuthContextValue | null>(null)

/**
 * Provides the authentication context to all descendants.
 * @param children - React subtree that will have access to the auth context.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuth()
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>
}

/**
 * Consumes the authentication context.
 * @throws {Error} If used outside of an {@link AuthProvider}.
 * @returns The current {@link AuthContextValue}.
 */
export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuthContext must be used inside <AuthProvider>')
  return ctx
}
