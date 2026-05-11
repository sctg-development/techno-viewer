# Techno-Viewer

**Techno-Viewer** is an open-source, client-side secure portal for browsing, decrypting and viewing encrypted engineering assets — DXF drawings, PDF documentation, XLSX spreadsheets, and source code — directly in the browser. No private key ever leaves the client.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-blue)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8-646cff)](https://vitejs.dev/)
[![AGE encryption](https://img.shields.io/badge/AGE-v1-green)](https://age-encryption.org/)
[![Code](https://tokeisrv.sctg.eu.org/b1/github.com/sctg-development/fufuni?type=Rust,TypeScript,TSX,html&category=code)]()
[![Comments](https://tokeisrv.sctg.eu.org/b1/github.com/sctg-development/fufuni?type=Rust,ypeScript,TSX,html&category=comments)]()

---

## Why Techno-Viewer?

Engineering teams routinely share sensitive assets — circuit schematics, mechanical drawings, firmware source — with a limited set of partners or customers. Techno-Viewer lets you:

- **Publish encrypted assets on any static host** (Cloudflare Pages, GitHub Pages, S3…)
- **Grant access per-user via AGE key pairs** — revoke by re-encrypting without the user's key
- **View DXF, PDF, XLSX and source code inline**, with AI-assisted code explanation and translation
- **Never expose plaintext files** to the server or CDN — decryption happens 100% in the browser

---

## Features

| Feature | Details |
|---|---|
| AGE decryption | Client-side, browser-native, zero server key handling |
| DXF viewer | Full CAD rendering via `@mlightcad/cad-viewer` |
| PDF viewer | Inline PDF rendering |
| XLSX viewer | Spreadsheet rendering via `xlsx` |
| Source code viewer | Monaco Editor with syntax highlighting |
| AI translation | Translate code comments to English (requires AI proxy) |
| AI explanation | Structured technical explanation of source files |
| AI junior comments | Annotate code for junior developers |
| Batch download | Download selected files as a ZIP archive |
| Persistent cache | Encrypted IndexedDB cache (LRU, 300 MiB default) |
| i18n | French, English, Chinese UI |
| Analytics | Optional PostHog file-view events (best-effort, backend-enriched) |

---

## Live Demo

> Copy the private key below and paste it into the login screen of your deployed instance.

**Test user 1 key** (decrypts the sample assets in this repository):

```
AGE-SECRET-KEY-1TUTW5YJN0NZ52ZJFVV9QHELJH5MY9ZL00YNG9LTK0QMP0YQJDFUQ5Y8NTH
```

The matching public key is `age102v6m86rmsv2hcqwhdk2zg5u6nsluh9jhrueletsl6zjkvkjg54s4yaj67`.  
All five test key pairs are in [keys/private/](keys/private/) and [keys/public/](keys/public/).

The sample encrypted assets include:
- `drawings/` — DXF technical drawing (`test.dxf`)
- `schematics/` — Electronic schematic DXF (`BMS_Buck-Boost.dxf`)
- `doc/` — PDF calculation note (`LM2587_BuckBoost_50W_Note_de_Calcul.pdf`)
- `agro-crypt/` — [agro-crypt](https://github.com/sctg-development/agro-crypt) C source code

---

## Screenshots

- Pseudo Login
<img width="1886" height="1614" alt="image" src="https://github.com/user-attachments/assets/d7618122-b9c3-4013-b45c-dfa2782e54e0" />

- DXF Viewer
<img width="1883" height="1615" alt="image" src="https://github.com/user-attachments/assets/7cd59e89-aef8-4837-b556-6bb1f99fe2b4" />

- Code Viewer
<img width="1885" height="1617" alt="image" src="https://github.com/user-attachments/assets/b502c9fb-7c85-41e0-9824-27e9d3ccbbf2" />

- Gerber viewer
<img width="1887" height="1613" alt="image" src="https://github.com/user-attachments/assets/3bb618cb-bdd6-4aae-9eba-e4a2090006d7" />



---

## Architecture

```
Browser (React 19 + Vite 8)
  │
  ├── Auth: AGE private key entered by user, stored in sessionStorage
  ├── Tree: encrypted manifest (public/files.json.age) fetched and decrypted
  ├── Files: /encrypted/*.age fetched on demand, decrypted in-browser
  └── Viewers: DXF / PDF / XLSX / Monaco rendered from decrypted bytes
                         │
                    (optional)
              Cloudflare Pages Function
              /api/file-viewed → PostHog
```

**Key source locations:**

| Path | Role |
|---|---|
| [src/main.tsx](src/main.tsx) | App entry point |
| [src/App.tsx](src/App.tsx) | Router shell |
| [src/context/AuthContext.tsx](src/context/AuthContext.tsx) | AGE key session state |
| [src/hooks/useAgeDecrypt.ts](src/hooks/useAgeDecrypt.ts) | File decryption flow |
| [src/hooks/useFileTree.ts](src/hooks/useFileTree.ts) | Encrypted manifest loading |
| [src/services/encryptedFileCache.ts](src/services/encryptedFileCache.ts) | IndexedDB LRU cache |
| [src/services/fileViewAnalytics.ts](src/services/fileViewAnalytics.ts) | Analytics client |
| [functions/api/file-viewed.js](functions/api/file-viewed.js) | Cloudflare Pages Function |
| [rencrypt/](rencrypt/) | Rust CLI — key gen, encryption, manifest |

---

## Quick Start

### Prerequisites

- Node.js 20+
- Rust toolchain (for `rencrypt`)

### 1. Install dependencies

```bash
npm install
```

### 2. Build rencrypt

```bash
cd rencrypt && cargo build --release && cd ..
```

### 3. Generate key pairs

```bash
rencrypt/target/release/rencrypt -v generate-keys --keys=keys --count=5
```

### 4. Add your assets and encrypt

```bash
# Place your files under drawings/, schematics/, doc/, or any custom path
rencrypt/target/release/rencrypt encrypt \
  --path drawings/ \
  --path schematics/ \
  --path doc/ \
  --keep-plaintext-manifest -v
```

This writes encrypted files to `encrypted/` and the manifest to `public/files.json.age`.

### 5. Configure environment

```bash
cp .env.example .env
# Edit .env with your values
```

### 6. Run in development

```bash
npm run dev:env
```

### 7. Build for production

```bash
npm run build:env
```

---

## Encryption Model

```
Source file ──► rencrypt encrypt ──► encrypted/<sha256>.age
                     │
                     └── AGE v1 X25519, encrypted for every public key in keys/public/

Manifest (files.json) ──► rencrypt encrypt ──► public/files.json.age
```

- Each file is encrypted once per recipient public key stored in `keys/public/`
- The manifest maps virtual paths (e.g. `drawings/en/test.dxf`) to encrypted blob hashes
- Revoke access by removing a public key and re-running `rencrypt encrypt`

### Rencrypt CLI reference

```bash
# Generate N key pairs
rencrypt generate-keys --keys=keys --count=5

# Encrypt source trees
rencrypt encrypt --path ./drawings --path ./doc [--keys keys] [--encrypted-dir encrypted]

# Extract DXF strings to glossary CSV
rencrypt extract --path drawings/en --glossary glossaire.csv

# AI-translate glossary
rencrypt translate --lang=en,cn --ai-json-enc <url> --ai-cryptoken <token>
```

See [USAGE.md](USAGE.md) for the full workflow.

---

## Deployment

The project deploys to Cloudflare Pages out of the box. The GitHub Actions workflow in [.github/workflows/](.github/workflows/) injects `POSTHOG_PROJECT_TOKEN` and `POSTHOG_HOST` from repository secrets before running `wrangler pages deploy`.

Any static host with custom headers support works — just ensure:

1. `encrypted/` directory is served with `Cache-Control: no-store`
2. SPA fallback routes all 404s to `index.html`

See [public/_headers](public/_headers) and [public/_redirects](public/_redirects).

---

## AI Features (Optional)

The Monaco viewer can translate, explain and annotate source code using an LLM via a configurable proxy. Set `AI_PROXY_URL` in `.env` (or hardcode the proxy URL in the source). The proxy must be compatible with the OpenAI chat completions API.

A compatible proxy: [sctg-development/ai-proxy-cloudflare](https://github.com/sctg-development/ai-proxy-cloudflare)

Authentication uses the user's AGE private key as a bearer token — no additional credential required.

---

## Persistent Encrypted Cache

To reduce repeated network fetches, the app stores encrypted payloads in IndexedDB:

- Backend: IndexedDB with `StorageManager` persistence request
- Eviction: LRU
- Default budget: 300 MiB
- Cache metrics visible in the UI (entries, size, hits/misses, origin quota)

Only encrypted bytes are cached — decrypted content lives only in memory during the active session.

---

## Analytics

Every file opened emits a `File Viewed` event; every ZIP download emits a `Files Downloading` event. Both are sent to a Cloudflare Pages Function at `/api/file-viewed` which enriches them with IP and geo data before posting to PostHog.

The browser never sends the user's private key to the backend — it derives and sends only the public key.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend framework | React 19 + TypeScript |
| Build tool | Vite 8 |
| UI components | HeroUI, Tailwind CSS 4 |
| CAD rendering | `@mlightcad/cad-viewer`, `@sctg/tracespace-view` |
| Code editor | Monaco Editor |
| Encryption | `age-encryption` (AGE v1 X25519) |
| Archiving | JSZip |
| i18n | i18next + react-i18next |
| Backend | Cloudflare Pages Functions |
| Analytics | PostHog |
| Encryption CLI | Rust (`rencrypt`) |

---

## Repository Layout

```
techno-viewer/
├── src/                  React application source
│   ├── components/       UI components (viewers, layout…)
│   ├── context/          Auth context
│   ├── hooks/            useAgeDecrypt, useFileTree, …
│   ├── i18n/             Translation resources (fr, en, zh)
│   ├── pages/            Home, Drawings, Documentation, Contact
│   └── services/         Cache, analytics
├── public/               Static assets + files.json.age manifest
├── encrypted/            AGE-encrypted file blobs (generated)
├── drawings/             Source DXF drawings (plaintext, not committed in prod)
├── schematics/           Source electronic schematics
├── doc/                  Source documentation (PDF…)
├── agro-crypt/           Sample C source (agro-crypt project)
├── keys/
│   ├── public/           AGE public keys (committed, one per user)
│   └── private/          AGE private keys (NEVER commit to a public repo)
├── rencrypt/             Rust CLI source
├── functions/            Cloudflare Pages Functions
└── tools/                Python helper scripts (DXF→PDF, AI translation…)
```

> **Security note:** The `keys/private/` directory in this repository contains **test-only** keys generated for demonstration purposes. For a production deployment, generate fresh keys, **never commit private keys**, and distribute them to users through a secure channel.

---

## Contributing

Contributions are welcome. Please open an issue to discuss significant changes before submitting a pull request.

---

## License

MIT — see [LICENSE.md](LICENSE.md).

Copyright (c) 2024-2026 Ronan Le Meillat — SCTG Development
