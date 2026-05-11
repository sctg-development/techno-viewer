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

import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useAuthContext } from '../context/AuthContext'
import { useFileTree } from './useFileTree'
import { useAgeDecrypt } from './useAgeDecrypt'
import { trackFilesDownloading, trackFileViewed, type FilesDownloadingAnalyticsFile } from '../services/fileViewAnalytics'
import type { FileNode } from '../types'

/** Props accepted by the {@link useDocumentViewerLogic} hook. */
interface UseDocumentViewerLogicProps {
  nodeId: string
}

/**
 * Centralises all state and event handlers required by a document-viewer page.
 * Fetches the file tree, manages the active file selection, batch-selection, and single-file download.
 * @param nodeId - The root node identifier used to filter the relevant subtree from the file tree.
 * @returns File-tree state, active viewer state, selection state, and event handler callbacks.
 */
export function useDocumentViewerLogic({ nodeId }: UseDocumentViewerLogicProps) {
  const { session } = useAuthContext()
  const privateKey = session?.privateKey ?? ''

  const { tree, loading: treeLoading, error: treeError, reload } = useFileTree(privateKey)
  const {
    decrypt,
    decryptWithMetadata,
    state: decryptState,
    error: decryptError,
    persistentCacheMetrics,
    setPersistentCacheEnabled,
    clearPersistentCache,
    refreshPersistentCacheMetrics,
  } = useAgeDecrypt(privateKey)

  const [activeFile, setActiveFile] = useState<FileNode | null>(null)
  const [activeContent, setActiveContent] = useState<Uint8Array | null>(null)
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const previousNodeIdRef = useRef(nodeId)

  const currentNodes = useMemo<FileNode[]>(() => {
    if (!tree) return []
    const root = tree.tree.find((n) => n.id === nodeId)
    return root?.children ?? (root ? [root] : [])
  }, [tree, nodeId])

  const allNodes = useMemo(() => flattenNodes(currentNodes), [currentNodes])
  const codeIndexes = useMemo<Record<string, string>>(() => tree?.codeIndexes ?? {}, [tree])
  const virtualRootPath = useMemo(() => buildVirtualRootPath(nodeId), [nodeId])

  /**
   * Opens a document node, decrypts its content, updates the active viewer, and emits a best-effort
   * PostHog-backed monitoring event through the Cloudflare Pages Function.
   * @param node - File-tree node selected by the user or by cross-file source navigation.
   */
  const openFile = useCallback(async (node: FileNode) => {
    if (!node.path) return
    setActiveFile(node)
    setActiveContent(null)
    const result = await decryptWithMetadata(node.path)
    if (!result) return

    setActiveContent(result.data)
    void trackFileViewed({
      username: session?.username ?? 'anonymous',
      privateKey,
      file: node.name,
      language: node.lang ?? extractLanguageFromNodeId(nodeId) ?? 'en',
      fromCache: result.fromCache,
      virtualPath: buildVirtualPath(currentNodes, node, virtualRootPath),
      cryptedPath: node.path,
    })
  }, [currentNodes, decryptWithMetadata, nodeId, privateKey, session?.username, virtualRootPath])

  useEffect(() => {
    const previousNodeId = previousNodeIdRef.current
    if (previousNodeId === nodeId) return

    previousNodeIdRef.current = nodeId

    if (!activeFile) return

    const nextFiles = flattenNodes(currentNodes).filter((n) => n.path && n.type !== 'folder')
    const byPath = new Map(nextFiles.map((n) => [n.path as string, n]))

    let nextNode: FileNode | undefined

    if (activeFile.path) {
      nextNode = byPath.get(activeFile.path)
    }

    if (!nextNode && activeFile.path) {
      const previousLang = extractLanguageFromNodeId(previousNodeId)
      const nextLang = extractLanguageFromNodeId(nodeId)
      if (previousLang && nextLang && previousLang !== nextLang) {
        const remappedPath = swapLanguageSegment(activeFile.path, previousLang, nextLang)
        if (remappedPath) nextNode = byPath.get(remappedPath)
      }
    }

    if (!nextNode) {
      nextNode = nextFiles.find((n) => n.name === activeFile.name && n.type === activeFile.type)
    }

    if (nextNode) {
      void openFile(nextNode)
      return
    }

    setActiveFile(null)
    setActiveContent(null)
  }, [nodeId, currentNodes, activeFile, openFile])

  const handleSelectFile = useCallback(async (node: FileNode) => {
    await openFile(node)
  }, [openFile])

  const handleToggleCheck = useCallback((path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const handleDownload = useCallback(() => {
    if (!activeFile || !activeContent) return

    if (activeFile.path) {
      void trackFilesDownloading({
        username: session?.username ?? 'anonymous',
        privateKey,
        language: extractLanguageFromNodeId(nodeId) ?? 'en',
        files: [{
          file: activeFile.name,
          virtualPath: buildVirtualPath(currentNodes, activeFile, virtualRootPath),
          cryptedPath: activeFile.path,
        }],
      })
    }

    const bytes = activeContent.slice()
    const blob = new Blob([bytes.buffer])
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = activeFile.name
    a.click()
    URL.revokeObjectURL(url)
  }, [activeFile, activeContent, currentNodes, nodeId, privateKey, session?.username, virtualRootPath])

  /**
   * Emits the `Files Downloading` monitoring event for the current batch selection.
   * The selected encrypted paths are resolved back to manifest nodes so the event includes the filename,
   * virtual path, and encrypted path for each downloaded ZIP entry.
   */
  const handleFilesDownloading = useCallback(() => {
    const selectedFiles = resolveSelectedAnalyticsFiles(currentNodes, selectedPaths, virtualRootPath)
    void trackFilesDownloading({
      username: session?.username ?? 'anonymous',
      privateKey,
      language: extractLanguageFromNodeId(nodeId) ?? 'en',
      files: selectedFiles,
    })
  }, [currentNodes, nodeId, privateKey, selectedPaths, session?.username, virtualRootPath])

  const clearSelection = useCallback(() => {
    setActiveFile(null)
    setActiveContent(null)
  }, [])

  return {
    privateKey,
    decrypt,
    currentNodes,
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
    setPersistentCacheEnabled,
    clearPersistentCache,
    refreshPersistentCacheMetrics,
    handleSelectFile,
    handleToggleCheck,
    handleDownload,
    handleFilesDownloading,
    clearSelection,
    reload,
  }
}

/**
 * Recursively flattens a tree of {@link FileNode} objects into a depth-first flat array.
 * @param nodes - Top-level nodes to flatten.
 * @returns All nodes including descendants, in depth-first order.
 */
function flattenNodes(nodes: FileNode[]): FileNode[] {
  const result: FileNode[] = []
  for (const n of nodes) {
    result.push(n)
    if (n.children) result.push(...flattenNodes(n.children))
  }
  return result
}

/**
 * Builds the stable virtual root segment used in analytics from a manifest root node id.
 * Language-scoped roots such as `drawings-en` become `drawings/en`, matching the original
 * repository hierarchy exposed to users before encryption.
 *
 * @param nodeId - Manifest root node identifier for the current viewer page.
 * @returns Virtual root path segment used as a prefix for viewed files.
 */
function buildVirtualRootPath(nodeId: string): string {
  const language = extractLanguageFromNodeId(nodeId)
  if (!language) return nodeId

  return `${nodeId.replace(/-(fr|en|zh)$/, '')}/${language}`
}

/**
 * Builds the full virtual path of a file by walking the visible manifest subtree.
 * If the selected node cannot be found for any reason, the function falls back to the root plus
 * the file name so monitoring still receives a useful human-readable path.
 *
 * @param nodes - Visible root children for the current document viewer.
 * @param target - File node being opened by the user.
 * @param rootPath - Virtual root path derived from the current manifest node id.
 * @returns Full virtual path such as `drawings/en/folder/file.dxf`.
 */
function buildVirtualPath(nodes: FileNode[], target: FileNode, rootPath: string): string {
  const childPath = findVirtualChildPath(nodes, target)
  return [rootPath, childPath ?? target.name].filter(Boolean).join('/')
}

/**
 * Recursively searches a manifest subtree for a selected file and returns its relative virtual path.
 * Matching prefers the encrypted path because it is globally unique in the manifest; the node id is used
 * as a secondary identifier for file nodes that might not have an encrypted path.
 *
 * @param nodes - Nodes to inspect.
 * @param target - File node whose virtual path should be resolved.
 * @param ancestors - Folder names already traversed while descending the tree.
 * @returns Relative virtual path beneath the viewer root, or `null` when the target is not found.
 */
function findVirtualChildPath(nodes: FileNode[], target: FileNode, ancestors: string[] = []): string | null {
  for (const node of nodes) {
    const nextAncestors = [...ancestors, node.name]
    const sameEncryptedPath = Boolean(node.path && target.path && node.path === target.path)
    const sameNodeId = node.id === target.id

    if (sameEncryptedPath || sameNodeId) {
      return nextAncestors.join('/')
    }

    if (node.children) {
      const childPath = findVirtualChildPath(node.children, target, nextAncestors)
      if (childPath) return childPath
    }
  }

  return null
}

/**
 * Resolves the currently selected encrypted paths into batch-download analytics file entries.
 * Missing paths are ignored because the selection UI only works with manifest paths and any mismatch would
 * indicate stale state after a tree reload.
 *
 * @param nodes - Visible root children for the current document viewer.
 * @param selectedPaths - Encrypted paths selected by the user for ZIP download.
 * @param rootPath - Virtual root path derived from the current manifest node id.
 * @returns Per-file analytics entries for the `Files Downloading` event.
 */
function resolveSelectedAnalyticsFiles(
  nodes: FileNode[],
  selectedPaths: Set<string>,
  rootPath: string
): FilesDownloadingAnalyticsFile[] {
  const selectedFiles: FilesDownloadingAnalyticsFile[] = []

  for (const selectedPath of selectedPaths) {
    const node = findNodeByEncryptedPath(nodes, selectedPath)
    if (!node?.path) continue

    selectedFiles.push({
      file: node.name,
      virtualPath: buildVirtualPath(nodes, node, rootPath),
      cryptedPath: node.path,
    })
  }

  return selectedFiles
}

/**
 * Finds a file node by its encrypted asset path in a manifest subtree.
 * The function preserves the tree as the source of truth for metadata instead of trusting selected paths alone.
 *
 * @param nodes - Nodes to inspect.
 * @param path - Encrypted asset path selected by the user.
 * @returns Matching file node, or `null` when the path is not present in the current tree.
 */
function findNodeByEncryptedPath(nodes: FileNode[], path: string): FileNode | null {
  for (const node of nodes) {
    if (node.path === path) return node

    if (node.children) {
      const child = findNodeByEncryptedPath(node.children, path)
      if (child) return child
    }
  }

  return null
}

/** Extracts language suffix from a node id such as `doc-en` or `drawings-zh`. */
function extractLanguageFromNodeId(nodeId: string): 'fr' | 'en' | 'zh' | null {
  const match = nodeId.match(/-(fr|en|zh)$/)
  if (!match) return null
  return match[1] as 'fr' | 'en' | 'zh'
}

/** Replaces one language path segment (`fr|en|zh`) with another in a URL-like path. */
function swapLanguageSegment(path: string, fromLang: 'fr' | 'en' | 'zh', toLang: 'fr' | 'en' | 'zh'): string | null {
  const parts = path.split('/')
  const index = parts.findIndex((part) => part === fromLang)
  if (index === -1) return null
  parts[index] = toLang
  return parts.join('/')
}
