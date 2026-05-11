import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import {
  copyFileSync,
  createReadStream,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from 'fs'
import { fileURLToPath } from 'url'
import { resolve, dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Keep the locally imported cad-viewer CSS in sync with the installed package.
function copyCadViewerCss() {
  const src = resolve(__dirname, 'node_modules/@mlightcad/cad-viewer/dist/index.css')
  const dst = resolve(__dirname, 'src/cad-viewer.css')
  if (existsSync(src)) {
    copyFileSync(src, dst)
    console.log('✓ Synced cad-viewer CSS to src/cad-viewer.css')
  }
}
copyCadViewerCss()

// Ensure CAD workers are available at /assets/* for cad-viewer runtime.
function copyCadViewerWorkers(targetRoot: string) {
  const assetsDir = resolve(targetRoot, 'assets')
  mkdirSync(assetsDir, { recursive: true })

  const workerSources: Array<{ src: string; dest: string }> = []

  const dxfWorker = resolve(
    __dirname,
    'node_modules/@mlightcad/data-model/dist/dxf-parser-worker.js'
  )
  workerSources.push({ src: dxfWorker, dest: resolve(assetsDir, 'dxf-parser-worker.js') })

  const cadSimpleDist = resolve(
    __dirname,
    'node_modules/@mlightcad/cad-simple-viewer/dist'
  )
  if (existsSync(cadSimpleDist)) {
    for (const fileName of readdirSync(cadSimpleDist)) {
      if (!fileName.endsWith('-worker.js')) continue
      workerSources.push({
        src: resolve(cadSimpleDist, fileName),
        dest: resolve(assetsDir, fileName),
      })
    }
  }

  for (const { src, dest } of workerSources) {
    if (!existsSync(src)) continue
    copyFileSync(src, dest)
  }
}

function cadViewerWorkersPlugin() {
  return {
    name: 'cad-viewer-workers',
    configResolved() {
      copyCadViewerWorkers(resolve(__dirname, 'public'))
      console.log('✓ Ensured CAD workers in public/assets/')
    },
    closeBundle() {
      copyCadViewerWorkers(resolve(__dirname, 'dist'))
      console.log('✓ Copied CAD workers to dist/assets/')
    },
  }
}

/**
 * Serve encrypted/ as static assets in dev, and copy to dist/encrypted/ at build.
 * Vite only serves public/ by default; encrypted/ lives at project root.
 */
function encryptedAssetsPlugin() {
  return {
    name: 'encrypted-assets',
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        if (!req.url?.startsWith('/encrypted/')) return next()
        const filePath = resolve(__dirname, req.url.slice(1))
        if (!existsSync(filePath)) return next()
        res.setHeader('Content-Type', 'application/octet-stream')
        res.setHeader('Cache-Control', 'no-store')
        createReadStream(filePath).pipe(res)
      })
    },
    closeBundle() {
      const src = resolve(__dirname, 'encrypted')
      const dst = resolve(__dirname, 'dist/encrypted')
      if (existsSync(src)) {
        cpSync(src, dst, { recursive: true })
        console.log('✓ Copied encrypted/ to dist/encrypted/')
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    vue(),
    cadViewerWorkersPlugin(),
    encryptedAssetsPlugin(),
  ],
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        cadViewer: resolve(__dirname, 'cad-viewer-iframe.html'),
      },
      output: {
        manualChunks(id) {
          if (id.includes('age-encryption')) return 'age-encryption'
          if (id.includes('vue')) return 'vue-runtime'
          if (id.includes('i18next') || id.includes('react-i18next')) return 'i18n'
          if (id.includes('react-dom') || id.includes('react-router')) return 'react-vendor'
        },
      },
    },
  },
  optimizeDeps: {
    include: ['vue', '@mlightcad/cad-viewer'],
  },
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'credentialless',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  define: {
    "process.env.NODE_DEBUG": false,
  },
  resolve: {
    dedupe: ['react', 'react-dom', 'react/jsx-runtime'],

  },
})
