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

import { NavLink, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@heroui/react'
import { LogOut, Globe } from 'lucide-react'
import { useAuthContext } from '../../context/AuthContext'
import i18n from '../../i18n'
import type { Language } from '../../types'

/** Available language options shown in the language-switcher control. */
const LANGUAGES: { code: Language; label: string }[] = [
  { code: 'fr', label: 'FR' },
  { code: 'en', label: 'EN' },
  { code: 'zh', label: '中' },
]

/** Top navigation bar including the main route links, language switcher, and authentication status indicator. */
export default function AppNavbar() {
  const { t } = useTranslation()
  const { session, isAuthenticated, logout } = useAuthContext()
  const navigate = useNavigate()

  /**
   * Changes the active application language and persists the choice to localStorage.
   * @param code - The {@link Language} code to switch to.
   */
  function switchLang(code: Language) {
    i18n.changeLanguage(code)
    localStorage.setItem('lang', code)
  }

  /** Logs the user out and redirects to the home page. */
  function handleLogout() {
    logout()
    navigate('/')
  }

  return (
    <header className="border-b border-border bg-paper-50/80 backdrop-blur-sm sticky top-0 z-50">
      {/* Top bar — coordinates + title */}
      <div className="flex items-center justify-between px-6 py-1 border-b border-border/50">
        <span className="coord-marker">X:12</span>
        <span className="font-mono text-xs uppercase tracking-[0.3em] text-ink-600 hidden sm:block">
          SPOT ANALYZER
        </span>
        <span className="coord-marker">Y:08</span>
      </div>

      {/* Main nav */}
      <nav className="flex items-center gap-0 px-4 sm:px-8 h-12 overflow-x-auto">
        {/* Nav links */}
        <div className="flex items-center gap-1 flex-1">
          {[
            { to: '/',          key: 'nav.home' },
            { to: '/docs',      key: 'nav.docs' },
            { to: '/drawings',  key: 'nav.drawings' },
            { to: '/schematics', key: 'nav.schematics' },
            { to: '/source-code', key: 'nav.source_code' },
            { to: '/contact',   key: 'nav.contact' },
          ].map(({ to, key }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `px-3 py-2 text-xs font-mono uppercase tracking-[0.15em] transition-colors whitespace-nowrap
                ${isActive
                  ? 'text-tech-red border-b-2 border-tech-red'
                  : 'text-ink-600 hover:text-ink-800'
                }`
              }
            >
              {t(key)}
            </NavLink>
          ))}
        </div>

        {/* Right section */}
        <div className="flex items-center gap-2 ml-auto shrink-0">
          {/* Language switcher */}
          <div className="flex items-center gap-0 border border-border rounded overflow-hidden">
            <Globe className="size-3 text-ink-400 ml-2 mr-1" />
            {LANGUAGES.map(({ code, label }) => (
              <button
                key={code}
                onClick={() => switchLang(code)}
                className={`px-2 py-1 text-xs font-mono transition-colors
                  ${i18n.language === code
                    ? 'bg-primary text-primary-foreground'
                    : 'text-ink-600 hover:bg-muted'
                  }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Auth status */}
          {isAuthenticated && session && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-ink-600 hidden md:block">
                {session.username}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onPress={handleLogout}
                className="text-xs font-mono uppercase tracking-wider text-ink-600 hover:text-tech-red p-1"
                aria-label={t('auth.logout')}
              >
                <LogOut className="size-3" />
              </Button>
            </div>
          )}
        </div>
      </nav>
    </header>
  )
}
