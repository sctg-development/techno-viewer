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

/** Represents a node in the file tree, either a folder or a typed document file. */
export interface FileNode {
  id: string
  name: string
  type: 'folder' | 'dxf' | 'pdf' | 'cpp' | 'h' | 'ts' | 'tsx' | 'js' | 'jsx' | 'rs' | 'yaml' | 'toml' | 'json' | 'sln' | 'vcxproj' | 'html' | 'xml' | 'gerber.zip' | 'xlsx' | 'other'
  path?: string          // relative URL path for encrypted files
  size?: number          // bytes (optional)
  children?: FileNode[]
  lang?: 'fr' | 'en' | 'zh'
  isOld?: boolean        // in an 'old' subfolder
}

/** Full file tree metadata loaded from the encrypted JSON manifest (`files.json.age`). */
export interface FileTree {
  version: number
  generated: string    // ISO timestamp
  tree: FileNode[]
  codeIndexes?: Record<string, string>
}

/** Holds the current user authentication session data stored in sessionStorage. */
export interface AuthSession {
  username: string
  privateKey: string   // AGE-SECRET-KEY-1…
}

/** Represents the lifecycle state of an AGE file decryption operation. */
export type DecryptState = 'idle' | 'loading' | 'success' | 'error'

/** Supported application UI languages. */
export type Language = 'fr' | 'en' | 'zh'

/** Associates a {@link FileNode} with its decrypted binary content, ready for display in a viewer. */
export interface ViewerFile {
  node: FileNode
  content: Uint8Array
}
