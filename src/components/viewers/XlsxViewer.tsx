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

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { read, utils, WorkBook } from 'xlsx'
import { useTranslation } from 'react-i18next'
import { Spinner } from '@heroui/react'

const MIN_COLUMN_WIDTH = 64
const MIN_ROW_HEIGHT = 24
const DEFAULT_COLUMN_WIDTH = 96
const DEFAULT_ROW_HEIGHT = 28
const ROW_HEADER_WIDTH = 36

type DragState =
  | {
      kind: 'column'
      index: number
      startPointer: number
      startSize: number
    }
  | {
      kind: 'row'
      index: number
      startPointer: number
      startSize: number
    }
  | null

function estimateTextWidth(value: string): number {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return 0
  return normalized.length * 8
}

function estimateRowLineCount(value: string): number {
  if (!value) return 1
  const lines = value.split(/\r?\n/)
  return Math.max(1, ...lines.map((line) => Math.ceil(Math.max(line.length, 1) / 32)))
}

/** Props for the {@link XlsxViewer} component. */
interface XlsxViewerProps {
  /** The binary data of the XLSX file. */
  data: Uint8Array
  /** The name of the file. */
  fileName: string
}

/**
 * A viewer component for XLSX files that resembles an Excel spreadsheet with tabs at the bottom.
 *
 * @param props - The component props.
 * @returns The rendered component.
 */
export default function XlsxViewer({ data, fileName }: XlsxViewerProps) {
  const { t } = useTranslation()
  const [workbook, setWorkbook] = useState<WorkBook | null>(null)
  const [activeSheetIndex, setActiveSheetIndex] = useState(0)
  const [columnWidths, setColumnWidths] = useState<number[]>([])
  const [rowHeights, setRowHeights] = useState<number[]>([])
  const dragStateRef = useRef<DragState>(null)

  useEffect(() => {
    try {
      const wb = read(data, { type: 'array' })
      setWorkbook(wb)
      setActiveSheetIndex(0)
    } catch (error) {
      console.error('Failed to parse XLSX file', error)
    }
  }, [data])

  const gridData = useMemo(() => {
    if (!workbook || !workbook.SheetNames[activeSheetIndex]) return null
    const sheetName = workbook.SheetNames[activeSheetIndex]
    const worksheet = workbook.Sheets[sheetName]
    if (!worksheet || !worksheet['!ref']) return null

    const range = utils.decode_range(worksheet['!ref'])
    const rows: string[][] = []

    for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
      const row: string[] = []
      for (let colIndex = range.s.c; colIndex <= range.e.c; colIndex += 1) {
        const cellAddress = utils.encode_cell({ r: rowIndex, c: colIndex })
        const cell = worksheet[cellAddress]
        row.push(cell ? utils.format_cell(cell) : '')
      }
      rows.push(row)
    }

    const columnLabels = Array.from(
      { length: range.e.c - range.s.c + 1 },
      (_, index) => utils.encode_col(range.s.c + index),
    )

    const sourceColumns = worksheet['!cols'] ?? []
    const defaultColumnWidths = Array.from({ length: columnLabels.length }, (_, index) => {
      const column = sourceColumns[range.s.c + index]
      const wpx = typeof column?.wpx === 'number' ? column.wpx : undefined
      return Math.max(MIN_COLUMN_WIDTH, Math.round(wpx ?? DEFAULT_COLUMN_WIDTH))
    })

    const sourceRows = worksheet['!rows'] ?? []
    const defaultRowHeights = Array.from({ length: rows.length }, (_, index) => {
      const row = sourceRows[range.s.r + index]
      const hpx = typeof row?.hpx === 'number' ? row.hpx : undefined
      return Math.max(MIN_ROW_HEIGHT, Math.round(hpx ?? DEFAULT_ROW_HEIGHT))
    })

    return { rows, columnLabels, defaultColumnWidths, defaultRowHeights }
  }, [workbook, activeSheetIndex])

  useEffect(() => {
    if (!gridData) {
      setColumnWidths([])
      setRowHeights([])
      return
    }
    setColumnWidths(gridData.defaultColumnWidths)
    setRowHeights(gridData.defaultRowHeights)
  }, [gridData])

  const handleColumnResizeStart = useCallback((index: number, event: React.MouseEvent) => {
    event.preventDefault()
    dragStateRef.current = {
      kind: 'column',
      index,
      startPointer: event.clientX,
      startSize: columnWidths[index] ?? DEFAULT_COLUMN_WIDTH,
    }
  }, [columnWidths])

  const handleRowResizeStart = useCallback((index: number, event: React.MouseEvent) => {
    event.preventDefault()
    dragStateRef.current = {
      kind: 'row',
      index,
      startPointer: event.clientY,
      startSize: rowHeights[index] ?? DEFAULT_ROW_HEIGHT,
    }
  }, [rowHeights])

  const autoFitColumn = useCallback((index: number) => {
    if (!gridData) return
    const headerWidth = estimateTextWidth(gridData.columnLabels[index] ?? '') + 26
    const widestCell = gridData.rows.reduce((maxWidth, row) => {
      const width = estimateTextWidth(String(row[index] ?? '')) + 20
      return Math.max(maxWidth, width)
    }, 0)

    const nextWidth = Math.min(560, Math.max(MIN_COLUMN_WIDTH, headerWidth, widestCell))
    setColumnWidths((previous) => {
      const next = [...previous]
      next[index] = nextWidth
      return next
    })
  }, [gridData])

  const autoFitRow = useCallback((index: number) => {
    if (!gridData) return
    const row = gridData.rows[index]
    if (!row) return
    const lineCount = row.reduce((maxLines, value) => {
      return Math.max(maxLines, estimateRowLineCount(String(value ?? '')))
    }, 1)
    const nextHeight = Math.min(180, Math.max(MIN_ROW_HEIGHT, 12 + lineCount * 16))
    setRowHeights((previous) => {
      const next = [...previous]
      next[index] = nextHeight
      return next
    })
  }, [gridData])

  useEffect(() => {
    const handlePointerMove = (event: MouseEvent) => {
      const dragState = dragStateRef.current
      if (!dragState) return

      if (dragState.kind === 'column') {
        const delta = event.clientX - dragState.startPointer
        const width = Math.max(MIN_COLUMN_WIDTH, dragState.startSize + delta)
        setColumnWidths((previous) => {
          const next = [...previous]
          next[dragState.index] = width
          return next
        })
      } else {
        const delta = event.clientY - dragState.startPointer
        const height = Math.max(MIN_ROW_HEIGHT, dragState.startSize + delta)
        setRowHeights((previous) => {
          const next = [...previous]
          next[dragState.index] = height
          return next
        })
      }
    }

    const handlePointerUp = () => {
      dragStateRef.current = null
    }

    window.addEventListener('mousemove', handlePointerMove)
    window.addEventListener('mouseup', handlePointerUp)
    return () => {
      window.removeEventListener('mousemove', handlePointerMove)
      window.removeEventListener('mouseup', handlePointerUp)
    }
  }, [])

  if (!workbook) {
    return (
      <div className="flex items-center justify-center h-full gap-3 text-ink-600">
        <Spinner size="sm" />
        <span className="font-mono text-sm">{t('viewer.loading')}</span>
      </div>
    )
  }

  if (!gridData) {
    return (
      <div className="flex items-center justify-center h-full gap-3 text-ink-600">
        <span className="font-mono text-sm">{t('viewer.error')} ({fileName})</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-[#f3f4f6] dark:bg-ink-900 overflow-hidden">
      <div className="px-4 py-2 border-b border-[#d1d5db] bg-[#f9fafb] dark:bg-ink-900 dark:border-ink-700">
        <span className="font-mono text-xs text-ink-600 dark:text-ink-300">{fileName}</span>
      </div>

      <div className="flex-1 overflow-auto p-4 xlsx-content bg-[#f3f4f6] dark:bg-ink-950">
        <div className="xlsx-table-wrapper">
          <table>
            <thead>
              <tr>
                <th
                  className="corner-cell"
                  style={{
                    width: ROW_HEADER_WIDTH,
                    minWidth: ROW_HEADER_WIDTH,
                    maxWidth: ROW_HEADER_WIDTH,
                  }}
                />
                {gridData.columnLabels.map((columnLabel, colIndex) => (
                  <th
                    key={columnLabel}
                    className="column-header"
                    style={{
                      width: columnWidths[colIndex] ?? DEFAULT_COLUMN_WIDTH,
                      minWidth: columnWidths[colIndex] ?? DEFAULT_COLUMN_WIDTH,
                      maxWidth: columnWidths[colIndex] ?? DEFAULT_COLUMN_WIDTH,
                    }}
                  >
                    {columnLabel}
                    <button
                      type="button"
                      className="col-resizer"
                      aria-label={`Resize column ${columnLabel}`}
                      onMouseDown={(event) => handleColumnResizeStart(colIndex, event)}
                      onDoubleClick={() => autoFitColumn(colIndex)}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {gridData.rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex + 1}`}>
                  <th
                    className="row-header"
                    style={{
                      width: ROW_HEADER_WIDTH,
                      minWidth: ROW_HEADER_WIDTH,
                      maxWidth: ROW_HEADER_WIDTH,
                      height: rowHeights[rowIndex] ?? DEFAULT_ROW_HEIGHT,
                    }}
                  >
                    {rowIndex + 1}
                    <button
                      type="button"
                      className="row-resizer"
                      aria-label={`Resize row ${rowIndex + 1}`}
                      onMouseDown={(event) => handleRowResizeStart(rowIndex, event)}
                      onDoubleClick={() => autoFitRow(rowIndex)}
                    />
                  </th>
                  {row.map((value, colIndex) => (
                    <td
                      key={`cell-${rowIndex + 1}-${colIndex}`}
                      className={value !== '' && !Number.isNaN(Number(value)) ? 'is-numeric' : ''}
                      style={{
                        width: columnWidths[colIndex] ?? DEFAULT_COLUMN_WIDTH,
                        minWidth: columnWidths[colIndex] ?? DEFAULT_COLUMN_WIDTH,
                        maxWidth: columnWidths[colIndex] ?? DEFAULT_COLUMN_WIDTH,
                        height: rowHeights[rowIndex] ?? DEFAULT_ROW_HEIGHT,
                      }}
                    >
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Tabs Area (Bottom) */}
      <div className="flex items-center gap-1 p-2 bg-[#f3f4f6] border-t border-[#d1d5db] overflow-x-auto shrink-0 shadow-[0_-2px_4px_rgba(0,0,0,0.05)] dark:bg-ink-900 dark:border-ink-700">
        {workbook.SheetNames.map((sheetName, index) => (
          <button
            key={sheetName}
            onClick={() => setActiveSheetIndex(index)}
            className={`px-4 py-1.5 text-sm font-mono whitespace-nowrap border rounded-t transition-colors ${
              index === activeSheetIndex
                ? 'border-[#217346] text-[#217346] bg-white dark:bg-ink-800 font-bold border-b-transparent shadow-sm'
                : 'border-transparent text-ink-600 hover:bg-[#e5e7eb] dark:hover:bg-ink-800/50'
            }`}
          >
            {sheetName}
          </button>
        ))}
      </div>
      <style>{`
        .xlsx-table-wrapper table {
          border-collapse: collapse;
          width: max-content;
          min-width: 100%;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 0.875rem;
          color: #111827;
          background-color: #ffffff;
          border: 1px solid #d1d5db;
        }
        :is(.dark .xlsx-table-wrapper table) {
          color: var(--color-ink-100);
          background-color: var(--color-ink-950);
        }

        .xlsx-table-wrapper th,
        .xlsx-table-wrapper td {
          border: 1px solid #d1d5db;
          padding: 0.375rem 0.625rem;
          min-width: 96px;
          height: 28px;
        }

        .xlsx-table-wrapper .corner-cell,
        .xlsx-table-wrapper .column-header,
        .xlsx-table-wrapper .row-header {
          background-color: #f8f9fa;
          color: #616161;
          font-weight: 600;
          user-select: none;
        }

        .xlsx-table-wrapper .corner-cell,
        .xlsx-table-wrapper .column-header {
          position: sticky;
          top: 0;
          z-index: 2;
          text-align: center;
        }

        .xlsx-table-wrapper .corner-cell {
          left: 0;
          z-index: 4;
          min-width: 36px;
          width: 36px;
          max-width: 36px;
          box-sizing: border-box;
          border-right-color: #c6c6c6;
          border-bottom-color: #c6c6c6;
          box-shadow: inset -1px 0 0 #d0d0d0;
        }

        .xlsx-table-wrapper .row-header {
          position: sticky;
          left: 0;
          z-index: 3;
          min-width: 36px;
          width: 36px;
          max-width: 36px;
          text-align: center;
          padding: 0;
          box-sizing: border-box;
          overflow: hidden;
          border-right-color: #c6c6c6;
          font-size: 0.75rem;
          font-weight: 500;
          font-variant-numeric: tabular-nums;
          box-shadow: inset -1px 0 0 #d0d0d0;
        }

        .xlsx-table-wrapper td {
          background-color: #ffffff;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .xlsx-table-wrapper .column-header {
          padding-right: 0.875rem;
          border-bottom-color: #c6c6c6;
          box-shadow: inset 0 -1px 0 #d0d0d0;
        }

        .xlsx-table-wrapper .row-header {
          padding-bottom: 0.6rem;
        }

        .xlsx-table-wrapper .row-header:hover,
        .xlsx-table-wrapper .corner-cell:hover,
        .xlsx-table-wrapper .column-header:hover {
          background-color: #f1f3f4;
        }

        .xlsx-table-wrapper .col-resizer {
          position: absolute;
          top: 0;
          right: -4px;
          width: 8px;
          height: 100%;
          border: 0;
          background: transparent;
          cursor: col-resize;
          z-index: 6;
        }

        .xlsx-table-wrapper .row-resizer {
          position: absolute;
          left: 0;
          bottom: -4px;
          width: 100%;
          height: 8px;
          border: 0;
          background: transparent;
          cursor: row-resize;
          z-index: 6;
        }

        .xlsx-table-wrapper .column-header,
        .xlsx-table-wrapper .row-header {
          position: sticky;
        }

        .xlsx-table-wrapper .column-header:hover .col-resizer,
        .xlsx-table-wrapper .row-header:hover .row-resizer {
          background: color-mix(in srgb, #217346 22%, transparent);
        }

        .xlsx-table-wrapper tbody tr:hover td {
          background-color: #f9fafb;
        }

        .xlsx-table-wrapper td.is-numeric {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }

        :is(.dark .xlsx-table-wrapper th), :is(.dark .xlsx-table-wrapper td) {
          border-color: var(--color-ink-700);
        }

        :is(.dark .xlsx-table-wrapper .corner-cell),
        :is(.dark .xlsx-table-wrapper .column-header),
        :is(.dark .xlsx-table-wrapper .row-header) {
          background-color: var(--color-ink-900);
          color: var(--color-ink-300);
        }

        :is(.dark .xlsx-table-wrapper td) {
          background-color: var(--color-ink-950);
        }

        :is(.dark .xlsx-table-wrapper .corner-cell),
        :is(.dark .xlsx-table-wrapper .row-header) {
          box-shadow: inset -1px 0 0 var(--color-ink-700);
        }

        :is(.dark .xlsx-table-wrapper .column-header) {
          box-shadow: inset 0 -1px 0 var(--color-ink-700);
        }

        :is(.dark .xlsx-table-wrapper .row-header:hover),
        :is(.dark .xlsx-table-wrapper .corner-cell:hover),
        :is(.dark .xlsx-table-wrapper .column-header:hover) {
          background-color: color-mix(in srgb, var(--color-ink-800) 88%, white);
        }

        :is(.dark .xlsx-table-wrapper tbody tr:hover td) {
          background-color: color-mix(in srgb, var(--color-ink-900) 75%, black);
        }
      `}</style>
    </div>
  )
}
