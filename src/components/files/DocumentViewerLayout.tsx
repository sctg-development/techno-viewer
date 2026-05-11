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

import { useEffect, useRef, useState } from 'react'
import { Button, Spinner } from '@heroui/react'
import { RefreshCw, AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import FileTree from './FileTree'
import FileViewer from '../viewers/FileViewer'
import BatchDownload from './BatchDownload'
import type { FileNode, Language } from '../../types'

interface PersistentCacheMetrics {
  entries: number
  sizeBytes: number
  usageBytes: number | null
  quotaBytes: number | null
  persisted: boolean | null
  limitBytes: number
  hits: number
  misses: number
  enabled: boolean
}

/** Props for the {@link DocumentViewerLayout} component. */
interface DocumentViewerLayoutProps {
  title: string
  nodes: FileNode[]
  allNodes: FileNode[]
  codeIndexes: Record<string, string>
  activeFile: FileNode | null
  activeContent: Uint8Array | null
  selectedPaths: Set<string>
  treeLoading: boolean
  treeError: string | null
  decryptState: 'idle' | 'loading' | 'success' | 'error'
  decryptError: string | null
  persistentCacheMetrics: PersistentCacheMetrics
  decryptFile: (path: string) => Promise<Uint8Array | null>
  appLanguage: Language
  onSetPersistentCacheEnabled: (enabled: boolean) => void
  onClearPersistentCache: () => Promise<void>
  onRefreshPersistentCacheMetrics: () => Promise<void>
  onSelectFile: (node: FileNode) => void
  onToggleCheck: (path: string) => void
  onDownload: () => void
  onFilesDownloading: () => void
  onReload: () => void
}

interface ViewerFocusLocation {
  path: string
  line: number
  column: number
}

/**
 * Two-panel document viewer layout with a resizable file-tree panel on the left
 * and a file-content viewer on the right.
 * Handles loading/error states for both the file tree and decryption.
 */
export default function DocumentViewerLayout({
  title,
  nodes,
  allNodes,
  codeIndexes,
  activeFile,
  activeContent,
  selectedPaths,
  treeLoading,
  treeError,
  decryptState,
  decryptError,
  persistentCacheMetrics,
  decryptFile,
  appLanguage,
  onSetPersistentCacheEnabled,
  onClearPersistentCache,
  onRefreshPersistentCacheMetrics,
  onSelectFile,
  onToggleCheck,
  onDownload,
  onFilesDownloading,
  onReload,
}: DocumentViewerLayoutProps) {
  const { t } = useTranslation()
  const [leftPanelWidth, setLeftPanelWidth] = useState(384)
  const [isClearingCache, setIsClearingCache] = useState(false)
  const [viewerFocusLocation, setViewerFocusLocation] = useState<ViewerFocusLocation | null>(null)
  const isResizingRef = useRef(false)

  const handleNavigateToDefinition = async (target: FileNode, line: number, column: number) => {
    if (!target.path) return
    setViewerFocusLocation({ path: target.path, line, column })
    onSelectFile(target)
  }

  useEffect(() => {
    const MIN_WIDTH = 280
    const MAX_WIDTH = 720

    const onMouseMove = (event: MouseEvent) => {
      if (!isResizingRef.current) return
      const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, event.clientX))
      setLeftPanelWidth(next)
    }

    const onMouseUp = () => {
      isResizingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  /** Begins a drag-resize interaction on the left panel divider. */
  const handleResizeMouseDown = () => {
    isResizingRef.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  /** Resets the left panel width to its default value on double-click of the divider. */
  const handleResizeDoubleClick = () => {
    setLeftPanelWidth(384)
  }

  const formatBytes = (bytes: number | null): string => {
    if (bytes === null || Number.isNaN(bytes)) return 'n/a'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const globalUsageRatio =
    persistentCacheMetrics.quotaBytes && persistentCacheMetrics.usageBytes !== null
      ? Math.min(100, Math.round((persistentCacheMetrics.usageBytes / persistentCacheMetrics.quotaBytes) * 100))
      : null

  const cacheBudgetRatio =
    persistentCacheMetrics.limitBytes > 0
      ? Math.min(100, Math.round((persistentCacheMetrics.sizeBytes / persistentCacheMetrics.limitBytes) * 100))
      : 0

  const handleClearCache = async () => {
    setIsClearingCache(true)
    try {
      await onClearPersistentCache()
    } finally {
      setIsClearingCache(false)
    }
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* ── Left panel: file tree ────────────────────────── */}
      <aside
        className="shrink-0 border-r border-border flex flex-col overflow-hidden bg-surface/60"
        style={{ width: `${leftPanelWidth}px` }}
      >
        {treeLoading && (
          <div className="flex items-center justify-center flex-1 gap-2 text-ink-600">
            <Spinner size="sm" />
            <span className="font-mono text-xs">{t('files.loading')}</span>
          </div>
        )}
        {treeError && (
          <div className="p-4 text-center space-y-3">
            <AlertTriangle className="size-8 text-tech-red mx-auto" />
            <p className="font-mono text-xs text-ink-600">{t('files.error_load')}</p>
            <Button size="sm" onPress={onReload} className="btn-tech">
              <RefreshCw className="size-3 mr-1" />
              Retry
            </Button>
          </div>
        )}
        {!treeLoading && !treeError && nodes.length > 0 && (
          <>
            <div className="flex-1 overflow-hidden">
              <FileTree
                nodes={nodes}
                selectedPaths={selectedPaths}
                onSelect={onSelectFile}
                onToggleCheck={onToggleCheck}
                activeFilePath={activeFile?.path}
              />
            </div>
            <BatchDownload
              selectedPaths={selectedPaths}
              allNodes={allNodes}
              decryptFile={decryptFile}
              onFilesDownloading={onFilesDownloading}
            />
            <div className="border-t border-border p-3 bg-paper-50/70 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] uppercase tracking-wider text-ink-600">
                  {t('files.cache.title')}
                </span>
                <label className="flex items-center gap-2 text-xs font-mono text-ink-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={persistentCacheMetrics.enabled}
                    onChange={(e) => onSetPersistentCacheEnabled(e.target.checked)}
                    className="w-3 h-3 accent-tech-red"
                  />
                  {persistentCacheMetrics.enabled ? t('files.cache.toggle_on') : t('files.cache.toggle_off')}
                </label>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-ink-600">
                <span>{t('files.cache.entries')}: {persistentCacheMetrics.entries}</span>
                <span>{t('files.cache.size')}: {formatBytes(persistentCacheMetrics.sizeBytes)}</span>
                <span>{t('files.cache.hits')}: {persistentCacheMetrics.hits}</span>
                <span>{t('files.cache.misses')}: {persistentCacheMetrics.misses}</span>
                <span>{t('files.cache.budget')}: {cacheBudgetRatio}%</span>
                <span>
                  {t('files.cache.origin')}: {globalUsageRatio === null ? t('files.cache.not_available') : `${globalUsageRatio}%`}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] text-ink-500">
                  {t('files.cache.persisted')}: {persistentCacheMetrics.persisted === null ? t('files.cache.not_available') : persistentCacheMetrics.persisted ? t('files.cache.yes') : t('files.cache.no')}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => void onRefreshPersistentCacheMetrics()}
                    className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider border border-border rounded text-ink-600 hover:text-tech-red hover:border-tech-red transition-colors"
                  >
                    {t('files.cache.refresh')}
                  </button>
                  <button
                    onClick={() => void handleClearCache()}
                    disabled={isClearingCache}
                    className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider border border-border rounded text-ink-600 hover:text-tech-red hover:border-tech-red transition-colors disabled:opacity-50"
                  >
                    {isClearingCache ? t('files.cache.clearing') : t('files.cache.clear')}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </aside>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('files.resize_panel', { defaultValue: 'Resize panel' })}
        onMouseDown={handleResizeMouseDown}
        onDoubleClick={handleResizeDoubleClick}
        className="w-1 shrink-0 cursor-col-resize bg-border/60 hover:bg-tech-red/60 transition-colors"
      />

      {/* ── Right panel: viewer ──────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {decryptState === 'loading' && !activeContent && (
          <div className="flex items-center justify-center flex-1 gap-3 text-ink-600">
            <Spinner size="sm" />
            <span className="font-mono text-sm">{t('files.decrypt_loading')}</span>
          </div>
        )}
        {decryptState === 'error' && (
          <div className="flex flex-col items-center justify-center flex-1 gap-3 p-6">
            <AlertTriangle className="size-8 text-tech-red" />
            <p className="font-mono text-sm text-center">{decryptError || t('files.decrypt_error')}</p>
          </div>
        )}
        {activeFile && activeContent && decryptState === 'success' && (
          <FileViewer
            node={activeFile}
            data={activeContent}
            allNodes={allNodes}
            codeIndexes={codeIndexes}
            decryptFile={decryptFile}
            onDownload={onDownload}
            onNavigateToDefinition={handleNavigateToDefinition}
            focusLocation={viewerFocusLocation}
            onConsumeFocusLocation={() => setViewerFocusLocation(null)}
            language={appLanguage}
          />
        )}
        {!activeFile && decryptState !== 'loading' && (
          <div className="flex items-center justify-center flex-1 text-ink-400">
            <p className="font-mono text-sm">{t('files.no_selection')}</p>
          </div>
        )}
      </div>
    </div>
  )
}
