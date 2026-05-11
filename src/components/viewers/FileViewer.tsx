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

import { Suspense, lazy } from 'react'
import { useTranslation } from 'react-i18next'
import { Spinner } from '@heroui/react'
import { Download } from 'lucide-react'
import type { FileNode } from '../../types'
import type { Language } from '../../types'
import MonacoViewer from './MonacoViewer.tsx'

/** Lazily loaded DXF viewer component to keep the main bundle small. */
const DxfViewer = lazy(() => import('./DxfViewer'))
/** Lazily loaded PDF viewer component to keep the main bundle small. */
const PdfViewer = lazy(() => import('./PdfViewer'))
/** Lazily loaded Gerber viewer component for .gerber.zip archives. */
const GerberViewer = lazy(() => import('./GerberViewer'))
/** Lazily loaded XLSX viewer component for Excel spreadsheets. */
const XlsxViewer = lazy(() => import('./XlsxViewer'))

/** Returns `true` when a node type should be rendered as source code. */
function isCodeNodeType(type: FileNode['type']): boolean {
  return ['cpp', 'h', 'ts', 'tsx', 'js', 'jsx', 'rs', 'yaml', 'toml', 'json', 'sln', 'vcxproj', 'html', 'xml'].includes(type)
}

function isGerberZipNode(node: FileNode): boolean {
  return node.type === 'gerber.zip' && node.name.toLowerCase().endsWith('.gerber.zip')
}

interface ViewerFocusLocation {
  path: string
  line: number
  column: number
}

/** Props for the {@link FileViewer} component. */
interface FileViewerProps {
  node: FileNode
  data: Uint8Array
  allNodes: FileNode[]
  codeIndexes: Record<string, string>
  decryptFile: (path: string) => Promise<Uint8Array | null>
  onDownload: () => void
  onNavigateToDefinition: (target: FileNode, line: number, column: number) => void
  focusLocation: ViewerFocusLocation | null
  onConsumeFocusLocation: () => void
  language?: Language
}

/** Fallback UI displayed while a lazily loaded viewer chunk is being fetched. */
function LoadingFallback() {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-center h-full gap-3 text-ink-600">
      <Spinner size="sm" />
      <span className="font-mono text-sm">{t('viewer.loading')}</span>
    </div>
  )
}

/**
 * Dispatches to the appropriate viewer (DXF, PDF, C++ source, or generic download)
 * based on the node's file type.
 * @param node - The file metadata node.
 * @param data - Decrypted file bytes.
 * @param onDownload - Callback invoked when the user requests a file download.
 * @param language - Current UI language, forwarded to the CAD viewer locale.
 */
export default function FileViewer({
  node,
  data,
  allNodes,
  codeIndexes,
  decryptFile,
  onDownload,
  onNavigateToDefinition,
  focusLocation,
  onConsumeFocusLocation,
  language = 'en',
}: FileViewerProps) {
  const { t } = useTranslation()

  // Map language to cad-viewer locale
  const cadLocale = language === 'zh' ? 'zh' : 'en'

  return (
    <div className="flex flex-col h-full">
      {/* Viewer toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-surface/80 shrink-0">
        <span className="font-mono text-xs text-ink-600 truncate">{node.name}</span>
        <button
          onClick={onDownload}
          className="flex items-center gap-1 text-xs font-mono uppercase tracking-wider text-ink-600 hover:text-tech-red transition-colors"
          title={t('viewer.download')}
        >
          <Download className="size-3" />
          {t('files.download')}
        </button>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-hidden">
        <Suspense fallback={<LoadingFallback />}>
          {(node.type === 'dxf') && (
            <DxfViewer data={data} fileName={node.name} locale={cadLocale} />
          )}
          {node.type === 'pdf' && (
            <PdfViewer data={data} fileName={node.name} />
          )}
          {isCodeNodeType(node.type) && (
            <MonacoViewer
              node={node}
              data={data}
              allNodes={allNodes}
              codeIndexes={codeIndexes}
              decryptFile={decryptFile}
              onNavigateToDefinition={onNavigateToDefinition}
              focusLocation={focusLocation}
              onConsumeFocusLocation={onConsumeFocusLocation}
            />
          )}
          {isGerberZipNode(node) && (
            <GerberViewer data={data} fileName={node.name} useStorage={false} showNav={true} showLoadFiles={false} showAnalyticsOptin={false} />
          )}
          {node.type === 'xlsx' && (
            <XlsxViewer data={data} fileName={node.name} />
          )}
          {node.type === 'other' && !isGerberZipNode(node) && (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-ink-600">
              <p className="font-mono text-sm">{t('viewer.error')}</p>
              <button
                onClick={onDownload}
                className="btn-tech flex items-center gap-2 px-4 py-2 border border-ink-400 rounded hover:border-tech-red hover:text-tech-red transition-colors"
              >
                <Download className="size-4" />
                {t('viewer.download')}
              </button>
            </div>
          )}
        </Suspense>
      </div>
    </div>
  )
}
