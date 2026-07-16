import express from "express";
import expressAsyncHandler from "express-async-handler";
import sql from "../dbClient.js";
import { isAdmin, isAuth } from "../utils.js";
import Stripe from "stripe";
import dotenv from "dotenv";

dotenv.config();

const orderRouter = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2022-11-15",
});

// ────────────────────────────────────────────
// Helper — build order response from DB row + items
// ────────────────────────────────────────────

const buildOrderResponse = (order, items, userInfo) => ({
  _id: order.id,
  user: {
    _id:   order.user_id,
    name:  userInfo?.name || "",
    email: userInfo?.email || "",
  },
  orderItems: items.map((item) => ({
    product: item.product,
    name:    item.name,
    qty:     item.qty,
    price:   Number(item.price),
    image:   item.image,
    seller:  item.seller,
  })),
  itemsPrice:    Number(order.items_price),
  shippingPrice: Number(order.shipping_price),
  taxPrice:      Number(order.tax_price),
  totalPrice:    Number(order.total_price),
  paymentMethod: order.payment_method,
  isPaid:        order.is_paid,
  paidAt:        order.paid_at,
  isDelivered:   order.is_delivered,
  deliveredAt:   order.delivered_at,
  shippingAddress: {
    fullName:   order.shipping_full_name,
    contact:    order.shipping_contact,
    address:    order.shipping_address,
    city:       order.shipping_city,
    postalCode: order.shipping_postal_code,
    country:    order.shipping_country,
  },
  paymentResult: order.payment_result
    ? JSON.parse(order.payment_result)
    : null,
  createdAt: order.created_at,
  updatedAt: order.updated_at,
});

// ────────────────────────────────────────────
// GET /api/orders/  — Admin: list all orders
// ────────────────────────────────────────────
orderRouter.get(
  "/",
  isAuth,
  isAdmin,
  expressAsyncHandler(async (req, res) => {
    // Fetch all orders with user names
    const orders = await sql`
      SELECT o.*, u.name as user_name, u.email as user_email
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      ORDER BY o.created_at DESC
    `;

    // Fetch items for all orders in one query
    const orderIds = orders.map((o) => o.id);
    const allItems = await sql`
      SELECT "order" as order_id, product, seller, name, qty, price, "image"
      FROM order_items WHERE "order" = ANY(${orderIds})
    `;

    // Group items by order
    const itemsByOrder = {};
    for (const item of allItems) {
      if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = [];
      itemsByOrder[item.order_id].push({
        product: item.product,
        name: item.name,
        qty: item.qty,
        price: Number(item.price),
        image: item.image,
        seller: item.seller,
      });
    }

    // Build response array
    const result = orders.map((o) => ({
      _id: o.id,
      user: {
        _id:   o.user_id,
        name:  o.user_name || "",
        email: o.user_email || "",
      },
      orderItems: itemsByOrder[o.id] || [],
      itemsPrice: Number(o.items_price),
      shippingPrice: Number(o.shipping_price),
      taxPrice: Number(o.tax_price),
      totalPrice: Number(o.total_price),
      paymentMethod: o.payment_method,
      isPaid: o.is_paid,
      paidAt: o.paid_at,
      isDelivered: o.is_delivered,
      deliveredAt: o.delivered_at,
      shippingAddress: {
        fullName: o.shipping_full_name,
        contact: o.shipping_contact,
        address: o.shipping_address,
        city: o.shipping_city,
        postalCode: o.shipping_postal_code,
        country: o.shipping_country,
      },
      paymentResult: o.payment_result ? JSON.parse(o.payment_result) : null,
      createdAt: o.created_at,
      updatedAt: o.updated_at,
    }));

    res.send(result);
  })
);

// ────────────────────────────────────────────
// GET /api/orders/summary  — Admin: stats & charts
// ────────────────────────────────────────────
orderRouter.get(
  "/summary",
  isAuth,
  isAdmin,
  expressAsyncHandler(async (req, res) => {
    const userResult = (await sql`SELECT COUNT(*) AS cnt FROM users`)[0];
    const orderResult = (await sql`
      SELECT COUNT(*) AS numOrders, COALESCE(SUM(total_price), 0) AS totalSales FROM orders
    `)[0];
    const dailyOrders = await sql`
      SELECT TO_CHAR(created_at, 'YYYY-MM-DD') AS "_id",
             COUNT(*) AS orders,
             COALESCE(SUM(total_price), 0) AS sales
      FROM orders GROUP BY TO_CHAR(created_at, 'YYYY-MM-DD')
      ORDER BY "_id" ASC
    `;
    const categories = await sql`
      SELECT category AS "_id", COUNT(*) AS count
      FROM products GROUP BY category ORDER BY count DESC
    `;

    res.send({
      users:              [{ _id: null, numUsers: Number(userResult.cnt) }],
      orders:             [{ _id: null, numOrders: Number(orderResult.numOrders), totalSales: orderResult.totalSales }],
      dailyOrders:        dailyOrders.map((d) => ({ _id: d._id, orders: Number(d.orders), sales: d.sales })),
      productCategories:  categories.map((c) => ({ _id: c._id, count: Number(c.count) })),
    });
  })
);

// ────────────────────────────────────────────
// GET /api/orders/mine  — User: own orders
// ────────────────────────────────────────────
orderRouter.get(
  "/mine",
  isAuth,
  expressAsyncHandler(async (req, res) => {
    const allItems = await sql`
      SELECT o.*, u.name as user_name, u.email as user_email
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.user_id = ${req.user._id}
      ORDER BY o.created_at DESC
    `;

    const orderIds = allItems.map((o) => o.id);
    const items = await sql`
      SELECT "order" as order_id, product, seller, name, qty, price, "image"
      FROM order_items WHERE "order" = ANY(${orderIds})
    `;

    const itemsByOrder = {};
    for (const item of items) {
      if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = [];
      itemsByOrder[item.order_id].push({
        product: item.product, name: item.name, qty: item.qty,
        price: Number(item.price), image: item.image, seller: item.seller,
      });
    }

    res.send(allItems.map((o) => ({
      _id: o.id,
      user: { _id: o.user_id, name: o.user_name || "", email: o.user_email || "" },
      orderItems: itemsByOrder[o.id] || [],
      itemsPrice: Number(o.items_price),
      shippingPrice: Number(o.shipping_price),
      taxPrice: Number(o.tax_price),
      totalPrice: Number(o.total_price),
      paymentMethod: o.payment_method,
      isPaid: o.is_paid,
      paidAt: o.paid_at,
      isDelivered: o.is_delivered,
      deliveredAt: o.delivered_at,
      shippingAddress: {
        fullName: o.shipping_full_name,
        contact: o.shipping_contact,
        address: o.shipping_address,
        city: o.shipping_city,
        postalCode: o.shipping_postal_code,
        country: o.shipping_country,
      },
      paymentResult: o.payment_result ? JSON.parse(o.payment_result) : null,
      createdAt: o.created_at,
      updatedAt: o.updated_at,
    })));
  })
);

// ────────────────────────────────────────────
// GET /api/orders/purchase  — Alias for /mine
// ────────────────────────────────────────────
orderRouter.get(
  "/purchase",
  isAuth,
  expressAsyncHandler(async (req, res) => {
    // Reuse logic from /mine (identical query)
    const allItems = await sql`
      SELECT o.*, u.name as user_name, u.email as user_email
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.user_id = ${req.user._id}
      ORDER BY o.created_at DESC
    `;

    const orderIds = allItems.map((o) => o.id);
    const items = await sql`
      SELECT "order" as order_id, product, seller, name, qty, price, "image"
      FROM order_items WHERE "order" = ANY(${orderIds})
    `;

    const itemsByOrder = {};
    for (const item of items) {
      if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = [];
      itemsByOrder[item.order_id].push({
        product: item.product, name: item.name, qty: item.qty,
        price: Number(item.price), image: item.image, seller: item.seller,
      });
    }

    res.send(allItems.map((o) => ({
      _id: o.id,
      user: { _id: o.user_id, name: o.user_name || "", email: o.user_email || "" },
      orderItems: itemsByOrder[o.id] || [],
      itemsPrice: Number(o.items_price),
      shippingPrice: Number(o.shipping_price),
      taxPrice: Number(o.tax_price),
      totalPrice: Number(o.total_price),
      paymentMethod: o.payment_method,
      isPaid: o.is_paid,
      paidAt: o.paid_at,
      isDelivered: o.is_delivered,
      deliveredAt: o.delivered_at,
      shippingAddress: {
        fullName: o.shipping_full_name,
        contact: o.shipping_contact,
        address: o.shipping_address,
        city: o.shipping_city,
        postalCode: o.shipping_postal_code,
        country: o.shipping_country,
      },
      paymentResult: o.payment_result ? JSON.parse(o.payment_result) : null,
      createdAt: o.created_at,
      updatedAt: o.updated_at,
    })));
  })
);

// ────────────────────────────────────────────
// GET /api/orders/:id  — Order detail
// ────────────────────────────────────────────
orderRouter.get(
  "/:id",
  isAuth,
  expressAsyncHandler(async (req, res) => {
    const orderData = await sql`
      SELECT o.*, u.name as user_name, u.email as user_email
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.id = ${req.params.id}
    `;

    if (!orderData[0]) {
      return res.status(404).send({ message: "Order not found" });
    }

    const order = orderData[0];
    const items = await sql`
      SELECT product, seller, name, qty, price, "image"
      FROM order_items WHERE "order" = ${req.params.id}
    `;

    res.send(buildOrderResponse(order, items, { name: order.user_name, email: order.user_email }));
  })
);

// ────────────────────────────────────────────
// POST /api/orders/  — Create order
// ────────────────────────────────────────────
orderRouter.post(
  "/",
  isAuth,
  expressAsyncHandler(async (req, res) => {
    try {
      if (!req.body.orderItems || req.body.orderItems.length === 0) {
        return res.status(400).send({ message: "Cart is empty" });
      }

      const result = await sql.begin(async (s) => {
        // Get seller_ids for all products in one query
        const productIds = req.body.orderItems.map((item) => item.product);

        const products = await s`
          SELECT id, seller_id FROM products WHERE id = ANY(${productIds})
        `;

        if (products.length !== productIds.length) {
          throw new Error("One or more products not found");
        }

        // Build seller lookup map
        const sellerMap = {};
        for (const p of products) {
          sellerMap[p.id] = p.seller_id;
        }

        // Create order
        const order = await s`
          INSERT INTO orders
            (id, user_id, payment_method, items_price, shipping_price,
             tax_price, total_price,
             shipping_full_name, shipping_contact, shipping_address,
             shipping_city, shipping_postal_code, shipping_country,
             is_paid, is_delivered)
          VALUES (gen_random_uuid(), ${req.user._id}, ${req.body.paymentMethod},
                  ${req.body.itemsPrice}, ${req.body.shippingPrice},
                  ${req.body.taxPrice}, ${req.body.totalPrice},
                  ${req.body.shippingAddress.fullName}, ${req.body.shippingAddress.contact},
                  ${req.body.shippingAddress.address}, ${req.body.shippingAddress.city},
                  ${req.body.shippingAddress.postalCode}, ${req.body.shippingAddress.country},
                  false, false)
          RETURNING *;
        `;

        // Create order items
        for (const item of req.body.orderItems) {
          await s`
            INSERT INTO order_items (id, "order", product, seller, name, qty, "image", price)
            VALUES (gen_random_uuid(), ${order[0].id}, ${item.product},
                    ${sellerMap[item.product] || null}, ${item.name},
                    ${item.qty}, ${item.image}, ${item.price})
          `;
        }

        // Fetch full order with user info
        const fullOrder = (await s`
          SELECT o.*, u.name as user_name, u.email as user_email
          FROM orders o
          LEFT JOIN users u ON o.user_id = u.id
          WHERE o.id = ${order[0].id}
        `)[0];

        // Fetch items for response
        const items = (await s`
          SELECT product, seller, name, qty, price, "image"
          FROM order_items WHERE "order" = ${order[0].id}
        `);

        return { order: fullOrder, items };
      });

      res.status(201).send({
        message: "New Order Created",
        order: buildOrderResponse(result.order, result.items,
          { name: result.order.user_name, email: result.order.user_email }
        ),
      });
    } catch (err) {
      res.status(500).send({ message: "Internal server error", error: err.message });
    }
  })
);

// ────────────────────────────────────────────
// PUT /api/orders/:id/pay  — Mark order as paid
// ────────────────────────────────────────────
orderRouter.put(
  "/:id/pay",
  isAuth,
  expressAsyncHandler(async (req, res) => {
    const orderData = await sql`
      SELECT o.*, u.name as user_name, u.email as user_email
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.id = ${req.params.id}
    `;

    if (!orderData[0]) {
      return res.status(404).send({ message: "Order Not Found" });
    }

    // Build Stripe payment result
    const paymentResult = {
      id:           req.body.id,
      status:       req.body.status,
      update_time:  req.body.update_time,
      email_address: req.body.email_address,
    };

    const result = await sql`
      UPDATE orders
      SET is_paid          = true,
          paid_at          = NOW(),
          payment_result   = ${JSON.stringify(paymentResult)},
          updated_at       = NOW()
      WHERE id = ${req.params.id}
      RETURNING *;
    `;

    const items = await sql`
      SELECT product, seller, name, qty, price, "image"
      FROM order_items WHERE "order" = ${req.params.id}
    `;

    res.send({
      message: "Order Paid",
      order: buildOrderResponse(result[0], items, {
        name: orderData[0].user_name,
        email: orderData[0].user_email,
      }),
    });
  })
);

// ────────────────────────────────────────────
// POST /api/orders/create-payment-intent  — Stripe
// ────────────────────────────────────────────
orderRouter.post(
  "/create-payment-intent",
  isAuth,
  expressAsyncHandler(async (req, res) => {
    const { amount } = req.body;
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: "usd",
    });
    res.send({ clientSecret: paymentIntent.client_secret });
  })
);

// ────────────────────────────────────────────
// DELETE /api/orders/:id  — Admin: delete order
// ────────────────────────────────────────────
orderRouter.delete(
  "/:id",
  isAuth,
  isAdmin,
  expressAsyncHandler(async (req, res) => {
    const result = await sql.begin(async (s) => {
      // Delete order items first (no ON DELETE CASCADE on orders FK)
      await s`DELETE FROM order_items WHERE "order" = ${req.params.id}`;
      const deleted = await s`DELETE FROM orders WHERE id = ${req.params.id} RETURNING *`;
      return deleted[0];
    });

    if (!result) {
      return res.status(404).send({ message: "Order Not Found" });
    }

    res.send({ message: "Order Deleted", order: result });
  })
);

// ────────────────────────────────────────────
// PUT /api/orders/:id/deliver  — Admin: mark delivered
// ────────────────────────────────────────────
orderRouter.put(
  "/:id/deliver",
  isAuth,
  isAdmin,
  expressAsyncHandler(async (req, res) => {
    const orderData = await sql`
      SELECT o.*, u.name as user_name
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.id = ${req.params.id}
    `;

    if (!orderData[0]) {
      return res.status(404).send({ message: "Order Not Found" });
    }

    const result = await sql`
      UPDATE orders
      SET is_delivered  = true,
          delivered_at  = NOW(),
          updated_at    = NOW()
      WHERE id = ${req.params.id}
      RETURNING *;
    `;

    const items = await sql`
      SELECT product, seller, name, qty, price, "image"
      FROM order_items WHERE "order" = ${req.params.id}
    `;

    res.send({
      message: "Order Delivered",
      order: buildOrderResponse(result[0], items, {
        name: orderData[0].user_name,
        email: "",
      }),
    });
  })
);

export default orderRouter;
