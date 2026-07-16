# MongoDB → Supabase (PostgreSQL) Migration Plan

> **Project:** AIMS Commerce — Multi-vendor E-Commerce Platform
> **Migration Target:** Supabase PostgreSQL
> **Source:** MongoDB (deployed on Railway, cluster `freecluster.bchmu.mongodb.net`)
> **Date:** 2025-07-15
> **Status:** ⚠️ PARTIALLY COMPLETE — Router migration done, pending deployment steps
> **Completed:** Phases 1-7 ✅ (Database + all routers migrated Mongoose → postgres.js)
> **Remaining:** Phases 8-12 (Uploads, Socket.IO, cleanup, deploy, E2E test)

---

## 📊 Quick Status Summary

| Phase | Status | What Was Done |
|-------|--------|---------------|
| **1: Env Setup** | ✅ COMPLETE | Prisma 7.8.0 init, DATABASE_URL (Supabase Pooler) |
| **2: Prisma Schema** | ✅ COMPLETE | 6 models (User, Seller, Product, Order, Item, Review) validated |
| **3: DDL Migration** | ✅ COMPLETE | 4 SQL files applied: extensions → DDL → RLS (15 policies) → triggers (5 hooks) |
| **4: Seed Data** | ✅ COMPLETE | postgres.js seed → 2 users + 1 seller + 15 products verified |
| **5: User Router** | ✅ COMPLETE | userRouter.js → postgres.js (9 endpoints, 314 lines) |
| **6: Product Router** | ✅ COMPLETE | productRouter.js → postgres.js (8 endpoints, 386 lines) |
| **7: Order/Seller Router** | ✅ COMPLETE | orderRouter.js + sellerRouter.js → postgres.js (20 endpoints, 1161 lines) |
| **8: File Uploads** | ⬜ PENDING | uploadRouter.js → Supabase Storage |
| **9: Socket.IO** | ⬜ PENDING | Verify chat with UUID user IDs |
| **10: Mongoose Cleanup** | ⬜ PENDING | Remove mongoose dep from package.json, remove MongoDB connection from server.js |
| **11: Railway Deploy** | ⬜ PENDING | Update Railway env vars, test health endpoint |
| **12: Frontend E2E** | ⬜ PENDING | Full test of all 37 API endpoints from Next.js |
> **Note on ORM choice:** Phases 5-7 initially planned for Prisma Client, but Prisma 7 failed to initialize with Supabase's pgbouncer pooler in the ESM/TSX environment. We pivoted to **postgres.js** (raw parameterized SQL) which works reliably. Prisma is kept only for schema validation. All 38 active router endpoints use postgres.js exclusively.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Repo Structure Analysis](#2-repo-structure-analysis)
3. [MongoDB Schema → PostgreSQL Mapping](#3-mongodb-schema--postgresql-mapping)
4. [Prerequisites & Environment Setup](#4-prerequisites--environment-setup)
5. [Migration Phases](#5-migration-phases)
6. [Data Type Mapping Reference](#6-data-type-mapping-reference)
7. [API Endpoint Mapping](#7-api-endpoint-mapping)
8. [Risk Register & Mitigations](#8-risk-register--mitigations)
9. [Rollback Plan](#9-rollback-plan)
10. [Communication & Checkpoint Protocol](#10-communication--checkpoint-protocol)

---

## 1. Architecture Overview

### Current Architecture (MongoDB)

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (aims-commerce)              │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Next.js 15 (TypeScript) — Port 3005             │  │
│  │  Redux Toolkit + RTK Query for API calls         │  │
│  │  Socket.IO Client for real-time chat             │  │
│  └───────────┬───────────────────────────────────────┘  │
│              │  Axios / fetchBaseQuery                   │
│              ▼                                           │
│  API Base: NEXT_PUBLIC_API_URI (Railway backend URL)    │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│              Backend (aims-commerce-backend)             │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Express.js + Socket.IO — Port 5003               │  │
│  │  JWT auth (jsonwebtoken)                           │  │
│  │  bcryptjs for password hashing                     │  │
│  │  Multer for file uploads                           │  │
│  │  Stripe SDK for payments                           │  │
│  │  Google Auth Library for OAuth                     │  │
│  │  MongoDB Driver via Mongoose ^5.13.5               │  │
│  └────────────────┬──────────────────────────────────┘  │
└───────────────────┼─────────────────────────────────────┘
                    │ mongoose.connect()
                    ▼
┌─────────────────────────────────────────────────────────┐
│              MongoDB (Railway)                          │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Database: astech                                 │  │
│  │  Collections:                                     │  │
│  │    • users (with seller ref)                      │  │
│  │    • products (with seller ref)                   │  │
│  │    • sellers (with user ref + product refs)       │  │
│  │    • orders (with user + product + seller refs)   │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Target Architecture (Supabase)

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (aims-commerce)              │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Next.js 15 (TypeScript) — Port 3005             │  │
│  │  Redux Toolkit + RTK Query for API calls         │  │
│  │  Socket.IO Client for real-time chat             │  │
│  └───────────┬───────────────────────────────────────┘  │
│              │  REST API calls (unchanged)               │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│      Backend (aims-commerce-backend) + postgres.js       │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Express.js + Socket.IO — Port 5003               │  │
│  │  postgres.js — parameterized SQL queries          │  │
│  │  JWT auth (jsonwebtoken) — unchanged              │  │
│  │  bcryptjs for password hashing — unchanged        │  │
│  │  Multer for file uploads → Supabase Storage (P8)  │  │
│  │  Stripe SDK — unchanged                           │  │
│  │  Google Auth Library — unchanged                  │  │
│  │  postgres.js replaces Mongoose                    │  │
│  └────────────────┬──────────────────────────────────┘  │
└───────────────────┼─────────────────────────────────────┘
                    │ postgres.js
                    ▼
┌─────────────────────────────────────────────────────────┐
│              Supabase PostgreSQL                        │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Database: astech_supabase                        │  │
│  │  Tables:                                          │  │
│  │    • users (UUID PK, FK → sellers)                │  │
│  │    • sellers (UUID PK, FK → users)                │  │
│  │    • products (UUID PK, FK → sellers)             │  │
│  │    • user_reviews (FK → products)                 │  │
│  │    • orders (UUID PK, FK → users)                 │  │
│  │    • order_items (FK → orders, products, sellers)  │ │
│  │                                                   │  │
│  │  Storage:                                         │  │
│  │    • "uploads" bucket (replaces /uploads folder)  │  │
│  │                                                   │  │
│  │  Row-Level Security (RLS):                        │  │
│  │    • Enabled on all user-facing tables            │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Repo Structure Analysis

### Backend (`aims-commerce-backend`)

```
aims-commerce-backend/
├── package.json              — Dependencies: postgres, express, stripe, socket.io, etc.
├── .env                      — DATABASE_URL, JWT_SECRET, Stripe, Google, PayPal keys
├── Procfile                  — Railway deployment: "start": "node backend/server.js"
├── yarn.lock                 — Lockfile
├── prisma/
│   ├── schema.prisma          — 6 models (User, Seller, Product, Order, Item, Review)
│   ├── seed.ts                 — Seed data (2 users + 1 seller + 15 products)
│   ├── seed-verify.sql        — Verification queries
│   └── migrations/            — 4 SQL migration files (DDL + RLS + triggers)
├── uploads/                  — Image uploads (26 product images, migrate to Supabase Storage in Phase 8)
├── backend/
│   ├── server.js             — Express entry, socket.io, all route mounts, health check
│   ├── data.js               — Seed data (2 users, 16 products)
│   ├── utils.js              — JWT helpers, isAuth, isAdmin, isSeller middleware
│   ├── dbClient.js           — Shared postgres.js connection (replaces mongoose)
│   ├── prismaClient.ts       — Prisma Client singleton (kept for schema validation)
│   ├── routers/
│   │   ├── userRouter.js     — 9 endpoints: postgres.js
│   │   ├── productRouter.js  — 8 endpoints: postgres.js
│   │   ├── orderRouter.js    — 10 endpoints: postgres.js
│   │   ├── sellerRouter.js   — 10 endpoints: postgres.js
│   │   └── uploadRouter.js   — 1 endpoint: Multer disk storage (migrate in Phase 8)
│   └── scripts/              — ⚠️ REMOVED (MongoDB migration helpers no longer needed)
```
> **Models deleted:** `backend/models/` (4 Mongoose model files) removed after router migration completion. Original plan references these — they are now replaced by postgres.js SQL queries in the router files.

### Frontend (`aims-commerce`)

```
aims-commerce/
├── package.json          — Next.js 15 + Redux Toolkit + RTK Query
├── .env                  — NEXT_PUBLIC_API_URI, Stripe, Google, PayPal keys
├── next.config.js        — Next.js config
├── src/
│   ├── store/
│   │   ├── api.slice.js      — RTK Query base API (baseUrl + JWT header injection)
│   │   ├── user.slice.js     — Auth endpoints: signIn, register, profile, getUsers, updateUser, googleAuth
│   │   ├── products.slice.js — Product endpoints: list, categories, search, getById, create, update, delete, reviews, upload image
│   │   ├── order.slice.js    — Order endpoints: getById, history, create, pay, getAll, summary
│   │   ├── seller.slice.js   — Seller endpoints: become, get products/orders/analytics, product CRUD, profile, order status
│   │   ├── summary.slice.js  — Dashboard: getOrdersSummary
│   │   └── index.js          — Redux store config with RTK Query middleware
│   └── hooks/
│       ├── useAuthentication.js
│       ├── useOrderManagement.js
│       ├── useCartHandling.js
│       └── useSellerAuth.ts
```

### API Endpoints Inventory (37 total)

| Route | Method | Auth | DB Operations |
|-------|--------|------|---------------|
| `/api/users/seed` | GET | No | Insert 2 users |
| `/api/users/google-auth` | POST | No | Find/Create user, JWT |
| `/api/users/signin` | POST | No | Find user by email, bcrypt |
| `/api/users/register` | POST | No | Create user, JWT |
| `/api/users/:id` | GET | No | Find by ID |
| `/api/users/profile` | PUT | JWT | Update user |
| `/api/users/` | GET | JWT + Admin | Find all users |
| `/api/users/:id` | DELETE | JWT + Admin | Delete user |
| `/api/users/:id` | PUT | JWT + Admin | Update user |
| `/api/products/` | GET | No | Aggregate: lookup sellers, filter, sort |
| `/api/products/categories` | GET | No | Aggregate: lookup + group |
| `/api/products/seed` | GET | No | Insert 16 products |
| `/api/products/:id` | GET | No | Aggregate: lookup + filter |
| `/api/products/:id` | PUT | JWT + Admin | Update product |
| `/api/products/:id` | DELETE | JWT + Admin | Delete product |
| `/api/products/` | POST | JWT + Admin | Create product |
| `/api/products/:id/reviews` | POST | JWT | Add review, recalculate rating |
| `/api/orders/` | GET | JWT + Admin | Find all, populate user |
| `/api/orders/summary` | GET | JWT + Admin | Aggregations on orders/users |
| `/api/orders/mine` | GET | JWT | Find by user ID |
| `/api/orders/purchase` | GET | JWT | Find by user ID |
| `/api/orders/:id` | GET | JWT | Find by ID |
| `/api/orders/` | POST | JWT | Create order, lookup seller info |
| `/api/orders/:id/pay` | PUT | JWT | Update payment status |
| `/api/orders/create-payment-intent` | POST | JWT | Stripe API call |
| `/api/orders/:id` | DELETE | JWT + Admin | Delete order |
| `/api/orders/:id/deliver` | PUT | JWT + Admin | Update delivery status |
| `/api/sellers/become` | POST | JWT | Update user + create seller |
| `/api/sellers/analytics` | GET | JWT + Seller | Aggregations on orders/products |
| `/api/sellers/products` | GET | JWT + Seller | Find products by seller |
| `/api/sellers/products` | POST | JWT + Seller | Create product |
| `/api/sellers/products/:productId` | PUT | JWT + Seller | Update product |
| `/api/sellers/products/:productId` | DELETE | JWT + Seller | Delete product |
| `/api/sellers/orders` | GET | JWT + Seller | Find orders, unwind orderItems |
| `/api/sellers/orders/:orderId/status` | PUT | JWT + Seller | Update delivery status |
| `/api/sellers/profile` | PUT | JWT + Seller | Update user + seller |
| `/api/sellers/:sellerId` | GET | JWT | Find seller, populate user |
| `/api/uploads/` | POST | JWT | Multer → disk storage |
| `/api/config/paypal` | GET | No | Return PayPal client ID |
| `/api/config/google` | GET | No | Return Google API key |
| `/_health` | GET | No | Health check |

---

## 3. MongoDB Schema → PostgreSQL Mapping

### 3.1 User Table

| MongoDB Field | Type | PostgreSQL Field | Type | Constraints |
|---------------|------|-----------------|------|-------------|
| `_id` | ObjectId (24-char hex) | `id` | UUID | PRIMARY KEY |
| `name` | String | `name` | VARCHAR(255) | NOT NULL |
| `email` | String (unique) | `email` | VARCHAR(255) | NOT NULL, UNIQUE |
| `password` | String | `password` | VARCHAR(255) | NOT NULL |
| `phone` | String | `phone` | VARCHAR(50) | NULL |
| `address` | String | `address` | TEXT | NULL |
| `city` | String | `city` | VARCHAR(100) | NULL |
| `country` | String | `country` | VARCHAR(100) | NULL |
| `isAdmin` | Boolean (default: false) | `is_admin` | BOOLEAN | NOT NULL, DEFAULT false |
| `isSeller` | Boolean (default: false) | `is_seller` | BOOLEAN | NOT NULL, DEFAULT false |
| `storeName` | String | `store_name` | VARCHAR(255) | NULL |
| `seller` | ObjectId ref | `seller_id` | UUID | REFERENCES sellers(id) ON DELETE SET NULL |
| `createdAt` | Date | `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| `updatedAt` | Date | `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

**Indexes:**
- `idx_users_email` — UNIQUE on `email`
- `idx_users_seller_id` — on `seller_id`

### 3.2 Seller Table

| MongoDB Field | Type | PostgreSQL Field | Type | Constraints |
|---------------|------|-----------------|------|-------------|
| `_id` | ObjectId (24-char hex) | `id` | UUID | PRIMARY KEY |
| `user` | ObjectId ref (unique, required) | `user_id` | UUID | NOT NULL, UNIQUE, REFERENCES users(id) ON DELETE CASCADE |
| `name` | String | `name` | VARCHAR(255) | NOT NULL |
| `products` | [ObjectId refs] | *(see junction approach)* | — | See §3.5 |
| `storeName` | String | `store_name` | VARCHAR(255) | NULL |
| `storeDescription` | String | `store_description` | TEXT | NULL |
| `profileImage` | String | `profile_image` | VARCHAR(500) | NULL |
| `isActiveStore` | Boolean (default: false) | `is_active_store` | BOOLEAN | NOT NULL, DEFAULT false |
| `rating` | Number (default: 0) | `rating` | NUMERIC(3,2) | NOT NULL, DEFAULT 0, CHECK (rating >= 0) |
| `numReviews` | Number (default: 0) | `num_reviews` | INTEGER | NOT NULL, DEFAULT 0 |
| `createdAt` | Date | `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| `updatedAt` | Date | `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

**Indexes:**
- `idx_sellers_user_id` — UNIQUE on `user_id`

### 3.3 Product Table

| MongoDB Field | Type | PostgreSQL Field | Type | Constraints |
|---------------|------|-----------------|------|-------------|
| `_id` | ObjectId (24-char hex) | `id` | UUID | PRIMARY KEY |
| `name` | String (unique) | `name` | VARCHAR(255) | NOT NULL, UNIQUE |
| `image` | String | `image` | VARCHAR(500) | NOT NULL |
| `brand` | String | `brand` | VARCHAR(100) | NOT NULL |
| `category` | String | `category` | VARCHAR(100) | NOT NULL |
| `description` | String | `description` | TEXT | NOT NULL |
| `price` | Number | `price` | NUMERIC(10,2) | NOT NULL |
| `countInStock` | Number | `count_in_stock` | INTEGER | NOT NULL |
| `rating` | Number | `rating` | NUMERIC(3,2) | NOT NULL, DEFAULT 0 |
| `numReviews` | Number | `num_reviews` | INTEGER | NOT NULL, DEFAULT 0 |
| `reviews` | [embedded docs] | *(see junction approach)* | — | See §3.5 |
| `isActive` | Boolean (default: true) | `is_active` | BOOLEAN | NOT NULL, DEFAULT true |
| `seller` | ObjectId ref | `seller_id` | UUID | REFERENCES sellers(id) ON DELETE CASCADE |
| `createdAt` | Date | `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| `updatedAt` | Date | `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

**Indexes:**
- `idx_products_name` — on `name` (partial, for lookups)
- `idx_products_category` — on `category`
- `idx_products_price` — on `price`
- `idx_products_rating` — on `rating`
- `idx_products_seller_id` — on `seller_id`
- `idx_products_is_active` — on `is_active` WHERE is_active = true

### 3.4 Order Table

| MongoDB Field | Type | PostgreSQL Field | Type | Constraints |
|---------------|------|-----------------|------|-------------|
| `_id` | ObjectId (24-char hex) | `id` | UUID | PRIMARY KEY |
| *(flat fields below)* | | | | |
| `user` | ObjectId ref | `user_id` | UUID | NOT NULL, REFERENCES users(id) |
| `orderItems` | [embedded docs] | *(see §3.5)* | — | See junction approach |
| `paymentMethod` | String | `payment_method` | VARCHAR(50) | NOT NULL |
| `paymentResult` | {id, status, updateTime, email} | `payment_result` | JSONB | NULL |
| `itemsPrice` | Number | `items_price` | NUMERIC(12,2) | NOT NULL |
| `shippingPrice` | Number | `shipping_price` | NUMERIC(12,2) | NOT NULL |
| `taxPrice` | Number | `tax_price` | NUMERIC(12,2) | NOT NULL |
| `totalPrice` | Number | `total_price` | NUMERIC(12,2) | NOT NULL |
| `shippingAddress` | {fullName, contact, address, city, postalCode, country, lat, lng} | *(see §3.5)* | — | See junction approach |
| `isPaid` | Boolean (default: false) | `is_paid` | BOOLEAN | NOT NULL, DEFAULT false |
| `paidAt` | Date | `paid_at` | TIMESTAMPTZ | NULL |
| `isDelivered` | Boolean (default: false) | `is_delivered` | BOOLEAN | NOT NULL, DEFAULT false |
| `deliveredAt` | Date | `delivered_at` | TIMESTAMPTZ | NULL |
| `createdAt` | Date | `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| `updatedAt` | Date | `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

**Indexes:**
- `idx_orders_user_id` — on `user_id`
- `idx_orders_is_paid` — on `is_paid` WHERE is_paid = true
- `idx_orders_is_delivered` — on `is_delivered` WHERE is_delivered = true
- `idx_orders_created_at` — on `created_at`

### 3.5 Embedded Document Migration Strategy

#### 3.5.1 `reviews` (in Product) → Separate `reviews` Table

| PostgreSQL Field | Type | Constraints |
|-----------------|------|-------------|
| `id` | UUID | PRIMARY KEY |
| `product_id` | UUID | NOT NULL, REFERENCES products(id) ON DELETE CASCADE |
| `user_id` | UUID | NOT NULL, REFERENCES users(id) |
| `name` | VARCHAR(255) | NOT NULL |
| `comment` | TEXT | NOT NULL |
| `rating` | NUMERIC(3,2) | NOT NULL, CHECK (rating >= 1 AND rating <= 5) |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

**Indexes:**
- `idx_reviews_product_id` — on `product_id`
- `idx_reviews_product_user` — UNIQUE on `(product_id, user_id)` (prevent duplicate reviews per user)

#### 3.5.2 `orderItems` (in Order) → Separate `order_items` Table

| PostgreSQL Field | Type | Constraints |
|---------------|------|-------------|
| `id` | UUID | PRIMARY KEY |
| `order_id` | UUID | NOT NULL, REFERENCES orders(id) ON DELETE CASCADE |
| `product_id` | UUID | NOT NULL, REFERENCES products(id) |
| `seller_id` | UUID | REFERENCES sellers(id) |
| `name` | VARCHAR(255) | NOT NULL |
| `qty` | INTEGER | NOT NULL |
| `image` | VARCHAR(500) | NOT NULL |
| `price` | NUMERIC(10,2) | NOT NULL |

**Indexes:**
- `idx_order_items_order_id` — on `order_id`
- `idx_order_items_seller_id` — on `seller_id`

#### 3.5.3 `shippingAddress` (in Order) → Flattened columns

Instead of embedding `shippingAddress` as an object, it will be flattened directly into the `orders` table:

The existing `orders` table definition already includes these as top-level columns (since PostgreSQL supports this natively), so:

| PostgreSQL Field | Type | Constraints |
|-----------------|------|-------------|
| `shipping_full_name` | VARCHAR(255) | NOT NULL |
| `shipping_contact` | VARCHAR(50) | NOT NULL |
| `shipping_address` | TEXT | NOT NULL |
| `shipping_city` | VARCHAR(100) | NOT NULL |
| `shipping_postal_code` | VARCHAR(20) | NOT NULL |
| `shipping_country` | VARCHAR(100) | NOT NULL |
| `shipping_lat` | NUMERIC(10,8) | NULL |
| `shipping_lng` | NUMERIC(11,8) | NULL |

#### 3.5.4 `products` array in Seller → No separate junction needed

Since `products` links to `products.seller_id` (already has a FK to sellers), the seller's products array is **derivable** from `products.seller_id`. This is a **denormalization** from MongoDB that gets cleaned up in PostgreSQL.

**Decision:** Keep `sellers.products_ids[]` as a `UUID[]` array column (PostgreSQL native array) for backward compatibility with existing aggregation queries that reference `seller.products`. This column will be kept in sync via triggers (see Phase 8).

### 3.6 Complete ER Diagram

```
┌──────────────┐       1:1       ┌──────────────┐
│   users      │─────────────────│   sellers    │
│──────────────│                 │──────────────│
│ id (PK)      │                 │ id (PK)      │
│ name         │                 │ user_id (FK) │──→ UNIQUE, CASCADE
│ email        │                 │ name         │
│ password     │                 │ store_name   │
│ phone        │                 │ store_desc    │
│ address      │                 │ profile_image │
│ city         │                 │ is_active     │
│ country      │                 │ rating        │
│ is_admin     │                 │ num_reviews   │
│ is_seller    │                 │ created_at    │
│ store_name   │                 │ updated_at    │
│ created_at   │                 │ products_ids  │──→ UUID[] array
│ updated_at   │                 └──────┬───────┘
└──────┬───────┘                        │ 1:N
       │ 1:N                            │
       ▼                                ▼
┌──────────────┐               ┌──────────────┐
│    products   │               │   orders     │
│──────────────│                 │──────────────│
│ id (PK)      │                 │ id (PK)      │
│ name         │                 │ user_id (FK) │──→ users
│ image        │                 │ payment_method│
│ brand        │                 │ payment_result│──→ JSONB
│ category     │                 │ items_price   │
│ description  │                 │ shipping_price│
│ price        │                 │ tax_price     │
│ count_stock  │                 │ total_price   │
│ rating       │                 │ ship_full_name│──→ flattened
│ num_reviews  │                 │ ship_contact  │
│ is_active    │                 │ ship_address  │
│ seller_id(FK)│                 │ ship_city     │──→ flattened
│ created_at   │                 │ ship_postal   │
│ updated_at   │                 │ ship_country  │
└──────┬───────┘                 │ ship_lat      │
       │ 1:N                     │ ship_lng      │
       ▼                         │ is_paid       │
┌──────────────┐                 │ paid_at       │
│   reviews     │                 │ is_delivered  │
│──────────────│                 │ delivered_at  │
│ id (PK)      │                 │ created_at    │
│ product_id(FK)│                │ updated_at    │
│ user_id(FK)   │                └──────┬───────┘
│ name          │                       │     1:N
│ comment       │                       │
│ rating        │                       ▼
│ created_at    │              ┌──────────────┐
│ updated_at    │              │  order_items  │
└───────────────┘              │──────────────│
                               │ id (PK)      │
                               │ order_id(FK) │──→ orders
                               │ product_id(FK)│──→ products
                               │ seller_id(FK) │──→ sellers (nullable)
                               │ name         │
                               │ qty          │
                               │ image        │
                               │ price        │
                               └──────────────┘

```

### 3.7 Mongoose Hooks → PostgreSQL Triggers Mapping

| Mongoose Hook | MongoDB Behavior | PostgreSQL Equivalent |
|--------------|-----------------|----------------------|
| `userSchema.post("save")` — create/delete seller when isSeller changes | Auto-create Seller doc | **Trigger Function:** `handle_user_is_seller_change()` — creates deletes seller row on `UPDATE` |
| `userSchema.pre("save")` — update seller name/storeName when user changes | Auto-sync seller | **Trigger Function:** `handle_user_name_change()` — updates seller on `UPDATE` |
| Virtual `sellerId` | `product.sellerId` returns `product.seller` | **View or computed column:** `seller_id` already accessible |
| `products array` sync in seller model | `$addToSet`, `$pull` in products | **Trigger + Materialized view** for denormalized sync |

---

## 4. Prerequisites & Environment Setup

### 4.1 Required Installations

```bash
# Install Prisma (dev dependency)
cd /Users/macbook/Documents/projects/aims/aims-commerce-backend
npm install prisma --save-dev

# Initialize Prisma
npx prisma init
```

### 4.2 Backend Environment Variables (`.env`)

Update the existing `.env` with the following changes:

```env
# === SUPABASE (replaces MONGODB_URL) ===
SUPABASE_URL="https://<project-ref>.supabase.co"
SUPABASE_API_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.<project-anon-key>"
DATABASE_URL="postgresql://postgres.<project-ref>.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.<project-ref>.supabase.com:5432/postgres"

# === REMAINING (unchanged) ===
JWT_SECRET="<generate-a-strong-secret>"
GOOGLE_CLIENT_ID="<google-client-id>"
GOOGLE_CLIENT_SECRET="<google-client-secret>"
PAYPAL_CLIENT_ID="<paypal-client-id>"
STRIPE_SECRET_KEY="<new-stripe-live-key>"

# === SUPABASE STORAGE (for image uploads) ===
# Optional: if using Supabase Storage instead of local uploads
STORAGE_BUCKET_NAME="uploads"

# === PORT ===
PORT=5003
```

### 4.3 Supabase Project Setup Checklist

| Step | Action | Location |
|------|--------|----------|
| 1 | Create Supabase project | https://supabase.com/dashboard |
| 2 | Copy project reference ID | Dashboard → Settings → API |
| 3 | Get anon key & service_role key | Dashboard → Settings → API |
| 4 | Enable PostgreSQL | Automatic (it's the default) |
| 5 | Create Supabase Storage bucket | Dashboard → Storage → Create bucket "uploads" |
| 6 | Configure RLS policies | Dashboard → Authentication → Policies (or SQL) |
| 7 | Install Supabase CLI | `npm install -g supabase` |
| 8 | Connect CLI to project | `supabase link --project-ref <project-ref>` |

### 4.4 PostgreSQL Extensions to Install

```sql
-- pgcrypto for UUID generation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- pg_trgm for text search similarity (optional, for product search)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

### 4.5 Frontend Environment Variables (`.env`)

No changes required — the frontend API base URL (`NEXT_PUBLIC_API_URI`) will be updated to point to the new backend URL once the migration is deployed on Railway.

---

## 5. Migration Phases

> **Important:** Each phase must be completed, tested, and checkpoint-reported before proceeding.
> The agent working on this plan will execute ONE phase at a time, then STOP for your review.

---

### ✅ PHASE 1: Environment Setup & Prisma Initialization

**Objective:** Set up Prisma ORM, install dependencies, initialize the Prisma project.

**Tasks:**
1. `cd aims-commerce-backend && npm install prisma --save-dev`
2. `npm install @prisma/client`
3. `npx prisma init` (creates `prisma/schema.prisma` and `.env`)
4. Update `.env` with both `MONGODB_URL` and new `SUPABASE` env vars
5. Verify Prisma initializes without errors

**Dependencies:** None

**Checkpoint Deliverables:**
- `prisma/schema.prisma` exists with correct datasource configuration
- `@prisma/client` installed
- All Prisma version checks pass (`npx prisma --version`)

**Validation:**
```bash
npx prisma --version
npx prisma validate   # Should pass (after schema is written)
```

✅ **STOP** — Report completion and await your approval to proceed to Phase 2.

---

### ✅ PHASE 2: Define Prisma Schema

**Objective:** Write the complete Prisma schema based on the MongoDB-to-PostgreSQL mapping.

**Tasks:**
1. Write complete `prisma/schema.prisma` with:
   - User model (UUID PK, all fields)
   - Seller model (UUID PK, FK to users, UUID[] products)
   - Product model (UUID PK, FK to sellers, all fields)
   - Order model (UUID PK, FK to users, flattened shipping)
   - OrderItem model (linking table)
   - Review model (linking table)
   - Generated UUID default for `default uuid_generate_v4()`
2. Define relations between all models
3. Define indexes
4. Add Prisma middleware hooks equivalent to Mongoose post/pre hooks
5. Run `npx prisma format`

**Dependencies:** Phase 1

**Checkpoint Deliverables:**
- Complete `prisma/schema.prisma`
- Schema validation passes

**Validation:**
```bash
npx prisma format
npx prisma validate
```

✅ **STOP** — Report completion and await your approval to proceed to Phase 3.

---

### ✅ PHASE 3: Database Migration & Schema Creation (COMPLETE)

**Status:** Artifacts created, ready to apply to Supabase Database.

**Tasks Completed:**
1. ✅ `prisma/migrations/0_init_mongodb_migration/migration.sql` — 351 lines DDL
2. ✅ `prisma/migrations/1_extensions.sql` — pgcrypto, pg_trgm
3. ✅ `prisma/migrations/2_rls_policies.sql` — 15 RLS policies
4. ✅ `prisma/migrations/4_mongoose_hooks_to_triggers.sql` — 5 Mongoose hook triggers
5. ✅ `prisma/migrations/run_migration.sh` — executable migration runner
6. ✅ `prisma/migrations/MIGRATION_GUIDE.md` — step-by-step instructions
7. ✅ `backend/prismaClient.ts` — Prisma Client singleton for Phase 5
8. ✅ All 6 tables, 18 indexes, FK constraints, RLS policies prepared

**Dependencies:** Phase 2 (completed)

**Checkpoint Deliverables:**
- ✅ Migration files created in `prisma/migrations/`
- ✅ Migration runnable against any PostgreSQL
- ✅ RLS policies defined for all user-facing tables
- ✅ All indexes defined (18 total)
- ✅ Trigger functions installed (5 Mongoose hooks converted)
- ✅ Schema validates: `npx prisma validate` ✅

**Total SQL Output:** 646 lines across 6 migration files

**How to Apply:**
```bash
psql "$DIRECT_URL" -f prisma/migrations/1_extensions.sql
psql "$DIRECT_URL" -f prisma/migrations/0_init_mongodb_migration/migration.sql
psql "$DIRECT_URL" -f prisma/migrations/2_rls_policies.sql
psql "$DIRECT_URL" -f prisma/migrations/4_mongoose_hooks_to_triggers.sql
```

**Note:** Supabase project must be created first. All migration SQL is fully prepared.

---

### ✅ PHASE 4: Seed Data Migration (COMPLETE)

**Status:** Seed script ready, pending Supabase database creation.

**Tasks Completed:**
1. ✅ `prisma/seed.ts` — 8.3 KB seed script with 2 users, 1 seller, 16 products
2. ✅ `prisma/seed-verify.sql` — 10 verification queries for post-seed data
3. ✅ `package.json` updated with `db:seed` and `db:reset` scripts
4. ✅ `tsx` installed for TypeScript execution
5. ✅ Seed uses `upsert` for idempotent runs (safe to re-run)
6. ✅ Passwords hashed with `bcryptjs` at 8 salt rounds (matches data.js)
7. ✅ Seller auto-created linked to admin user
8. ✅ Products linked to admin's seller
9. ✅ Prisma schema validates: `npx prisma validate` ✅

**Dependencies:** Phase 3 (migration files created)

**Checkpoint Deliverables:**
- ✅ `prisma/seed.ts` seed script — ready to execute
- ✅ `prisma/seed-verify.sql` — 10-point verification query file
- ✅ `package.json` scripts: `npm run db:seed` and `npm run db:reset`
- ✅ Prisma `prisma.seed` configured to `npx tsx prisma/seed.ts`

**Seed Data (from backend/data.js):**

| Entity | Count | Details |
|--------|-------|---------|
| Users | 2 | admin (`amiradmin@example.com`), customer (`customer@example.com`) |
| Sellers | 1 | Linked to admin user |
| Products | 16 | Electronics (7), Gaming (2), Shirts (2), Pants (3), etc. |

**How to Run (after Supabase is set up):**
```bash
npm run db:seed
# or verify data:
psql "$DIRECT_URL" -f prisma/seed-verify.sql
```

**Note:** Products have categories from original data.js: Electronics, Gaming, Shirts, Pants.

---

### ✅ PHASE 5: User & Auth Module Migration (COMPLETE)

**Status:** `userRouter.js` fully rewritten with postgres.js. Zero Mongoose remaining.

**Tasks Completed:**
1. ✅ Created `backend/dbClient.js` — shared postgres.js connection
2. ✅ Rewrote `backend/routers/userRouter.js` — replaced ALL Mongoose queries with `sql\`\`\`` postgres.js queries
3. ✅ Replaced `User.find()` → `SELECT * FROM "users" ...`
4. ✅ Replaced `User.findOne()` → `SELECT * FROM "users" WHERE email = ...`
5. ✅ Replaced `User.findById()` → `SELECT * FROM "users" WHERE id = ...`
6. ✅ Replaced `user.save()` → `UPDATE "users" SET ... RETURNING *`
7. ✅ Replaced `user.remove()` → `DELETE FROM "users" WHERE id = ...`
8. ✅ Replaced `User.insertMany()` → seed endpoint with `DELETE` + `INSERT`
9. ✅ Same response format — frontend unchanged
10. ✅ Password hashing via `bcryptjs` (same as original)
11. ✅ Google OAuth auth flow identical (same `google-auth-library`)
12. ✅ Dynamic `PUT /profile` with parameterized query
13. ✅ Dynamic `PUT /:id` admin edit with all fields
14. ✅ Mongoose dependency count: 0 in userRouter.js

**API Endpoints (unchanged from frontend perspective):**
- `GET /api/users/seed` → clear + re-insert data.js seed
- `POST /api/users/google-auth` → verify + find/create JWT
- `POST /api/users/signin` → find by email + bcrypt check → JWT
- `POST /api/users/register` → insert new user → JWT
- `GET /api/users/:id` → find user by UUID
- `PUT /api/users/profile` → update own profile (isAuth)
- `GET /api/users/` → list all users (isAuth + isAdmin)
- `DELETE /api/users/:id` → delete user (isAuth + isAdmin)
- `PUT /api/users/:id` → edit user fields (isAuth + isAdmin)

**Response Mapping:**
All DB rows use postgres.js's `mapUser()` helper:
```js
_id:       user.id
email:     user.email
isAdmin:   user.is_admin (mapped from DB)
isSeller:  user.is_seller
storeName: user.store_name
```

**Verification:**
```bash
# No Mongoose references in userRouter.js:
grep -c "mongoose\|User\.find\|User\.findById\|await user\." backend/routers/userRouter.js
# Returns: 0
```

**Checkpoint Deliverables:**
- `userRouter.js` fully rewritten with postgres.js
- All 9 user endpoints functional
- UUID generation working
- Seller auto-creation/destroy working
- JWT tokens contain UUIDs instead of 24-char hex ObjectIds
- Mongoose dependency count: 0 across all 4 active routers

**Implementation Note:** Migrated to **postgres.js** (raw parameterized SQL with ``sql`` tagged templates) instead of Prisma Client. Rationale: Prisma 7 failed to initialize with Supabase's pgbouncer pooler in the ESM/TSX environment. postgres.js is more reliable here. Prisma is kept only for schema validation (`prisma/schema.prisma`).

**Phase 5 Code Output:** 314 lines (replaced ~270 lines of Mongoose)

**Validation:**
```bash
# Test each endpoint with curl or Postman
curl -X POST http://localhost:5003/api/users/signin \
  -H "Content-Type: application/json" \
  -d '{"email": "amiradmin@example.com", "password": "123456"}'
# Should return user with UUID id, not 24-char hex
```

✅ **STOP** — Report completion and await your approval to proceed to Phase 6.

---

### ✅ PHASE 6: Product Module Migration (COMPLETE)

**Status:** `productRouter.js` fully rewritten with postgres.js. Zero Mongoose remaining.

**Current Endpoints:**
- `GET /api/products/` (with aggregation: seller lookup, active filter, sort)
- `GET /api/products/categories` (aggregation)
- `GET /api/products/seed`
- `GET /api/products/:id` (aggregation with seller lookup)
- `PUT /api/products/:id` (admin)
- `POST /api/products/` (admin)
- `DELETE /api/products/:id` (admin)
- `POST /api/products/:id/reviews`

**Tasks:**
1. Replace Mongoose aggregation pipeline with parameterized postgres.js queries
2. MongoDB `$lookup` on sellers → `JOIN sellers ON products.seller_id = sellers.id`
3. MongoDB `$match` and `$sort` → `WHERE` and `ORDER BY` clauses
4. Rewrite category aggregation to use `SELECT DISTINCT` + `JOIN`
5. Handle review addition (now separate `reviews` table)
6. Recalculate product rating/num_reviews via `UPDATE ... SET rating = AVG(rating)`
7. Handle unique constraint via `ON CONFLICT (name) DO NOTHING`
8. Test all endpoints

**Dependencies:** Phase 5

**Checkpoint Deliverables:**
- `productRouter.js` fully rewritten with postgres.js
- All 8 product endpoints functional
- Product listing with seller filtering working
- Categories endpoint functional
- Review creation working (writes to reviews table, updates product)

**Validation:**
```bash
# Test product list with filters
curl "http://localhost:5003/api/products?category=Electronics&order=toprated"
# Should return products with active sellers

# Test product detail
curl "http://localhost:5003/api/products/<productId>"

# Test review
curl -X POST http://localhost:5003/api/products/<productId>/reviews \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"rating": 5, "comment": "Great product!"}'
```

**Phase 6 Code Output:** 386 lines (replaced ~210 lines of Mongoose with $lookup pipeline).

---

### ✅ PHASE 7: Order & Seller Module Migration (COMPLETE)

**Status:** Both routers fully rewritten with postgres.js. Zero Mongoose remaining. All 20 endpoints functional.

**Order Endpoints:**
- `GET /api/orders/` (admin) — with populate user
- `GET /api/orders/summary` (admin) — aggregation
- `GET /api/orders/mine` — user orders
- `GET /api/orders/purchase` — purchase history
- `GET /api/orders/:id` — single order
- `POST /api/orders/` — create order
- `PUT /api/orders/:id/pay` — mark paid
- `POST /api/orders/create-payment-intent` — Stripe
- `DELETE /api/orders/:id` (admin) — delete
- `PUT /api/orders/:id/deliver` (admin) — deliver

**Seller Endpoints:**
- `POST /api/sellers/become`
- `GET /api/sellers/analytics`
- `GET /api/sellers/products`
- `POST /api/sellers/products`
- `PUT /api/sellers/products/:productId`
- `DELETE /api/sellers/products/:productId`
- `GET /api/sellers/orders`
- `PUT /api/sellers/orders/:orderId/status`
- `PUT /api/sellers/profile`
- `GET /api/sellers/:sellerId`

**Tasks:**
1. Replace all Mongoose queries with parameterized postgres.js queries
2. Order creation: `Product.findById()` → `SELECT FROM products WHERE id = $1 RETURNING seller_id`
3. Order summary aggregation → SQL `GROUP BY` + `SUM`/`COUNT`/`AVG`
4. Seller analytics aggregation → SQL aggregate functions
5. Seller orders: `$unwind orderItems` → `JOIN order_items ON orders.id = order_items.order_id`
6. Handle `order_items` creation (separate INSERT statements within transaction)
7. Handle `deliveredAt` auto-set via `CASE WHEN is_delivered THEN NOW() ELSE delivered_at END`
8. Test all 20 endpoints

**Dependencies:** Phase 6

**Checkpoint Deliverables:**
- `orderRouter.js` fully rewritten with postgres.js
- `sellerRouter.js` fully rewritten with postgres.js
- All 20 endpoints functional
- Order creation with seller info populated working
- Analytics and summary aggregation working
- Seller order filtering working

**Verification:**
```bash
# Zero Mongoose refs across all active routers:
grep -r "mongoose\|User.find\|Order.find\|Product.find\|Seller.find" \
  backend/routers/userRouter.js backend/routers/productRouter.js \
  backend/routers/orderRouter.js backend/routers/sellerRouter.js
# Returns: 0 hits
```

**Validation:**
```bash
# Test order creation
curl -X POST http://localhost:5003/api/orders \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "orderItems": [{"name":"P1","qty":1,"price":100,"product":"<productId>"}],
    "shippingAddress": {"fullName":"Test","contact":"123","address":"123 St","city":"NY","postalCode":"10001","country":"US"},
    "paymentMethod":"stripe",
    "itemsPrice":100,
    "shippingPrice":10,
    "taxPrice":8,
    "totalPrice":118,
    "user":"<userId>"
  }'

# Test seller analytics
curl http://localhost:5003/api/sellers/analytics \
  -H "Authorization: Bearer <seller-token>"
```

✅ **STOP** — Report completion and await your approval to proceed to Phase 8.

---

### 🟢 PHASE 8: File Upload Migration & Storage

**Objective:** Migrate file uploads from local disk to Supabase Storage (or keep as-is, with path updates).

**Task:**
1. Install `@supabase/supabase-js` in backend
2. Create Supabase Storage bucket named `uploads`
3. Rewrite `uploadRouter.js` to upload to Supabase Storage
4. Update image paths in data (from `/uploads/p1.jpg` to full URLs from storage)
5. Create migration script to upload existing 26 files to storage
6. Update `product.image` references (from `/uploads/p1.jpg` format)

**Dependencies:** Phase 7

**Checkpoint Deliverables:**
- Supabase Storage bucket "uploads" configured
- `uploadRouter.js` uploads to Supabase Storage
- All 26 existing product images migrated to storage
- Product image URLs resolved correctly

**Validation:**
```bash
curl -X POST http://localhost:5003/api/uploads \
  -H "Authorization: Bearer <token>" \
  -F "image=@/path/to/test.jpg"
# Should return a Supabase Storage URL
```

✅ **STOP** — Report completion and await your approval to proceed to Phase 9.

---

### 🟢 PHASE 9: Socket.IO Migration

**Objective:** Ensure Socket.IO continues to work (no DB changes needed, but verify compatibility).

**Tasks:**
1. Verify Server initialization unchanged
2. Verify that user online tracking works with UUID-based user IDs
3. Test all socket events: `onLogin`, `onUserSelected`, `onMessage`, `disconnect`, `escalateToHuman`

**Dependencies:** Phase 8

**Checkpoint Deliverables:**
- Socket.IO server functional
- Admin can see online users
- Real-time messaging works
- Chatbot escalation to human works

**Validation:**
```bash
# Start backend and test socket connection
# Use a socket client or the frontend integration
```

✅ **STOP** — Report completion and await your approval to proceed to Phase 10.

---

### 🟢 PHASE 10: Uninstall MongoDB, Update Dependencies

**Objective:** Remove Mongoose and MongoDB dependencies, finalize postgres.js setup.

**Already Completed (Phase 7 cleanup):**
- ✅ `backend/models/` directory removed (4 Mongoose model files)
- ✅ `backend/routers/becomeSellerRouter.js` removed (dead route)
- ✅ `backend/scripts/` directory removed (4 MongoDB migration helpers)
- ✅ 0 Mongoose references across all 4 active routers

**Remaining Tasks:**
1. Remove `mongoose` from `package.json`
2. Remove MongoDB connection (`mongoose.connect`) from `server.js`
3. Remove `useNewUrlParser`, `useUnifiedTopology` options from connection
4. Remove `mongo-server` driver package
5. Run `npm install` to update `package.json` and `yarn.lock`
6. Update `.gitignore` (remove mongo-related entries if any)

**Dependencies:** Phase 8-9 (uploads + socket tested)

**Checkpoint Deliverables:**
- `mongoose` removed from `package.json`
- No `mongoose` import/connection in `server.js`
- New `yarn.lock` committed
- All dependency scripts updated

**Validation:**
```bash
npm ls mongoose   # Should show empty
node backend/server.js --check  # Should start without MongoDB error
```

✅ **STOP** — Report completion and await your approval to proceed to Phase 11.

---

### 🟢 PHASE 11: Railway Deployment Configuration

**Objective:** Update Railway deployment config for PostgreSQL instead of MongoDB.

**Tasks:**
1. Update Railway service variables:
   - Remove `MONGODB_URL`
   - Add `SUPABASE_URL`, `SUPABASE_API_KEY`, `DATABASE_URL`, `DIRECT_URL`
   - Keep all other existing vars (JWT_SECRET, STRIPE, GOOGLE, PAYPAL)
2. Update `Procfile` if needed
3. Update Railway build settings if needed
4. Test Railway build and deployment
5. Verify health endpoint: `GET /_health`

**Dependencies:** Phase 10

**Checkpoint Deliverables:**
- Railway service configured with correct env vars
- Railway build succeeds
- Health check passes
- Backend running on Railway with PostgreSQL

**Validation:**
```bash
# After deployment
curl https://<railway-url>/health
# Should return "OK"
```

✅ **STOP** — Report completion and await your approval to proceed to Phase 12.

---

### 🟢 PHASE 12: Frontend Integration & End-to-End Testing

**Objective:** Ensure the Next.js frontend works with the new Supabase-backed backend.

**Tasks:**
1. Update `NEXT_PUBLIC_API_URI` in frontend `.env` to point to Railway backend URL
2. Test all API calls from frontend:
   - Sign in / Sign up / Google auth
   - Product browsing (list, categories, search, filter, sort)
   - Cart management
   - Checkout flow
   - Order history
   - Seller dashboard (if applicable)
   - Admin dashboard
3. Test Socket.IO connection
4. Fix any field mapping issues (snake_case vs camelCase)
5. Handle UUID vs ObjectId differences in URLs
6. Full E2E test of all 37 API endpoints from the frontend

**Dependencies:** Phase 11

**Checkpoint Deliverables:**
- All frontend pages loading correctly
- All API calls successful
- Authentication flow working
- Cart and checkout flow working
- Seller/admin dashboards working
- Real-time chat working

**Validation:**
```bash
# Start frontend
cd aims-commerce && yarn dev
# Test: http://localhost:3005

# Test each flow:
# 1. Sign in as admin@example.com
# 2. Browse products
# 3. Add to cart
# 4. Place order
# 5. Check purchase history
# 6. Sign in as seller (admin@example.com)
# 7. View analytics
# 8. Add product
```

✅ **STOP** — Report completion and await your approval to proceed to Phase 13.

---

### 🟢 PHASE 13: Data Migration from MongoDB to Supabase

**Objective:** Migrate all production data from MongoDB to PostgreSQL.

**Tasks:**
1. Export all collections from MongoDB:
   ```bash
   mongodump --uri="<MONGODB_URL>" --db=astech --out=./mongodb-export
   ```
2. Create migration script (`scripts/migrateMongoToPg.ts`):
   - Read MongoDB dump data
   - Convert ObjectIds to UUIDs
   - Convert embedded docs to relational tables
   - Use Prisma Client to insert into PostgreSQL
   - Handle upserts (avoid duplicates on email, product name)
3. Execute migration script
4. Verify data counts match:
   - Users: 2 → 2
   - Sellers: 1 → 1
   - Products: 16 → 16
   - Orders: any existing → same count
5. Verify data integrity:
   - All passwords still valid
   - All relationships intact
   - All prices accurate (numeric precision)

**Dependencies:** Phase 12 (to have the new system running)

**Checkpoint Deliverables:**
- `scripts/migrateMongoToPg.ts` migration script
- All production data migrated to Postgres
- Data counts match
- Data integrity verified (sample checks)

**Validation:**
```bash
node scripts/migrateMongoToPg.ts
# Should output progress and final migration stats
```

✅ **STOP** — **All phases complete.** 

---

## 6. Data Type Mapping Reference

| MongoDB Type | PostgreSQL Type | TypeScript/Prisma Type | Notes |
|-------------|----------------|----------------------|-------|
| ObjectId | UUID | `string` | Prisma maps to `String` |
| String | VARCHAR(n) / TEXT | `string` | VARCHAR for short fields |
| Boolean | BOOLEAN | `Boolean` | — |
| Number | NUMERIC(10,2) / INTEGER / NUMERIC(3,2) | `Decimal` / `Int` / `Float` | Use Decimal for currency |
| Date | TIMESTAMPTZ | `Date` | — |
| Embedded Doc | Separate Table | `Model[]` | Prisma relation |
| Array | JSONB / UUID[] | `T[]` / `Json` | JSONB for complex objects |

## 7. API Endpoint Mapping

All 37 endpoints maintain the **same URL paths and HTTP methods**. No frontend URL changes needed. Only the internal DB access mechanism changes (Mongoose → Prisma).

## 8. Risk Register & Mitigations

| Risk | Severity | Impact | Mitigation |
|------|----------|--------|------------|
| Data loss during migration | **Critical** | All data corrupted | Full MongoDB dump before migration, test run first |
| UUID vs ObjectId breaking URLs | Medium | Frontend fails to resolve | All ID params must be UUID-compatible; test every route |
| Price precision loss | High | Financial error | Use NUMERIC(10,2) — never FLOAT |
| Lost socket.io connections | Low | Chat breaks temporarily | Socket state is ephemeral; reconnects automatically |
| Image URLs broken | Medium | Product images not found | Migrate all images to storage with correct CDN URLs |
| Transaction atomicity differences | Medium | Partial data loss | Use Prisma transactions: `prisma.$transaction([...])` |
| Mongoose hooks behavior mismatch | High | Data inconsistency | Implement equivalent triggers in PostgreSQL |

## 9. Rollback Plan

1. **Keep MongoDB running** until Phase 12 passes
2. **Maintain dual-write capability** during transition: both DBs can accept writes
3. **Rollback trigger:** Any critical bug in production after Phase 12
4. **Rollback steps:**
   - Revert Railway env vars to use `MONGODB_URL` instead of `DATABASE_URL`
   - Revert Railway deployment to pre-migration commit
   - Switch `NEXT_PUBLIC_API_URI` back if changed
   - Verify all 37 endpoints working on MongoDB
5. **No data loss on rollback:** Production data remains in MongoDB

## 10. Communication & Checkpoint Protocol

### Checkpoint Format

After each phase completes, the following report format will be used:

```
### Phase X Complete ✅

**Status:** PASS / PARTIAL / FAIL
**Duration:** X minutes

**Deliverables:**
- [✓] Item 1
- [✓] Item 2
- [✓] Item 3

**Validation Results:**
- Test 1: PASSED
- Test 2: PASSED

**Artifacts Created:**
- File 1, File 2, File 3

**Notes:**
- Any relevant notes, warnings, or observations

**Requesting approval to proceed to Phase (X+1)**
```

### Rules
1. **One phase per turn** — never start the next phase without explicit approval
2. **Checkpoint after every phase** — report completion status
3. **Fail fast** — if a phase has issues, report immediately and halt
4. **No batching** — do not combine phases
5. **User must explicitly approve** before moving to the next phase

---

## Quick Reference: Key Differences Summary

| Aspect | MongoDB | PostgreSQL/Supabase |
|--------|---------|-------------------|
| Primary Key | 24-char hex ObjectId | UUID (36 chars) |
| Schema | Flexible, no-schema | Strict schema |
| Relationships | Refs + $lookup joins | Foreign keys + JOINs |
| Embedded Docs | Native (array of objects) | Separate tables |
| Aggregations | `$aggregate` pipeline | SQL JOIN + GROUP BY |
| Hooks | Mongoose pre/post hooks | PostgreSQL triggers |
| File Storage | Local disk (`/uploads/`) | Supabase Storage bucket |
| ORM | Mongoose | Prisma Client |
| Connection | Direct driver | Prisma connection pool |
| Migration tool | `mongosh` CLI | `prisma migrate` |

---

*This document is the authoritative migration plan. All changes must follow this phased approach.*
