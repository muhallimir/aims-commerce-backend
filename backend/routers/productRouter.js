import express from "express";
import expressAsyncHandler from "express-async-handler";
import sql from "../dbClient.js";
import data from "../data.js";
import { isAdmin, isAuth } from "../utils.js";

const productRouter = express.Router();

// ========================
// GET /api/products/ - List filtered products
// ========================
productRouter.get(
  "/",
  expressAsyncHandler(async (req, res) => {
    const { name, category, order, min, max, rating } = req.query;

    const sortOrder =
      order === "lowest" ? "p.price ASC"
      : order === "highest" ? "p.price DESC"
      : order === "toprated" ? "p.rating DESC"
      : "p.id ASC";

    const products = await sql`
      SELECT p.id, p.name, p.image, p.brand, p.category, p.description,
             p.price, p.count_in_stock, p.rating, p.num_reviews,
             p.seller_id, p.is_active, p.created_at, p.updated_at
      FROM products p
      JOIN sellers s ON p.seller_id = s.id
      WHERE p.is_active = true AND s.is_active_store = true
      ${name && sql`AND p.name ILIKE ${'%' + name + '%'}`}
      ${category && sql`AND p.category = ${category}`}
      ${min && Number(min) !== 0 && sql`AND p.price >= ${Number(min)}`}
      ${max && Number(max) !== 0 && sql`AND p.price <= ${Number(max)}`}
      ${rating && Number(rating) !== 0 && sql`AND p.rating >= ${Number(rating)}`}
      ORDER BY ${sortOrder}
    `;

    // Convert DECIMAL → Number so frontend gets native JS numbers
    const formatted = products.map((p) => ({
      id:        p.id,
      name:      p.name,
      image:     p.image,
      brand:     p.brand,
      category:  p.category,
      description: p.description,
      price:     parseFloat(p.price),
      count_in_stock: p.count_in_stock,
      rating:    parseFloat(p.rating),
      num_reviews: p.num_reviews,
      seller_id: p.seller_id,
      is_active: p.is_active,
      created_at: p.created_at,
      updated_at: p.updated_at,
    }));

    res.send(formatted);
  })
);

// ========================
// GET /api/products/categories - Distinct categories
// ========================
productRouter.get(
  "/categories",
  expressAsyncHandler(async (req, res) => {
    const cats = await sql`
      SELECT DISTINCT p.category
      FROM products p
      JOIN sellers s ON p.seller_id = s.id
      WHERE p.is_active = true AND s.is_active_store = true
      ORDER BY p.category ASC
    `;
    res.send(cats.map((c) => c.category));
  })
);

// ========================
// GET /api/products/seed - Seed products from data.js
// ========================
productRouter.get(
  "/seed",
  expressAsyncHandler(async (req, res) => {
    // Find admin seller for product assignment
    const adminSeller = (await sql`
      SELECT u.id FROM users u
      WHERE u.is_admin = true AND u.is_seller = true
      LIMIT 1
    `)[0];

    if (!adminSeller) {
      return res.status(400).send({ message: "No admin seller found for seeding" });
    }

    const seller = (await sql`
      SELECT id FROM sellers WHERE user_id = ${adminSeller.id} LIMIT 1
    `)[0];

    if (!seller) {
      return res.status(400).send({ message: "No seller record found for admin user" });
    }

    let count = 0;
    for (const p of data.products) {
      const result = await sql`
        INSERT INTO products (id, name, image, brand, category, description,
                              price, count_in_stock, rating, num_reviews, seller_id, is_active)
        VALUES (gen_random_uuid(), ${p.name}, ${p.image}, ${p.brand}, ${p.category},
                ${p.description}, ${p.price}, ${p.countInStock}, 0, 0, ${seller.id}, true)
        ON CONFLICT (name) DO NOTHING
        RETURNING id;
      `;
      if (result[0]) count++;
    }

    res.send({ productCount: count, createdCount: count });
  })
);

// ========================
// GET /api/products/:id - Single product with reviews
// ========================
productRouter.get(
  "/:id",
  expressAsyncHandler(async (req, res) => {
    const productData = await sql`
      SELECT p.id, p.name, p.image, p.brand, p.category, p.description,
             p.price, p.count_in_stock, p.rating, p.num_reviews,
             p.seller_id, p.is_active, p.created_at, p.updated_at,
             COALESCE(
               (SELECT json_agg(json_build_object(
                 '_id', r.id,
                 'name', r.name,
                 'rating', r.rating,
                 'comment', r.comment,
                 'created_at', r.created_at
               ) ORDER BY r.created_at DESC)
               FROM reviews r WHERE r.product_id = p.id),
               '[]'
             ) AS reviews
      FROM products p
      WHERE p.id = ${req.params.id}
        AND p.is_active = true
        AND EXISTS (
          SELECT 1 FROM sellers s WHERE s.id = p.seller_id AND s.is_active_store = true
        )
    `;

    const product = productData[0];
    if (!product) {
      return res.status(404).send({ message: "Product Not Found or Store Inactive" });
    }

    res.send({
      id:        product.id,
      name:      product.name,
      image:     product.image,
      brand:     product.brand,
      category:  product.category,
      description: product.description,
      price:     parseFloat(product.price),
      count_in_stock: product.count_in_stock,
      rating:    parseFloat(product.rating),
      num_reviews: product.num_reviews,
      seller_id: product.seller_id,
      reviews:   JSON.parse(product.reviews || "[]"),
      is_active: product.is_active,
      created_at: product.created_at,
      updated_at: product.updated_at,
    });
  })
);

// ========================
// PUT /api/products/:id - Admin update product
// ========================
productRouter.put(
  "/:id",
  isAuth,
  isAdmin,
  expressAsyncHandler(async (req, res) => {
    try {
      const { name, image, price, category, brand, countInStock, description } = req.body;

      const result = await sql`
        UPDATE products
        SET name          = COALESCE(${name ?? null}, name),
            image         = COALESCE(${image ?? null}, image),
            price         = COALESCE(${price ?? null}, price),
            category      = COALESCE(${category ?? null}, category),
            brand         = COALESCE(${brand ?? null}, brand),
            count_in_stock= COALESCE(${countInStock ?? null}, count_in_stock),
            description   = COALESCE(${description ?? null}, description),
            updated_at    = NOW()
        WHERE id = ${req.params.id}
        RETURNING *;
      `;

      if (!result[0]) {
        return res.status(404).send({ message: "Product Not Found" });
      }

      const p = result[0];
      res.send({
        message:        "Product Updated",
        product:        {
          _id:       p.id,
          name:      p.name,
          image:     p.image,
          brand:     p.brand,
          category:  p.category,
          description: p.description,
          price:     parseFloat(p.price),
          countInStock: p.count_in_stock,
          rating:    parseFloat(p.rating),
          numReviews: p.num_reviews,
          seller:    p.seller_id,
          is_active: p.is_active,
          created_at: p.created_at,
          updated_at: p.updated_at,
        },
      });
    } catch (err) {
      res.status(500).send({ message: "Internal server error", error: err.message });
    }
  })
);

// ========================
// DELETE /api/products/:id - Admin delete product
// ========================
productRouter.delete(
  "/:id",
  isAuth,
  isAdmin,
  expressAsyncHandler(async (req, res) => {
    const result = await sql`
      DELETE FROM products WHERE id = ${req.params.id} RETURNING *;
    `;

    if (!result[0]) {
      return res.status(404).send({ message: "Product Not Found" });
    }

    res.send({ message: "Product Successfully Deleted" });
  })
);

// ========================
// POST /api/products/ - Admin create product
// ========================
productRouter.post(
  "/",
  isAuth,
  isAdmin,
  expressAsyncHandler(async (req, res) => {
    try {
      const { seller_id } = req.body;

      // Resolve seller owner
      let ownerId = seller_id || null;
      if (!ownerId) {
        // Try to find admin's seller
        const adminUser = (await sql`
          SELECT u.id FROM users u
          WHERE u.id = ${req.user._id} AND (u.is_admin = true OR u.is_seller = true)
          LIMIT 1
        `)[0];
        if (adminUser) {
          const seller = (await sql`
            SELECT id FROM sellers WHERE user_id = ${adminUser.id} LIMIT 1
          `)[0];
          ownerId = seller?.id || null;
        }
      }

      const product = await sql`
        INSERT INTO products (id, name, image, price, category, brand,
                              count_in_stock, rating, num_reviews, description, seller_id, is_active)
        VALUES (gen_random_uuid(),
                ${req.body.name || `New Product ${Date.now()}`},
                ${req.body.image || "/images/sample.jpg"},
                ${req.body.price ?? 0},
                ${req.body.category || "Category"},
                ${req.body.brand || "Brand"},
                ${req.body.countInStock ?? 0},
                0, 0,
                ${req.body.description || "Product description"},
                ${ownerId}, true)
        RETURNING *;
      `;

      const p = product[0];
      res.send({
        message:        "New Product Created",
        product:        {
          _id:       p.id,
          name:      p.name,
          image:     p.image,
          brand:     p.brand,
          category:  p.category,
          description: p.description,
          price:     parseFloat(p.price),
          countInStock: p.count_in_stock,
          rating:    parseFloat(p.rating),
          numReviews: p.num_reviews,
          seller:    p.seller_id,
          is_active: p.is_active,
          created_at: p.created_at,
          updated_at: p.updated_at,
        },
      });
    } catch (err) {
      res.status(500).send({ message: "Internal server error", error: err.message });
    }
  })
);

// ========================
// POST /api/products/:id/reviews - Submit product review
// ========================
productRouter.post(
  "/:id/reviews",
  isAuth,
  expressAsyncHandler(async (req, res) => {
    try {
      const productId = req.params.id;
      const { rating, comment } = req.body;

      // Check product exists and is active
      const product = (await sql`
        SELECT id FROM products WHERE id = ${productId} AND is_active = true
      `)[0];

      if (!product) {
        return res.status(404).send({ message: "Product Not Found" });
      }

      // Check if user already reviewed (by user_id, not name)
      const existing = (await sql`
        SELECT COUNT(*) AS cnt FROM reviews
        WHERE product_id = ${productId} AND user_id = ${req.user._id}
      `)[0];

      if (Number(existing.cnt) > 0) {
        return res.status(400).send({ message: "You already submitted a review" });
      }

      // Insert review
      const newReview = (await sql`
        INSERT INTO reviews (id, product_id, user_id, name, comment, rating)
        VALUES (gen_random_uuid(), ${productId}, ${req.user._id},
                ${req.user.name}, ${comment || ""}, ${rating})
        RETURNING *;
      `)[0];

      // Recalculate product rating/num_reviews globally
      const stats = (await sql`
        SELECT COUNT(*) AS cnt, COALESCE(AVG(rating), 0)::decimal(3,2) AS avg_rating
        FROM reviews WHERE product_id = ${productId}
      `)[0];

      await sql`
        UPDATE products
        SET num_reviews = ${stats.cnt},
            rating      = ${parseFloat(stats.avg_rating.toFixed(2))},
            updated_at  = NOW()
        WHERE id = ${productId}
      `;

      res.status(201).send({
        message:  "Review Created",
        review:   {
          _id:          newReview.id,
          name:         newReview.name,
          rating:       parseFloat(newReview.rating),
          comment:      newReview.comment,
          created_at:   newReview.created_at,
        },
      });
    } catch (err) {
      res.status(500).send({ message: "Internal server error", error: err.message });
    }
  })
);

export default productRouter;
