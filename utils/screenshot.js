const cloudinary = require("../config/cloudinary");
const DebugLog = require("../models/DebugLog");
const { addLog } = require("./logger");

async function uploadScreenshotAndLog(account, buffer, type, message) {
  if (!buffer) return null;
  try {
    const cloudinaryUrl = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: "goodwallet/debug",
          public_id: `${account.name.replace(/\s+/g, "-")}-${type}-${Date.now()}`,
          resource_type: "image",
        },
        (error, result) => (error ? reject(error) : resolve(result.secure_url)),
      );

      require("streamifier").createReadStream(buffer).pipe(uploadStream);
    });

    addLog(`📤 ${type} screenshot uploaded`);

    await DebugLog.create({
      accountName: account.name,
      errorType: type,
      screenshotUrl: cloudinaryUrl,
      message: message,
      timestamp: new Date(),
    });

    return cloudinaryUrl;
  } catch (e) {
    addLog(`❌ Upload failed: ${e.message}`);
    return null;
  }
}

module.exports = { uploadScreenshotAndLog };
