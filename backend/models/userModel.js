import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    isAdmin: { type: Boolean, default: false, required: true },
    isSeller: { type: Boolean, default: false, required: true },
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Seller",
      required: false, // Only present for users with isSeller: true
    },
  },
  {
    timestamps: true,
  }
);

//sync Seller document with User updates
userSchema.post("save", async function (doc) {
  if (doc.isSeller && !doc.seller) {
    // Create Seller document if user is a seller and no Seller document exists
    const seller = await mongoose.model("Seller").create({
      user: doc._id,
      name: doc.name,
      storeName: `${doc.name}'s Store`,
      products: [],
      rating: 0,
      numReviews: 0,
    });
    await mongoose.model("User").updateOne(
      { _id: doc._id },
      { $set: { seller: seller._id } }
    );
  } else if (!doc.isSeller && doc.seller) {
    // Remove Seller document if user is no longer a seller
    await mongoose.model("Seller").deleteOne({ _id: doc.seller });
    await mongoose.model("User").updateOne(
      { _id: doc._id },
      { $unset: { seller: "" } }
    );
  }
});

// sync Seller name when User name changes
userSchema.pre("save", async function (next) {
  if (this.isModified("name") && this.seller) {
    await mongoose.model("Seller").updateOne(
      { _id: this.seller },
      { $set: { name: this.name, storeName: `${this.name}'s Store` } }
    );
  }
  next();
});

const User = mongoose.model("User", userSchema);
export default User;