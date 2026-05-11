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

import { useCallback, useEffect, useRef } from 'react'

/** Props for the {@link DxfViewer} component. */
interface DxfViewerProps {
  data: Uint8Array
  fileName?: string
  theme?: 'light' | 'dark'
  /** locale for cad-viewer: 'en', 'zh', or 'default' */
  locale?: 'en' | 'zh' | 'default'
}

/** postMessage payload sent to the iframe to load a DXF drawing. */
interface CadViewerLoadMessage {
  source: 'novasulf-parent'
  type: 'cad-viewer:load'
  payload: {
    data: Uint8Array
    fileName: string
    theme: 'light' | 'dark'
    locale: 'en' | 'zh' | 'default'
  }
}

/** postMessage payload sent to the iframe to check readiness. */
interface CadViewerPingMessage {
  source: 'novasulf-parent'
  type: 'cad-viewer:ping'
}

/** postMessage payload received from the iframe when it signals readiness. */
interface CadViewerReadyMessage {
  source: 'novasulf-cad-iframe'
  type: 'cad-viewer:ready'
}

/**
 * Embeds the CAD viewer iframe and communicates with it via `postMessage` to render DXF drawings.
 * Uses a ref-based readiness flag and ping/pong handshake to handle iframe load races.
 * @param data - Decrypted DXF file bytes.
 * @param fileName - Original file name forwarded to the iframe.
 * @param theme - Visual theme passed to the CAD viewer.
 * @param locale - UI locale passed to the CAD viewer.
 */
export default function DxfViewer({ data, fileName = 'drawing.dxf', theme = 'light', locale = 'default' }: DxfViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const viewerReadyRef = useRef(false)
  const latestInputRef = useRef({ data, fileName, theme, locale })

  /** Posts the currently pending drawing data to the iframe CAD viewer. No-op if the viewer is not yet ready or data is empty. */
  const postCurrentDrawing = useCallback(() => {
    const frameWindow = iframeRef.current?.contentWindow
    const latest = latestInputRef.current
    if (!frameWindow || !viewerReadyRef.current || !latest.data?.length) return

    const copiedBytes = latest.data.slice()

    const message: CadViewerLoadMessage = {
      source: 'novasulf-parent',
      type: 'cad-viewer:load',
      payload: {
        data: copiedBytes,
        fileName: latest.fileName,
        theme: latest.theme,
        locale: latest.locale,
      },
    }

    frameWindow.postMessage(message, window.location.origin)
  }, [])

  /** Sends a ping message to the iframe to request a `cad-viewer:ready` response. Used after each iframe (re)load. */
  const requestViewerReady = useCallback(() => {
    const frameWindow = iframeRef.current?.contentWindow
    if (!frameWindow) return

    const ping: CadViewerPingMessage = {
      source: 'novasulf-parent',
      type: 'cad-viewer:ping',
    }

    frameWindow.postMessage(ping, window.location.origin)
  }, [])

  useEffect(() => {
    latestInputRef.current = { data, fileName, theme, locale }
    postCurrentDrawing()
  }, [data, fileName, theme, locale, postCurrentDrawing])

  useEffect(() => {
    const onMessage = (event: MessageEvent<CadViewerReadyMessage>) => {
      if (event.origin !== window.location.origin) return
      if (event.source !== iframeRef.current?.contentWindow) return
      if (event.data?.source !== 'novasulf-cad-iframe') return
      if (event.data?.type !== 'cad-viewer:ready') return

      viewerReadyRef.current = true
      postCurrentDrawing()
    }

    window.addEventListener('message', onMessage)
    requestViewerReady()
    return () => {
      window.removeEventListener('message', onMessage)
    }
  }, [postCurrentDrawing, requestViewerReady])

  const iframeSrc = `${import.meta.env.BASE_URL}cad-viewer-iframe.html`

  /** Resets the viewer-ready flag and sends a ping on every iframe load event. */
  const onFrameLoad = () => {
    viewerReadyRef.current = false
    requestViewerReady()
  }

  if (!data?.length) return null

  return (
    <iframe
      ref={iframeRef}
      src={iframeSrc}
      title={fileName}
      onLoad={onFrameLoad}
      style={{ width: '100%', height: '100%', minHeight: '500px' }}
      className="border-0 bg-paper-50"
    />
  )
}
