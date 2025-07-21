import express from "express";
import asyncHandler from "express-async-handler";
import Seller from "../models/sellerModel.js";
import Product from "../models/productModel.js";

const sellerRouter = express.Router();

import User from "../models/userModel.js";
import { isAuth } from "../utils.js";

// POST /api/sellers/become — Customer becomes a seller
sellerRouter.post(
    "/become",
    isAuth,
    asyncHandler(async (req, res) => {
        try {
            const { name, storeName } = req.body;
            if (!name) {
                return res.status(400).json({ message: "Name is required" });
            }
            // Get user from token
            const user = await User.findById(req.user._id);
            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }
            if (user.isSeller) {
                return res.status(400).json({ message: "User is already a seller" });
            }
            // Only update user, let post-save hook create Seller
            user.isSeller = true;
            user.name = name; // Optionally sync name
            await user.save();
            // Wait for post-save hook to create Seller
            const updatedUser = await User.findById(user._id).populate('seller');
            res.status(201).json({
                message: "Seller profile created",
                sellerId: updatedUser.seller?._id,
            });
        } catch (err) {
            console.error("Error in /api/sellers/become:", err);
            res.status(500).json({ message: "Internal server error", error: err.message });
        }
    })
);

// GET /api/sellers/:id — Get seller info and their products
sellerRouter.get(
    "/:id",
    asyncHandler(async (req, res) => {
        const seller = await Seller.findById(req.params.id).populate("user", "name email");

        if (!seller) {
            res.status(404).json({ message: "Seller not found" });
            return;
        }

        const products = await Product.find({ seller: seller._id });

        res.send({
            _id: seller._id,
            user: seller.user,
            name: seller.name,
            storeName: seller.storeName,
            rating: seller.rating,
            numReviews: seller.numReviews,
            createdAt: seller.createdAt,
            updatedAt: seller.updatedAt,
            products,
        });
    })
);

export default sellerRouter;