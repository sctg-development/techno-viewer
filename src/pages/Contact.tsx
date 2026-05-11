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

import { useTranslation } from 'react-i18next'
import { Mail, MapPin, Building2 } from 'lucide-react'

/** Contact page displaying company name, email and address. */
export default function Contact() {
  const { t } = useTranslation()

  return (
    <div className="max-w-2xl mx-auto px-6 py-16 space-y-12">
      <div className="space-y-2">
        <p className="section-title">// {t('contact.title')}</p>
        <h1 className="text-3xl font-bold uppercase tracking-tight">{t('contact.title')}</h1>
        <p className="font-mono text-sm text-ink-600">{t('contact.subtitle')}</p>
      </div>

      <div className="tech-corner border border-border p-8 space-y-6 bg-surface">
        {[
          { icon: <Building2 className="size-4" />, value: t('contact.company') },
          { icon: <Mail className="size-4" />,      value: t('contact.email'),   href: `mailto:${t('contact.email')}` },
          { icon: <MapPin className="size-4" />,     value: t('contact.address') },
        ].map(({ icon, value, href }, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="text-tech-red shrink-0">{icon}</span>
            {href ? (
              <a
                href={href}
                className="font-mono text-sm text-ink-800 hover:text-tech-red transition-colors"
              >
                {value}
              </a>
            ) : (
              <span className="font-mono text-sm text-ink-800">{value}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
