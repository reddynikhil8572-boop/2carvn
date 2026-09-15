# 2carvn — Frontend

Multi-tenant education platform frontend. React 18 + TypeScript + Vite 5 + TanStack Query 5,
tailwindcss (shadcn-style Radix primitives). Talks to the Prisma/PostgreSQL backend at
[`backend-v2/`](backend-v2/) (`/api/v1`).

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # type-check (tsc -b) + production bundle
npm run lint         # tsc --noEmit
npm run test         # vitest (frontend suite in src/**)
```

Requires `backend-v2` running on `http://localhost:5000` (its CORS allow-list and
`FRONTEND_URL` both point at `localhost:3000`).

## Deploying

The frontend is deployed to Vercel and the API is deployed as a Render Web Service.
The repository includes [`vercel.json`](vercel.json) for Vite output and React Router
fallbacks, and [`render.yaml`](render.yaml) for the API build, start command, and health check.

### 1. Deploy the API to Render

Create a Render Blueprint from this repository, or create a Web Service with:

- Root directory: `backend-v2`
- Build command: `npm ci && npm run build`
- Start command: `npm start`
- Health check path: `/health`

Set the `sync: false` values in [`render.yaml`](render.yaml) in the Render dashboard.
Generate `ENCRYPTION_KEY` with `openssl rand -base64 32`; it must decode to exactly 32 bytes.
Use the connection strings and S3-compatible storage credentials from Supabase, AWS S3,
Cloudflare R2, or another provider. Render generates the JWT and encryption secrets in the
Blueprint. After the first deploy, copy the API URL, such as `https://edusphere-api.onrender.com`.

Run Prisma migrations once against the production database from a machine with the production
environment loaded:

```bash
cd backend-v2
npm run migrate:deploy
```

### 2. Deploy the frontend to Vercel

Import the repository into Vercel with the project root set to the repository root. Vercel
detects the existing Vite configuration. Add this environment variable for Production (and
Preview if needed):

```text
VITE_API_BASE_URL=https://edusphere-api.onrender.com
```

Then update these Render variables to the Vercel URL, without a trailing slash:

```text
FRONTEND_URL=https://your-app.vercel.app
CORS_ORIGIN=https://your-app.vercel.app
BACKEND_URL=https://edusphere-api.onrender.com
```

Keep `withCredentials` enabled on the frontend, as already configured. The API uses secure,
cross-site HTTP-only cookies in production, so both deployments must use HTTPS.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `http://localhost:5000` | Backend origin; the API is joined as `/api/v1`. |

**No secrets belong in frontend env vars.** `DATABASE_URL`, JWT/SMTP/S3/Redis keys, encrypting
keys, etc. are backend-only. See [`backend-v2/.env.example`](backend-v2/.env.example).

## Auth model

- Session is held in **HTTP-only cookies** (`edusphere_at` / `edusphere_rt`). Axios sends them via
  `withCredentials: true`. Nothing token-like is ever written to `localStorage` — the only value
  stored there is the theme preference (`edusphere:theme`).
- 401s trigger a single refresh via a shared in-flight promise; a second 401 (failed refresh)
  dispatches `edusphere:logout` and redirects to login — no retry loops.
- 403 → `/forbidden`; 5xx surfaces the backend's `requestId` for correlation; 501 (object storage
  unconfigured) renders "This feature is currently unavailable" instead of a raw error.

## Course content

Content is a tree — Course → Modules → Chapters → Lessons → **items** (`VIDEO` | `QUIZ` |
`ASSIGNMENT`), addressed by item id. Authoring (staff): [`course-edit.tsx`](src/pages/courses/course-edit.tsx).
Faceted learning (student): [`course-learn.tsx`](src/pages/courses/course-learn.tsx).

### Uploads (direct-to-storage)

Uploads flow through the backend only for signing; bytes go **directly** to the storage service
that is actually configured (it is not proxied through the server):

1. Backend issues a scoped presigned URL (course cover, lesson item video, assignment submission).
2. The browser PUTs/`FormData`-posts the bytes to storage (fields placed **before** the file, per
   the storage service's multipart contract).
3. The backend confirm/attach call records the object key.

Video items are created first, then uploaded + confirmed with `{ key, durationSeconds }`
(duration is probed client-side via a hidden `<video>` before confirmation). Assignment
submissions pass the uploaded `fileKey` straight to `POST /items/:id/submissions`.

Orchestration lives in [`src/api/upload.ts`](src/api/upload.ts); the reusable bits are
[`FilePicker`](src/components/file-picker.tsx) (choose/clear/progress) and
[`useCoverUrl`](src/hooks/useUpload.ts).

### Video progress & quizzes

- Watch time is reported via 15 s heartbeats (`POST /items/:id/video/heartbeat`); completion is
  **backend-authoritative** (≥90% furthest position + ≥90% credited watch time). The client only
  sends its current position + delta — never fabricated totals.
- Quiz attempts are server-enforced: the backend hard-expires them (`AttemptStatus.EXPIRED`)
  whether or not the client submits. [`QuizCountdown`](src/components/quiz-countdown.tsx) reflects
  the attempt's own `expiresAt` and blocks submission at zero.

## Routing & performance

- Routes are `React.lazy`, so each page loads on demand.
- `vite.config.ts` splits vendor code into cached chunks (`vendor-react`, `vendor-ui`, …); the
  largest baseline chunk stays under 220 kB.
- `MotionConfig reducedMotion="user"` respects the OS reduced-motion preference."# 2carvn" 
