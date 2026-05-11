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

/** Props for the {@link PdfViewer} component. */
interface PdfViewerProps {
  data: Uint8Array
  fileName?: string
}

/**
 * Renders a PDF from raw bytes inside a native browser `<iframe>` via a Blob URL.
 * The Blob URL is automatically revoked when the component unmounts or the data changes.
 * @param data - Raw PDF bytes.
 * @param fileName - Used as the iframe title for accessibility.
 */
export default function PdfViewer({ data, fileName = 'document.pdf' }: PdfViewerProps) {
  const [blobUrl, setBlobUrl] = useState<string>('')

  useEffect(() => {
    if (!data?.length) return

    const blob = new Blob([data.buffer as ArrayBuffer], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    setBlobUrl(url)

    return () => {
      URL.revokeObjectURL(url)
      setBlobUrl('')
    }
  }, [data])

  if (!blobUrl) return null

  return (
    <iframe
      src={blobUrl}
      title={fileName}
      style={{ width: '100%', height: '100%', minHeight: '500px' }}
      className="border-0 bg-white"
    />
  )
}
