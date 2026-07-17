# AIMS Commerce — Role-Based Access Control

> Last verified: 2026-07-17 — 79 API E2E tests + 16 browser E2E tests + DB scan CLEAN.
> Test runners: `npm run test:e2e`, `npm run test:browser`, `npm run test:scan` (in `aims-commerce-backend/`).
> Source of truth: `aims-commerce-backend/scripts/e2e_test.mjs` (API) and `scripts/browser_e2e_start_selling.mjs` (browser).

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
| `GET` | `/api/users/:id` | ✅ 401 (no token); 403 (other user); 200 (self or admin) — see security note below |
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

## Become-Seller Flow (realistic, end-to-end)

A 9-step customer → seller flow in `testBecomeSellerFlow()`:

1. **Register fresh customer** (`__TEST__newbie@aims.test`) — gets JWT
2. **GET /profile** → `isSeller=false` (start state)
3. **GET /sellers/products** → 403 (gate denies before promotion)
4. **POST /sellers/become** → 201 + `isSeller=true` + **new JWT issued**
5. **GET /profile with new JWT** → `isSeller=true`
6. **GET /sellers/products with new JWT** → 200 (gate now passes)
7. **GET /sellers/:id (public, no auth)** → 200, new seller visible to the world
8. **POST /signin (re-login from scratch)** → `isSeller=true` in fresh token
9. **POST /sellers/products with new JWT** → 201 (newbie can immediately create products)
10. **POST /sellers/become again** → 400 "User is already a seller"

Then explicit cleanup deletes the newbie + their seller row + any products they created. The global `cleanup()` is also a safety net.

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
  Total:  79
  Passed: 79
  Failed: 0
════════════════════════════════════════════
  admin:    13 pass, 0 fail (of 13)
  seller:   12 pass, 0 fail (of 12)
  customer: 35 pass, 0 fail (of 35)
  public:   19 pass, 0 fail (of 19)

$ npm run test:browser   # the "Start Selling" click flow in a real browser
════════════════════════════════════════════
  Browser E2E (Start Selling flow)
  Passed: 16
  Failed: 0
════════════════════════════════════════════

$ npm run test:scan      # post-run DB scan
  ✓ CLEAN — no test data found in any table.
```

## 6. Security Note: `GET /api/users/:id` was unauthenticated

The endpoint at `src/pages/api/users/[id].ts` previously had **no auth
check** on the GET handler — anyone could fetch the full user row
(email, phone, address, store_name, is_admin, is_seller, etc.). The
StartSellingForm was abusing it as a "refetch my profile" call after
`/api/sellers/become` returned, and then dispatching the raw
snake_case data into Redux, which **broke `userInfo.isSeller`** and
caused the destination page to bounce the user back to the form. The
user perceived this as "clicked Start Selling, nothing happened."

Both bugs were fixed:
- The form now uses `res.data.user` from `/api/sellers/become`
  directly (already camelCase) and only that.
- The endpoint now requires auth: only the user themselves or an
  admin can fetch a user row. The response is also mapped to camelCase.

## 7. Browser-level test: `test:browser`

Before the browser test existed, the only validation of the
"Start Selling" flow was API-level (HTTP requests to the endpoints).
The HTTP contract was correct, but the **UI** was broken. A real
browser test now exercises:

1. Register fresh customer via API
2. Open `/signin`, sign in via the UI
3. Verify JWT cookie was set
4. Navigate to `/start-selling`, verify form is visible
5. Fill the form (name + storeName)
6. Click the "Start Selling" submit button
7. Assert: the user lands on `/seller/dashboard` (not bounced back to `/start-selling`)
8. Assert: no error message is shown
9. Assert: the success/welcome/seller UI is visible
10. Re-signin via API → assert `isSeller=true`
11. Use the new JWT to access `/api/sellers/products` → 200
12. Verify the user has a `seller_id` in the DB
13. Public `GET /api/sellers/:id` returns the new seller's profile
14. Verify the cookie was updated to a seller JWT
15. Cleanup: delete the user and their seller row

The test is in `scripts/browser_e2e_start_selling.mjs` and uses
Playwright. Run with `npm run test:browser`.

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
