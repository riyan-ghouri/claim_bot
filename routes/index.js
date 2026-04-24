const express = require("express");
const path = require("path");
const router = express.Router();

const cloudinary = require("../config/cloudinary");
const DebugLog = require("../models/DebugLog");
const AccountSession = require("../models/AccountSession");
const { getLogs, getLastRunTime, addLog } = require("../utils/logger");
const { runAccountByIndex, getIsRunning } = require("../services/claimService");

// ====================== DASHBOARD ======================
router.get("/", (req, res) =>
  res.sendFile(path.join(__dirname, "../views", "dashboard.html")),
);

// ====================== LOGS ======================
router.get("/logs", (req, res) => {
  const logs = getLogs();
  res.send(logs.join("\n") || "No logs yet.");
});

// ====================== STATUS ======================
router.get("/status", async (req, res) => {
  const total = await AccountSession.countDocuments().catch(() => 0);
  res.json({ isRunning: getIsRunning(), lastRunTime: getLastRunTime(), totalAccounts: total });
});

// ====================== GALLERY ======================
router.get("/gallery", async (req, res) => {
  try {
    const data = await DebugLog.find().sort({ timestamp: -1 }).limit(30);
    res.json(data);
  } catch (e) {
    res.json([]);
  }
});

// ====================== RUN VIA CRON (with email) ======================
router.get("/run/:index", async (req, res) => {
  const index = req.params.index;
  if (!index) return res.status(400).send("Index required");

  res.send(
    `<h2>✅ Cron trigger received for index ${index}</h2><p>Email report will be sent after completion.</p><a href="/">← Back</a>`,
  );

  runAccountByIndex(index, true); // true = isCronTrigger → send email
});

// ====================== DELETE SINGLE IMAGE ======================
router.delete("/delete-image/:id", async (req, res) => {
  try {
    const debugLog = await DebugLog.findById(req.params.id);
    if (!debugLog) return res.status(404).send("Image not found");

    if (debugLog.screenshotUrl) {
      try {
        const filename = debugLog.screenshotUrl.split("/").pop();
        const publicId = `goodwallet/debug/${filename.split(".")[0]}`;
        await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
        console.log(`✅ Deleted from Cloudinary: ${publicId}`);
      } catch (cloudErr) {
        console.error("Cloudinary delete warning:", cloudErr.message);
      }
    }

    await DebugLog.findByIdAndDelete(req.params.id);
    res.sendStatus(200);
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).send("Server error while deleting image");
  }
});

// ====================== CLEAR ALL SCREENSHOTS ======================
router.delete("/clear-all-screenshots", async (req, res) => {
  try {
    const allLogs = await DebugLog.find({}, "screenshotUrl");

    for (const log of allLogs) {
      if (log.screenshotUrl) {
        try {
          const filename = log.screenshotUrl.split("/").pop();
          const publicId = `goodwallet/debug/${filename.split(".")[0]}`;
          await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
        } catch (e) {
          console.error("Cloudinary delete warning:", e.message);
        }
      }
    }

    await DebugLog.deleteMany({});
    addLog(`🗑️ All screenshots cleared from Cloudinary and MongoDB`);
    res.sendStatus(200);
  } catch (err) {
    console.error("Clear all error:", err);
    res.status(500).send("Server error while clearing screenshots");
  }
});

module.exports = router;
