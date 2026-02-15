# OCR Frontend (Next.js + Prisma + Kreuzberg)

This app provides:

- File preview/upload UI
- OCR/extraction requests to Kreuzberg API
- OCR/extraction requests to Mistral API (optional, selectable in UI)
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
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_GLM_OCR_MODEL=glm-ocr:latest
```

## OCR providers

The upload panel has an OCR provider selector:

- `GLM-OCR (Ollama)` (image OCR in current app flow)
- `Kreuzberg OCR` (existing flow)
- `Mistral OCR` (uses `MISTRAL_API_KEY`)

Provider choice is sent per upload request so both providers can coexist.

## EasyPanel deployment

This repo includes a production `Dockerfile`.

### 1) Create app service from this Git repo

- Runtime: Dockerfile
- Exposed port: `3000`

### 2) Set environment variables in EasyPanel app service

```env
DATABASE_URL=file:./dev.db
KREUZBERG_URL=https://basheer-kreuz.prd42b.easypanel.host
```

### 3) Persistent storage (important for SQLite)

If you use SQLite in production, mount a persistent volume to keep `dev.db` across restarts.

### 4) Deploy

The container startup command runs:

1. `prisma db push`
2. `next start`

so schema is synced before app start.
