import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import Seller from "../models/sellerModel.js";
import Product from "../models/productModel.js";
import path from "path";

dotenv.config({ path: path.resolve('./.env') });

async function syncProductsToSellers() {
    try {
        await mongoose.connect(process.env.MONGODB_URL, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });

        console.log("✅ Connected to MongoDB");

        const sellers = await Seller.find();

        for (const seller of sellers) {
            for (const productId of seller.products) {
                await Product.updateOne(
                    { _id: productId },
                    { $set: { seller: seller._id } }
                );
            }
        }

        console.log("✅ Synced seller references in products.");
        await mongoose.disconnect();
    } catch (err) {
        console.error("❌ Error syncing sellers to products:", err.message);
        process.exit(1);
    }
}

syncProductsToSellers();
