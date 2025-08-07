import mongoose from "mongoose";

const sellerSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            unique: true,
        },
        name: { type: String, required: true },
        products: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
        storeName: { type: String },
        storeDescription: { type: String },
        profileImage: { type: String },
        isActiveStore: { type: Boolean, default: false },
        rating: { type: Number, default: 0 },
        numReviews: { type: Number, default: 0 },
    },
    {
        timestamps: true,
    }
);

const Seller = mongoose.model("Seller", sellerSchema);

export default Seller;