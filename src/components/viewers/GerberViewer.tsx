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


import { useEffect, useState } from 'react'
import { TracespaceViewer } from '@sctg/tracespace-view'

interface GerberViewerProps {
  data: Uint8Array
  fileName?: string
  useStorage?: boolean
  showNav?: boolean
  showLoadFiles?: boolean
  showAnalyticsOptin?: boolean
}

/**
 * Renders a `.gerber.zip` archive inside the embedded Tracespace viewer.
 * The Zip file is converted into a `data:` URI so the viewer can load it directly.
 */
export default function GerberViewer({
  data,
  fileName = 'schematics.gerber.zip',
  useStorage = false,
  showNav = true,
  showLoadFiles = false,
  showAnalyticsOptin = false,
}: GerberViewerProps) {
  const [dataUri, setDataUri] = useState<string>('')

  useEffect(() => {
    if (!data?.length) {
      setDataUri('')
      return
    }

    const blob = new Blob([data.buffer as ArrayBuffer], { type: 'application/zip' })
    const reader = new FileReader()

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setDataUri(reader.result)
      }
    }

    reader.readAsDataURL(blob)

    return () => {
      reader.onload = null
      setDataUri('')
    }
  }, [data])

  if (!dataUri) return null

  return (
    <div className="h-full min-h-125">
      <TracespaceViewer
        useStorage={useStorage}
        showNav={showNav}
        showLoadFiles={showLoadFiles}
        showPageTitle={false}
        showPageTitleLogo={false}
        showAnalyticsOptin={showAnalyticsOptin}
        file={dataUri}
      />
    </div>
  )
}
