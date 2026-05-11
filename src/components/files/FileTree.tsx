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
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, Eye, Download, Archive } from 'lucide-react'
import type { FileNode } from '../../types'

/** Props for the {@link FileTree} component. */
interface FileTreeProps {
  nodes: FileNode[]
  selectedPaths: Set<string>
  onSelect: (node: FileNode) => void
  onToggleCheck: (path: string) => void
  activeFilePath?: string
}

/** Props for the internal {@link TreeNode} component. */
interface TreeNodeProps {
  node: FileNode
  depth: number
  selectedPaths: Set<string>
  onSelect: (node: FileNode) => void
  onToggleCheck: (path: string) => void
  activeFilePath?: string
}

/**
 * Returns the appropriate file-type badge icon element for a given node type.
 * @param type - The file type from {@link FileNode}.
 * @returns A small labelled badge or icon element.
 */
function getFileIcon(type: FileNode['type']) {
  switch (type) {
    case 'dxf': return <span className="text-[9px] font-mono text-ink-400 border border-ink-400 px-0.5 rounded leading-none">DXF</span>
    case 'pdf': return <span className="text-[9px] font-mono text-tech-red border border-tech-red px-0.5 rounded leading-none">PDF</span>
    case 'cpp': return <span className="text-[9px] font-mono text-blue-600 border border-blue-600 px-0.5 rounded leading-none">C++</span>
    case 'h':   return <span className="text-[9px] font-mono text-purple-600 border border-purple-600 px-0.5 rounded leading-none">.H</span>
    case 'ts':  return <span className="text-[9px] font-mono text-sky-600 border border-sky-600 px-0.5 rounded leading-none">TS</span>
    case 'tsx': return <span className="text-[9px] font-mono text-sky-700 border border-sky-700 px-0.5 rounded leading-none">TSX</span>
    case 'js':  return <span className="text-[9px] font-mono text-amber-600 border border-amber-600 px-0.5 rounded leading-none">JS</span>
    case 'jsx': return <span className="text-[9px] font-mono text-amber-700 border border-amber-700 px-0.5 rounded leading-none">JSX</span>
    case 'rs':  return <span className="text-[9px] font-mono text-orange-700 border border-orange-700 px-0.5 rounded leading-none">RS</span>
    case 'yaml': return <span className="text-[9px] font-mono text-emerald-700 border border-emerald-700 px-0.5 rounded leading-none">YAML</span>
    case 'toml': return <span className="text-[9px] font-mono text-indigo-700 border border-indigo-700 px-0.5 rounded leading-none">TOML</span>
    case 'json': return <span className="text-[9px] font-mono text-cyan-700 border border-cyan-700 px-0.5 rounded leading-none">JSON</span>
    case 'sln': return <span className="text-[9px] font-mono text-violet-700 border border-violet-700 px-0.5 rounded leading-none">SLN</span>
    case 'vcxproj': return <span className="text-[9px] font-mono text-fuchsia-700 border border-fuchsia-700 px-0.5 rounded leading-none">VCXPROJ</span>
    case 'html': return <span className="text-[9px] font-mono text-pink-700 border border-pink-700 px-0.5 rounded leading-none">HTML</span>
    case 'xml': return <span className="text-[9px] font-mono text-gray-700 border border-gray-700 px-0.5 rounded leading-none">XML</span>
    case 'gerber.zip': return <span className="text-[9px] font-mono text-red-700 border border-red-700 px-0.5 rounded leading-none">GERBER</span>
    case 'xlsx': return <span className="text-[9px] font-mono text-green-700 border border-green-700 px-0.5 rounded leading-none">XLSX</span>
    default:    return <File className="size-3 text-ink-400" />
  }
}

/**
 * Renders a single node in the file tree with expand/collapse for folders
 * and checkbox + click-to-preview for files.
 */
function TreeNode({ node, depth, selectedPaths, onSelect, onToggleCheck, activeFilePath }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(depth < 2)

  const isFolder = node.type === 'folder'
  const isChecked = node.path ? selectedPaths.has(node.path) : false
  const isActive = node.path === activeFilePath

  const toggleExpand = useCallback(() => {
    if (isFolder) setExpanded((v) => !v)
  }, [isFolder])

  const handleSelect = useCallback(() => {
    if (!isFolder) onSelect(node)
  }, [isFolder, node, onSelect])

  const handleCheck = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation()
    if (node.path) onToggleCheck(node.path)
  }, [node.path, onToggleCheck])

  return (
    <div>
      <div
        className={`file-tree-item ${isActive ? 'selected' : ''} ${isFolder ? '' : 'cursor-pointer'}`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={isFolder ? toggleExpand : handleSelect}
        role={isFolder ? 'button' : 'listitem'}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            if (isFolder) toggleExpand()
            else handleSelect()
          }
        }}
      >
        {/* Checkbox for files */}
        {!isFolder && node.path && (
          <input
            type="checkbox"
            checked={isChecked}
            onChange={handleCheck}
            onClick={(e) => e.stopPropagation()}
            className="w-3 h-3 accent-tech-red shrink-0"
            aria-label={`Select ${node.name}`}
          />
        )}

        {/* Expand icon for folders */}
        {isFolder && (
          <span className="shrink-0">
            {expanded
              ? <ChevronDown className="size-3 text-ink-400" />
              : <ChevronRight className="size-3 text-ink-400" />
            }
          </span>
        )}

        {/* Folder / file icon */}
        <span className="shrink-0">
          {isFolder
            ? (expanded ? <FolderOpen className="size-3 text-ink-400" /> : <Folder className="size-3 text-ink-400" />)
            : getFileIcon(node.type)
          }
        </span>

        {/* Name */}
        <span className={`truncate ${node.isOld ? 'opacity-50 italic' : ''}`}>
          {node.name}
        </span>
      </div>

      {/* Children */}
      {isFolder && expanded && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedPaths={selectedPaths}
              onSelect={onSelect}
              onToggleCheck={onToggleCheck}
              activeFilePath={activeFilePath}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Renders the full file tree with a toolbar for select-all / deselect-all.
 * Delegates each node to the internal {@link TreeNode} component.
 */
export default function FileTree({
  nodes,
  selectedPaths,
  onSelect,
  onToggleCheck,
  activeFilePath,
}: FileTreeProps) {
  const { t } = useTranslation()

  // Collect all file paths recursively
  /**
   * Recursively collects all file paths from a list of nodes.
   * @param ns - Nodes to traverse.
   * @returns A flat array of all `path` values found in the subtree.
   */
  function collectPaths(ns: FileNode[]): string[] {
    const paths: string[] = []
    for (const n of ns) {
      if (n.path) paths.push(n.path)
      if (n.children) paths.push(...collectPaths(n.children))
    }
    return paths
  }

  const allPaths = collectPaths(nodes)
  const allSelected = allPaths.length > 0 && allPaths.every((p) => selectedPaths.has(p))

  /** Toggles the selection state of every visible file: selects all if any are unselected, otherwise deselects all. */
  function toggleAll() {
    if (allSelected) {
      allPaths.forEach((p) => {
        if (selectedPaths.has(p)) onToggleCheck(p)
      })
    } else {
      allPaths.forEach((p) => {
        if (!selectedPaths.has(p)) onToggleCheck(p)
      })
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <button
          onClick={toggleAll}
          className="text-xs font-mono uppercase tracking-wider text-ink-600 hover:text-tech-red transition-colors flex items-center gap-1"
        >
          <Archive className="size-3" />
          {allSelected ? t('files.deselect_all') : t('files.select_all')}
        </button>
        {selectedPaths.size > 0 && (
          <span className="text-xs font-mono text-tech-red ml-auto">
            {t('files.selected', { count: selectedPaths.size })}
          </span>
        )}
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1" role="list">
        {nodes.map((node) => (
          <TreeNode
            key={node.id}
            node={node}
            depth={0}
            selectedPaths={selectedPaths}
            onSelect={onSelect}
            onToggleCheck={onToggleCheck}
            activeFilePath={activeFilePath}
          />
        ))}
      </div>
    </div>
  )
}
