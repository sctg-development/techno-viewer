# Techno-Viewer Claude Sonnet 4.6 Skills

## Goal
Create skills dedicated to development support for **Techno-Viewer**, a React/Vite application that decrypts and displays engineering assets encrypted with AGE on the client.

## Project context
- Frontend React 19 + Vite 8
- Secure viewing UX for encrypted assets (`drawings`, `schematics`, `doc`, `agro-crypt`)
- Client-side AGE encryption/decryption using `age-encryption`
- Encrypted manifest and files stored under `public/files.json.age` and `encrypted/*.age`
- Rust tools in `rencrypt/` for key generation, encryption, and extraction/glossary
- Client-side encrypted IndexedDB cache with LRU via `src/services/encryptedFileCache.ts`
- Multilingual UI: FR/EN/CN

## Key files
- `README.md`, `USAGE.md`
- `package.json`, `vite.config.ts`, `tsconfig.json`
- `src/main.tsx`, `src/App.tsx`
- `src/context/AuthContext.tsx`
- `src/hooks/useAgeDecrypt.ts`
- `src/hooks/useFileTree.ts`
- `src/services/encryptedFileCache.ts`
- `src/components/viewers/` (DXF/PDF/XLSX/Monaco)
- `functions/api/file-viewed.js`
- `rencrypt/` Rust CLI and `rencrypt/README.md`
- `tools/` for translation/glossary

## Recommended skills

### 1. Architecture and flow analysis
- Understand the separation between:
  - encrypted manifest loading
  - fetching `.age` files
  - client-side AGE decryption
  - rendering in DXF/PDF/XLSX/Monaco viewers
- Explain the role of AGE key authentication versus a traditional auth model
- Verify the consistency of `src/hooks` + `src/services` architecture

### 2. AGE decryption audit and improvement
- Review the `useAgeDecrypt` flow and state handling
- Check error cases for missing `privateKey`, HTTP `fetch`, and AGE `decrypt`
- Optimize memory and persistent cache usage (IndexedDB)
- Identify test surfaces and regression risks

### 3. Technical viewer evaluation
- Audit the DXF/PDF/XLSX and Monaco viewer integrations
- Verify the user experience for large file loading
- Suggest improvements for fullscreen handling, rendering errors, and loading indicators

### 4. Build / environment / tooling support
- Diagnose `npm run dev:env` and `build:env` scripts
- Verify Vite, Tailwind, and mixed React + Vue dependency configuration
- Check Mac/browser compatibility and static app packaging

### 5. AI / translation / extraction assistance
- Audit AI tools in `tools/translate_en.py`, `tools/translate_cn.py`, and `rencrypt/src/translate.rs`
- Propose high-quality system prompts for technical DXF glossary translation
- Verify the `rencrypt extract`, `translate`, `generate` pipeline and `ai.json.enc` usage

## Usage guidance for Claude
- Always answer in French unless instructed otherwise
- Answer concisely and with a code focus
- Base responses on the key files listed above
- When a change is requested, specify the exact files involved
- Do not rewrite the whole application without a good reason

## Example prompt
```
You are a development assistant specialized in the Techno-Viewer project.
Analyze the source code, identify the following areas of interest, and propose a concrete action:
- AGE decryption flow (`src/hooks/useAgeDecrypt.ts`)
- persistent encrypted cache (`src/services/encryptedFileCache.ts`)
- encryption workflow in `rencrypt/`
- viewer architecture in `src/components/viewers/`

Give:
1. an architecture summary
2. the top 3 technical risks
3. one or two improvement recommendations
```

## Example user queries
- `Analyze the useAgeDecrypt flow and tell me whether error handling is correct.`
- `Propose an improvement for AGE key validation before decryption.`
- `Which files should I edit to add support for a new file type?`
- `Verify that the Vite configuration supports deployment on GitHub Pages.`

---

## Specific notes
- `rencrypt/` contains Rust logic for key generation, encryption, extraction, and translation
- The client interface is primarily React, but the project also includes Vue code for third-party components
- The primary goal is to keep sensitive data processing on the client
