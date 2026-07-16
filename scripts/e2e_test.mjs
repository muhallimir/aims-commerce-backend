/**
 * E2E test suite — full-stack role-based access.
 *
 * Covers 37 backend API endpoints across 3 roles (admin, seller, customer).
 * Tests use real HTTP calls against http://127.0.0.1:5003.
 *
 * Test data hygiene:
 *  - All test-created users/products/orders are prefixed `__TEST__`
 *  - After the run, the cleanup step deletes every row matching the prefix
 *  - The original MongoDB-dumped data is left intact
 *
 * Usage:
 *   # 1. Start the backend: node backend/server.js
 *   # 2. Run the tests:    node scripts/e2e_test.mjs
 *   # 3. Results:          scripts/e2e_test_results.json
 */

import fs from "fs/promises";
import postgres from "postgres";
import "dotenv/config";
import bcrypt from "bcryptjs";

const API = process.env.API_URL || "http://127.0.0.1:5003";
const TEST_PREFIX = "__TEST__";
const TEST_PASSWORD = "testpass123";

const PWD_HASH = bcrypt.hashSync(TEST_PASSWORD, 8);
const sql = postgres(process.env.DIRECT_URL, { max: 1, onnotice: () => {} });

// ── Results tracking ───────────────────────────────────────────
const results = { byRole: { admin: [], seller: [], customer: [], public: [] }, summary: { total: 0, passed: 0, failed: 0 } };
function record(role, name, ok, detail) {
  results.byRole[role].push({ name, ok, detail });
  results.summary.total++;
  if (ok) results.summary.passed++; else results.summary.failed++;
  const mark = ok ? "✅" : "❌";
  console.log(`  ${mark} [${role}] ${name}${detail ? " — " + detail : ""}`);
}

// acceptCreateStatus: a POST that creates a resource is conventionally 201, but some routers
// return 200. Accept both.
function isCreateOk(status) { return status === 200 || status === 201; }

async function http(method, path, { token, body, isJson = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const init = { method, headers };
  if (body !== undefined) init.body = isJson ? JSON.stringify(body) : body;
  const r = await fetch(`${API}${path}`, init);
  // Read body once; fall back to text if not JSON
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}

// ── Test data setup ───────────────────────────────────────────
async function setupTestUsers() {
  console.log("═══ Setup: creating __TEST__ users ═══");

  // Admin test user
  const adminEmail = `${TEST_PREFIX}admin@aims.test`;
  const sellerEmail = `${TEST_PREFIX}seller@aims.test`;
  const customerEmail = `${TEST_PREFIX}customer@aims.test`;

  // Wipe any previous run
  await sql`DELETE FROM users WHERE email LIKE ${TEST_PREFIX + '%'}`;
  await sql`DELETE FROM sellers WHERE name LIKE ${TEST_PREFIX + '%'}`;

  // Create admin (also owns a seller profile, so they can create products)
  const adminId = (await sql`
    INSERT INTO users (id, name, email, password, is_admin, is_seller)
    VALUES (gen_random_uuid(), ${TEST_PREFIX + 'Admin'}, ${adminEmail}, ${PWD_HASH}, true, true)
    RETURNING id
  `)[0].id;

  const adminSellerId = (await sql`
    INSERT INTO sellers (id, user_id, name, store_name, is_active_store, rating, num_reviews, products_ids)
    VALUES (gen_random_uuid(), ${adminId}, ${TEST_PREFIX + 'AdminStore'}, ${TEST_PREFIX + "AdminStore"}, true, 0, 0, ARRAY[]::text[])
    RETURNING id
  `)[0].id;

  await sql`UPDATE users SET seller_id = ${adminSellerId} WHERE id = ${adminId}`;

  // Create seller (also becomes owner of a seller record)
  const sellerUserId = (await sql`
    INSERT INTO users (id, name, email, password, is_admin, is_seller)
    VALUES (gen_random_uuid(), ${TEST_PREFIX + 'Seller'}, ${sellerEmail}, ${PWD_HASH}, false, true)
    RETURNING id
  `)[0].id;

  const sellerId = (await sql`
    INSERT INTO sellers (id, user_id, name, store_name, is_active_store, rating, num_reviews, products_ids)
    VALUES (gen_random_uuid(), ${sellerUserId}, ${TEST_PREFIX + 'Seller'}, ${TEST_PREFIX + "Store"}, true, 0, 0, ARRAY[]::text[])
    RETURNING id
  `)[0].id;

  await sql`UPDATE users SET seller_id = ${sellerId} WHERE id = ${sellerUserId}`;

  // Create customer
  const customerRow = (await sql`
    INSERT INTO users (id, name, email, password, is_admin, is_seller)
    VALUES (gen_random_uuid(), ${TEST_PREFIX + 'Customer'}, ${customerEmail}, ${PWD_HASH}, false, false)
    RETURNING id
  `)[0];

  console.log(`  Created: ${adminEmail}, ${sellerEmail}, ${customerEmail}`);
  return { adminEmail, sellerEmail, customerEmail };
}

async function signin(email) {
  const r = await http("POST", "/api/users/signin", { body: { email, password: TEST_PASSWORD } });
  if (r.status !== 200) throw new Error(`signin failed for ${email}: ${r.status} ${JSON.stringify(r.data)}`);
  return { token: r.data.token, user: r.data };
}

// ── Test suites ───────────────────────────────────────────────
async function testPublicEndpoints() {
  console.log("\n═══ Public endpoints (no auth) ═══");
  const r = await http("GET", "/api/products/");
  record("public", "GET /api/products", r.status === 200 && Array.isArray(r.data), `status=${r.status} count=${r.data?.length}`);

  const r2 = await http("GET", "/api/products/categories");
  record("public", "GET /api/products/categories", r2.status === 200 && Array.isArray(r2.data), `status=${r2.status} count=${r2.data?.length}`);

  const r3 = await http("GET", "/_health");
  record("public", "GET /_health", r3.status === 200 && r3.data === "OK", `status=${r3.status}`);

  const r4 = await http("GET", "/api/config/paypal");
  record("public", "GET /api/config/paypal", r4.status === 200, `status=${r4.status}`);
}

async function testAuthFlow(emails) {
  console.log("\n═══ Auth flow ═══");
  const r1 = await http("POST", "/api/users/signin", { body: { email: emails.adminEmail, password: TEST_PASSWORD } });
  record("admin", "POST /api/users/signin (admin)", r1.status === 200 && !!r1.data?.token, `status=${r1.status}`);

  const r2 = await http("POST", "/api/users/signin", { body: { email: emails.sellerEmail, password: TEST_PASSWORD } });
  record("seller", "POST /api/users/signin (seller)", r2.status === 200 && !!r2.data?.token, `status=${r2.status}`);

  const r3 = await http("POST", "/api/users/signin", { body: { email: emails.customerEmail, password: TEST_PASSWORD } });
  record("customer", "POST /api/users/signin (customer)", r3.status === 200 && !!r3.data?.token, `status=${r3.status}`);

  const r4 = await http("POST", "/api/users/signin", { body: { email: "nobody@x.com", password: "wrong" } });
  record("public", "POST /api/users/signin (bad creds) → 401", r4.status === 401, `status=${r4.status}`);

  const r5 = await http("POST", "/api/users/register", {
    body: { name: TEST_PREFIX + "Reg", email: TEST_PREFIX + "reg@aims.test", password: TEST_PASSWORD }
  });
  record("public", "POST /api/users/register", r5.status === 200 && !!r5.data?.token, `status=${r5.status}`);
}

async function testUserEndpoints(tokens, emails) {
  console.log("\n═══ User endpoints ═══");
  // GET /api/users/:id (public)
  const anyUser = (await sql`SELECT id FROM users WHERE email = ${emails.adminEmail}`)[0];
  const r1 = await http("GET", `/api/users/${anyUser.id}`);
  record("public", "GET /api/users/:id", r1.status === 200 && r1.data?.email === emails.adminEmail, `status=${r1.status}`);

  // GET /api/users (admin only)
  const r2 = await http("GET", "/api/users", { token: tokens.admin });
  record("admin", "GET /api/users (list all)", r2.status === 200 && Array.isArray(r2.data), `status=${r2.status} count=${r2.data?.length}`);

  const r3 = await http("GET", "/api/users", { token: tokens.customer });
  record("customer", "GET /api/users (denied)", r3.status === 401, `status=${r3.status}`);

  // PUT /api/users/profile
  const r4 = await http("PUT", "/api/users/profile", { token: tokens.customer, body: { name: TEST_PREFIX + "CustomerRenamed" } });
  record("customer", "PUT /api/users/profile", r4.status === 200, `status=${r4.status} body=${JSON.stringify(r4.data).slice(0, 100)}`);

  // PUT /api/users/:id (admin)
  const r5 = await http("PUT", `/api/users/${anyUser.id}`, { token: tokens.admin, body: { name: TEST_PREFIX + "AdminRenamed" } });
  record("admin", `PUT /api/users/:id (admin)`, r5.status === 200, `status=${r5.status} body=${JSON.stringify(r5.data).slice(0, 100)}`);

  // PUT /api/users/:id (customer, denied)
  const r6 = await http("PUT", `/api/users/${anyUser.id}`, { token: tokens.customer, body: { name: "hacked" } });
  record("customer", "PUT /api/users/:id (denied)", r6.status === 401, `status=${r6.status}`);

  // DELETE /api/users/:id (admin) — won't actually delete, will create a new throwaway user to delete
  const tmpUser = (await sql`
    INSERT INTO users (id, name, email, password) VALUES (gen_random_uuid(), ${TEST_PREFIX + 'Tmp'}, ${TEST_PREFIX + 'tmp@aims.test'}, ${PWD_HASH}) RETURNING id
  `)[0];
  const r7 = await http("DELETE", `/api/users/${tmpUser.id}`, { token: tokens.admin });
  record("admin", "DELETE /api/users/:id (admin)", r7.status === 200, `status=${r7.status}`);

  const r8 = await http("DELETE", `/api/users/${anyUser.id}`, { token: tokens.customer });
  record("customer", "DELETE /api/users/:id (denied)", r8.status === 401, `status=${r8.status}`);
}

async function testProductEndpoints(tokens) {
  console.log("\n═══ Product endpoints ═══");
  // GET /api/products (public)
  const r1 = await http("GET", "/api/products/");
  record("public", "GET /api/products (with query)", r1.status === 200, `status=${r1.status}`);

  // Filter by category
  const r1b = await http("GET", "/api/products/?category=Electronics");
  record("public", "GET /api/products?category=Electronics", r1b.status === 200 && r1b.data.every(p => p.category === "Electronics"), `count=${r1b.data?.length}`);

  // GET /api/products/:id
  const anyProduct = (await sql`SELECT id FROM products LIMIT 1`)[0];
  const r2 = await http("GET", `/api/products/${anyProduct.id}`);
  record("public", "GET /api/products/:id", r2.status === 200 && r2.data?.name, `name=${r2.data?.name}`);

  // POST /api/products (admin)
  const newProduct = {
    name: TEST_PREFIX + "Product " + Date.now(),
    image: "/uploads/test.jpg",
    price: 99.99,
    category: TEST_PREFIX + "Category",
    brand: "TestBrand",
    countInStock: 10,
    description: TEST_PREFIX + " test product description",
  };
  const r3 = await http("POST", "/api/products/", { token: tokens.admin, body: newProduct });
  const createdProductId = r3.data?.product?._id;
  record("admin", "POST /api/products (create)", isCreateOk(r3.status) && !!createdProductId, `status=${r3.status} id=${createdProductId} body=${JSON.stringify(r3.data).slice(0, 100)}`);

  const r3b = await http("POST", "/api/products/", { token: tokens.customer, body: newProduct });
  record("customer", "POST /api/products (denied)", r3b.status === 401, `status=${r3b.status}`);

  // PUT /api/products/:id (admin)
  if (createdProductId) {
    const r4 = await http("PUT", `/api/products/${createdProductId}`, { token: tokens.admin, body: { price: 149.99 } });
    record("admin", "PUT /api/products/:id (update)", r4.status === 200 && r4.data?.product?.price === 149.99, `status=${r4.status}`);
  }

  // POST /api/products/:id/reviews (any auth user)
  if (createdProductId) {
    const r5 = await http("POST", `/api/products/${createdProductId}/reviews`, { token: tokens.customer, body: { rating: 5, comment: TEST_PREFIX + " review" } });
    record("customer", "POST /api/products/:id/reviews", r5.status === 201 || r5.status === 200, `status=${r5.status} body=${JSON.stringify(r5.data).slice(0, 200)}`);
  }

  // DELETE /api/products/:id (admin) — at the end
  if (createdProductId) {
    const r6 = await http("DELETE", `/api/products/${createdProductId}`, { token: tokens.admin });
    record("admin", "DELETE /api/products/:id", r6.status === 200, `status=${r6.status}`);
  }

  return { createdProductId };
}

async function testSellerEndpoints(tokens) {
  console.log("\n═══ Seller endpoints ═══");
  // POST /api/sellers/become (customer)
  // Use a unique email so we can re-test safely
  const becomeEmail = `${TEST_PREFIX}seller2@aims.test`;
  await sql`DELETE FROM users WHERE email = ${becomeEmail}`;
  const cust = (await sql`SELECT id FROM users WHERE email = ${TEST_PREFIX + 'customer@aims.test'}`)[0];

  // The become endpoint requires the JWT user; we already have a customer token
  const r1 = await http("POST", "/api/sellers/become", { token: tokens.customer, body: { name: TEST_PREFIX + "NewSeller", storeName: TEST_PREFIX + "NewStore" } });
  // The customer user is already is_seller=false in the new setup; this should succeed
  record("customer", "POST /api/sellers/become", r1.status === 200 || r1.status === 201, `status=${r1.status}`);

  // GET /api/sellers/products (seller)
  const r2 = await http("GET", "/api/sellers/products", { token: tokens.seller });
  record("seller", "GET /api/sellers/products", r2.status === 200 && Array.isArray(r2.data), `status=${r2.status} count=${r2.data?.length}`);

  const r2b = await http("GET", "/api/sellers/products", { token: tokens.customer });
  record("customer", "GET /api/sellers/products (denied)", r2b.status === 403 || r2b.status === 401, `status=${r2b.status}`);

  // POST /api/sellers/products (seller)
  const newProd = {
    name: TEST_PREFIX + "SellerProd " + Date.now(),
    image: "/uploads/seller-test.jpg",
    price: 49.99, category: TEST_PREFIX + "Cat", brand: "SellerBrand",
    countInStock: 5, description: TEST_PREFIX + " seller product",
  };
  const r3 = await http("POST", "/api/sellers/products", { token: tokens.seller, body: newProd });
  const sellerProdId = r3.data?._id || r3.data?.product?._id || r3.data?.product?.id;
  record("seller", "POST /api/sellers/products", isCreateOk(r3.status) && !!sellerProdId, `status=${r3.status} id=${sellerProdId} body=${JSON.stringify(r3.data).slice(0, 100)}`);

  // GET /api/sellers/analytics (seller)
  const r4 = await http("GET", "/api/sellers/analytics", { token: tokens.seller });
  record("seller", "GET /api/sellers/analytics", r4.status === 200, `status=${r4.status}`);

  // GET /api/sellers/orders (seller)
  const r5 = await http("GET", "/api/sellers/orders", { token: tokens.seller });
  record("seller", "GET /api/sellers/orders", r5.status === 200, `status=${r5.status}`);

  // PUT /api/sellers/products/:id (seller)
  if (sellerProdId) {
    const r6 = await http("PUT", `/api/sellers/products/${sellerProdId}`, { token: tokens.seller, body: { price: 79.99 } });
    record("seller", "PUT /api/sellers/products/:id", r6.status === 200, `status=${r6.status}`);
  }

  // PUT /api/sellers/profile (seller) — requires name + storeName
  const r7 = await http("PUT", "/api/sellers/profile", { token: tokens.seller, body: { name: TEST_PREFIX + "Seller", storeName: TEST_PREFIX + "StoreRenamed" } });
  record("seller", "PUT /api/sellers/profile", r7.status === 200, `status=${r7.status} body=${JSON.stringify(r7.data).slice(0, 100)}`);

  return { sellerProdId };
}

async function testOrderEndpoints(tokens) {
  console.log("\n═══ Order endpoints ═══");
  // GET /api/orders/mine (customer)
  const r1 = await http("GET", "/api/orders/mine", { token: tokens.customer });
  record("customer", "GET /api/orders/mine", r1.status === 200 && Array.isArray(r1.data), `status=${r1.status} count=${r1.data?.length}`);

  // POST /api/orders (customer) — create an order with the seller product
  const anyProduct = (await sql`SELECT id, name, price, image, seller_id FROM products WHERE name NOT LIKE ${TEST_PREFIX + '%'} AND is_active = true LIMIT 1`)[0];
  const orderBody = {
    orderItems: [{
      name: anyProduct.name, qty: 1, image: anyProduct.image,
      price: anyProduct.price, product: anyProduct.id, seller: anyProduct.seller_id,
    }],
    shippingAddress: {
      fullName: TEST_PREFIX + "Ship", contact: "5551234",
      address: "1 Test St", city: "Testville", postalCode: "00000", country: "Testland",
    },
    paymentMethod: "PayPal",
    itemsPrice: anyProduct.price,
    shippingPrice: 10, taxPrice: 5, totalPrice: anyProduct.price + 10 + 5,
  };
  const r2 = await http("POST", "/api/orders/", { token: tokens.customer, body: orderBody });
  const orderId = r2.data?._id || r2.data?.order?._id;
  record("customer", "POST /api/orders (create)", isCreateOk(r2.status) && !!orderId, `status=${r2.status} id=${orderId} body=${JSON.stringify(r2.data).slice(0, 100)}`);

  // GET /api/orders/:id (customer)
  if (orderId) {
    const r3 = await http("GET", `/api/orders/${orderId}`, { token: tokens.customer });
    record("customer", "GET /api/orders/:id (own)", r3.status === 200, `status=${r3.status}`);
  }

  // GET /api/orders/ (admin)
  const r4 = await http("GET", "/api/orders/", { token: tokens.admin });
  record("admin", "GET /api/orders (all)", r4.status === 200 && Array.isArray(r4.data), `status=${r4.status} count=${r4.data?.length}`);

  // GET /api/orders/summary (admin)
  const r5 = await http("GET", "/api/orders/summary", { token: tokens.admin });
  record("admin", "GET /api/orders/summary", r5.status === 200, `status=${r5.status}`);

  const r5b = await http("GET", "/api/orders/summary", { token: tokens.customer });
  record("customer", "GET /api/orders/summary (denied)", r5b.status === 401 || r5b.status === 403, `status=${r5b.status}`);

  // PUT /api/orders/:id/pay (customer)
  if (orderId) {
    const r6 = await http("PUT", `/api/orders/${orderId}/pay`, { token: tokens.customer, body: { id: "test-tx", status: "COMPLETED", update_time: new Date().toISOString() } });
    record("customer", "PUT /api/orders/:id/pay", r6.status === 200, `status=${r6.status}`);
  }

  // PUT /api/orders/:id/deliver (admin)
  if (orderId) {
    const r7 = await http("PUT", `/api/orders/${orderId}/deliver`, { token: tokens.admin });
    record("admin", "PUT /api/orders/:id/deliver", r7.status === 200, `status=${r7.status}`);
  }

  // DELETE /api/orders/:id (admin)
  if (orderId) {
    const r8 = await http("DELETE", `/api/orders/${orderId}`, { token: tokens.admin });
    record("admin", "DELETE /api/orders/:id", r8.status === 200, `status=${r8.status}`);
  }

  return { orderId };
}

async function testUploadEndpoint(tokens) {
  console.log("\n═══ Upload endpoint ═══");
  // Skip: requires real multer multipart. We just confirm auth is required.
  const r1 = await http("POST", "/api/uploads/", { token: tokens.customer, body: {} });
  // Without a file, it returns 400 ("No image file provided") — which still proves auth passed
  record("customer", "POST /api/uploads (auth passes, no file → 400)", r1.status === 400, `status=${r1.status} msg=${r1.data?.message}`);
}

async function cleanup() {
  console.log("\n═══ Cleanup: removing all __TEST__ data ═══");
  // Order: delete child rows first, then parents
  const r1 = await sql`DELETE FROM order_items WHERE name LIKE ${TEST_PREFIX + '%'}`;
  console.log(`  order_items: ${r1.count}`);
  const r2 = await sql`DELETE FROM orders WHERE shipping_full_name LIKE ${TEST_PREFIX + '%'}`;
  console.log(`  orders: ${r2.count}`);
  const r3 = await sql`DELETE FROM products WHERE name LIKE ${TEST_PREFIX + '%'}`;
  console.log(`  products: ${r3.count}`);
  const r4 = await sql`DELETE FROM sellers WHERE name LIKE ${TEST_PREFIX + '%'}`;
  console.log(`  sellers: ${r4.count}`);
  const r5 = await sql`DELETE FROM users WHERE email LIKE ${TEST_PREFIX + '%'} OR name LIKE ${TEST_PREFIX + '%'}`;
  console.log(`  users: ${r5.count}`);
  // Test reviews
  const r6 = await sql`DELETE FROM reviews WHERE comment LIKE ${TEST_PREFIX + '%'}`;
  console.log(`  reviews: ${r6.count}`);
}

async function main() {
  console.log(`AIMS Commerce — E2E test suite`);
  console.log(`Target: ${API}`);
  console.log(`Prefix: ${TEST_PREFIX}`);
  console.log(`Started: ${new Date().toISOString()}\n`);

  try {
    await testPublicEndpoints();

    const emails = await setupTestUsers();

    await testAuthFlow(emails);

    const tokens = {
      admin: (await signin(emails.adminEmail)).token,
      seller: (await signin(emails.sellerEmail)).token,
      customer: (await signin(emails.customerEmail)).token,
    };

    await testUserEndpoints(tokens, emails);
    await testProductEndpoints(tokens);
    await testSellerEndpoints(tokens);
    await testOrderEndpoints(tokens);
    await testUploadEndpoint(tokens);
  } catch (e) {
    console.error("Test crashed:", e);
  } finally {
    await cleanup();
    await sql.end();
  }

  // Summary
  console.log("\n════════════════════════════════════════════");
  console.log(`  E2E Test Summary`);
  console.log(`  Total:  ${results.summary.total}`);
  console.log(`  Passed: ${results.summary.passed}`);
  console.log(`  Failed: ${results.summary.failed}`);
  console.log("════════════════════════════════════════════");
  for (const role of Object.keys(results.byRole)) {
    const list = results.byRole[role];
    const pass = list.filter(r => r.ok).length;
    const fail = list.length - pass;
    console.log(`  ${role}: ${pass} pass, ${fail} fail (of ${list.length})`);
  }
  console.log();

  await fs.writeFile("./scripts/e2e_test_results.json", JSON.stringify(results, null, 2));
  process.exit(results.summary.failed === 0 ? 0 : 1);
}

main();
