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
import { RefreshCw } from 'lucide-react'
import { useDocumentViewerLogic } from '../hooks/useDocumentViewerLogic'
import DocumentViewerLayout from '../components/files/DocumentViewerLayout'
import type { Language } from '../types'

/** Root manifest node id for the AUTOCHEM source-code package. */
const SOURCE_NODE_ID = 'agro-crypt'

/** Source-code page for the encrypted AUTOCHEM package. */
export default function SourceCodePage() {
  const { t, i18n } = useTranslation()
  const logic = useDocumentViewerLogic({ nodeId: SOURCE_NODE_ID })
  const appLang = (['fr', 'en', 'zh'].includes(i18n.language) ? i18n.language : 'en') as Language

  return (
    <div className="h-[calc(100vh-7rem)] flex flex-col">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border">
        <h1 className="section-title">- {t('nav.source_code')}</h1>
        <button
          onClick={logic.reload}
          className="p-1 text-ink-600 hover:text-tech-red transition-colors"
          title="Reload"
        >
          <RefreshCw className="size-4" />
        </button>
      </div>

      <DocumentViewerLayout
        title={t('nav.source_code')}
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
