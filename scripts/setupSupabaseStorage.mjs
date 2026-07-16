/**
 * Supabase Storage setup — create the `uploads` bucket, upload all local
 * images from uploads/, and re-point all product rows to the new public URLs.
 *
 * Idempotent: safe to re-run.
 *
 * Usage: node scripts/setupSupabaseStorage.mjs
 */

import fs from "fs/promises";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import "dotenv/config";

const BUCKET = "uploads";
const LOCAL_DIR = "./uploads";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
const DIRECT_URL = process.env.DIRECT_URL;

if (!SUPABASE_URL || !SUPABASE_KEY || !DIRECT_URL) {
  console.error("Missing SUPABASE_URL / SUPABASE_SECRET_KEY / DIRECT_URL in .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});
const sql = postgres(DIRECT_URL, { max: 1, onnotice: () => {} });

async function ensureBucket() {
  console.log(`[1/3] Ensuring bucket "${BUCKET}" exists...`);
  const { data: existing } = await supabase.storage.listBuckets();
  const found = existing?.find((b) => b.name === BUCKET);
  if (found) {
    console.log(`  Bucket already exists (public: ${found.public})`);
    if (!found.public) {
      console.log(`  Updating to public...`);
      const { error } = await supabase.storage.updateBucket(BUCKET, { public: true });
      if (error) throw error;
    }
    return;
  }
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: 5 * 1024 * 1024, // 5MB
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  });
  if (error) throw error;
  console.log(`  Created public bucket "${BUCKET}"`);
}

async function uploadLocalImages() {
  console.log(`[2/3] Uploading images from ${LOCAL_DIR} → ${BUCKET}/...`);
  const files = await fs.readdir(LOCAL_DIR);
  const images = files.filter((f) => /\.(jpe?g|png|webp|gif)$/i.test(f));
  let uploaded = 0, skipped = 0;

  for (const filename of images) {
    const localPath = path.join(LOCAL_DIR, filename);
    const buffer = await fs.readFile(localPath);
    const contentType = `image/${filename.match(/\.([a-z]+)$/i)[1].toLowerCase().replace("jpg", "jpeg")}`;

    // Check if already exists
    const { data: existing } = await supabase.storage.from(BUCKET).list("", { search: filename });
    if (existing?.some((f) => f.name === filename)) {
      skipped++;
      continue;
    }

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(filename, buffer, { contentType, upsert: false });
    if (error) {
      console.log(`  FAIL ${filename}: ${error.message}`);
      continue;
    }
    uploaded++;
  }
  console.log(`  Uploaded ${uploaded}, skipped ${skipped} (already in bucket)`);

  // Verify
  const { data: inBucket } = await supabase.storage.from(BUCKET).list();
  console.log(`  Total in bucket: ${inBucket?.length || 0}`);
}

async function updateProductImageUrls() {
  console.log(`[3/3] Re-pointing product image URLs to Supabase Storage...`);
  const products = await sql`
    SELECT id, name, image FROM products WHERE image LIKE '/uploads/%'
  `;

  let updated = 0;
  for (const p of products) {
    // /uploads/p1.jpg → https://...supabase.co/storage/v1/object/public/uploads/p1.jpg
    const filename = p.image.replace(/^\/uploads\//, "");
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(filename);
    const newUrl = urlData.publicUrl;

    await sql`UPDATE products SET image = ${newUrl} WHERE id = ${p.id}`;
    updated++;
  }
  console.log(`  Updated ${updated} products to point at Supabase Storage URLs`);

  // Verify
  const sample = await sql`
    SELECT name, image FROM products WHERE image LIKE '%supabase%' LIMIT 3
  `;
  console.log(`  Sample updated URLs:`);
  sample.forEach((p) => console.log(`    ${p.name}: ${p.image.slice(0, 80)}…`));

  // Stats
  const stats = await sql`
    SELECT
      COUNT(*) FILTER (WHERE image LIKE '%supabase%') AS supabase,
      COUNT(*) FILTER (WHERE image LIKE '/uploads/%') AS local
    FROM products
  `;
  console.log(`  Final: ${stats[0].supabase} supabase URLs, ${stats[0].local} still local`);
}

async function main() {
  try {
    await ensureBucket();
    await uploadLocalImages();
    await updateProductImageUrls();
    console.log("\n✓ Supabase Storage setup complete");
  } catch (e) {
    console.error("Setup failed:", e);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
