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
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import { useDocumentViewerLogic } from '../hooks/useDocumentViewerLogic'
import DocumentViewerLayout from '../components/files/DocumentViewerLayout'
import type { Language } from '../types'

/** Language filter for the documentation tree. */
type DocLang ='fr' | 'en' | 'zh'

/** Documentation page. Allows the user to browse, preview, and download encrypted documentation filtered by language. */
export default function DocumentationPage() {
  const { t, i18n } = useTranslation()
  const [docLang, setDocLang] = useState<DocLang>('fr')

  const logic = useDocumentViewerLogic({ nodeId: `doc-${docLang}` })

  /**
   * Switches the active documentation language.
   * If the same file exists in the new language, it is reopened automatically.
   * @param lang - The target {@link DocLang}.
   */
  const handleLangChange = (lang: DocLang) => {
    setDocLang(lang)
  }

  const appLang = (['fr', 'en', 'zh'].includes(i18n.language) ? i18n.language : 'en') as Language

  return (
    <div className="h-[calc(100vh-7rem)] flex flex-col">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border">
        <h1 className="section-title">— {t('nav.docs')}</h1>
        <div className="flex items-center gap-2">
          <div className="flex border border-border rounded overflow-hidden">
            {(['en', 'zh'] as DocLang[]).map((lang) => (
              <button
                key={lang}
                onClick={() => handleLangChange(lang)}
                className={`px-3 py-1 text-xs font-mono uppercase transition-colors
                  ${docLang === lang
                    ? 'bg-primary text-primary-foreground'
                    : 'text-ink-600 hover:bg-muted'
                  }`}
              >
                {t(`files.lang_${lang}`)}
              </button>
            ))}
          </div>
          <button onClick={logic.reload} className="p-1 text-ink-600 hover:text-tech-red transition-colors">
            <RefreshCw className="size-4" />
          </button>
        </div>
      </div>

      <DocumentViewerLayout
        title={t('nav.docs')}
        nodes={logic.currentNodes}
        allNodes={logic.allNodes}
        codeIndexes={logic.codeIndexes}
        activeFile={logic.activeFile}
        activeContent={logic.activeContent}
        selectedPaths={logic.selectedPaths}
        treeLoading={logic.treeLoading}
        treeError={logic.treeError}
        decryptState={logic.decryptState}
        decryptError={logic.decryptError}
        persistentCacheMetrics={logic.persistentCacheMetrics}
        decryptFile={logic.decrypt}
        appLanguage={appLang}
        onSetPersistentCacheEnabled={logic.setPersistentCacheEnabled}
        onClearPersistentCache={logic.clearPersistentCache}
        onRefreshPersistentCacheMetrics={logic.refreshPersistentCacheMetrics}
        onSelectFile={logic.handleSelectFile}
        onToggleCheck={logic.handleToggleCheck}
        onDownload={logic.handleDownload}
        onFilesDownloading={logic.handleFilesDownloading}
        onReload={logic.reload}
      />
    </div>
  )
}
