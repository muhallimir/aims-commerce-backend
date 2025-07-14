import express from "express";
import asyncHandler from "express-async-handler";
import Seller from "../models/sellerModel.js";
import Product from "../models/productModel.js";

const sellerRouter = express.Router();

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
