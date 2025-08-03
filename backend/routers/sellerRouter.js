import express from "express";
import asyncHandler from "express-async-handler";
import Seller from "../models/sellerModel.js";
import Product from "../models/productModel.js";
import Order from "../models/orderModel.js";
import User from "../models/userModel.js";
import { isAuth, isSeller, generateToken } from "../utils.js";

const sellerRouter = express.Router();

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

            // Update user to become seller
            user.isSeller = true;
            user.name = name;
            user.storeName = storeName || `${name}'s Store`;
            await user.save();

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
                    isSeller: updatedUser.isSeller,
                    storeName: updatedUser.storeName,
                    createdAt: updatedUser.createdAt,
                    updatedAt: updatedUser.updatedAt,
                },
                token
            });
        } catch (err) {
            console.error("Error in /api/sellers/become:", err);
            res.status(500).json({
                message: "Internal server error",
                error: err.message
            });
        }
    })
);

// GET /api/sellers/analytics — Get seller analytics
sellerRouter.get(
    "/analytics",
    isAuth,
    isSeller,
    asyncHandler(async (req, res) => {
        try {
            const user = await User.findById(req.user._id).populate('seller');
            if (!user || !user.seller) {
                return res.status(404).json({ message: "Seller not found" });
            }

            const sellerId = user.seller._id;

            // Get total revenue from paid orders
            const revenueResult = await Order.aggregate([
                { $unwind: "$orderItems" },
                {
                    $match: {
                        "orderItems.seller": sellerId,
                        "isPaid": true
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalRevenue: { $sum: { $multiply: ["$orderItems.price", "$orderItems.qty"] } }
                    }
                }
            ]);

            // Get total orders count
            const totalOrders = await Order.countDocuments({
                "orderItems.seller": sellerId,
                "isPaid": true
            });

            // Get total products count
            const totalProducts = await Product.countDocuments({
                seller: sellerId
            });

            // Get monthly revenue (last 12 months)
            const monthlyRevenueResult = await Order.aggregate([
                { $unwind: "$orderItems" },
                {
                    $match: {
                        "orderItems.seller": sellerId,
                        "isPaid": true,
                        "paidAt": { $gte: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) }
                    }
                },
                {
                    $group: {
                        _id: {
                            year: { $year: "$paidAt" },
                            month: { $month: "$paidAt" }
                        },
                        sales: { $sum: { $multiply: ["$orderItems.price", "$orderItems.qty"] } }
                    }
                },
                { $sort: { "_id.year": 1, "_id.month": 1 } }
            ]);

            // Format monthly revenue data
            const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            const monthlyRevenue = monthlyRevenueResult.map(item => ({
                name: monthNames[item._id.month - 1],
                sales: item.sales
            }));

            res.json({
                totalRevenue: revenueResult.length > 0 ? revenueResult[0].totalRevenue : 0,
                totalOrders,
                totalProducts,
                monthlyRevenue
            });
        } catch (err) {
            console.error("Error in /api/sellers/analytics:", err);
            res.status(500).json({
                message: "Internal server error",
                error: err.message
            });
        }
    })
);

// GET /api/sellers/products — Get seller's products
sellerRouter.get(
    "/products",
    isAuth,
    isSeller,
    asyncHandler(async (req, res) => {
        try {
            const user = await User.findById(req.user._id).populate('seller');
            if (!user || !user.seller) {
                return res.status(404).json({ message: "Seller not found" });
            }

            const products = await Product.find({ seller: user.seller._id });
            res.json(products);
        } catch (err) {
            console.error("Error in /api/sellers/products:", err);
            res.status(500).json({
                message: "Internal server error",
                error: err.message
            });
        }
    })
);

// POST /api/sellers/products — Create new product
sellerRouter.post(
    "/products",
    isAuth,
    isSeller,
    asyncHandler(async (req, res) => {
        try {
            const { name, price, category, brand, countInStock, description, image } = req.body;

            // Validate required fields
            if (!name || !price || !category || !brand || countInStock === undefined || !description) {
                return res.status(400).json({
                    message: "Missing required fields: name, price, category, brand, countInStock, description"
                });
            }

            const user = await User.findById(req.user._id).populate('seller');
            if (!user || !user.seller) {
                return res.status(404).json({ message: "Seller not found" });
            }

            const product = new Product({
                name,
                price,
                category,
                brand,
                countInStock,
                description,
                image: image || '/images/default-product.jpg',
                seller: user.seller._id,
                isActive: true,
                rating: 0,
                numReviews: 0,
                reviews: []
            });

            const savedProduct = await product.save();

            res.status(201).json({
                message: "Product created successfully",
                product: savedProduct
            });
        } catch (err) {
            console.error("Error in /api/sellers/products POST:", err);
            if (err.name === 'ValidationError') {
                res.status(400).json({
                    message: "Validation error",
                    error: err.message
                });
            } else if (err.code === 11000) {
                res.status(400).json({
                    message: "Product name already exists",
                    error: "Duplicate product name"
                });
            } else {
                res.status(500).json({
                    message: "Internal server error",
                    error: err.message
                });
            }
        }
    })
);

// PUT /api/sellers/products/:productId — Update product
sellerRouter.put(
    "/products/:productId",
    isAuth,
    isSeller,
    asyncHandler(async (req, res) => {
        try {
            const { name, price, category, brand, countInStock, description, image, isActive } = req.body;

            const user = await User.findById(req.user._id).populate('seller');
            if (!user || !user.seller) {
                return res.status(404).json({ message: "Seller not found" });
            }

            const product = await Product.findOne({
                _id: req.params.productId,
                seller: user.seller._id
            });

            if (!product) {
                return res.status(404).json({ message: "Product not found" });
            }

            // Update fields if provided
            if (name !== undefined) product.name = name;
            if (price !== undefined) product.price = price;
            if (category !== undefined) product.category = category;
            if (brand !== undefined) product.brand = brand;
            if (countInStock !== undefined) product.countInStock = countInStock;
            if (description !== undefined) product.description = description;
            if (image !== undefined) product.image = image;
            if (isActive !== undefined) product.isActive = isActive;

            const updatedProduct = await product.save();

            res.json({
                message: "Product updated successfully",
                product: updatedProduct
            });
        } catch (err) {
            console.error("Error in /api/sellers/products PUT:", err);
            if (err.name === 'ValidationError') {
                res.status(400).json({
                    message: "Validation error",
                    error: err.message
                });
            } else if (err.code === 11000) {
                res.status(400).json({
                    message: "Product name already exists",
                    error: "Duplicate product name"
                });
            } else {
                res.status(500).json({
                    message: "Internal server error",
                    error: err.message
                });
            }
        }
    })
);

// DELETE /api/sellers/products/:productId — Delete product
sellerRouter.delete(
    "/products/:productId",
    isAuth,
    isSeller,
    asyncHandler(async (req, res) => {
        try {
            const user = await User.findById(req.user._id).populate('seller');
            if (!user || !user.seller) {
                return res.status(404).json({ message: "Seller not found" });
            }

            const product = await Product.findOne({
                _id: req.params.productId,
                seller: user.seller._id
            });

            if (!product) {
                return res.status(404).json({ message: "Product not found" });
            }

            await Product.deleteOne({ _id: req.params.productId });

            res.json({ message: "Product deleted successfully" });
        } catch (err) {
            console.error("Error in /api/sellers/products DELETE:", err);
            res.status(500).json({
                message: "Internal server error",
                error: err.message
            });
        }
    })
);

// GET /api/sellers/orders — Get seller's orders
sellerRouter.get(
    "/orders",
    isAuth,
    isSeller,
    asyncHandler(async (req, res) => {
        try {
            const user = await User.findById(req.user._id).populate('seller');
            if (!user || !user.seller) {
                return res.status(404).json({ message: "Seller not found" });
            }

            const orders = await Order.find({
                "orderItems.seller": user.seller._id
            }).populate('user', 'name email').sort({ createdAt: -1 });

            // Filter and format order items for this seller only
            const formattedOrders = orders.map(order => {
                const sellerOrderItems = order.orderItems.filter(
                    item => item.seller && item.seller.toString() === user.seller._id.toString()
                );

                return {
                    _id: order._id,
                    createdAt: order.createdAt,
                    user: {
                        name: order.user.name,
                        email: order.user.email
                    },
                    shippingAddress: {
                        fullName: order.shippingAddress.fullName,
                        contactNo: order.shippingAddress.contact,
                        address: order.shippingAddress.address,
                        city: order.shippingAddress.city,
                        postalCode: order.shippingAddress.postalCode,
                        country: order.shippingAddress.country
                    },
                    orderItems: sellerOrderItems.map(item => ({
                        name: item.name,
                        quantity: item.qty,
                        price: item.price,
                        image: item.image,
                        productId: item.product
                    })),
                    totalPrice: sellerOrderItems.reduce((sum, item) => sum + (item.price * item.qty), 0),
                    isPaid: order.isPaid,
                    isDelivered: order.isDelivered,
                    paidAt: order.paidAt,
                    deliveredAt: order.deliveredAt
                };
            });

            res.json(formattedOrders);
        } catch (err) {
            console.error("Error in /api/sellers/orders:", err);
            res.status(500).json({
                message: "Internal server error",
                error: err.message
            });
        }
    })
);

// PUT /api/sellers/orders/:orderId/status — Update order status
sellerRouter.put(
    "/orders/:orderId/status",
    isAuth,
    isSeller,
    asyncHandler(async (req, res) => {
        try {
            const { status, isDelivered, deliveredAt } = req.body;

            const user = await User.findById(req.user._id).populate('seller');
            if (!user || !user.seller) {
                return res.status(404).json({ message: "Seller not found" });
            }

            const order = await Order.findOne({
                _id: req.params.orderId,
                "orderItems.seller": user.seller._id
            });

            if (!order) {
                return res.status(404).json({ message: "Order not found" });
            }

            // Update order status
            if (isDelivered !== undefined) {
                order.isDelivered = isDelivered;
            }
            if (deliveredAt !== undefined) {
                order.deliveredAt = deliveredAt;
            } else if (isDelivered === true) {
                order.deliveredAt = new Date();
            }

            const updatedOrder = await order.save();

            res.json({
                message: "Order status updated successfully",
                order: {
                    _id: updatedOrder._id,
                    isDelivered: updatedOrder.isDelivered,
                    deliveredAt: updatedOrder.deliveredAt,
                    updatedAt: updatedOrder.updatedAt
                }
            });
        } catch (err) {
            console.error("Error in /api/sellers/orders PUT:", err);
            res.status(500).json({
                message: "Internal server error",
                error: err.message
            });
        }
    })
);

// GET /api/sellers/:sellerId — Get seller info
sellerRouter.get(
    "/:sellerId",
    isAuth,
    asyncHandler(async (req, res) => {
        try {
            const seller = await Seller.findById(req.params.sellerId).populate("user", "name email");

            if (!seller) {
                return res.status(404).json({ message: "Seller not found" });
            }

            // Get user data for additional fields
            const userData = await User.findById(seller.user._id);

            res.json({
                _id: seller._id,
                name: seller.name,
                email: seller.user.email,
                isSeller: true,
                storeName: seller.storeName,
                storeDescription: seller.storeDescription,
                profileImage: seller.profileImage,
                createdAt: seller.createdAt,
                updatedAt: seller.updatedAt
            });
        } catch (err) {
            console.error("Error in /api/sellers/:sellerId:", err);
            res.status(500).json({
                message: "Internal server error",
                error: err.message
            });
        }
    })
);

export default sellerRouter;