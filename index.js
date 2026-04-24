const express = require("express");
const dotenv = require("dotenv");

dotenv.config();

// Config
const cloudinary = require("./config/cloudinary");
const { connectDB } = require("./config/db");

// Setup Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Connect to MongoDB
connectDB();

// Express App
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Routes
app.use("/", require("./routes/index"));

// Start Server
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📌 Use: /run/:index for cron-job.org (with email)`);
});
