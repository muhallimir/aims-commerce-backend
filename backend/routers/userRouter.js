import express from "express";
import expressAsyncHandler from "express-async-handler";
import bcrypt from "bcryptjs";
import data from "../data.js";
import { generateToken, isAdmin, isAuth } from "../utils.js";
import { OAuth2Client } from "google-auth-library";
import sql from "../dbClient.js";

const userRouter = express.Router();
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const mapUser = (user) => ({  // map DB row to response shape
  _id:        user.id,
  name:       user.name,
  email:      user.email,
  phone:      user.phone || "",
  address:    user.address || "",
  city:       user.city || "",
  country:    user.country || "",
  storeName:  user.store_name || "",
  isAdmin:    user.is_admin,
  isSeller:   user.is_seller,
  sellerId:   user.seller_id,
  token:      generateToken({
    _id: user.id,
    name: user.name,
    email: user.email,
    isAdmin: user.is_admin,
    isSeller: user.is_seller,
  }),
});

// ========================
// GET /api/users/seed
// ========================
userRouter.get(
  "/seed",
  expressAsyncHandler(async (_req, res) => {
    // Clear existing data
    await sql`DELETE FROM "reviews";`;
    await sql`DELETE FROM "order_items";`;
    await sql`DELETE FROM "orders";`;
    await sql`DELETE FROM "products";`;
    await sql`DELETE FROM "sellers";`;
    await sql`DELETE FROM "users";`;

    // Create admin user (same as seed.ts)
    const adminPass = bcrypt.hashSync("123456", 8);
    const custPass = bcrypt.hashSync("4321", 8);

    const admin = (await sql`
      INSERT INTO "users" (id, name, email, password, is_admin, is_seller)
      VALUES (gen_random_uuid(), ${data.users[0].name}, ${data.users[0].email}, ${adminPass}, true, true)
      RETURNING *;
    `)[0];

    const customer = (await sql`
      INSERT INTO "users" (id, name, email, password, is_admin, is_seller)
      VALUES (gen_random_uuid(), ${data.users[1].name}, ${data.users[1].email}, ${custPass}, false, false)
      RETURNING *;
    `)[0];

    // Create seller
    const seller = (await sql`
      INSERT INTO "sellers" (id, "user_id", name, "store_name", "is_active_store", rating, "num_reviews", "products_ids")
      VALUES (gen_random_uuid(), ${admin.id}, ${admin.name}, ${admin.name}'s Store', false, 0, 0, ARRAY[]::text[])
      RETURNING *;
    `)[0];

    // Update admin seller_id
    await sql`UPDATE "users" SET "seller_id" = ${seller.id} WHERE id = ${admin.id}`;

    // Create products
    let count = 0;
    for (const p of data.products) {
      await sql`
        INSERT INTO "products" (id, name, image, brand, category, description, price, "count_in_stock", rating, "num_reviews", "seller_id", "is_active")
        VALUES (gen_random_uuid(), ${p.name}, ${p.image}, ${p.brand}, ${p.category}, ${p.description}, ${p.price}, ${p.countInStock}, 0, 0, ${seller.id}, true)
        ON CONFLICT (name) DO NOTHING;
      `;
      count++;
    }

    res.send({
      createdUsers: [mapUser(admin), mapUser(customer)],
      seller: mapUserSimplified(seller),
      productsCount: count,
    });
  })
);

function mapUserSimplified(seller) {
  return {
    _id: seller.id,
    name: seller.name,
    storeName: seller.store_name,
  };
}

/**
 * Google OAuth login
 * Verifies Google token, finds or creates user, returns JWT + profile
 */
userRouter.post(
  "/google-auth",
  expressAsyncHandler(async (req, res) => {
    const { credential } = req.body;

    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { email, name, sub: googleId } = payload;

    if (!email) {
      return res.status(400).send({ message: "Google login failed" });
    }

    // Find user by email
    let user = (await sql`SELECT * FROM "users" WHERE email = ${email} LIMIT 1;`)[0];

    if (!user) {
      // Create new user
      const password = bcrypt.hashSync(googleId + process.env.JWT_SECRET);
      user = (await sql`
        INSERT INTO "users" (id, name, email, password)
        VALUES (gen_random_uuid(), ${name}, ${email}, ${password})
        RETURNING *;
      `)[0];
    }

    res.send(mapUser(user));
  })
);

/**
 * Login — email/password
 */
userRouter.post(
  "/signin",
  expressAsyncHandler(async (req, res) => {
    const { email, password } = req.body;

    const user = (await sql`SELECT * FROM "users" WHERE email = ${email} LIMIT 1;`)[0];

    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).send({ message: "Invalid email or password" });
    }

    res.send(mapUser(user));
  })
);

/**
 * Register new account
 */
userRouter.post(
  "/register",
  expressAsyncHandler(async (req, res) => {
    const { name, email, password } = req.body;

    const existing = (await sql`SELECT 1 FROM "users" WHERE email = ${email} LIMIT 1;`);
    if (existing.length > 0) {
      return res.status(400).send({ message: "User already exists" });
    }

    const user = (await sql`
      INSERT INTO "users" (id, name, email, password)
      VALUES (gen_random_uuid(), ${name}, ${email}, ${bcrypt.hashSync(password, 8)})
      RETURNING *;
    `)[0];

    res.send(mapUser(user));
  })
);

/**
 * Get user by ID
 */
userRouter.get(
  "/:id",
  expressAsyncHandler(async (req, res) => {
    const user = (await sql`SELECT * FROM "users" WHERE id = ${req.params.id} LIMIT 1;`)[0];
    if (user) {
      res.send(user);
    } else {
      res.status(404).send({ message: "User Not Found" });
    }
  })
);

/**
 * Update own profile
 */
userRouter.put(
  "/profile",
  isAuth,
  expressAsyncHandler(async (req, res) => {
    const { name, email, phone, address, city, country, storeName, password } = req.body;
    const userId = req.user._id;

    // Build dynamic update query
    const fields = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
    if (email !== undefined) { fields.push(`email = $${idx++}`); values.push(email); }
    if (phone !== undefined) { fields.push(`phone = $${idx++}`); values.push(phone); }
    if (address !== undefined) { fields.push(`address = $${idx++}`); values.push(address || null); }
    if (city !== undefined) { fields.push(`city = $${idx++}`); values.push(city || null); }
    if (country !== undefined) { fields.push(`country = $${idx++}`); values.push(country || null); }
    if (storeName !== undefined) { fields.push(`store_name = $${idx++}`); values.push(storeName || null); }
    if (password !== undefined) { fields.push(`password = $${idx++}`); values.push(bcrypt.hashSync(password, 8)); }

    if (fields.length === 0) {
      const user = (await sql`SELECT * FROM "users" WHERE id = ${userId} LIMIT 1;`)[0];
      return res.send(mapUser(user));
    }

    fields.push(`updated_at = NOW()`);
    const query = `UPDATE "users" SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *;`;
    values.push(userId);

    const result = await sql.unsafe(query, values);
    const user = result[0];

    res.send(mapUser(user));
  })
);

/**
 * List all users (Admin only)
 */
userRouter.get(
  "/",
  isAuth,
  isAdmin,
  expressAsyncHandler(async (_req, res) => {
    const users = await sql`SELECT * FROM "users" ORDER BY created_at DESC;`;
    res.send(users.map(mapUser));
  })
);

/**
 * Delete user (Admin only)
 */
userRouter.delete(
  "/:id",
  isAuth,
  isAdmin,
  expressAsyncHandler(async (req, res) => {
    const user = (await sql`SELECT * FROM "users" WHERE id = ${req.params.id} LIMIT 1;`)[0];

    if (!user) {
      return res.status(404).send({ message: "User Not Found" });
    }

    if (user.email === "amiradmin@example.com") {
      return res.status(400).send({ message: "Can Not Delete Admin User" });
    }

    await sql`DELETE FROM "users" WHERE id = ${req.params.id};`;
    res.send({ message: "User Deleted" });
  })
);

/**
 * Edit user by admin (update name, email, isSeller, isAdmin, etc.)
 */
userRouter.put(
  "/:id",
  isAuth,
  isAdmin,
  expressAsyncHandler(async (req, res) => {
    const user = (await sql`SELECT * FROM "users" WHERE id = ${req.params.id} LIMIT 1;`)[0];

    if (!user) {
      return res.status(404).send({ message: "User Not Found" });
    }

    const { name, email, phone, address, city, country, storeName, isSeller, isAdmin } = req.body;

    const fields = [`updated_at = NOW()`];
    const values = [];
    let idx = 1;

    if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
    if (email !== undefined) { fields.push(`email = $${idx++}`); values.push(email); }
    if (phone !== undefined) { fields.push(`phone = $${idx++}`); values.push(phone); }
    if (address !== undefined) { fields.push(`address = $${idx++}`); values.push(address || null); }
    if (city !== undefined) { fields.push(`city = $${idx++}`); values.push(city || null); }
    if (country !== undefined) { fields.push(`country = $${idx++}`); values.push(country || null); }
    if (storeName !== undefined) { fields.push(`store_name = $${idx++}`); values.push(storeName || null); }
    if (isSeller !== undefined) { fields.push(`is_seller = $${idx++}`); values.push(Boolean(isSeller)); }
    if (isAdmin !== undefined) { fields.push(`is_admin = $${idx++}`); values.push(Boolean(isAdmin)); }

    values.push(req.params.id);
    const query = `UPDATE "users" SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *;`;

    const result = await sql.unsafe(query, values);
    const updatedUser = result[0];

    res.send({
      message: "User Updated",
      user: mapUser(updatedUser),
    });
  })
);

export default userRouter;
