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

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toast } from '@heroui/react'
import { AuthProvider } from './context/AuthContext'
import Layout from './components/layout/Layout'
import Home from './pages/Home'
import DrawingsPage from './pages/Drawings'
import DocumentationPage from './pages/Documentation'
import SourceCodePage from './pages/SourceCode'
import SchematicsPage from './pages/Schematics.tsx'
import Contact from './pages/Contact'

/** Root application component. Configures the router, authentication context, and top-level route definitions. */
export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Toast.Provider />
      <AuthProvider>
        <Layout>
          <Routes >
            <Route path="/"         element={<Home />} />
            <Route path="/drawings" element={<DrawingsPage />} />
            <Route path="/docs"     element={<DocumentationPage />} />
            <Route path="/source-code" element={<SourceCodePage />} />
            <Route path="/schematics" element={<SchematicsPage />} />
            <Route path="/contact"  element={<Contact />} />
            {/* Catch-all: redirect to home */}
            <Route path="*"         element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </AuthProvider>
    </BrowserRouter>
  )
}
