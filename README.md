# OCR Frontend (Next.js + Prisma + Kreuzberg)

This app provides:

- File preview/upload UI
- OCR/extraction requests to Kreuzberg API
- OCR/extraction requests to Mistral API (optional, selectable in UI)
- OCR/extraction requests to Ollama GLM-OCR (optional, selectable in UI)
- OCR/extraction requests to Marker API (optional, selectable in UI)
- OCR/extraction requests to Docling API (optional, selectable in UI)
- AI editing actions inside BlockNote (`Summarize`, `Improve`, `Expand`)
- Extraction history stored with Prisma
- PDF page export as individual PNG images (no zip)

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Required environment variables

Create `.env` (or use `.env.example`) with:

```env
DATABASE_URL=file:./dev.db
KREUZBERG_URL=https://basheer-kreuz.prd42b.easypanel.host
MISTRAL_API_BASE_URL=https://api.mistral.ai
MISTRAL_OCR_MODEL=mistral-ocr-latest
MISTRAL_API_KEY=
ZAI_API_BASE_URL=https://api.z.ai/api/coding/paas/v4
ZAI_API_KEY=
ZAI_MODEL=glm-4.5
NVIDIA_API_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_API_KEY=
NVIDIA_MODEL=meta/llama-3.1-70b-instruct
GROQ_API_BASE_URL=https://api.groq.com/openai/v1
GROQ_API_KEY=
GROQ_MODEL=llama-3.3-70b-versatile
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_GLM_OCR_MODEL=glm-ocr:latest
MARKER_URL=http://localhost:8080
DOCLING_URL=http://localhost:5001
```

## AI in Editor

The BlockNote editor includes built-in AI actions:

- `Summarize`
- `Improve`
- `Expand`

These call `POST /api/ai` and apply the returned markdown back into the editor.

Required env vars for AI:

```env
ZAI_API_BASE_URL=https://api.z.ai/api/coding/paas/v4
ZAI_API_KEY=
ZAI_MODEL=glm-4.5
NVIDIA_API_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_API_KEY=
NVIDIA_MODEL=meta/llama-3.1-70b-instruct
GROQ_API_BASE_URL=https://api.groq.com/openai/v1
GROQ_API_KEY=
GROQ_MODEL=llama-3.3-70b-versatile
```

## OCR providers

The upload panel has an OCR provider selector:

- `Kreuzberg OCR` (default)
- `Marker (Best Formatting)`
- `Docling (Precise Tables)`
- `GLM-OCR (Ollama)` (image OCR only in current app flow)
- `Mistral OCR` (requires `MISTRAL_API_KEY`)

Provider choice is sent per upload request so all providers can coexist.

If you choose `GLM-OCR (Ollama)`, Ollama must be running and reachable from the app host.
If you choose `Marker` or `Docling`, those services must also be running and reachable from the app host.

Example local setup:

```bash
ollama serve
ollama pull glm-ocr:latest
```

## EasyPanel deployment

This repo includes a production `Dockerfile`.

### 1) Create app service from this Git repo

- Runtime: Dockerfile
- Exposed port: `3000`

### 2) Set environment variables in EasyPanel app service

```env
DATABASE_URL=file:./dev.db
KREUZBERG_URL=https://basheer-kreuz.prd42b.easypanel.host
MARKER_URL=https://your-marker-domain.example
DOCLING_URL=https://your-docling-domain.example
MISTRAL_API_BASE_URL=https://api.mistral.ai
MISTRAL_OCR_MODEL=mistral-ocr-latest
MISTRAL_API_KEY=
ZAI_API_BASE_URL=https://api.z.ai/api/coding/paas/v4
ZAI_API_KEY=
ZAI_MODEL=glm-4.5
NVIDIA_API_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_API_KEY=
NVIDIA_MODEL=meta/llama-3.1-70b-instruct
GROQ_API_BASE_URL=https://api.groq.com/openai/v1
GROQ_API_KEY=
GROQ_MODEL=llama-3.3-70b-versatile
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_GLM_OCR_MODEL=glm-ocr:latest
```

### 2b) Configure Kreuzberg service defaults (EasyPanel Kreuzberg container)

Set Kreuzberg OCR/layout defaults on the Kreuzberg service itself.

- Example file: `deploy/kreuzberg.env.example`
- Apply those keys in EasyPanel under the Kreuzberg service `Environment` tab

Recommended starting point:

```env
KREUZBERG_CORS_ORIGINS=https://your-frontend-domain.example
KREUZBERG_OCR_BACKEND=paddleocr
KREUZBERG_OCR_LANGUAGE=eng
KREUZBERG_PDF_HIERARCHY_ENABLED=true
KREUZBERG_WORKERS=4
KREUZBERG_CACHE_ENABLED=true
KREUZBERG_CACHE_DIR=/tmp/kreuzberg-cache
```

### 3) Persistent storage (important for SQLite)

If you use SQLite in production, mount a persistent volume to keep `dev.db` across restarts.

### 4) Deploy

The container startup command runs:

1. `prisma db push`
2. `next start`

so schema is synced before app start.
