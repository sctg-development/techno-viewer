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

import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Spinner } from '@heroui/react'
import { Download } from 'lucide-react'
import JSZip from 'jszip'
import type { FileNode } from '../../types'
import { downloadBlob } from '../../utils/download'

/** Props for the {@link BatchDownload} component. */
interface BatchDownloadProps {
  selectedPaths: Set<string>
  /** File nodes used to resolve original names and hierarchy */
  allNodes: FileNode[]
  decryptFile: (path: string) => Promise<Uint8Array | null>
  /** Callback invoked when the user starts a ZIP download so backend monitoring can capture the batch intent. */
  onFilesDownloading: () => void
}

/**
 * Sanitizes a path segment so it remains a safe ZIP entry component.
 */
function sanitizeZipSegment(segment: string): string {
  const sanitized = segment.trim().replace(/[\\/]+/g, '-').replace(/^\.+$/, '')
  return sanitized.length > 0 ? sanitized : 'file'
}

/**
 * Resolves the original relative ZIP path for a file by walking the manifest tree.
 * @param nodes - The node list to search.
 * @param path - The `path` value to look up.
 * @param ancestors - Folder names accumulated while descending the tree.
 * @returns A ZIP entry path using the original folder hierarchy, or `undefined`.
 */
function findZipEntryPath(nodes: FileNode[], path: string, ancestors: string[] = []): string | undefined {
  for (const n of nodes) {
    const nextAncestors = n.type === 'folder' ? [...ancestors, sanitizeZipSegment(n.name)] : ancestors

    if (n.path === path) {
      return [...ancestors, sanitizeZipSegment(n.name)].join('/')
    }

    if (n.children) {
      const found = findZipEntryPath(n.children, path, nextAncestors)
      if (found) return found
    }
  }
  return undefined
}

/**
 * Builds a fallback ZIP entry path when a file cannot be resolved from the manifest tree.
 */
function toFallbackZipEntryPath(path: string, fallbackName?: string): string {
  if (fallbackName && fallbackName.trim().length > 0) {
    return sanitizeZipSegment(fallbackName)
  }

  const encryptedName = path
    .replace(/^\/+/, '')
    .split('/')
    .pop()
    ?.replace(/\.age$/i, '')

  return encryptedName && encryptedName.length > 0 ? sanitizeZipSegment(encryptedName) : 'file'
}

/**
 * Decrypts all selected files using AGE, bundles them into a ZIP archive,
 * and triggers a browser download.
 */
export default function BatchDownload({ selectedPaths, allNodes, decryptFile, onFilesDownloading }: BatchDownloadProps) {
  const { t } = useTranslation()
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState(0)

  const handleBatchDownload = useCallback(async () => {
    if (selectedPaths.size === 0) return

    setDownloading(true)
    setProgress(0)
    onFilesDownloading()

    const zip = new JSZip()
    const paths = Array.from(selectedPaths)
    let done = 0

    try {
      for (const path of paths) {
        const zipEntryPath = findZipEntryPath(allNodes, path) ?? toFallbackZipEntryPath(path)

        const decrypted = await decryptFile(path)
        if (!decrypted) continue

        zip.file(zipEntryPath, decrypted.slice().buffer)

        done++
        setProgress(Math.round((done / paths.length) * 100))
      }

      const blob = await zip.generateAsync({ type: 'blob' })
      downloadBlob(blob, `spot-analyzer-${Date.now()}.zip`)
    } finally {
      setDownloading(false)
      setProgress(0)
    }
  }, [selectedPaths, allNodes, decryptFile, onFilesDownloading])

  if (selectedPaths.size === 0) return null

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-t border-border bg-surface/80">
      <span className="text-xs font-mono text-ink-600">
        {t('files.selected', { count: selectedPaths.size })}
      </span>
      <Button
        size="sm"
        onPress={handleBatchDownload}
        isDisabled={downloading}
        className="btn-tech ml-auto flex items-center gap-1"
      >
        {downloading ? (
          <>
            <Spinner size="sm" />
            <span>{progress}%</span>
          </>
        ) : (
          <>
            <Download className="size-3" />
            {t('files.download_zip')}
          </>
        )}
      </Button>
    </div>
  )
}
