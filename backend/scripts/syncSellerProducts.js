import mongoose from "mongoose";
import Seller from "../models/sellerModel.js";
import Product from "../models/productModel.js";
import dotenv from "dotenv";

dotenv.config();

const syncSellerProducts = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URL);
        console.log("Connected to MongoDB");

        // Get all sellers
        const sellers = await Seller.find({});
        console.log(`Found ${sellers.length} sellers to sync`);

        let updatedSellers = 0;
        let totalProductsAdded = 0;

        for (const seller of sellers) {
            // Find all products that belong to this seller
            const sellerProducts = await Product.find({ seller: seller._id });

            // Get the product IDs
            const productIds = sellerProducts.map(product => product._id);

            // Update the seller's products array
            await Seller.findByIdAndUpdate(
                seller._id,
                { $set: { products: productIds } },
                { new: true }
            );

            console.log(`Seller: ${seller.name} (${seller.storeName}) - Added ${productIds.length} products`);

            if (productIds.length > 0) {
                updatedSellers++;
                totalProductsAdded += productIds.length;
            }
        }

        console.log("\n=== Sync Results ===");
        console.log(`Total sellers: ${sellers.length}`);
        console.log(`Sellers with products: ${updatedSellers}`);
        console.log(`Total products synced: ${totalProductsAdded}`);

        // Verification: Show some examples
        console.log("\n=== Verification (First 5 sellers with products) ===");
        const verificationSellers = await Seller.find({ products: { $not: { $size: 0 } } })
            .limit(5)
            .populate('products', 'name price');

        verificationSellers.forEach(seller => {
            console.log(`${seller.name} (${seller.storeName}): ${seller.products.length} products`);
            seller.products.forEach(product => {
                console.log(`  - ${product.name} ($${product.price})`);
            });
        });

    } catch (error) {
        console.error("Error syncing seller products:", error);
    } finally {
        await mongoose.disconnect();
        console.log("\nDisconnected from MongoDB");
    }
};

syncSellerProducts();
