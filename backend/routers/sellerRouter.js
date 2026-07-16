import express from "express";
import expressAsyncHandler from "express-async-handler";
import sql from "../dbClient.js";
import { generateToken, isAdmin, isAuth, isSeller } from "../utils.js";

const sellerRouter = express.Router();

// ========================
// HELPERS
// ========================

const mapSeller = (s) => ({
  _id:              s.id,
  name:             s.name,
  email:            "",    // populated from user table
  isSeller:         true,
  storeName:        s.store_name || "",
  storeDescription: s.store_description || "",
  profileImage:     s.profile_image || "",
  isActiveStore:    s.is_active_store || false,
  createdAt:        s.created_at,
  updatedAt:        s.updated_at,
});

const findSellerByUser = async (userId) => {
  return (
    await sql`
      SELECT * FROM "sellers" WHERE "user" = ${userId}
    `
  )[0] || null;
};

const ensureIsSeller = async (userId, user) => {
  const seller = await findSellerByUser(userId);
  if (!seller) {
    return { error: { status: 404, message: "Seller not found" }, seller: null };
  }
  return { error: null, seller };
};

// ========================
// POST /api/sellers/become — Customer becomes a seller
// ========================
sellerRouter.post(
  "/become",
  isAuth,
  expressAsyncHandler(async (req, res) => {
    try {
      const { name, storeName } = req.body;
      if (!name) {
        return res.status(400).json({ message: "Name is required" });
      }

      // Fetch user and create seller in a transaction
      const user = (
        await sql`
          SELECT * FROM "users" WHERE id = ${req.user._id}
        `
      )[0];

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      if (user.is_seller) {
        return res.status(400).json({ message: "User is already a seller" });
      }

      const storeNameVal = storeName || `${name}'s Store`;

      const result = await sql.begin(async (sql) => {
        // Update user to become seller
        const updatedUser = await sql`
          UPDATE "users"
          SET is_seller = true, store_name = ${storeNameVal}
          WHERE id = ${req.user._id}
          RETURNING *;
        `;

        // Create seller profile (using the user's name from req)
        const newSeller = await sql`
          INSERT INTO "sellers" (id, "user", name, "store_name", "is_active_store")
          VALUES (gen_random_uuid(), ${req.user._id}, ${name}, ${storeNameVal}, true)
          RETURNING *;
        `;

        // Update user's seller_id reference
        await sql`
          UPDATE "users" SET "seller" = ${newSeller[0].id}
          WHERE id = ${req.user._id};
        `;

        return { user: updatedUser[0], seller: newSeller[0] };
      });

      const token = generateToken({
        _id:          result.user.id,
        name:         result.user.name,
        email:        result.user.email,
        isAdmin:      result.user.is_admin,
        isSeller:     true,
      });

      res.status(201).json({
        message:  "Successfully became a seller",
        user: {
          _id:          result.user.id,
          name:         result.user.name,
          email:        result.user.email,
          isSeller:     result.user.is_seller,
          storeName:    result.user.store_name,
          createdAt:    result.user.created_at,
          updatedAt:    result.user.updated_at,
        },
        token,
      });
    } catch (err) {
      console.error("Error in /api/sellers/become:", err);
      res.status(500).json({ message: "Internal server error", error: err.message });
    }
  })
);

// ========================
// GET /api/sellers/analytics — Get seller analytics
// ========================
sellerRouter.get(
  "/analytics",
  isAuth,
  isSeller,
  expressAsyncHandler(async (req, res) => {
    try {
      const { error, seller } = await ensureIsSeller(req.user._id, req.user);
      if (error) return res.status(error.status).json({ message: error.message });

      const sellerId = seller.id;

      // Total revenue from paid orders (via order_items)
      const revenueResult = await sql`
        SELECT COALESCE(SUM(oi.price * oi.qty), 0) AS total_revenue
        FROM order_items oi
        JOIN orders o ON oi.order = o.id
        WHERE oi.seller = ${sellerId}
          AND o.is_paid = true
      `;

      // Total paid orders count
      const totalOrders = await sql`
        SELECT COUNT(DISTINCT o.id) AS count
        FROM order_items oi
        JOIN orders o ON oi.order = o.id
        WHERE oi.seller = ${sellerId}
          AND o.is_paid = true
      `;

      // Total products count
      const totalProducts = await sql`
        SELECT COUNT(*) AS count FROM "products" WHERE "seller" = ${sellerId}
      `;

      // Monthly revenue (last 12 months)
      const monthlyRevenueRaw = await sql`
        SELECT 
          EXTRACT(YEAR FROM o.paid_at)::int AS year,
          EXTRACT(MONTH FROM o.paid_at)::int AS month,
          SUM(oi.price * oi.qty) AS sales
        FROM order_items oi
        JOIN orders o ON oi.order = o.id
        WHERE oi.seller = ${sellerId}
          AND o.is_paid = true
          AND o.paid_at >= NOW() - INTERVAL '12 months'
        GROUP BY EXTRACT(YEAR FROM o.paid_at), EXTRACT(MONTH FROM o.paid_at)
        ORDER BY year ASC, month ASC
      `;

      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const monthlyRevenue = monthlyRevenueRaw.map((item) => ({
        name: monthNames[item.month - 1],
        sales: item.sales,
      }));

      res.json({
        totalRevenue:    Number(revenueResult[0].total_revenue),
        totalOrders:     Number(totalOrders[0].count),
        totalProducts:   Number(totalProducts[0].count),
        monthlyRevenue,
      });
    } catch (err) {
      console.error("Error in /api/sellers/analytics:", err);
      res.status(500).json({ message: "Internal server error", error: err.message });
    }
  })
);

// ========================
// GET /api/sellers/products — Get seller's products
// ========================
sellerRouter.get(
  "/products",
  isAuth,
  isSeller,
  expressAsyncHandler(async (req, res) => {
    try {
      const { error, seller } = await ensureIsSeller(req.user._id, req.user);
      if (error) return res.status(error.status).json({ message: error.message });

      const products = await sql`
        SELECT * FROM "products" WHERE "seller" = ${seller.id} ORDER BY created_at DESC
      `;

      res.json(products || []);
    } catch (err) {
      console.error("Error in /api/sellers/products:", err);
      res.status(500).json({ message: "Internal server error", error: err.message });
    }
  })
);

// ========================
// POST /api/sellers/products — Create new product
// ========================
sellerRouter.post(
  "/products",
  isAuth,
  isSeller,
  expressAsyncHandler(async (req, res) => {
    try {
      const { name, price, category, brand, countInStock, description, image } = req.body;

      if (!name || !price || !category || !brand || countInStock === undefined || !description) {
        return res.status(400).json({
          message:
            "Missing required fields: name, price, category, brand, countInStock, description",
        });
      }

      const { error, seller } = await ensureIsSeller(req.user._id, req.user);
      if (error) return res.status(error.status).json({ message: error.message });

      const result = await sql.begin(async (s) => {
        // Create product
        const product = await s`
          INSERT INTO "products" 
            (id, name, image, brand, category, description, price, "count_in_stock", rating, "num_reviews", "seller_id", "is_active")
          VALUES 
            (gen_random_uuid(), ${name}, ${image || '/images/default-product.jpg'}, ${brand}, ${category}, 
             ${description}, ${price}, ${countInStock}, 0, 0, ${seller.id}, true)
          RETURNING *;
        `;

        // Add product to seller's products_ids array (ON CONFLICT for duplicate name)
        await s`
          UPDATE "sellers" 
          SET "products_ids" = array_append("products_ids", ${product[0].id}),
              "is_active_store" = true
          WHERE id = ${seller.id};
        `;

        return { product: product[0] };
      });

      res.status(201).json({ message: "Product created successfully", product: result.product });
    } catch (err) {
      console.error("Error in /api/sellers/products POST:", err);
      res.status(500).json({ message: "Internal server error", error: err.message });
    }
  })
);

// ========================
// PUT /api/sellers/products/:productId — Update product
// ========================
sellerRouter.put(
  "/products/:productId",
  isAuth,
  isSeller,
  expressAsyncHandler(async (req, res) => {
    try {
      const { name, price, category, brand, countInStock, description, image, isActive } = req.body;

      const { error, seller } = await ensureIsSeller(req.user._id, req.user);
      if (error) return res.status(error.status).json({ message: error.message });

      // Verify product belongs to this seller
      const existing = await sql`
        SELECT * FROM "products" WHERE id = ${req.params.productId} AND "seller" = ${seller.id}
      `;

      if (!existing[0]) {
        return res.status(404).json({ message: "Product not found" });
      }

      const product = await sql`
        UPDATE "products"
        SET name = COALESCE(${name}, name),
            price = COALESCE(${price}, price),
            category = COALESCE(${category}, category),
            brand = COALESCE(${brand}, brand),
            "count_in_stock" = COALESCE(${countInStock}, "count_in_stock"),
            description = COALESCE(${description}, description),
            image = COALESCE(${image}, image),
            "is_active" = COALESCE(${isActive}, "is_active")
        WHERE id = ${req.params.productId} AND "seller" = ${seller.id}
        RETURNING *;
      `;

      res.json({ message: "Product updated successfully", product: product[0] });
    } catch (err) {
      console.error("Error in /api/sellers/products PUT:", err);
      res.status(500).json({ message: "Internal server error", error: err.message });
    }
  })
);

// ========================
// DELETE /api/sellers/products/:productId — Delete product
// ========================
sellerRouter.delete(
  "/products/:productId",
  isAuth,
  isSeller,
  expressAsyncHandler(async (req, res) => {
    try {
      const { error, seller } = await ensureIsSeller(req.user._id, req.user);
      if (error) return res.status(error.status).json({ message: error.message });

      // Verify product belongs to this seller
      const existing = await sql`
        SELECT * FROM "products" WHERE id = ${req.params.productId} AND "seller" = ${seller.id}
      `;

      if (!existing[0]) {
        return res.status(404).json({ message: "Product not found" });
      }

      const result = await sql.begin(async (s) => {
        // Delete product
        await s`DELETE FROM "products" WHERE id = ${req.params.productId}`;

        // Remove from seller products array
        await s`
          UPDATE "sellers"
          SET "products_ids" = array_remove("products_ids", ${req.params.productId})
          WHERE id = ${seller.id};
        `;
      });

      res.json({ message: "Product deleted successfully" });
    } catch (err) {
      console.error("Error in /api/sellers/products DELETE:", err);
      res.status(500).json({ message: "Internal server error", error: err.message });
    }
  })
);

// ========================
// GET /api/sellers/orders — Get seller's orders
// ========================
sellerRouter.get(
  "/orders",
  isAuth,
  isSeller,
  expressAsyncHandler(async (req, res) => {
    try {
      const { error, seller } = await ensureIsSeller(req.user._id, req.user);
      if (error) return res.status(error.status).json({ message: error.message });

      // Get all orders containing this seller's items, with user info
      const orders = await sql`
        SELECT 
          o.id,
          o.is_paid,
          o.is_delivered,
          o.paid_at,
          o.delivered_at,
          o.created_at,
          o."shipping_full_name",
          o."shipping_contact",
          o."shipping_address",
          o."shipping_city",
          o."shipping_postal_code",
          o."shipping_country",
          oi.name,
          oi.qty,
          oi.price,
          oi.image,
          oi.product,
          u.name AS user_name,
          u.email AS user_email
        FROM order_items oi
        JOIN orders o ON oi.order = o.id
        JOIN users u ON o.user_id = u.id
        WHERE oi.seller = ${seller.id}
        ORDER BY o.created_at DESC
      `;

      // Group orders by order id (a single order may contain items from this seller)
      const orderMap = new Map();
      for (const row of orders) {
        const oid = row.id;
        if (!orderMap.has(oid)) {
          orderMap.set(oid, {
            _id: oid,
            user: { name: row.user_name, email: row.user_email },
            shippingAddress: {
              fullName:   row.shipping_full_name,
              contactNo:  row.shipping_contact,
              address:    row.shipping_address,
              city:       row.shipping_city,
              postalCode: row.shipping_postal_code,
              country:    row.shipping_country,
            },
            orderItems: [],
            totalPrice: 0,
            isPaid:   row.is_paid,
            isDelivered: row.is_delivered,
            paidAt:   row.paid_at,
            deliveredAt: row.delivered_at,
            createdAt: row.created_at,
          });
        }
        const order = orderMap.get(oid);
        order.orderItems.push({
          name:       row.name,
          quantity:   row.qty,
          price:      row.price,
          image:      row.image,
          productId:  row.product,
        });
        order.totalPrice += Number(row.price) * row.qty;
      }

      // Also get seller-specific totals from the order table
      const results = Array.from(orderMap.values());
      res.json(results);
    } catch (err) {
      console.error("Error in /api/sellers/orders:", err);
      res.status(500).json({ message: "Internal server error", error: err.message });
    }
  })
);

// ========================
// PUT /api/sellers/orders/:orderId/status — Update order status
// ========================
sellerRouter.put(
  "/orders/:orderId/status",
  isAuth,
  isSeller,
  expressAsyncHandler(async (req, res) => {
    try {
      const { isDelivered, deliveredAt } = req.body;

      const { error, seller } = await ensureIsSeller(req.user._id, req.user);
      if (error) return res.status(error.status).json({ message: error.message });

      // Verify order contains this seller's items
      const orderItems = await sql`
        SELECT COUNT(*) AS count FROM order_items 
        WHERE order = ${req.params.orderId} AND seller = ${seller.id}
      `;

      if (!orderItems[0] || Number(orderItems[0].count) === 0) {
        return res.status(404).json({ message: "Order not found" });
      }

      // Update order status
      const deliveredAtVal = isDelivered ? (deliveredAt || new Date().toISOString()) : deliveredAt;

      const updatedOrder = await sql`
        UPDATE orders
        SET is_delivered = COALESCE(${isDelivered}, is_delivered),
            delivered_at = COALESCE(${deliveredAtVal}, delivered_at)
        WHERE id = ${req.params.orderId}
        RETURNING id, is_delivered, delivered_at, updated_at;
      `;

      res.json({
        message: "Order status updated successfully",
        order: {
          _id:         updatedOrder[0].id,
          isDelivered: updatedOrder[0].is_delivered,
          deliveredAt: updatedOrder[0].delivered_at,
          updatedAt:   updatedOrder[0].updated_at,
        },
      });
    } catch (err) {
      console.error("Error in /api/sellers/orders PUT:", err);
      res.status(500).json({ message: "Internal server error", error: err.message });
    }
  })
);

// ========================
// PUT /api/sellers/profile — Update seller profile
// ========================
sellerRouter.put(
  "/profile",
  isAuth,
  isSeller,
  expressAsyncHandler(async (req, res) => {
    try {
      const {
        name,
        storeName,
        storeDescription,
        phone,
        address,
        city,
        country,
        isActiveStore,
      } = req.body;

      if (!name || !storeName) {
        return res.status(400).json({
          message: "Missing required fields: name and storeName are required",
        });
      }

      const { error, seller } = await ensureIsSeller(req.user._id, req.user);
      if (error) return res.status(error.status).json({ message: error.message });

      const result = await sql.begin(async (s) => {
        // Update User table fields
        const updatedUser = await s`
          UPDATE "users"
          SET name = ${name},
              phone = COALESCE(${phone}, phone),
              address = COALESCE(${address}, address),
              city = COALESCE(${city}, city),
              country = COALESCE(${country}, country),
              store_name = COALESCE(${storeName}, store_name)
          WHERE id = ${req.user._id} AND is_seller = true
          RETURNING *;
        `;

        // Update Seller table fields
        const updatedSellerData = {
          name:    name,
          user:    req.user._id,
        };
        if (storeName !== undefined) updatedSellerData["store_name"] = storeName;
        if (storeDescription !== undefined) updatedSellerData["store_description"] = storeDescription;
        if (isActiveStore !== undefined) updatedSellerData["is_active_store"] = isActiveStore;

        const updatedSeller = await s`
          UPDATE "sellers"
          SET name = ${name},
              store_name = COALESCE(${storeName}, store_name),
              store_description = COALESCE(${storeDescription}, store_description),
              "is_active_store" = COALESCE(${isActiveStore}, "is_active_store")
          WHERE id = ${seller.id}
          RETURNING *;
        `;

        return { user: updatedUser[0], seller: updatedSeller[0] };
      });

      if (!result.user) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({
        message: "Seller profile updated successfully",
        user: {
          _id:          result.user.id,
          name:         result.user.name,
          email:        result.user.email,
          phone:        result.user.phone || "",
          address:      result.user.address || "",
          city:         result.user.city || "",
          country:      result.user.country || "",
          isSeller:     result.user.is_seller,
          storeName:    result.user.store_name || "",
          updatedAt:    result.user.updated_at,
        },
        seller: {
          _id:              result.seller.id,
          storeName:        result.seller.store_name || "",
          storeDescription: result.seller.store_description || "",
          isActiveStore:    result.seller.is_active_store || false,
          updatedAt:        result.seller.updated_at,
        },
      });
    } catch (err) {
      console.error("Error in /api/sellers/profile PUT:", err);
      res.status(500).json({ message: "Internal server error", error: err.message });
    }
  })
);

// ========================
// GET /api/sellers/:sellerId — Get seller info
// ========================
sellerRouter.get(
  "/:sellerId",
  isAuth,
  expressAsyncHandler(async (req, res) => {
    try {
      const seller = await sql`
        SELECT * FROM "sellers" WHERE id = ${req.params.sellerId}
      `;

      if (!seller[0]) {
        return res.status(404).json({ message: "Seller not found" });
      }

      // Get user data for email
      const userData = await sql`
        SELECT id, name, email FROM "users" WHERE id = ${seller[0].user_id}
      `;

      res.json({
        _id:              seller[0].id,
        name:             seller[0].name,
        email:            userData[0]?.email || "",
        isSeller:         true,
        storeName:        seller[0].store_name || "",
        storeDescription: seller[0].store_description || "",
        profileImage:     seller[0].profile_image || "",
        isActiveStore:    seller[0].is_active_store || false,
        createdAt:        seller[0].created_at,
        updatedAt:        seller[0].updated_at,
      });
    } catch (err) {
      console.error("Error in /api/sellers/:sellerId:", err);
      res.status(500).json({ message: "Internal server error", error: err.message });
    }
  })
);

export default sellerRouter;
