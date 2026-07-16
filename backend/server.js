import express from "express";
import dotenv from "dotenv";

import productRouter from "./routers/productRouter.js";
import userRouter from "./routers/userRouter.js";
import orderRouter from "./routers/orderRouter.js";
import uploadRouter from "./routers/uploadRouter.js";
import sellerRouter from "./routers/sellerRouter.js";
import cors from "cors"

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// image router for uploads
app.use("/api/uploads", uploadRouter);

// Live chat moved to Supabase Realtime (see scripts/applyChatMigration.mjs
// and the @supabase/supabase-js channel API in the frontend). No Socket.IO.
app.use("/api/users", userRouter);
// Product routes (uses postgres.js via productRouter)
app.use("/api/products", productRouter);

// server request for createdOrders
app.use("/api/orders", orderRouter);

// server request for sellers
app.use("/api/sellers", sellerRouter);

// keep alive
app.get("/_health", (req, res) => {
  res.send("OK");
});

// PayPal api 1
app.get("/api/config/paypal", (_req, res) => {
  res.send(process.env.PAYPAL_CLIENT_ID || "sb");
});

// google map
app.get("/api/config/google", (req, res) => {
  res.send(process.env.GOOGLE_API_KEY || "");
});

import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Serve legacy local images (for backward compat — new images are in Supabase Storage)
app.use("/uploads", express.static(join(__dirname, "..", "uploads")));

// error catch for userRouter
app.use((err, _req, res, _next) => {
  res.status(500).send({ message: err.message });
});

const port = process.env.PORT || 5003;
app.listen(port, () => {
  console.log(`Serve at http://localhost:${port}`);
});
