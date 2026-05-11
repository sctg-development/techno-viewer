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

import { useState } from 'react'
import { Modal, Button } from '@heroui/react'
import { useTranslation } from 'react-i18next'
import { KeyRound, User } from 'lucide-react'
import { useAuthContext } from '../../context/AuthContext'

/** Props for the {@link AuthModal} component. */
interface AuthModalProps {
  /** When true the modal cannot be dismissed */
  required?: boolean
}

/**
 * Modal dialog prompting the user for their AGE private key.
 * Displayed automatically whenever the user is not authenticated.
 * @param required - When `true` the modal cannot be dismissed without a successful login.
 */
export default function AuthModal({ required = false }: AuthModalProps) {
  const { t } = useTranslation()
  const { isAuthenticated, login } = useAuthContext()

  const [username, setUsername] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  // Show modal only when not authenticated
  const open = !isAuthenticated

  /**
   * Validates and submits the login form.
   * @param e - The form submission event.
   */
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    if (!privateKey.trim()) {
      setFormError(t('auth.error_required'))
      return
    }
    if (!privateKey.trim().startsWith('AGE-SECRET-KEY-1')) {
      setFormError(t('auth.error_format'))
      return
    }
    login(username || 'anonymous', privateKey)
  }

  return (
    // Controlled mode: no <Modal> trigger wrapper needed — no PressResponder warning
    <Modal.Backdrop
      isOpen={open}
      onOpenChange={() => { /* noop: modal closes when auth succeeds */ }}
      isDismissable={!required}
      isKeyboardDismissDisabled={required}
    >
      <Modal.Container placement="center">
        <Modal.Dialog className="sm:max-w-md w-full">
          {/* Only show close trigger if modal is not required */}
          {!required && <Modal.CloseTrigger />}

          <Modal.Header>
            <Modal.Icon className="bg-primary/10 text-primary">
              <KeyRound className="size-5" />
            </Modal.Icon>
            <Modal.Heading className="font-mono uppercase tracking-widest text-sm">
              {t('auth.title')}
            </Modal.Heading>
          </Modal.Header>

          <Modal.Body>
            <p className="text-sm text-muted-foreground mb-4 text-primary">
              {t('auth.subtitle')}
            </p>

            <form id="auth-form" onSubmit={handleSubmit} className="space-y-4">
              {/* Username */}
              <div className="space-y-1">
                <label
                  htmlFor="auth-username"
                  className="section-title flex items-center gap-1"
                >
                  <User className="size-3" />
                  {t('auth.username_label')}
                </label>
                <input
                  id="auth-username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t('auth.username_placeholder')}
                  className="w-full px-3 py-2 rounded border border-border bg-surface font-mono text-sm focus:outline-none focus:ring-1 focus:ring-primary text-tertiary"
                />
              </div>

              {/* Private key — password type so browser can save */}
              <div className="space-y-1">
                <label
                  htmlFor="auth-key"
                  className="section-title flex items-center gap-1"
                >
                  <KeyRound className="size-3" />
                  {t('auth.key_label')}
                </label>
                <input
                  id="auth-key"
                  type="password"
                  autoComplete="current-password"
                  value={privateKey}
                  onChange={(e) => setPrivateKey(e.target.value)}
                  placeholder={t('auth.key_placeholder')}
                  required
                  className="w-full px-3 py-2 rounded border border-border bg-surface font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary text-tertiary"
                />
              </div>

              {formError && (
                <p className="text-xs text-tech-red font-mono border border-tech-red/30 px-2 py-1 rounded bg-tech-red/5">
                  {formError}
                </p>
              )}
            </form>
          </Modal.Body>

          <Modal.Footer>
            <Button
              type="submit"
              form="auth-form"
              className="btn-tech w-full bg-primary text-primary-foreground hover:bg-tech-red-dark"
            >
              {t('auth.login')}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}
