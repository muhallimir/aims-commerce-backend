import express from "express";
import asyncHandler from "express-async-handler";
import User from "../models/userModel.js";
import { isAuth, generateToken } from "../utils.js";

const becomeSellerRouter = express.Router();

// POST /become — Customer becomes a seller (alternative endpoint)
becomeSellerRouter.post(
    "/",
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

            // Update user to become seller
            user.isSeller = true;
            user.name = name;
            user.storeName = storeName || `${name}'s Store`;
            await user.save();

            // Wait a moment for the post-save hook to complete
            await new Promise(resolve => setTimeout(resolve, 200));

            // Generate new token with isSeller: true
            const token = generateToken(user);

            // Get updated user with populated seller
            const updatedUser = await User.findById(user._id).populate('seller');

            res.status(201).json({
                message: "Successfully became a seller",
                user: {
                    _id: updatedUser._id,
                    name: updatedUser.name,
                    email: updatedUser.email,
                    phone: updatedUser.phone,
                    address: updatedUser.address,
                    city: updatedUser.city,
                    country: updatedUser.country,
                    isSeller: updatedUser.isSeller,
                    storeName: updatedUser.storeName,
                    createdAt: updatedUser.createdAt,
                    updatedAt: updatedUser.updatedAt,
                },
                seller: {
                    _id: updatedUser.seller._id,
                    name: updatedUser.seller.name,
                    storeName: updatedUser.seller.storeName,
                    storeDescription: updatedUser.seller.storeDescription,
                    isActiveStore: updatedUser.seller.isActiveStore ?? false,
                    createdAt: updatedUser.seller.createdAt,
                    updatedAt: updatedUser.seller.updatedAt,
                },
                token
            });
        } catch (err) {
            console.error("Error in become seller:", err);
            res.status(500).json({
                message: "Internal server error",
                error: err.message
            });
        }
    })
);

export default becomeSellerRouter;