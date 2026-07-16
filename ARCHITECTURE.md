# AIMS Commerce — Architecture

> **Goal of this doc:** single source of truth for how the system fits together after the MongoDB → Supabase migration and the move toward a Vercel monorepo.
> **Last updated:** 2026-07-16 — 43/43 E2E tests passing on **Next.js + Vercel serverless** (no Express in production).
>
> **Status:** Phase 3 (move API routes into Next.js) **COMPLETE**. The `aims-commerce-backend/` repo is now a sidecar containing only the migration scripts (`dumpMongo.mjs`, `migrateMongoToSupabase.mjs`, `setupSupabaseStorage.mjs`, `applyChatMigration.mjs`) and the E2E test suite. The Express server (`backend/server.js`) is legacy and no longer used by the frontend.

---

## 1. Bird's-Eye View

```
┌──────────────────────────────────────────────────────────────────────┐
│                    Browser (Next.js Pages Router)                    │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ Redux Toolkit + RTK Query (src/store/)                         │  │
│  │ MUI v5 components (src/components/, src/layouts/)              │  │
│  │ Formik + Yup forms (src/forms/)                                │  │
│  │ src/middleware.ts (route guard — decodes JWT client-side)      │  │
│  │ src/lib/ — auth, supabase, db, chatClient, mappers             │  │
│  └────────┬───────────────────────────────────────────────────────┘  │
│           │ /api/* (same-origin — Vercel serverless functions)     │
└───────────┼──────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────────┐
│                Vercel (Next.js 15, both UI and API)                  │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ src/pages/api/** — 37 endpoints as serverless functions        │  │
│  │   - users (6), products (5), orders (8), sellers (9)           │  │
│  │   - uploads (1, multipart via formidable)                      │  │
│  │   - _health, config/{paypal,google}                            │  │
│  │ Reuses: postgres.js client, JWT helpers, mappers,              │  │
│  │         Supabase Storage + Realtime                            │  │
│  └────────┬───────────────────────────────────────────────────────┘  │
│           │ DIRECT_URL / DATABASE_URL                                │
└───────────┼──────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Supabase (PostgreSQL 15, pgbouncer pooler, free tier)                │
│  ┌──────────┐ ┌────────┐ ┌──────────────┐ ┌──────────────┐          │
│  │ users    │ │sellers │ │ products     │ │ orders       │          │
│  └──────────┘ └────────┘ └──────────────┘ └──────────────┘          │
│  ┌──────────────┐ ┌────────────────┐ ┌────────────────────┐       │
│  │ order_items  │ │ reviews        │ │ chat_sessions      │       │
│  │              │ │                │ │ chat_messages      │       │
│  └──────────────┘ └────────────────┘ └────────────────────┘       │
│  RLS: 21 policies; Triggers: 5 (incl. auto-create-seller)          │
│  Realtime: chat_sessions + chat_messages in supabase_realtime pub  │
│  Storage: bucket "uploads" (public) — 15 product images            │
└──────────────────────────────────────────────────────────────────────┘
```

**Vercel is the only deploy target.** No Express server in production. The
`aims-commerce-backend/` repo is now scripts + E2E tests; `backend/server.js`
remains for local dev only.

## 2. Repository Layout

```
aims/                            ← workspace root
├── aims-commerce/                ← Next.js 15 frontend + API routes (Vercel)
│   ├── src/
│   │   ├── lib/                  ← @lib/* alias — auth, db, supabase, mappers
│   │   │   ├── auth.ts           ← requireAuth/Admin/Seller
│   │   │   ├── db.ts             ← postgres.js singleton
│   │   │   ├── supabase.ts       ← Supabase client (admin + browser)
│   │   │   ├── userMap.ts        ← mapUser() shared by all user endpoints
│   │   │   ├── orderMap.ts       ← buildOrderResponse() shared by all order endpoints
│   │   │   ├── sellerMap.ts      ← mapSeller() + ensureIsSeller()
│   │   │   └── chatClient.ts     ← Supabase Realtime adapter (replaces socket.io-client)
│   │   ├── helpers/, common/, components/, forms/, hooks/, layouts/, middleware.ts, pages/, services/, store/
│   │   └── …
│   │       ├── pages/api/         ← 37 endpoints as Next.js API routes
│   │       │   ├── _health.ts, config/{paypal,google}.ts
│   │       │   ├── users/{signin,register,google-auth,profile,index,[id]}.ts
│   │       │   ├── products/{index,categories,seed,[id],[id]/reviews}.ts
│   │       │   ├── orders/{index,summary,mine,purchase,create-payment-intent,[id],[id]/pay,[id]/deliver}.ts
│   │       │   ├── sellers/{become,analytics,products,products/[productId],orders,orders/[orderId]/status,profile,[sellerId]}.ts
│   │       │   └── uploads/index.ts (multipart via formidable)
│   ├── .env                       ← NEXT_PUBLIC_SUPABASE_URL, DIRECT_URL, JWT_SECRET, etc.
│   ├── vercel.json
│   └── package.json
│
└── aims-commerce-backend/         ← LEGACY / scripts only (no longer in the deploy path)
    ├── backend/
    │   ├── server.js              ← Legacy Express (kept for local dev)
    │   ├── data.js                ← 15-product seed (only used by Express /api/products/seed)
    │   ├── dbClient.js            ← postgres.js (also used by migration scripts)
    │   ├── utils.js               ← generateToken, isAuth, isAdmin, isSeller
    │   └── routers/               ← 5 routers (kept as reference for the API route equivalents)
    ├── prisma/
    │   ├── schema.prisma          ← source of truth for table shape
    │   ├── migrations/            ← 0_init + RLS + triggers + 5_chat_supabase_realtime.sql
    │   ├── seed.ts                ← thin wrapper around `npm run db:migrate`
    │   └── seed-verify.sql
    ├── scripts/                    ← operational scripts (still used in CI / by hand)
    │   ├── dumpMongo.mjs
    │   ├── migrateMongoToSupabase.mjs
    │   ├── setupSupabaseStorage.mjs
    │   ├── applyChatMigration.mjs
    │   ├── e2e_test.mjs           ← 43 endpoint tests × 3 roles
    │   └── chat_test.mjs          ← 4 Supabase Realtime tests
    ├── mongo-dump/                 ← JSON dump of original MongoDB data
    ├── uploads/                    ← legacy local image folder (still served by /uploads)
    ├── .env
    ├── MONGODB_TO_SUPABASE_MIGRATION_PLAN.md
    ├── ROLE_BASED_ACCESS.md
    └── ARCHITECTURE.md             ← this file
```

## 3. Database Schema

Defined in `prisma/schema.prisma`. Six tables:

| Table | Purpose | Key columns |
|---|---|---|
| `users` | All accounts (customer/seller/admin) | `id uuid PK`, `email unique`, `is_admin`, `is_seller`, `seller_id → sellers.id` |
| `sellers` | Seller profile (1:1 with user via `user_id`) | `id uuid PK`, `user_id unique`, `store_name`, `is_active_store`, `products_ids text[]` |
| `products` | Catalogue | `id uuid PK`, `name unique`, `seller_id → sellers.id`, `is_active`, `category`, `rating`, `num_reviews` |
| `orders` | Customer orders | `id uuid PK`, `user_id → users.id`, `is_paid`, `is_delivered`, shipping address flattened |
| `order_items` | Line items | `id uuid PK`, `order_id`, `product_id` (nullable — see below), `seller_id` (nullable), `name`, `qty`, `price` |
| `reviews` | Product reviews | `id uuid PK`, `product_id`, `user_id`, `rating`, `comment`, `(product_id, user_id) unique` |

**Mongoose→Postgres notes:**
- MongoDB `_id` (24-char hex) is replaced with `gen_random_uuid()` UUIDs. The migration script `scripts/migrateMongoToSupabase.mjs` produces a **deterministic** UUID for each ObjectId via MD5, so re-running the migration is idempotent and re-uses the same UUIDs.
- Embedded `orderItems` in `orders` becomes a separate `order_items` table with FK to `orders.id` and (nullable) FK to `products.id`.
- 250 `order_items` rows from the original MongoDB pointed to products that had been deleted before the migration. The migration nulls the broken `product_id` and the column is now `NULL`-able. See `ROLE_BASED_ACCESS.md` §7.

## 4. Auth Flow

```
┌──────────┐  POST /api/users/signin    ┌──────────────┐
│ Browser  │ ────────────────────────▶ │ userRouter   │
│          │  { email, password }       │              │
│          │                            │ bcrypt.compare│
│          │ ◀──── 200 { token, user }  │ jwt.sign     │
└──────────┘                            └──────────────┘
       │                                       │
       │ cookie / localStorage                 │ JWT_SECRET in env
       ▼                                       │
   Authorization: Bearer <token>  ────────────▶│
                                              ▼
                            isAuth → isAdmin → isSeller (per route)
```

- `JWT_SECRET` from env. Tokens are 30-day.
- Both `aims-commerce-backend/backend/utils.js` (Express) and `aims-commerce/src/lib/auth.ts` (Next.js) use the same `jsonwebtoken` library, so the same tokens work in both.
- `aims-commerce/src/middleware.ts` decodes the token client-side to gate `/admin/*` and `/seller/*` page navigation **before** making any backend call. This is purely UX — the backend re-validates every request.

## 5. Frontend State

- `src/store/` is a Redux Toolkit + RTK Query setup. Each slice (`user.slice.js`, `product.slice.js`, `order.slice.js`, `seller.slice.js`, `admin.slice.js`, `chat.slice.js`) co-locates the state and the API endpoints.
- API base URL: `process.env.NEXT_PUBLIC_API_URI` (defaults to `http://127.0.0.1:5003`).
- JWT attached via `apiSlice.prepareHeaders` reading from cookie + localStorage.
- Chat: `src/lib/chatClient.ts` (drop-in `socket.io-client` replacement) using Supabase Realtime (`postgres_changes` on `chat_messages` + `chat_sessions`). No long-lived WebSocket on the server — works in Vercel serverless.

## 6. Image / File Uploads

`uploads` bucket (public, 5 MB cap, image MIME types only) created in Supabase Storage.
All 15 seeded product images live there; product `image` rows hold the public Supabase URL.
`scripts/setupSupabaseStorage.mjs` is idempotent and uploads any local files in `uploads/` that
aren't already in the bucket.

- `POST /api/uploads` accepts a multipart file → uploads to Supabase Storage → returns the
  public URL (and optionally updates a product's `image` column).
- Backend still serves `app.use("/uploads", express.static(...))` for backward compatibility
  with the 8 legacy timestamped files (e.g. `1628083335036.jpg`) that aren't seeded products.
- The frontend `getImageUrl()` helper passes through whatever string is in `product.image` —
  no special-casing needed.

## 7. Source of Truth: `mongo-dump/`

After the migration, the canonical "original" data lives in:

- `mongo-dump/users.json` (131 users from MongoDB)
- `mongo-dump/sellers.json` (31 sellers)
- `mongo-dump/products.json` (17 products, 1 with rating=4.5)
- `mongo-dump/orders.json` (162 orders)
- `mongo-dump/order_items.json` (300 items — added by the migration step, not in the dump)
- `mongo-dump/formdatas.json` (3)
- `mongo-dump/forms.json` (1)

To re-seed Supabase from this dump:

```bash
cd aims-commerce-backend
npm run db:dump      # refresh mongo-dump/ from the live cluster
npm run db:migrate   # wipe + reload Supabase
```

`scripts/migrateMongoToSupabase.mjs` is idempotent (uses `ON CONFLICT DO NOTHING` everywhere) and produces deterministic UUIDs from ObjectIds.

## 8. Testing

| Layer | Tool | Where | Run |
|---|---|---|---|
| Unit / integration | Jest + RTL | `aims-commerce/` | `npm test` |
| E2E (full stack) | Node fetch + postgres.js | `aims-commerce-backend/scripts/e2e_test.mjs` | `npm run test:e2e` |
| Smoke (lib layer) | tsx | `aims-commerce/src/lib/smoke-test.ts` | manual |

E2E suite covers all 37 active endpoints + negative cases. See `ROLE_BASED_ACCESS.md` for the matrix and current results.

## 9. Environment Variables

### `aims-commerce/.env`

```env
NEXT_PUBLIC_API_URI="http://127.0.0.1:5003"
NEXT_PUBLIC_SUPABASE_URL="https://tmnsezftbqitxibndtlk.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="..."
SUPABASE_SECRET_KEY="..."
DATABASE_URL="postgresql://...pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://...pooler.supabase.com:5432/postgres"
JWT_SECRET="..."
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="..."
NEXT_PUBLIC_LOCATIONIQ_API_KEY="..."
NEXT_PUBLIC_PAYPAL_CLIENT_ID="..."
```

### `aims-commerce-backend/.env`

```env
MONGODB_URL="mongodb+srv://...mongodb.net/astech"
SUPABASE_URL="https://tmnsezftbqitxibndtlk.supabase.co"
SUPABASE_SECRET_KEY="..."
DATABASE_URL="postgresql://...pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://...pooler.supabase.com:5432/postgres"
JWT_SECRET="..."
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
PAYPAL_CLIENT_ID="..."
STRIPE_SECRET_KEY="..."
PORT=5003
```

## 10. Migration Status

See `MONGODB_TO_SUPABASE_MIGRATION_PLAN.md` and `SERVERLESS_DEPLOYMENT_PLAN.md` for the full phase breakdown. Quick status:

| Phase | Status |
|---|---|
| Backend env / schema / DDL / seed | ✅ |
| User / product / order / seller routers → postgres.js | ✅ |
| File uploads → Supabase Storage | ✅ complete |
| Socket.IO verification with UUIDs | ✅ Migrated to Supabase Realtime |
| Mongoose cleanup | ✅ |
| ~~Railway deploy~~ | ❌ cancelled (replaced by Vercel) |
| Frontend E2E | ✅ 43/43 on Next.js + Vercel production build |
| Monorepo merge (Next.js API routes) | ✅ All 37 endpoints under `src/pages/api/` |
| Vercel deploy | ✅ Ready (see "Vercel Deployment" below) |

## 11. Vercel Deployment

This app is designed to deploy to Vercel as a single Next.js project.

**Vercel project setup:**

1. Import the `aims-commerce` repo into Vercel
2. Framework preset: Next.js (auto-detected)
3. Root directory: `./`
4. Build command: (auto, `next build`)
5. Install command: `npm install --legacy-peer-deps` (the project's `package.json` mixes peer dep ranges; `--legacy-peer-deps` resolves them)

**Environment variables to set in the Vercel dashboard:**

| Variable | Required? | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Client + server |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Client + server |
| `SUPABASE_SECRET_KEY` | yes | Server-only, service-role |
| `DIRECT_URL` | yes | Server-only, postgres.js direct (port 5432) |
| `DATABASE_URL` | yes | Server-only, postgres.js via pooler (port 6543, pgbouncer) |
| `JWT_SECRET` | yes | Must match what the Express backend used (or all existing tokens break) |
| `STRIPE_SECRET_KEY` | yes | Live or test |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | yes | Live or test |
| `GOOGLE_CLIENT_ID` | yes | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | yes | Google OAuth |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | yes | Same as `GOOGLE_CLIENT_ID` |
| `PAYPAL_CLIENT_ID` | yes | PayPal |
| `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | yes | Same as `PAYPAL_CLIENT_ID` |
| `NEXT_PUBLIC_LOCATIONIQ_API_KEY` | yes | LocationIQ for maps |
| `SUPABASE_JWKS_URL` | optional | (not used yet) |
| `MONGODB_URL` | **no** | Migration scripts only, run from your laptop |

**Skip** the `PORT` variable — Vercel sets `$PORT` itself.

**After deploy:** hit `https://<your-domain>/api/_health` — should return `OK` with status 200. If it returns 500, check Vercel function logs — most likely a missing env var or a DB connection issue.

**The `aims-commerce-backend/` repo is NOT deployed** — it stays as the home of the migration scripts and the E2E test suite. Local dev can still run `node backend/server.js` if needed (deprecated but functional).
