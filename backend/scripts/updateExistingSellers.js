import mongoose from "mongoose";
import Seller from "../models/sellerModel.js";
import dotenv from "dotenv";

dotenv.config();

const updateExistingSellers = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URL);
        console.log("Connected to MongoDB");

        const result = await Seller.updateMany(
            { isActiveStore: { $exists: false } },
            { $set: { isActiveStore: false } }
        );

        console.log(`Updated ${result.modifiedCount} sellers with isActiveStore: false`);

        const sellersCount = await Seller.countDocuments();
        const activeSellers = await Seller.countDocuments({ isActiveStore: true });
        const inactiveSellers = await Seller.countDocuments({ isActiveStore: false });

        console.log(`Total sellers: ${sellersCount}`);
        console.log(`Active stores: ${activeSellers}`);
        console.log(`Inactive stores: ${inactiveSellers}`);

    } catch (error) {
        console.error("Error updating sellers:", error);
    } finally {
        await mongoose.disconnect();
        console.log("Disconnected from MongoDB");
    }
};

updateExistingSellers();
