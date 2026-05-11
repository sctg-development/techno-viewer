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

import type { ReactNode } from 'react'
import AppNavbar from './AppNavbar'
import AuthModal from '../auth/AuthModal'

/** Props for the {@link Layout} component. */
interface LayoutProps {
  children: ReactNode
}

/**
 * Root page layout wrapping every route. Renders the navigation bar, page content, footer,
 * and the mandatory authentication modal.
 * @param children - The page content to render inside the main area.
 */
export default function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen flex flex-col tech-grid-bg">
      <AppNavbar />
      <main className="flex-1">
        {children}
      </main>
      <footer className="border-t border-border py-3 px-6 flex items-center justify-between">
        <span className="coord-marker text-xs">INDUSTRIAL-ANALYZER — ISMO</span>
        <span className="coord-marker text-xs">
          {new Date().getFullYear()}
        </span>
      </footer>
      {/* Auth modal — shown when not authenticated */}
      <AuthModal required />
    </div>
  )
}
