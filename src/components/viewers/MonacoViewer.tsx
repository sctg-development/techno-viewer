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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Editor, { type Monaco, type OnMount } from '@monaco-editor/react'
import { toast } from '@heroui/react'
import type { FileNode } from '../../types'
import { useAuthContext } from '../../context/AuthContext'

// ── Navigation history (module-level: persists across component remounts on file change) ──
interface NavEntry { path: string; line: number; column: number }
const _navBack: NavEntry[] = []
const _navFwd: NavEntry[] = []

interface SymbolLocation {
  file_hash: string
  original_path: string
  line: number
  column: number
  kind: string
}

interface CodeIndexChunk {
  symbols: Record<string, SymbolLocation[]>
}

interface ViewerFocusLocation {
  path: string
  line: number
  column: number
}

type PickerMode = 'definition' | 'reference' | 'implementation'

interface PickerItem {
  label: string
  detail: string
  location: SymbolLocation
  node: FileNode | null
}

interface PickerState {
  symbol: string
  mode: PickerMode
  items: PickerItem[]
  anchorTop: number
  anchorLeft: number
}

type AiOverlayMode = 'file-explanation' | 'selection-explanation'

interface AiOverlayState {
  mode: AiOverlayMode
  title: string
  content: string
}

interface MonacoViewerProps {
  node: FileNode
  data: Uint8Array
  allNodes: FileNode[]
  codeIndexes: Record<string, string>
  decryptFile: (path: string) => Promise<Uint8Array | null>
  onNavigateToDefinition: (target: FileNode, line: number, column: number) => void
  focusLocation: ViewerFocusLocation | null
  onConsumeFocusLocation: () => void
}

function monacoLanguageForNode(node: FileNode): string {
  switch (node.type) {
    case 'cpp':
    case 'h':
      return 'cpp'
    case 'ts':
    case 'tsx':
      return 'typescript'
    case 'js':
    case 'jsx':
      return 'javascript'
    case 'rs':
      return 'rust'
    case 'json':
      return 'json'
    case 'yaml':
      return 'yaml'
    case 'html':
      return 'html'
    case 'xml':
    case 'vcxproj':
      return 'xml'
    default:
      return 'plaintext'
  }
}

function symbolPrefix(symbol: string): string {
  const prefix = Array.from(symbol)
    .filter((character) => /[A-Za-z0-9_]/.test(character))
    .join('')
    .toLowerCase()
    .slice(0, 2)

  return prefix.length >= 2 ? prefix : 'misc'
}

function hashFromEncryptedPath(path?: string): string | null {
  if (!path) return null
  const match = path.match(/(?:^|\/)encrypted\/([a-f0-9]{64})\.age$/i)
  return match?.[1] ?? null
}

const IMPL_KINDS = new Set(['function', 'method', 'class', 'struct', 'trait', 'interface'])
const AI_PROVIDER = 'groq'
const AI_PROXY_URL = `https://ai-proxy.inet.pp.ua/${AI_PROVIDER}/v1/chat/completions`
const AI_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct'
const AI_CACHE_PREFIX = 'INDUSTRIAL-ANALYZER_monaco_ai_v1'
const MAX_PROXY_REQ_PER_MIN = 10
const MAX_CONTEXT_CHARS = 80_000
const MAX_TRANSLATE_CHUNK_CHARS = 9_000
const MAX_TRANSLATE_CHUNKS = 6

function splitTextIntoChunks(input: string, chunkSize: number): string[] {
  if (!input) return ['']
  if (input.length <= chunkSize) return [input]

  const lines = input.split('\n')
  const chunks: string[] = []
  let current = ''

  for (const line of lines) {
    const lineWithBreak = current.length === 0 ? line : `\n${line}`
    if (current.length + lineWithBreak.length <= chunkSize) {
      current += lineWithBreak
      continue
    }
    if (current.length > 0) chunks.push(current)
    if (line.length <= chunkSize) {
      current = line
      continue
    }

    let start = 0
    while (start < line.length) {
      const part = line.slice(start, start + chunkSize)
      if (part.length === chunkSize) chunks.push(part)
      else current = part
      start += chunkSize
    }
    if (start >= line.length && line.length % chunkSize === 0) current = ''
  }

  if (current.length > 0) chunks.push(current)
  return chunks
}

function stripAiCodeWrappers(raw: string): string {
  let cleaned = raw.trim()

  const fullFence = cleaned.match(/^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```\s*$/)
  if (fullFence?.[1]) return fullFence[1]

  const firstFenceStart = cleaned.indexOf('```')
  if (firstFenceStart >= 0) {
    const rest = cleaned.slice(firstFenceStart)
    const fenced = rest.match(/^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```/)
    if (fenced?.[1]) return fenced[1]
  }

  const lines = cleaned.split('\n')
  if (lines.length > 1) {
    const first = lines[0].toLowerCase()
    const isPreamble = first.includes('translated') || first.includes('source code') || first.includes('here is')
    if (isPreamble) {
      cleaned = lines.slice(1).join('\n').trim()
    }
  }

  return cleaned
}

function normalizedInterfaceLanguage(lang: string | undefined): 'fr' | 'en' | 'zh' {
  const normalized = (lang ?? '').toLowerCase()
  if (normalized.startsWith('fr')) return 'fr'
  if (normalized.startsWith('zh')) return 'zh'
  return 'en'
}

function inlineCommentTargetLanguage(lang: 'fr' | 'en' | 'zh'): string {
  if (lang === 'fr') return 'French'
  if (lang === 'zh') return 'Chinese'
  return 'English'
}

export default function MonacoViewer({
  node,
  data,
  allNodes,
  codeIndexes,
  decryptFile,
  onNavigateToDefinition,
  focusLocation,
  onConsumeFocusLocation,
}: MonacoViewerProps) {
  const { t, i18n } = useTranslation()
  const { session } = useAuthContext()
  const privateKey = session?.privateKey?.trim() ?? ''
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const providerDisposablesRef = useRef<{ dispose: () => void }[]>([])
  const pendingFocusRef = useRef<{ line: number; column: number } | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [picker, setPicker] = useState<PickerState | null>(null)
  const [isTranslating, setIsTranslating] = useState(false)
  const [isExplaining, setIsExplaining] = useState(false)
  const [isExplainingSelection, setIsExplainingSelection] = useState(false)
  const [isAnnotatingJunior, setIsAnnotatingJunior] = useState(false)
  const [translatedContent, setTranslatedContent] = useState<string | null>(null)
  const [annotatedJuniorContent, setAnnotatedJuniorContent] = useState<string | null>(null)
  const [explanationContent, setExplanationContent] = useState<string | null>(null)
  const [editorView, setEditorView] = useState<'source' | 'translated' | 'annotated-junior'>('source')
  const [aiOverlay, setAiOverlay] = useState<AiOverlayState | null>(null)
  const requestTimestampsRef = useRef<number[]>([])
  const aiLoadingToastIdRef = useRef<ReturnType<typeof toast> | null>(null)

  // Stable refs so providers registered at mount always call the latest callbacks.
  const onNavigateRef = useRef(onNavigateToDefinition)
  useEffect(() => { onNavigateRef.current = onNavigateToDefinition }, [onNavigateToDefinition])
  const allNodesRef = useRef(allNodes)
  useEffect(() => { allNodesRef.current = allNodes }, [allNodes])

  const text = useMemo(() => new TextDecoder('utf-8', { fatal: false }).decode(data), [data])
  const language = useMemo(() => monacoLanguageForNode(node), [node])
  const uiLanguage = useMemo(() => normalizedInterfaceLanguage(i18n.language), [i18n.language])
  const aiCacheKeyBase = useMemo(() => {
    const pathKey = node.path ?? node.name
    return `${AI_CACHE_PREFIX}:${pathKey}`
  }, [node.name, node.path])

  const readCache = useCallback((suffix: string): string | null => {
    try {
      return localStorage.getItem(`${aiCacheKeyBase}:${suffix}`)
    } catch {
      return null
    }
  }, [aiCacheKeyBase])

  const writeCache = useCallback((suffix: string, content: string) => {
    try {
      localStorage.setItem(`${aiCacheKeyBase}:${suffix}`, content)
    } catch {
      // Best-effort cache only.
    }
  }, [aiCacheKeyBase])

  useEffect(() => {
    const translated = readCache('translated')
    const annotatedJunior = readCache(`annotated-junior:${uiLanguage}`)
    setTranslatedContent(translated)
    setAnnotatedJuniorContent(annotatedJunior)
    if (annotatedJunior) setEditorView('annotated-junior')
    else if (translated) setEditorView('translated')
    else setEditorView('source')
    setExplanationContent(readCache('explanation-md'))
  }, [readCache, uiLanguage])

  const nodesByHash = useMemo(() => {
    const map = new Map<string, FileNode>()
    for (const fileNode of allNodes) {
      const hash = hashFromEncryptedPath(fileNode.path)
      if (!hash) continue
      map.set(hash, fileNode)
    }
    return map
  }, [allNodes])
  const nodesByHashRef = useRef(nodesByHash)
  useEffect(() => { nodesByHashRef.current = nodesByHash }, [nodesByHash])

  const indexCacheRef = useRef<Map<string, Promise<CodeIndexChunk | null>>>(new Map())

  const loadIndexChunk = useCallback(
    async (virtualName: string): Promise<CodeIndexChunk | null> => {
      const cached = indexCacheRef.current.get(virtualName)
      if (cached !== undefined) return cached
      const encryptedPath = codeIndexes[virtualName]
      const p: Promise<CodeIndexChunk | null> = (async () => {
        const base = import.meta.env.BASE_URL || '/'
        const normalizedBase = base.endsWith('/') ? base : `${base}/`
        const candidates = [
          `${normalizedBase}${virtualName}`,
          `/${virtualName}`,
        ]
        for (const url of candidates) {
          try {
            const r = await fetch(url)
            if (r.ok) return (await r.json()) as CodeIndexChunk
          } catch {
            // try next candidate URL
          }
        }
        if (!encryptedPath) return null
        const dec = await decryptFile(`/${encryptedPath.replace(/^\/+/, '')}`)
        if (!dec) return null
        try { return JSON.parse(new TextDecoder('utf-8', { fatal: false }).decode(dec)) as CodeIndexChunk }
        catch { return null }
      })()
      // Cache the promise immediately to deduplicate concurrent requests.
      // Remove it if it resolves to null so future calls can retry (e.g. after
      // codeIndexes becomes populated or decryptFile becomes ready).
      indexCacheRef.current.set(virtualName, p)
      p.then((result) => {
        if (result === null) indexCacheRef.current.delete(virtualName)
      })
      return p
    },
    [codeIndexes, decryptFile]
  )

  /** Returns ALL locations for a symbol (all overloads / all files). */
  const resolveSymbolLocations = useCallback(
    async (symbol: string): Promise<SymbolLocation[]> => {
      const chunk = await loadIndexChunk(`index_${symbolPrefix(symbol)}.json`)
      if (!chunk?.symbols) return []
      const direct = chunk.symbols[symbol]
      if (direct && direct.length) return direct
      const normalized = symbol.trim().toLowerCase()
      for (const [key, locations] of Object.entries(chunk.symbols)) {
        if (key.toLowerCase() === normalized) return locations
      }
      return []
    },
    [loadIndexChunk]
  )
  const resolveRef = useRef(resolveSymbolLocations)
  useEffect(() => { resolveRef.current = resolveSymbolLocations }, [resolveSymbolLocations])

  const trackRateLimit = useCallback((): boolean => {
    const now = Date.now()
    requestTimestampsRef.current = requestTimestampsRef.current.filter((ts) => now - ts < 60_000)
    if (requestTimestampsRef.current.length >= MAX_PROXY_REQ_PER_MIN) return false
    requestTimestampsRef.current.push(now)
    return true
  }, [])

  const fetchAiCompletion = useCallback(async (messages: Array<{ role: 'system' | 'user'; content: string }>): Promise<string> => {
    const response = await fetch(AI_PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${privateKey}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        stream: false,
        temperature: 0.2,
        top_p: 1,
        max_completion_tokens: 8192,
        messages,
      }),
    })
    if (!response.ok) {
      throw new Error(`Proxy error: ${response.status}`)
    }
    const body = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = body.choices?.[0]?.message?.content?.trim()
    if (!content) throw new Error('Empty model response')
    return content
  }, [privateKey])

  const fetchAiSanitizedCode = useCallback(async (messages: Array<{ role: 'system' | 'user'; content: string }>): Promise<string> => {
    const content = await fetchAiCompletion(messages)
    return stripAiCodeWrappers(content)
  }, [fetchAiCompletion])

  const openAiLoadingToast = useCallback((message: string) => {
    if (aiLoadingToastIdRef.current !== null) toast.close(aiLoadingToastIdRef.current)
    aiLoadingToastIdRef.current = toast(message, {
      isLoading: true,
      timeout: 0,
    })
  }, [])

  const closeAiLoadingToast = useCallback(() => {
    if (aiLoadingToastIdRef.current === null) return
    toast.close(aiLoadingToastIdRef.current)
    aiLoadingToastIdRef.current = null
  }, [])

  const collectExtraContext = useCallback(async (): Promise<string> => {
    const includeMatches = text.match(/#include\s+[<"]([^>"]+)[>"]/g) ?? []
    const includeNames = includeMatches
      .map((line) => line.match(/#include\s+[<"]([^>"]+)[>"]/)?.[1] ?? '')
      .filter(Boolean)
    const targets = allNodes
      .filter((candidate) => candidate.path && candidate.path !== node.path)
      .filter((candidate) => includeNames.some((inc) => candidate.name.endsWith(inc)))
      .slice(0, 4)

    let remainingChars = Math.max(0, MAX_CONTEXT_CHARS - text.length)
    const chunks: string[] = []
    for (const target of targets) {
      if (remainingChars <= 500 || !target.path) break
      const decrypted = await decryptFile(target.path)
      if (!decrypted) continue
      const decoded = new TextDecoder('utf-8', { fatal: false }).decode(decrypted)
      const clipped = decoded.slice(0, remainingChars)
      remainingChars -= clipped.length
      chunks.push(`\n\n### Related file: ${target.path}\n${clipped}`)
    }
    return chunks.join('')
  }, [allNodes, decryptFile, node.path, text])

  const downloadText = useCallback((filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  const handleTranslateComments = useCallback(async () => {
    if (!privateKey) {
      setStatusMessage(t('viewer.monaco.ai_missing_key'))
      window.setTimeout(() => setStatusMessage(null), 3000)
      return
    }
    if (!trackRateLimit()) {
      setStatusMessage(t('viewer.monaco.ai_rate_limited'))
      window.setTimeout(() => setStatusMessage(null), 3000)
      return
    }
    try {
      setIsTranslating(true)
      openAiLoadingToast(t('viewer.monaco.ai_toast_translating'))
      setStatusMessage(t('viewer.monaco.ai_translating'))
      const chunks = splitTextIntoChunks(text, MAX_TRANSLATE_CHUNK_CHARS)
      const limited = chunks.slice(0, MAX_TRANSLATE_CHUNKS)
      const translatedParts: string[] = []

      for (let i = 0; i < limited.length; i += 1) {
        if (i > 0 && !trackRateLimit()) {
          translatedParts.push(...chunks.slice(i))
          setStatusMessage(t('viewer.monaco.ai_rate_limited'))
          break
        }

        const translatedChunk = await fetchAiSanitizedCode([
          {
            role: 'system',
            content: 'Translate comments in the provided source code to English. Keep code tokens, identifiers, literals, spacing, and line structure unchanged. Do not wrap with markdown code fences. Do not add introductory or explanatory text. Return only source code.',
          },
          {
            role: 'user',
            content: limited[i],
          },
        ])
        translatedParts.push(translatedChunk || limited[i])
      }

      if (chunks.length > MAX_TRANSLATE_CHUNKS) {
        translatedParts.push(...chunks.slice(MAX_TRANSLATE_CHUNKS))
        setStatusMessage(t('viewer.monaco.ai_rate_limited'))
      }

      const translated = translatedParts.join('\n')
      setTranslatedContent(translated)
      setEditorView('translated')
      writeCache('translated', translated)
      setStatusMessage(t('viewer.monaco.ai_translation_ready'))
    } catch {
      setStatusMessage(t('viewer.monaco.ai_error'))
    } finally {
      setIsTranslating(false)
      closeAiLoadingToast()
      window.setTimeout(() => setStatusMessage(null), 3000)
    }
  }, [closeAiLoadingToast, fetchAiSanitizedCode, openAiLoadingToast, privateKey, t, text, trackRateLimit, writeCache])

  const handleExplainFile = useCallback(async () => {
    if (!privateKey) {
      setStatusMessage(t('viewer.monaco.ai_missing_key'))
      window.setTimeout(() => setStatusMessage(null), 3000)
      return
    }
    if (!trackRateLimit()) {
      setStatusMessage(t('viewer.monaco.ai_rate_limited'))
      window.setTimeout(() => setStatusMessage(null), 3000)
      return
    }
    try {
      setIsExplaining(true)
      openAiLoadingToast(t('viewer.monaco.ai_toast_explaining'))
      setStatusMessage(t('viewer.monaco.ai_explaining'))
      const extraContext = await collectExtraContext()
      const explanation = await fetchAiCompletion([
        {
          role: 'system',
          content: 'Explain the source code behavior in clear English Markdown. Keep it concise and technical. Use headings: Purpose, Architecture, Key Flows, Data Structures, Risks. Do not include markdown code fences unless strictly necessary.',
        },
        {
          role: 'user',
          content: `### Main file: ${node.path ?? node.name}\n${text.slice(0, MAX_CONTEXT_CHARS)}${extraContext}`,
        },
      ])
      setExplanationContent(explanation)
      writeCache('explanation-md', explanation)
      setAiOverlay({
        mode: 'file-explanation',
        title: t('viewer.monaco.ai_explain_file'),
        content: explanation,
      })
      setStatusMessage(t('viewer.monaco.ai_explanation_ready'))
    } catch {
      setStatusMessage(t('viewer.monaco.ai_error'))
    } finally {
      setIsExplaining(false)
      closeAiLoadingToast()
      window.setTimeout(() => setStatusMessage(null), 3000)
    }
  }, [closeAiLoadingToast, collectExtraContext, fetchAiCompletion, node.name, node.path, openAiLoadingToast, privateKey, t, text, trackRateLimit, writeCache])

  const handleAddJuniorInlineComments = useCallback(async () => {
    if (!privateKey) {
      setStatusMessage(t('viewer.monaco.ai_missing_key'))
      window.setTimeout(() => setStatusMessage(null), 3000)
      return
    }
    if (!trackRateLimit()) {
      setStatusMessage(t('viewer.monaco.ai_rate_limited'))
      window.setTimeout(() => setStatusMessage(null), 3000)
      return
    }

    try {
      setIsAnnotatingJunior(true)
      openAiLoadingToast(t('viewer.monaco.ai_toast_annotating_junior'))
      setStatusMessage('AI: adding inline junior comments...')
      const chunks = splitTextIntoChunks(text, MAX_TRANSLATE_CHUNK_CHARS)
      const limited = chunks.slice(0, MAX_TRANSLATE_CHUNKS)
      const resultParts: string[] = []
      const targetLang = inlineCommentTargetLanguage(uiLanguage)

      for (let i = 0; i < limited.length; i += 1) {
        if (i > 0 && !trackRateLimit()) {
          resultParts.push(...chunks.slice(i))
          setStatusMessage(t('viewer.monaco.ai_rate_limited'))
          break
        }

        const annotatedChunk = await fetchAiSanitizedCode([
          {
            role: 'system',
            content: `You are mentoring a junior developer. Add concise inline comments in ${targetLang}. Keep the original code behavior exactly unchanged. You may add comments and can translate existing comments into ${targetLang} if needed. Do not rename identifiers. Do not remove logic. Preserve formatting and line structure as much as possible. Return only source code without markdown fences or introductory text.`,
          },
          {
            role: 'user',
            content: limited[i],
          },
        ])
        resultParts.push(annotatedChunk || limited[i])
      }

      if (chunks.length > MAX_TRANSLATE_CHUNKS) {
        resultParts.push(...chunks.slice(MAX_TRANSLATE_CHUNKS))
        setStatusMessage(t('viewer.monaco.ai_rate_limited'))
      }

      const annotated = resultParts.join('\n')
      setAnnotatedJuniorContent(annotated)
      setEditorView('annotated-junior')
      writeCache(`annotated-junior:${uiLanguage}`, annotated)
      setStatusMessage('AI junior comments ready.')
    } catch {
      setStatusMessage(t('viewer.monaco.ai_error'))
    } finally {
      setIsAnnotatingJunior(false)
      closeAiLoadingToast()
      window.setTimeout(() => setStatusMessage(null), 3000)
    }
  }, [closeAiLoadingToast, fetchAiSanitizedCode, openAiLoadingToast, privateKey, t, text, trackRateLimit, uiLanguage, writeCache])

  const handleExplainSelection = useCallback(async () => {
    const editor = editorRef.current
    if (!editor) return
    if (!privateKey) {
      setStatusMessage(t('viewer.monaco.ai_missing_key'))
      window.setTimeout(() => setStatusMessage(null), 3000)
      return
    }
    if (!trackRateLimit()) {
      setStatusMessage(t('viewer.monaco.ai_rate_limited'))
      window.setTimeout(() => setStatusMessage(null), 3000)
      return
    }

    const model = editor.getModel()
    const selection = editor.getSelection()
    if (!model || !selection || selection.isEmpty()) {
      setStatusMessage('Select a code range first.')
      window.setTimeout(() => setStatusMessage(null), 2000)
      return
    }

    const selectedText = model.getValueInRange(selection).trim()
    if (!selectedText) {
      setStatusMessage('Select a code range first.')
      window.setTimeout(() => setStatusMessage(null), 2000)
      return
    }

    const startLine = Math.max(1, selection.startLineNumber - 20)
    const endLine = Math.min(model.getLineCount(), selection.endLineNumber + 20)
    const surrounding: string[] = []
    for (let line = startLine; line <= endLine; line += 1) {
      surrounding.push(model.getLineContent(line))
    }

    try {
      setIsExplainingSelection(true)
      openAiLoadingToast(t('viewer.monaco.ai_toast_explaining_selection'))
      setStatusMessage(t('viewer.monaco.ai_explaining'))
      const explanation = await fetchAiCompletion([
        {
          role: 'system',
          content: 'Explain the selected code in English Markdown. Focus on intent, behavior, inputs/outputs, and edge cases. Keep it actionable and concise.',
        },
        {
          role: 'user',
          content: `File: ${node.path ?? node.name}\n\nSelected code:\n${selectedText.slice(0, 12_000)}\n\nNearby context:\n${surrounding.join('\n').slice(0, 12_000)}`,
        },
      ])
      setAiOverlay({
        mode: 'selection-explanation',
        title: `${t('viewer.monaco.ai_explain_file')} - selection`,
        content: explanation,
      })
      setStatusMessage(t('viewer.monaco.ai_explanation_ready'))
    } catch {
      setStatusMessage(t('viewer.monaco.ai_error'))
    } finally {
      setIsExplainingSelection(false)
      closeAiLoadingToast()
      window.setTimeout(() => setStatusMessage(null), 3000)
    }
  }, [closeAiLoadingToast, fetchAiCompletion, node.name, node.path, openAiLoadingToast, privateKey, t, trackRateLimit])

  const jumpToLocation = useCallback((line: number, column: number) => {
    const editor = editorRef.current
    if (!editor) return
    const lineNumber = Math.max(1, line)
    const columnNumber = Math.max(1, column)
    editor.revealPositionInCenter({ lineNumber, column: columnNumber })
    editor.setPosition({ lineNumber, column: columnNumber })
    editor.focus()
  }, [])

  /** Push current cursor to history then navigate. */
  const navigateWithHistory = useCallback(
    (targetNode: FileNode, line: number, column: number) => {
      const editor = editorRef.current
      const curPos = editor?.getPosition()
      _navBack.push({ path: node.path ?? '', line: curPos?.lineNumber ?? 1, column: curPos?.column ?? 1 })
      _navFwd.length = 0
      if (targetNode.path === node.path) {
        jumpToLocation(line, column)
      } else {
        onNavigateRef.current(targetNode, line, column)
      }
    },
    [jumpToLocation, node.path]
  )
  const navigateWithHistoryRef = useRef(navigateWithHistory)
  useEffect(() => { navigateWithHistoryRef.current = navigateWithHistory }, [navigateWithHistory])

  /** Position and open the symbol picker, or show a status toast when empty. */
  const showPicker = useCallback(
    (symbol: string, mode: PickerMode, candidates: SymbolLocation[]) => {
      if (!candidates.length) {
        const key = mode === 'reference'
          ? 'viewer.monaco.no_references'
          : mode === 'implementation'
            ? 'viewer.monaco.no_implementations'
            : 'viewer.monaco.not_found'
        setStatusMessage(t(key, { symbol }))
        window.setTimeout(() => setStatusMessage(null), 2000)
        return
      }
      const editor = editorRef.current
      const domNode = editor?.getDomNode()
      const editorPos = editor?.getPosition()
      const pixelPos = editorPos && editor ? editor.getScrolledVisiblePosition(editorPos) : null
      const rect = domNode?.getBoundingClientRect()
      const anchorTop = (pixelPos?.top ?? 40) + 22
      const anchorLeft = Math.min(pixelPos?.left ?? 80, (rect?.width ?? 600) - 320)
      const items: PickerItem[] = candidates.map((loc) => ({
        label: loc.original_path || loc.file_hash.slice(0, 12),
        detail: `${loc.kind}  ·  :${loc.line}`,
        location: loc,
        node: nodesByHashRef.current.get(loc.file_hash) ?? null,
      }))
      setPicker({ symbol, mode, items, anchorTop, anchorLeft })
    },
    [t]
  )
  const showPickerRef = useRef(showPicker)
  useEffect(() => { showPickerRef.current = showPicker }, [showPicker])

  const handlePickerSelect = useCallback((item: PickerItem) => {
    setPicker(null)
    if (!item.node?.path) return
    navigateWithHistoryRef.current(item.node, item.location.line, item.location.column)
  }, [])

  const goBack = useCallback(() => {
    const prev = _navBack.pop()
    if (!prev) return
    const editor = editorRef.current
    const curPos = editor?.getPosition()
    _navFwd.push({ path: node.path ?? '', line: curPos?.lineNumber ?? 1, column: curPos?.column ?? 1 })
    if (prev.path === node.path) {
      jumpToLocation(prev.line, prev.column)
    } else {
      const target = allNodesRef.current.find((n) => n.path === prev.path)
      if (target) onNavigateRef.current(target, prev.line, prev.column)
    }
  }, [jumpToLocation, node.path])
  const goBackRef = useRef(goBack)
  useEffect(() => { goBackRef.current = goBack }, [goBack])

  const goForward = useCallback(() => {
    const next = _navFwd.pop()
    if (!next) return
    const editor = editorRef.current
    const curPos = editor?.getPosition()
    _navBack.push({ path: node.path ?? '', line: curPos?.lineNumber ?? 1, column: curPos?.column ?? 1 })
    if (next.path === node.path) {
      jumpToLocation(next.line, next.column)
    } else {
      const target = allNodesRef.current.find((n) => n.path === next.path)
      if (target) onNavigateRef.current(target, next.line, next.column)
    }
  }, [jumpToLocation, node.path])
  const goForwardRef = useRef(goForward)
  useEffect(() => { goForwardRef.current = goForward }, [goForward])
  const addJuniorCommentsRef = useRef(handleAddJuniorInlineComments)
  useEffect(() => { addJuniorCommentsRef.current = handleAddJuniorInlineComments }, [handleAddJuniorInlineComments])

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    for (const d of providerDisposablesRef.current) d.dispose()
    providerDisposablesRef.current = []

    const model = editor.getModel()
    if (model) {
      // ── Go to Definition ─────────────────────────────────────────────────────
      providerDisposablesRef.current.push(
        monaco.languages.registerDefinitionProvider(language, {
          provideDefinition: async (_m: unknown, position: { lineNumber: number; column: number }) => {
            const word = model.getWordAtPosition(position)
            if (!word?.word) return null
            const symbol = word.word
            const candidates = await resolveRef.current(symbol)
            if (!candidates.length) return null
            if (candidates.length === 1) {
              const loc = candidates[0]
              const target = nodesByHashRef.current.get(loc.file_hash)
              if (target) navigateWithHistoryRef.current(target, loc.line, loc.column)
            } else {
              showPickerRef.current(symbol, 'definition', candidates)
            }
            // Return a local stub to suppress Monaco's "No definition found" toast.
            return { uri: model.uri, range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column + word.word.length) }
          },
        })
      )

      // ── Go to References ─────────────────────────────────────────────────────
      providerDisposablesRef.current.push(
        monaco.languages.registerReferenceProvider(language, {
          provideReferences: async (_m: unknown, position: { lineNumber: number; column: number }) => {
            const word = model.getWordAtPosition(position)
            if (!word?.word) return []
            const symbol = word.word
            const candidates = await resolveRef.current(symbol)
            if (!candidates.length) {
              showPickerRef.current(symbol, 'reference', [])
              return [{
                uri: model.uri,
                range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column + Math.max(1, symbol.length)),
              }]
            }
            if (candidates.length === 1) {
              const loc = candidates[0]
              const target = nodesByHashRef.current.get(loc.file_hash)
              if (target) navigateWithHistoryRef.current(target, loc.line, loc.column)
            } else {
              showPickerRef.current(symbol, 'reference', candidates)
            }
            return [{
              uri: model.uri,
              range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column + Math.max(1, symbol.length)),
            }]
          },
        })
      )

      // ── Go to Implementations ─────────────────────────────────────────────────
      providerDisposablesRef.current.push(
        monaco.languages.registerImplementationProvider(language, {
          provideImplementation: async (_m: unknown, position: { lineNumber: number; column: number }) => {
            const word = model.getWordAtPosition(position)
            if (!word?.word) return null
            const symbol = word.word
            const all = await resolveRef.current(symbol)
            const candidates = all.filter((c) => IMPL_KINDS.has(c.kind))
            if (!candidates.length) {
              showPickerRef.current(symbol, 'implementation', [])
              return null
            }
            if (candidates.length === 1) {
              const loc = candidates[0]
              const target = nodesByHashRef.current.get(loc.file_hash)
              if (target) navigateWithHistoryRef.current(target, loc.line, loc.column)
            } else {
              showPickerRef.current(symbol, 'implementation', candidates)
            }
            return { uri: model.uri, range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column) }
          },
        })
      )
    }

    // ── Keyboard shortcuts ───────────────────────────────────────────────────
    editor.addAction({
      id: 'novasulf.goBack',
      label: t('viewer.monaco.go_back'),
      keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.LeftArrow],
      run: () => { goBackRef.current() },
    })
    editor.addAction({
      id: 'novasulf.goForward',
      label: t('viewer.monaco.go_forward'),
      keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.RightArrow],
      run: () => { goForwardRef.current() },
    })
    editor.addAction({
      id: 'novasulf.explainSelection',
      label: `${t('viewer.monaco.ai_explain_file')} (selection)`,
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 2.5,
      keybindings: [monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyE],
      run: async () => {
        await handleExplainSelection()
      },
    })
    editor.addAction({
      id: 'novasulf.inlineJuniorComments',
      label: 'AI: add inline junior comments',
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 2.6,
      run: async () => {
        await addJuniorCommentsRef.current()
      },
    })

    // ── Apply pending focus from cross-file navigation ───────────────────────
    if (pendingFocusRef.current) {
      const { line, column } = pendingFocusRef.current
      pendingFocusRef.current = null
      editor.revealPositionInCenter({ lineNumber: line, column })
      editor.setPosition({ lineNumber: line, column })
      editor.focus()
    }
  }

  const editorText = editorView === 'translated' && translatedContent
    ? translatedContent
    : editorView === 'annotated-junior' && annotatedJuniorContent
      ? annotatedJuniorContent
      : text

  // Dispose all providers on unmount.
  useEffect(() => {
    return () => {
      for (const d of providerDisposablesRef.current) d.dispose()
      providerDisposablesRef.current = []
      closeAiLoadingToast()
    }
  }, [closeAiLoadingToast])

  // Apply incoming focus (cross-file navigation landing after file switch).
  useEffect(() => {
    if (!focusLocation || focusLocation.path !== node.path) return
    onConsumeFocusLocation()
    if (editorRef.current) {
      jumpToLocation(focusLocation.line, focusLocation.column)
    } else {
      pendingFocusRef.current = { line: focusLocation.line, column: focusLocation.column }
    }
  }, [focusLocation, jumpToLocation, node.path, onConsumeFocusLocation])

  // Close picker on outside click.
  useEffect(() => {
    if (!picker) return
    const handler = (e: MouseEvent) => {
      if (e.target instanceof Element && !e.target.closest('[data-picker]')) setPicker(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [picker])

  const pickerTitle = picker
    ? picker.mode === 'definition'
      ? t('viewer.monaco.pick_definition', { symbol: picker.symbol })
      : picker.mode === 'reference'
        ? t('viewer.monaco.pick_reference', { symbol: picker.symbol })
        : t('viewer.monaco.pick_implementation', { symbol: picker.symbol })
    : ''

  return (
    <div ref={containerRef} className="relative h-full bg-ink-900">
      <Editor
        height="100%"
        language={language}
        theme="vs-dark"
        value={editorText}
        onMount={handleEditorDidMount}
        options={{
          readOnly: true,
          minimap: { enabled: true },
          scrollBeyondLastLine: false,
          fontSize: 13,
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          lineNumbersMinChars: 3,
          quickSuggestions: false,
          contextmenu: true,
          glyphMargin: false,
          wordWrap: 'off',
          renderWhitespace: 'selection',
        }}
      />

      {/* Back / Forward navigation buttons */}
      <div className="absolute top-2 right-16 flex gap-1 z-10">
        {annotatedJuniorContent && (
          <button
            onClick={() => setEditorView((prev) => (prev === 'annotated-junior' ? 'source' : 'annotated-junior'))}
            title={editorView === 'annotated-junior' ? 'Show original source' : 'Show junior inline comments'}
            className="px-2 py-0.5 text-[11px] font-mono border border-fuchsia-700 rounded text-fuchsia-300 hover:text-fuchsia-100 hover:border-fuchsia-500 bg-ink-900/90 transition-colors leading-none"
          >{editorView === 'annotated-junior' ? 'SRC' : 'JR'}</button>
        )}
        {translatedContent && (
          <button
            onClick={() => setEditorView((prev) => (prev === 'source' ? 'translated' : 'source'))}
            title={editorView === 'translated' ? 'Show original source' : 'Show translated comments'}
            className="px-2 py-0.5 text-[11px] font-mono border border-violet-700 rounded text-violet-300 hover:text-violet-100 hover:border-violet-500 bg-ink-900/90 transition-colors leading-none"
          >{editorView === 'translated' ? 'SRC' : 'EN'}</button>
        )}
        <button
          onClick={() => { void handleTranslateComments() }}
          disabled={isTranslating || isExplaining || isExplainingSelection || isAnnotatingJunior || !privateKey}
          title={t('viewer.monaco.ai_translate_comments')}
          className="px-2 py-0.5 text-[11px] font-mono border border-sky-700 rounded text-sky-300 hover:text-sky-100 hover:border-sky-500 bg-ink-900/90 transition-colors leading-none disabled:opacity-40 disabled:cursor-not-allowed"
        >{isTranslating ? t('viewer.monaco.ai_running_short') : t('viewer.monaco.ai_translate_short')}</button>
        {translatedContent && (
          <button
            onClick={() => downloadText(`${node.name.replace(/\.[^.]+$/, '')}.comments.en.${node.type}`, translatedContent)}
            title={t('viewer.monaco.ai_download_translation')}
            className="px-2 py-0.5 text-[11px] font-mono border border-emerald-700 rounded text-emerald-300 hover:text-emerald-100 hover:border-emerald-500 bg-ink-900/90 transition-colors leading-none"
          >{t('viewer.monaco.ai_download_short')}</button>
        )}
        <button
          onClick={() => { void handleExplainFile() }}
          disabled={isExplaining || isExplainingSelection || isAnnotatingJunior || !privateKey}
          title={t('viewer.monaco.ai_explain_file')}
          className="px-2 py-0.5 text-[11px] font-mono border border-amber-700 rounded text-amber-300 hover:text-amber-100 hover:border-amber-500 bg-ink-900/90 transition-colors leading-none disabled:opacity-40 disabled:cursor-not-allowed"
        >{isExplaining ? t('viewer.monaco.ai_running_short') : t('viewer.monaco.ai_explain_short')}</button>
        <button
          onClick={() => { void handleAddJuniorInlineComments() }}
          disabled={isAnnotatingJunior || isTranslating || isExplaining || isExplainingSelection || !privateKey}
          title="AI: add inline junior comments"
          className="px-2 py-0.5 text-[11px] font-mono border border-fuchsia-700 rounded text-fuchsia-300 hover:text-fuchsia-100 hover:border-fuchsia-500 bg-ink-900/90 transition-colors leading-none disabled:opacity-40 disabled:cursor-not-allowed"
        >{isAnnotatingJunior ? t('viewer.monaco.ai_running_short') : 'AI+JR'}</button>
        {annotatedJuniorContent && (
          <button
            onClick={() => downloadText(`${node.name.replace(/\.[^.]+$/, '')}.junior.${uiLanguage}.${node.type}`, annotatedJuniorContent)}
            title="Download junior-commented code"
            className="px-2 py-0.5 text-[11px] font-mono border border-emerald-700 rounded text-emerald-300 hover:text-emerald-100 hover:border-emerald-500 bg-ink-900/90 transition-colors leading-none"
          >{t('viewer.monaco.ai_download_short')}</button>
        )}
        {explanationContent && (
          <button
            onClick={() => downloadText(`${node.name}.explanation.md`, explanationContent)}
            title={t('viewer.monaco.ai_download_explanation')}
            className="px-2 py-0.5 text-[11px] font-mono border border-emerald-700 rounded text-emerald-300 hover:text-emerald-100 hover:border-emerald-500 bg-ink-900/90 transition-colors leading-none"
          >{t('viewer.monaco.ai_download_short')}</button>
        )}
        <button
          onClick={goBack}
          title={`${t('viewer.monaco.go_back')} (Alt+←)`}
          className="px-2 py-0.5 text-[11px] font-mono border border-ink-700 rounded text-ink-400 hover:text-ink-100 hover:border-ink-500 bg-ink-900/90 transition-colors leading-none"
        >←</button>
        <button
          onClick={goForward}
          title={`${t('viewer.monaco.go_forward')} (Alt+→)`}
          className="px-2 py-0.5 text-[11px] font-mono border border-ink-700 rounded text-ink-400 hover:text-ink-100 hover:border-ink-500 bg-ink-900/90 transition-colors leading-none"
        >→</button>
      </div>

      {/* Symbol picker overlay */}
      {picker && (
        <div
          data-picker
          style={{ top: picker.anchorTop, left: picker.anchorLeft }}
          className="absolute z-50 w-176 max-w-[calc(100vw-2rem)] max-h-64 overflow-y-auto rounded border border-ink-600 bg-[#1e1e1e] shadow-2xl text-xs font-mono text-[#d4d4d4]"
        >
          <div className="sticky top-0 px-3 py-1.5 border-b border-ink-700 bg-[#252526] text-[#c8c8c8] text-[10px] uppercase tracking-wider truncate">
            {pickerTitle}
          </div>
          {picker.items.map((item, i) => (
            <button
              key={i}
              onClick={() => handlePickerSelect(item)}
              className="w-full text-left px-3 py-2 text-[#d4d4d4] hover:bg-[#2a2d2e] transition-colors border-b border-ink-800/40 last:border-0"
            >
              <div className="text-[#f3f3f3] break-all leading-4">{item.label}</div>
              <div className="text-[#9ca3af] text-[10px] mt-0.5">{item.detail}</div>
            </button>
          ))}
        </div>
      )}

      {/* Status toast */}
      {statusMessage && (
        <div className="absolute bottom-3 right-3 rounded border border-ink-700 bg-surface/95 px-3 py-1.5 text-xs font-mono text-ink-100 shadow-soft">
          {statusMessage}
        </div>
      )}

      {/* AI explanation overlay */}
      {aiOverlay && (
        <div className="absolute inset-0 z-50 bg-black/45 p-4 sm:p-6">
          <div className="mx-auto h-full max-w-5xl rounded border border-ink-600 bg-[#1e1e1e] shadow-2xl text-[#d4d4d4] font-mono flex flex-col">
            <div className="flex items-center justify-between gap-3 border-b border-ink-700 bg-[#252526] px-4 py-2">
              <div className="text-xs uppercase tracking-wider text-[#c8c8c8] truncate">{aiOverlay.title}</div>
              <button
                onClick={() => setAiOverlay(null)}
                className="px-2 py-0.5 text-[11px] border border-ink-600 rounded text-ink-300 hover:text-ink-100 hover:border-ink-400"
              >Close</button>
            </div>
            <div className="flex-1 overflow-auto px-4 py-3">
              <pre className="whitespace-pre-wrap wrap-break-word text-xs leading-5 text-[#d4d4d4]">{aiOverlay.content}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
