import { MongoClient } from 'mongodb';
import fs from 'fs/promises';
import 'dotenv/config';

const url = process.env.MONGODB_URL;
const client = new MongoClient(url, { serverSelectionTimeoutMS: 10000 });

try {
  await client.connect();
  const db = client.db('astech');
  const collections = ['users', 'sellers', 'products', 'orders', 'formdatas', 'forms'];
  const outDir = './mongo-dump';
  await fs.mkdir(outDir, { recursive: true });

  for (const name of collections) {
    const docs = await db.collection(name).find({}).toArray();
    const path = `${outDir}/${name}.json`;
    await fs.writeFile(path, JSON.stringify(docs, null, 2));
    console.log(`  ${name}: ${docs.length} docs → ${path}`);
  }

  // Print a sample of each so we know what's inside
  console.log('\n--- sample products (first 2) ---');
  const products = JSON.parse(await fs.readFile(`${outDir}/products.json`, 'utf8'));
  products.slice(0, 2).forEach(p => {
    console.log(JSON.stringify({
      _id: p._id,
      name: p.name,
      category: p.category,
      brand: p.brand,
      price: p.price,
      countInStock: p.countInStock,
      rating: p.rating,
      numReviews: p.numReviews,
      image: p.image,
      seller: p.seller,
      hasDescription: !!p.description,
      descLen: p.description?.length,
    }, null, 2));
  });

  console.log('\n--- sample users (first 2) ---');
  const users = JSON.parse(await fs.readFile(`${outDir}/users.json`, 'utf8'));
  users.slice(0, 2).forEach(u => {
    console.log(JSON.stringify({
      _id: u._id,
      name: u.name,
      email: u.email,
      isAdmin: u.isAdmin,
      isSeller: u.isSeller,
      seller: u.seller,
      hasPassword: !!u.password,
    }, null, 2));
  });

  console.log('\n--- sample sellers (first 2) ---');
  const sellers = JSON.parse(await fs.readFile(`${outDir}/sellers.json`, 'utf8'));
  sellers.slice(0, 2).forEach(s => {
    console.log(JSON.stringify({
      _id: s._id,
      name: s.name,
      storeName: s.storeName,
      user: s.user,
      isActiveStore: s.isActiveStore,
      rating: s.rating,
      numReviews: s.numReviews,
    }, null, 2));
  });

  console.log('\n--- sample orders (first 1) ---');
  const orders = JSON.parse(await fs.readFile(`${outDir}/orders.json`, 'utf8'));
  if (orders[0]) {
    console.log(JSON.stringify({
      _id: orders[0]._id,
      user: orders[0].user,
      paymentMethod: orders[0].paymentMethod,
      itemsPrice: orders[0].itemsPrice,
      totalPrice: orders[0].totalPrice,
      isPaid: orders[0].isPaid,
      isDelivered: orders[0].isDelivered,
      shippingFullName: orders[0].shippingAddress?.fullName,
      orderItemsCount: orders[0].orderItems?.length,
    }, null, 2));
  }

  // Stats
  console.log('\n--- stats ---');
  const adminCount = users.filter(u => u.isAdmin).length;
  const sellerCount = users.filter(u => u.isSeller).length;
  const activeStores = sellers.filter(s => s.isActiveStore).length;
  const ratedProducts = products.filter(p => p.rating > 0).length;
  const paidOrders = orders.filter(o => o.isPaid).length;
  const deliveredOrders = orders.filter(o => o.isDelivered).length;
  console.log(JSON.stringify({
    users: { total: users.length, admin: adminCount, seller: sellerCount },
    sellers: { total: sellers.length, active: activeStores },
    products: { total: products.length, withRating: ratedProducts, zeroRating: products.length - ratedProducts },
    orders: { total: orders.length, paid: paidOrders, delivered: deliveredOrders },
  }, null, 2));
} finally {
  await client.close();
}
