const mongoose = require("mongoose");

async function connectDB() {
  await mongoose
    .connect(process.env.MONGODB_URI)
    .then(() => console.log("✅ Connected to MongoDB"))
    .catch((err) => console.error("❌ MongoDB error:", err));
}

module.exports = { connectDB };
