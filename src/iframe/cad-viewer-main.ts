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

import { createApp, h, ref } from 'vue'
import ElementPlus from 'element-plus'
import { MlCadViewer, i18n } from '@mlightcad/cad-viewer'
import 'element-plus/dist/index.css'
import '../cad-viewer.css'

/** Visual theme applied to the CAD viewer canvas. */
type ViewerTheme = 'light' | 'dark'
/** Locale used by the CAD viewer UI. Use `'default'` to follow the environment locale. */
type ViewerLocale = 'en' | 'zh' | 'default'

/** postMessage payload sent by the parent frame to instruct the iframe to load a DXF drawing. */
interface CadViewerLoadMessage {
  source: 'novasulf-parent'
  type: 'cad-viewer:load'
  payload: {
    data: Uint8Array
    fileName: string
    theme: ViewerTheme
    locale: ViewerLocale
  }
}

/** postMessage payload sent by the parent frame to check whether the iframe viewer is ready. */
interface CadViewerPingMessage {
  source: 'novasulf-parent'
  type: 'cad-viewer:ping'
}

/** Union of all message types the iframe can receive from its parent frame. */
type ParentMessage = CadViewerLoadMessage | CadViewerPingMessage

/** Sends a `cad-viewer:ready` postMessage to the parent frame, signalling that the iframe is initialised and ready to receive DXF data. */
function notifyReady() {
  window.parent.postMessage(
    {
      source: 'novasulf-cad-iframe',
      type: 'cad-viewer:ready',
    },
    window.location.origin
  )
}

/** Reactive reference holding the currently loaded DXF {@link File} object. Updated when a new drawing is received from the parent frame. */
const fileRef = ref<File | undefined>(undefined)
/** Reactive reference holding the active viewer theme. */
const themeRef = ref<ViewerTheme>('light')
/** Reactive reference holding the active viewer locale. */
const localeRef = ref<ViewerLocale>('default')
/** Base URL for external CAD viewer data assets hosted on the jsDelivr CDN. */
const cadDataBaseUrl = 'https://cdn.jsdelivr.net/gh/mlightcad/cad-data@main/'

const app = createApp({
  setup() {
    return () =>
      h(
        'div',
        {
          style: {
            width: '100%',
            height: '100%',
            minHeight: '100%',
            position: 'relative',
            overflow: 'hidden',
          },
        },
        [
          fileRef.value
            ? h(MlCadViewer, {
                localFile: fileRef.value,
                locale: localeRef.value,
                baseUrl: cadDataBaseUrl,
                useMainThreadDraw: false,
                theme: themeRef.value,
              })
            : null,
        ]
      )
  },
})

app.use(ElementPlus)
app.use(i18n)
app.mount('#cad-root')

window.addEventListener('message', (event: MessageEvent<ParentMessage>) => {
  if (event.origin !== window.location.origin) return
  if (event.data?.source !== 'novasulf-parent') return
  if (event.data?.type === 'cad-viewer:ping') {
    notifyReady()
    return
  }
  if (event.data?.type !== 'cad-viewer:load') return

  const payload = event.data.payload
  if (!payload?.data) return

  const bytes = new Uint8Array(payload.data)
  const normalizedBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  )
  const blob = new Blob([normalizedBuffer], { type: 'application/dxf' })

  fileRef.value = new File([blob], payload.fileName || 'drawing.dxf', {
    type: 'application/dxf',
  })
  themeRef.value = payload.theme === 'dark' ? 'dark' : 'light'
  localeRef.value = payload.locale === 'zh' ? 'zh' : payload.locale === 'en' ? 'en' : 'default'
})

notifyReady()
