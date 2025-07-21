import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import User from "../models/userModel.js";
import path from "path";

dotenv.config({ path: path.resolve('./.env') });

async function resetIsSellerForUsers() {
    try {
        await mongoose.connect(process.env.MONGODB_URL, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });

        console.log("✅ Connected to MongoDB");

        // Set isSeller to false for all users except admins
        const result = await User.updateMany(
            { isAdmin: { $ne: true } },
            { $set: { isSeller: false, seller: null } }
        );

        console.log(`✅ Updated ${result.nModified || result.modifiedCount} users to isSeller: false`);
        await mongoose.disconnect();
    } catch (err) {
        console.error("❌ Error updating users:", err.message);
        process.exit(1);
    }
}

resetIsSellerForUsers();
