# AIMS Commerce — Architecture

> **Goal of this doc:** single source of truth for how the system fits together after the MongoDB → Supabase migration and the move toward a Vercel monorepo.
> **Last updated:** 2026-07-16 — 43/43 E2E tests passing.

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
│  │ src/lib/ — auth, supabase, db (monorepo-ready)                 │  │
│  └────────┬───────────────────────────────────────────────────────┘  │
│           │ NEXT_PUBLIC_API_URI (default http://127.0.0.1:5003)      │
└───────────┼──────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────────┐
│             Express.js (aims-commerce-backend, port 5003)            │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ 5 routers — all use postgres.js (no Mongoose)                  │  │
│  │ userRouter.js      ( 9 endpoints)                              │  │
│  │ productRouter.js   ( 8 endpoints, includes review)             │  │
│  │ orderRouter.js     (10 endpoints)                              │  │
│  │ sellerRouter.js    (10 endpoints)                              │  │
│  │ uploadRouter.js    ( 1 endpoint  → Supabase Storage)           │  │
│  │ backend/server.js — Express (chat moved to Supabase Realtime)  │  │
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
│  ┌──────────────┐ ┌────────────────┐                                │
│  │ order_items  │ │ reviews        │                                │
│  └──────────────┘ └────────────────┘                                │
│  RLS: 15 policies; Triggers: 5 (incl. auto-create-seller)          │
│  Storage: bucket "uploads" (planned, not yet created)               │
└──────────────────────────────────────────────────────────────────────┘
```

## 2. Repository Layout

```
aims/                            ← workspace root
├── aims-commerce/                ← Next.js 15 frontend (Pages Router, port 3005)
│   ├── src/
│   │   ├── lib/                  ← @lib/* alias — auth, db, supabase clients
│   │   │   ├── auth.ts           ← requireAuth/Admin/Seller (replacement for backend/utils.js)
│   │   │   ├── db.ts             ← postgres.js singleton
│   │   │   └── supabase.ts       ← Supabase client (admin + browser)
│   │   ├── helpers/, common/, components/, forms/, hooks/, layouts/, middleware.ts, pages/, services/, store/
│   │   └── …
│   ├── .env                       ← NEXT_PUBLIC_API_URI, NEXT_PUBLIC_SUPABASE_URL, DIRECT_URL, etc.
│   └── package.json
│
└── aims-commerce-backend/         ← Express.js + postgres.js API (port 5003)
    ├── backend/
    │   ├── server.js              ← Express only (chat on Supabase Realtime)
    │   ├── data.js                ← legacy 15-product seed (still used by /api/products/seed)
    │   ├── dbClient.js            ← postgres.js pool (the live one used by routers)
    │   ├── utils.js               ← generateToken, isAuth, isAdmin, isSeller
    │   └── routers/
    │       ├── userRouter.js       ← 9 endpoints
    │       ├── productRouter.js    ← 8 endpoints
    │       ├── orderRouter.js      ← 10 endpoints
    │       ├── sellerRouter.js     ← 10 endpoints
    │       └── uploadRouter.js     ← Supabase Storage
    ├── prisma/
    │   ├── schema.prisma          ← source of truth for table shape
    │   ├── migrations/            ← 0_init_mongodb_migration + 4 RLS/triggers
    │   ├── seed.ts                ← now a thin wrapper around db:migrate
    │   ├── seed-verify.sql
    │   └── MIGRATION_GUIDE.md
    ├── scripts/                    ← operational scripts
    │   ├── dumpMongo.mjs          ← MongoDB → mongo-dump/*.json
    │   ├── migrateMongoToSupabase.mjs  ← mongo-dump → Supabase (1:1)
    │   └── e2e_test.mjs           ← 43 endpoint tests × 3 roles
    ├── mongo-dump/                 ← JSON dump of original MongoDB data
    │   ├── users.json
    │   ├── sellers.json
    │   ├── products.json
    │   ├── orders.json
    │   ├── formdatas.json
    │   └── forms.json
    ├── uploads/                    ← legacy local image folder (still served by /uploads)
    ├── .env                        ← Supabase + Mongo + Stripe + JWT
    ├── MONGODB_TO_SUPABASE_MIGRATION_PLAN.md
    ├── ROLE_BASED_ACCESS.md
    └── ARCHITECTURE.md             ← this file (referenced from frontend as well)
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
| File uploads → Supabase Storage | 🟡 partial (router migrated, bucket + image upload not done) |
| Socket.IO verification with UUIDs | ✅ | Migrated to Supabase Realtime. `scripts/chat_test.mjs` (4/4) verifies session upsert + message insert + realtime broadcast. |
| Mongoose cleanup | ✅ (no mongoose in package.json or any .js/.ts) |
| ~~Railway deploy~~ | ❌ cancelled (replaced by monorepo deploy) |
| Frontend E2E | ✅ (43/43 passing — see ROLE_BASED_ACCESS.md) |
| Monorepo merge (Next.js API routes) | ⬜ |
| Vercel deploy | ⬜ |
