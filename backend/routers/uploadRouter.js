import express from "express";
import { isAuth } from "../utils.js";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";

const uploadRouter = express.Router();

// === Supabase Storage client ===
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  {
    global: {
      headers: {
        "Content-Type": "application/json",
      },
    },
  }
);

const STORAGE_BUCKET = "uploads";

// === Multer config (memory storage for upload) ===
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB limit
  fileFilter(req, file, cb) {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"));
    }
    cb(null, true);
  },
});

// === POST /api/uploads - Upload image to Supabase Storage ===
uploadRouter.post("/", isAuth, upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send({ message: "No image file provided" });
    }

    // Generate unique filename
    const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${req.file.originalname.replace(/\s+/g, "_").toLowerCase()}`;

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(uniqueName, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false,
      });

    if (error) {
      console.error("Supabase Storage upload error:", error);
      return res.status(500).send({
        message: "Upload failed",
        error: error.message,
      });
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(uniqueName);

    const imageUrl = urlData.publicUrl;

    // Also update the database — if product_id is provided in body,
    // update the product image field
    const { product_id } = req.body;
    if (product_id) {
      const sql = (await import("../dbClient.js")).default;
      await sql`
        UPDATE products
        SET image = ${imageUrl},
            updated_at = NOW()
        WHERE id = ${product_id};
      `;
    }

    res.send(imageUrl);
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).send({
      message: "Internal server error",
      error: err.message,
    });
  }
});

export default uploadRouter;
