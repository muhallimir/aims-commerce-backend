# AIMS Commerce — Role-Based Access Control

> Last verified: 2026-07-17 — 65/65 E2E tests passing across all 3 roles + 4 negative cases.
> Test runner: `npm run test:e2e` (in `aims-commerce-backend/`).
> Source of truth: `aims-commerce-backend/scripts/e2e_test.mjs`.

---

## 1. The Three Roles

| Role | `isAdmin` | `isSeller` | Auth source |
|---|---|---|---|
| **Customer** | `false` | `false` | `users.is_admin=false, is_seller=false` |
| **Seller** | `false` | `true` | `users.is_seller=true` + matching `sellers` row |
| **Admin** | `true` | any | `users.is_admin=true` |

A single user can be both admin and seller (e.g. `admin@example.com` from the original MongoDB dump). The JWT carries `isAdmin` and `isSeller` as separate claims, so the frontend can render both panels.

## 2. JWT Structure

```json
{
  "_id":      "uuid-string",   // users.id
  "name":     "Amir",
  "email":    "admin@example.com",
  "isAdmin":  true,
  "isSeller": true,
  "iat":      1752671234,
  "exp":      1755263234       // 30 days
}
```

Signed with `JWT_SECRET` (env var). Sent in `Authorization: Bearer <token>` header.

The frontend (`src/middleware.ts`) decodes the same JWT client-side and uses the `isAdmin` / `isSeller` claims to gate `/admin/*` and `/seller/*` routes **before** any backend call.

## 3. Backend Middleware Chain

`backend/utils.js` exports three Express middlewares:

| Middleware | What it checks | Failure status |
|---|---|---|
| `isAuth` | `Authorization: Bearer …` present + valid signature | `401` |
| `isAdmin` | `req.user.isAdmin === true` | `401` |
| `isSeller` | `req.user.isSeller === true` | `403` |

All routers (`backend/routers/*.js`) attach these per-route. There is **no implicit admin**: even an admin must send a valid JWT.

## 4. Endpoint × Role Matrix

Generated from `scripts/e2e_test.mjs` — the row in the right column is what the test actually expects.

### Public (no auth required)

| Method | Path | Test result |
|---|---|---|
| `GET` | `/api/products/` | ✅ 200, returns 15 of 17 products (2 belong to inactive sellers) |
| `GET` | `/api/products/categories` | ✅ 200, distinct active-seller categories |
| `GET` | `/api/products/:id` | ✅ 200, full product + reviews |
| `GET` | `/api/users/:id` | ✅ 200, public profile |
| `GET` | `/api/users/profile` | ✅ 401 (no token); 200 with token |
| `GET` | `/api/sellers/:sellerId` | ✅ 200 (found) / 404 (not found) |
| `GET` | `/api/config/paypal` | ✅ 200, PayPal client id |
| `GET` | `/api/config/google` | ✅ 200, Google oauth client id |
| `GET` | `/_health` | ✅ 200, "OK" |
| `POST` | `/api/users/register` | ✅ 200, returns user + JWT |
| `POST` | `/api/users/signin` | ✅ 200 (good creds), 401 (bad creds) |
| `POST` | `/api/users/google-auth` | ✅ 401 (bad token) — clean error, not 500 |
| `GET` | `/api/products/seed` | (legacy seed endpoint, not in test) |

### Customer (any authenticated user)

| Method | Path | Test |
|---|---|---|
| `GET` | `/api/users/profile` | ✅ 200 (own profile) |
| `PUT` | `/api/users/profile` | ✅ 200 |
| `PUT` | `/api/users/:id` (other user) | ❌ 401 denied |
| `DELETE` | `/api/users/:id` | ❌ 401 denied |
| `GET` | `/api/users` (list all) | ❌ 401 denied (admin only) |
| `GET` | `/api/orders/:id` (own) | ✅ 200 |
| `GET` | `/api/orders/:id` (no token) | ❌ 401 denied |
| `POST` | `/api/products/:id/reviews` | ✅ 201 |
| `POST` | `/api/orders/` | ✅ 201 |
| `GET` | `/api/orders/mine` | ✅ 200 |
| `GET` | `/api/orders/purchase` | ✅ 200 (alias of /mine) |
| `GET` | `/api/orders/purchase` (no token) | ❌ 401 denied |
| `PUT` | `/api/orders/:id/pay` | ✅ 200 |
| `POST` | `/api/orders/create-payment-intent` | ✅ 200 (Stripe live) / 503 (no key) |
| `POST` | `/api/orders/create-payment-intent` (no auth) | ❌ 401 denied |
| `PUT` | `/api/orders/:id/deliver` (customer attempt) | ❌ 401 — admin only |
| `POST` | `/api/sellers/become` | ✅ 201 — promotes user to seller |
| `GET` | `/api/sellers/products` | ❌ 403 denied (seller only) |
| `GET` | `/api/sellers/analytics` | ❌ 403 denied |
| `GET` | `/api/sellers/orders` | ❌ 403 denied |
| `PUT` | `/api/sellers/products/:productId` | ❌ 403 denied (only owning seller) |
| `DELETE` | `/api/sellers/products/:productId` | ❌ 403 denied (only owning seller) |
| `PUT` | `/api/sellers/orders/:orderId/status` | ❌ 403 denied (only seller of that order or admin) |
| `GET` | `/api/orders/summary` | ❌ 401 denied (admin only) |
| `POST` | `/api/uploads/` (no file) | ✅ 400 "No image file provided" |
| `POST` | `/api/uploads/` (no auth) | ❌ 401 denied |
| `POST` | `/api/uploads/` (real PNG) | ✅ 200 + Supabase Storage URL |
| `POST` | `/api/products` (admin create) | ❌ 401 denied |

### Seller (isSeller=true)

| Method | Path | Test |
|---|---|---|
| `GET` | `/api/sellers/products` | ✅ 200, returns own products |
| `POST` | `/api/sellers/products` | ✅ 201 |
| `PUT` | `/api/sellers/products/:productId` | ✅ 200 |
| `DELETE` | `/api/sellers/products/:productId` (no orders) | ✅ 200 |
| `DELETE` | `/api/sellers/products/:productId` (has order_items) | ✅ 409 Conflict — soft-delete instead |
| `GET` | `/api/sellers/analytics` | ✅ 200 |
| `GET` | `/api/sellers/orders` | ✅ 200 |
| `PUT` | `/api/sellers/orders/:orderId/status` (own order) | ✅ 200 |
| `PUT` | `/api/sellers/profile` | ✅ 200 |
| `PUT` | `/api/orders/:id/deliver` (seller attempt) | ❌ 401 denied — admin only |
| `POST` | `/api/sellers/become` (already a seller) | ❌ 400 "User is already a seller" |

### Admin (isAdmin=true)

| Method | Path | Test |
|---|---|---|
| `GET` | `/api/users` (list all) | ✅ 200 |
| `PUT` | `/api/users/:id` | ✅ 200 |
| `DELETE` | `/api/users/:id` | ✅ 200 |
| `POST` | `/api/products/` | ✅ 200 |
| `PUT` | `/api/products/:id` | ✅ 200 |
| `DELETE` | `/api/products/:id` | ✅ 200 |
| `GET` | `/api/orders/` (all) | ✅ 200 |
| `GET` | `/api/orders` (customer attempt) | ❌ 401 denied |
| `GET` | `/api/orders/summary` | ✅ 200 |
| `PUT` | `/api/orders/:id/deliver` | ✅ 200 |
| `DELETE` | `/api/orders/:id` | ✅ 200 |
| `POST` | `/api/uploads/` | ✅ (auth passes, file logic in handler) |

## 5. Test Results — Final Run

```
$ npm run test:e2e
════════════════════════════════════════════
  E2E Test Summary
  Total:  65
  Passed: 65
  Failed: 0
════════════════════════════════════════════
  admin:    11 pass, 0 fail (of 11)
  seller:   11 pass, 0 fail (of 11)
  customer: 24 pass, 0 fail (of 24)
  public:   19 pass, 0 fail (of 19)
```

JSON: `aims-commerce-backend/scripts/e2e_test_results.json`.

## 6. Test Data Hygiene

Every test-created row uses the `__TEST__` prefix on `name` / `email` / `store_name` / `image` / `shipping_full_name` / `comment`. After the suite runs, the cleanup hook deletes every row matching that prefix. The original MongoDB-dumped data is left intact.

**Verified after every run:**

| Entity | Original | After test | Δ |
|---|---:|---:|---:|
| users | 131 | 131 | 0 |
| sellers | 31 | 31 | 0 |
| products | 17 | 17 | 0 |
| orders | 162 | 162 | 0 |
| order_items | 300 | 300 | 0 |
| `__TEST__` rows | 0 | 0 | 0 |

## 7. Bugs Found and Fixed by the Test Suite

Running the suite surfaced 7 pre-existing bugs in the post-Mongoose migration code. All fixed in this commit:

1. `sellerRouter.js:142,151,168,392,394` — `oi.order` and `oi.seller` should be `oi.order_id` and `oi.seller_id` (column names from Prisma schema).
2. `sellerRouter.js` `/api/sellers/become` — explicit INSERT conflicted with `trigger_auto_create_seller` DB trigger. Switched to: trigger does the INSERT, JS code then patches `name`/`store_name`/`is_active_store` and links `users.seller_id`.
3. `sellerRouter.js` `/api/sellers/products/:id` and `/api/sellers/profile` and `/api/sellers/orders/:id/status` — `COALESCE(${x}, col)` with `x === undefined` throws `UNDEFINED_VALUE` in postgres.js. Fixed with `COALESCE(${x ?? null}, col)`.
4. `userRouter.js` `PUT /api/users/profile` and `PUT /api/users/:id` — called `sql.query(query, values)` which is not a postgres.js method. Replaced with `sql.unsafe(query, values)`.
5. `productRouter.js` `POST /api/products/:id/reviews` — `stats.avg_rating.toFixed(2)` failed because `numeric` columns come back as strings from postgres.js. Fixed with `parseFloat()` first.
6. `prisma/seed.ts` (the original MongoDB→Supabase seed) — was reading `p.rating` and `p.numReviews` from products that didn't have those fields, causing `UNDEFINED_VALUE`. **Replaced entirely** by `scripts/migrateMongoToSupabase.mjs` which reads from the actual MongoDB dump.
7. `order_items.product_id` is now nullable — the original MongoDB had 250 `order_items` rows pointing to products that were deleted from MongoDB before the migration. The migration nulls these broken refs and succeeds. (Schema `migration.sql` updated with `ALTER TABLE … ALTER COLUMN "product_id" DROP NOT NULL`.)

## 8. How to Run

```bash
cd aims-commerce-backend
node backend/server.js &           # start backend on :5003
npm run test:e2e                   # 43 tests, ~3s
```

Results in `scripts/e2e_test_results.json`.
