import express from "express";
import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import data from "../data.js";
import Product from "../models/productModel.js";
import { isAdmin, isAuth } from "../utils.js";

const productRouter = express.Router();

productRouter.get(
  "/",
  expressAsyncHandler(async (req, res) => {
    const name = req.query.name || "";
    const category = req.query.category || "";
    const order = req.query.order || "";
    const min =
      req.query.min && Number(req.query.min) !== 0 ? Number(req.query.min) : 0;
    const max =
      req.query.max && Number(req.query.max) !== 0 ? Number(req.query.max) : 0;
    const rating =
      req.query.rating && Number(req.query.rating) !== 0
        ? Number(req.query.rating)
        : 0;

    const nameFilter = name ? { name: { $regex: name, $options: "i" } } : {};
    const categoryFilter = category ? { category } : {};
    const priceFilter = min && max ? { price: { $gte: min, $lte: max } } : {};
    const ratingFilter = rating ? { rating: { $gte: rating } } : {};
    const sortOrder =
      order === "lowest"
        ? { price: 1 }
        : order === "highest"
          ? { price: -1 }
          : order === "toprated"
            ? { rating: -1 }
            : { _id: 1 };

    // Use aggregation to filter products by active stores
    const products = await Product.aggregate([
      {
        $lookup: {
          from: "sellers",
          localField: "seller",
          foreignField: "_id",
          as: "sellerInfo"
        }
      },
      {
        $match: {
          $and: [
            nameFilter,
            categoryFilter,
            priceFilter,
            ratingFilter,
            { isActive: true }, // Product must be active
            { "sellerInfo.isActiveStore": true } // Store must be active
          ]
        }
      },
      {
        $project: {
          sellerInfo: 0 // Remove seller info from response to keep original structure
        }
      },
      {
        $sort: sortOrder
      }
    ]);

    res.send(products);
  })
);

productRouter.get(
  "/categories",
  expressAsyncHandler(async (req, res) => {
    // Get categories only from active products in active stores
    const categories = await Product.aggregate([
      {
        $lookup: {
          from: "sellers",
          localField: "seller",
          foreignField: "_id",
          as: "sellerInfo"
        }
      },
      {
        $match: {
          $and: [
            { isActive: true }, // Product must be active
            { "sellerInfo.isActiveStore": true } // Store must be active
          ]
        }
      },
      {
        $group: {
          _id: "$category"
        }
      },
      {
        $project: {
          _id: 1
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    const categoryList = categories.map(cat => cat._id);
    res.send(categoryList);
  })
);

productRouter.get(
  "/seed",
  expressAsyncHandler(async (req, res) => {
    const createdProducts = await Product.insertMany(data.products);
    res.send({ createdProducts });
  })
);

productRouter.get(
  "/:id",
  expressAsyncHandler(async (req, res) => {
    // Use aggregation to check if product exists and store is active
    const productResult = await Product.aggregate([
      {
        $match: { _id: new mongoose.Types.ObjectId(req.params.id) }
      },
      {
        $lookup: {
          from: "sellers",
          localField: "seller",
          foreignField: "_id",
          as: "sellerInfo"
        }
      },
      {
        $match: {
          $and: [
            { isActive: true }, // Product must be active
            { "sellerInfo.isActiveStore": true } // Store must be active
          ]
        }
      },
      {
        $project: {
          sellerInfo: 0 // Remove seller info from response
        }
      }
    ]);

    if (productResult.length > 0) {
      res.send(productResult[0]);
    } else {
      res.status(404).send({ message: "Product Not Found or Store Inactive" });
    }
  })
);

productRouter.put(
  "/:id",
  isAuth,
  isAdmin,
  expressAsyncHandler(async (req, res) => {
    const productId = req.params.id;
    const product = await Product.findById(productId);
    if (product) {
      product.name = req.body.name;
      product.price = req.body.price;
      product.image = req.body.image;
      product.category = req.body.category;
      product.brand = req.body.brand;
      product.countInStock = req.body.countInStock;
      product.description = req.body.description;
      const updatedProduct = await product.save();
      res.send({ message: "Product Updated", product: updatedProduct });
    } else {
      res.status(404).send({ message: "Product Not Found" });
    }
  })
);

productRouter.delete(
  "/:id",
  isAuth,
  isAdmin,
  expressAsyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id);
    if (product) {
      const deleteProduct = await product.remove();
      res.send({
        message: "Product Successfully Deleted",
        product: deleteProduct,
      });
    } else {
      res.status(404).send({ message: "Product Not Found" });
    }
  })
);

export const uploadAndRemoveBg = async (req, res) => {
  try {
    const file = req.file;

    const formData = new FormData();
    formData.append("image_file", fs.createReadStream(file.path));
    formData.append("size", "auto");

    const response = await axios.post("https://api.remove.bg/v1.0/removebg", formData, {
      headers: {
        ...formData.getHeaders(),
        "X-Api-Key": REMOVE_BG_API_KEY,
      },
      responseType: "arraybuffer",
    });

    // Save image to public directory
    const outputPath = path.join("public", "uploads", `removed-${file.filename}`);
    fs.writeFileSync(outputPath, response.data);

    // Delete original
    fs.unlinkSync(file.path);

    res.json({ imageUrl: `/uploads/removed-${file.filename}` });
  } catch (error) {
    console.error(error?.response?.data || error);
    res.status(500).json({ message: "Failed to remove background" });
  }
};


// create product 1 (as admin)
productRouter.post(
  "/",
  isAuth,
  isAdmin,
  expressAsyncHandler(async (req, res) => {
    const product = new Product({
      name: "New Product" + Date.now(),
      image: "/images/sample.jpg",
      price: 0,
      category: "Category",
      brand: "Brand",
      countInStock: 0,
      rating: 0,
      numReviews: 0,
      description: "Product description",
    });
    const createdProduct = await product.save();
    res.send({ message: "New Product Created", product: createdProduct });
  })
);

// product router for  reviews
productRouter.post(
  "/:id/reviews",
  isAuth,
  expressAsyncHandler(async (req, res) => {
    const productId = req.params.id;
    const product = await Product.findById(productId);
    if (product) {
      if (product.reviews.find((x) => x.name === req.user.name)) {
        return res
          .status(400)
          .send({ message: "You already submitted a review" });
      }
      const review = {
        name: req.user.name,
        rating: Number(req.body.rating),
        comment: req.body.comment,
      };
      product.reviews.push(review);
      product.numReviews = product.reviews.length;
      product.rating =
        product.reviews.reduce((a, c) => c.rating + a, 0) /
        product.reviews.length;
      const updatedProduct = await product.save();
      res.status(201).send({
        message: "Review Created",
        review: updatedProduct.reviews[updatedProduct.reviews.length - 1],
      });
    } else {
      res.status(404).send({ message: "Product Not Found" });
    }
  })
);

export default productRouter;
