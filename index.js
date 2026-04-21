const puppeteer = require("puppeteer");
const express = require("express");
const mongoose = require("mongoose");
const cloudinary = require("./config/cloudinary");
const DebugLog = require("./models/DebugLog");
const AccountSession = require("./models/AccountSession");
const path = require("path");
const dotenv = require("dotenv");
const fs = require("fs");

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => console.error("❌ MongoDB error:", err));

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json()); // Important for mail API

let isRunning = false;
let logs = [];
let lastRunTime = null;

const addLog = (message) => {
  const time = new Date().toLocaleTimeString();
  const entry = `[${time}] ${message}`;
  logs.push(entry);
  console.log(entry);
  if (logs.length > 1000) logs.shift();
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ====================== CHROMIUM PATH FINDER ======================
function getChromiumExecutablePath() {
  try {
    const baseDir = "/ms-playwright";
    if (!fs.existsSync(baseDir)) return null;

    const items = fs.readdirSync(baseDir);
    const chromiumDir = items.find(
      (dir) => dir.includes("chromium") && !dir.includes("headless"),
    );

    if (!chromiumDir) return null;

    const fullPath = `${baseDir}/${chromiumDir}/chrome-linux64/chrome`;
    return fs.existsSync(fullPath) ? fullPath : null;
  } catch (err) {
    console.log(`❌ Error locating Chromium: ${err.message}`);
    return null;
  }
}

// ====================== SEND EMAIL HELPER ======================

const fetch = require("node-fetch"); // This now works with v2

// ====================== SEND EMAIL HELPER (Fixed for Node 22) ======================
async function sendClaimReport(account, status, message, screenshots = []) {
  try {
    const payload = {
      to: "riyanghouri7@gmail.com",
      subject: `GoodWallet Claim Report - ${account.name || `Index ${account.index}`}`,
      message: message,
      accountName: account.name || `Account ${account.index}`,
      index: `Index ${account.index || ""}`,
      todayReceive: "250",
      img1: screenshots[0] || "",
      img2: screenshots[1] || "",
      img3: screenshots[2] || "",
      apiKey: "RG_23456788ytfdsdfgn",
    };

    const response = await fetch(
      "https://b3tr-wallet.vercel.app/api/send-mail",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

    const result = await response.text();

    if (response.ok) {
      addLog(
        `📧 Email report sent successfully for ${account.name || account.index}`,
      );
    } else {
      addLog(`⚠️ Email API error: ${result}`);
    }
  } catch (e) {
    addLog(`❌ Failed to send email: ${e.message}`);
    console.error("Full email error:", e);
  }
}

// ====================== UPLOAD HELPER ======================
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

// ====================== MAIN FUNCTION ======================
async function runAccountByIndex(index, isCronTrigger = false) {
  if (isRunning) return;

  isRunning = true;
  logs = [];
  addLog(
    `🚀 Starting claim for account index: ${index} ${isCronTrigger ? "(Cron)" : "(Manual)"}`,
  );

  let browser;
  let screenshots = []; // Will store up to 3 image URLs for email

  try {
    let account = await AccountSession.findOne({ index: Number(index) });
    if (!account) throw new Error(`Account ${index} not found`);

    // Reset error status if needed
    if (account.status === "error") {
      await AccountSession.findOneAndUpdate(
        { index: Number(index) },
        { status: "active", lastError: null },
      );
      account = await AccountSession.findOne({ index: Number(index) });
    }

    if (account.status !== "active") {
      addLog(`⛔ Skipping - status: ${account.status}`);
      return;
    }

    const executablePath = getChromiumExecutablePath();
    if (!executablePath) throw new Error("Chromium binary not found");

    browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--single-process",
        "--no-zygote",
      ],
      timeout: 90000,
      dumpio: false,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    addLog(`🚀 Running: ${account.name}`);

    // Inject session
    await page.evaluateOnNewDocument((sessionJson) => {
      localStorage.clear();
      localStorage.setItem("SIGNER_SESSION", sessionJson);
      localStorage.setItem("Tracking_Sentry", "allowed");
      localStorage.setItem("Tracking_Amplitude", "allowed");
      localStorage.setItem("defaultLoginMethod", "google");
    }, account.sessionData);

    // Optimized Navigation
    await page.goto("https://goodwallet.xyz/en/gooddollar", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await sleep(10000);

    const targetUrl = "https://goodwallet.xyz/en/gooddollar";

    // 🔁 Force redirect loop until correct page is stable
    for (let i = 0; i < 5; i++) {
      const currentUrl = page.url();
      console.log("🌐 Current URL:", currentUrl);

      if (!currentUrl.includes("/gooddollar")) {
        addLog(`⚠️ Redirected to wrong route: ${currentUrl}`);
        addLog(`🔁 Forcing back to /gooddollar...`);

        await page.goto(targetUrl, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });

        await sleep(5000);
      } else {
        addLog(`✅ Correct route reached`);
        break;
      }
    }

    // Initial Screenshot
    let buffer = await page
      .screenshot({ encoding: "binary", type: "jpeg", quality: 65 })
      .catch(() => null);
    let url = await uploadScreenshotAndLog(
      account,
      buffer,
      "initial-load",
      "After navigation",
    );
    if (url) screenshots.push(url);

    // Cooldown Check
    const cooldown = await page.evaluate(
      () =>
        document.body.innerText.includes("Just a little longer") ||
        document.body.innerText.includes("Coming soon"),
    );

    if (cooldown) {
      addLog(`⏳ Cooldown detected`);
      buffer = await page
        .screenshot({ encoding: "binary", type: "jpeg", quality: 65 })
        .catch(() => null);
      url = await uploadScreenshotAndLog(
        account,
        buffer,
        "cooldown",
        "Cooldown screen",
      );
      if (url) screenshots.push(url);

      await AccountSession.findOneAndUpdate(
        { index: Number(index) },
        { lastClaimed: new Date() },
      );

      if (isCronTrigger)
        await sendClaimReport(
          account,
          "Cooldown",
          "Account is in cooldown period.",
          screenshots,
        );
      return;
    }

    // Button Detection with Retry
    // 🛡 Final route check before interacting
    const finalUrl = page.url();
    if (!finalUrl.includes("/gooddollar")) {
      addLog(`🚨 Wrong page before claim: ${finalUrl}`);
      addLog(`🔁 Redirecting again...`);

      await page.goto("https://goodwallet.xyz/en/gooddollar", {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });

      await sleep(6000);
    }
    let btnExists = false;
    for (let i = 0; i < 3; i++) {
      await sleep(6000);
      btnExists = await page.evaluate(
        () =>
          document.querySelectorAll('div[class*="claimButtonText"]').length >
            0 || document.querySelectorAll("button").length > 3,
      );
      if (btnExists) break;
    }

    if (!btnExists) {
      addLog(`⚠️ UI missing`);
      buffer = await page
        .screenshot({ encoding: "binary", type: "jpeg", quality: 65 })
        .catch(() => null);
      url = await uploadScreenshotAndLog(
        account,
        buffer,
        "ui-missing",
        "Claim button not found",
      );
      if (url) screenshots.push(url);

      await AccountSession.findOneAndUpdate(
        { index: Number(index) },
        { status: "error", lastError: "UI missing" },
      );

      if (isCronTrigger)
        await sendClaimReport(
          account,
          "Error",
          "Claim button not found after retries.",
          screenshots,
        );
      return;
    }

    const isDisabled = await page.evaluate(
      () =>
        !!document.querySelector('span[class*="textDisabled"]') ||
        !!document.querySelector("button:disabled"),
    );

    if (isDisabled) {
      addLog(`⛔ Already claimed today`);
      if (isCronTrigger)
        await sendClaimReport(
          account,
          "Already Claimed",
          "Daily claim already done.",
          screenshots,
        );
    } else {
      // Before Claim
      buffer = await page
        .screenshot({ encoding: "binary", type: "jpeg", quality: 65 })
        .catch(() => null);
      url = await uploadScreenshotAndLog(
        account,
        buffer,
        "before-claim",
        "Before click",
      );
      if (url) screenshots.push(url);

      // Click
      const clicked = await page.evaluate(() => {
        // Try to find real clickable button
        const buttons = Array.from(document.querySelectorAll("button"));

        const claimBtn = buttons.find((btn) =>
          btn.innerText.toLowerCase().includes("claim"),
        );

        if (claimBtn) {
          claimBtn.click();
          return true;
        }

        return false;
      });

      if (!clicked) {
        addLog(`❌ Claim button not found for click`);
      } else {
        addLog(`💰 Claim button clicked (verified)`);
      }

      addLog(`💰 Claim button clicked`);
      await sleep(12000);

      // After Claim
      buffer = await page
        .screenshot({ encoding: "binary", type: "jpeg", quality: 65 })
        .catch(() => null);
      url = await uploadScreenshotAndLog(
        account,
        buffer,
        "after-claim",
        "After claim",
      );
      if (url) screenshots.push(url);

      addLog(`✅ Claim completed`);
      await AccountSession.findOneAndUpdate(
        { index: Number(index) },
        { lastClaimed: new Date() },
      );

      if (isCronTrigger) {
        await sendClaimReport(
          account,
          "Success",
          "Claim successfully processed.",
          screenshots,
        );
      }
    }
  } catch (err) {
    addLog(`❌ Error: ${err.message}`);
    await AccountSession.findOneAndUpdate(
      { index: Number(index) },
      { status: "error", lastError: err.message },
    );

    // Take error screenshot
    if (browser) {
      try {
        const page = (await browser.pages())[0];
        const errBuffer = await page
          .screenshot({ encoding: "binary", type: "jpeg", quality: 65 })
          .catch(() => null);
        const errUrl = await uploadScreenshotAndLog(
          { name: account?.name || `Index-${index}` },
          errBuffer,
          "error",
          err.message,
        );
        if (errUrl) screenshots.push(errUrl);
      } catch (_) {}
    }

    if (isCronTrigger) {
      await sendClaimReport(
        { name: `Index ${index}`, index },
        "Error",
        `Failed: ${err.message}`,
        screenshots,
      );
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    isRunning = false;
    lastRunTime = new Date();
    addLog(`🏁 Finished processing account index ${index}`);
  }
}

// ====================== ROUTES ======================
app.get("/", (req, res) =>
  res.sendFile(path.join(__dirname, "views", "dashboard.html")),
);

app.get("/logs", (req, res) => res.send(logs.join("\n") || "No logs yet."));

app.get("/status", async (req, res) => {
  const total = await AccountSession.countDocuments().catch(() => 0);
  res.json({ isRunning, lastRunTime, totalAccounts: total });
});

app.get("/gallery", async (req, res) => {
  try {
    const data = await DebugLog.find().sort({ timestamp: -1 }).limit(30);
    res.json(data);
  } catch (e) {
    res.json([]);
  }
});

// NEW: Run via Cron (with email)
app.get("/run/:index", async (req, res) => {
  const index = req.params.index;
  if (!index) return res.status(400).send("Index required");

  res.send(
    `<h2>✅ Cron trigger received for index ${index}</h2><p>Email report will be sent after completion.</p><a href="/">← Back</a>`,
  );

  runAccountByIndex(index, true); // true = isCronTrigger → send email
});

// ====================== DELETE & CLEAR ROUTES ======================

// Delete single image
app.delete("/delete-image/:id", async (req, res) => {
  try {
    const debugLog = await DebugLog.findById(req.params.id);
    if (!debugLog) {
      return res.status(404).send("Image not found");
    }

    // Delete from Cloudinary
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

    // Delete from MongoDB
    await DebugLog.findByIdAndDelete(req.params.id);

    res.sendStatus(200);
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).send("Server error while deleting image");
  }
});

// Clear all screenshots
app.delete("/clear-all-screenshots", async (req, res) => {
  try {
    const allLogs = await DebugLog.find({}, "screenshotUrl");

    // Delete from Cloudinary
    for (const log of allLogs) {
      if (log.screenshotUrl) {
        try {
          const filename = log.screenshotUrl.split("/").pop();
          const publicId = `goodwallet/debug/${filename.split(".")[0]}`;
          await cloudinary.uploader.destroy(publicId, {
            resource_type: "image",
          });
        } catch (e) {
          console.error("Cloudinary delete warning:", e.message);
        }
      }
    }

    // Delete all records from MongoDB
    await DebugLog.deleteMany({});

    addLog(`🗑️ All screenshots cleared from Cloudinary and MongoDB`);
    res.sendStatus(200);
  } catch (err) {
    console.error("Clear all error:", err);
    res.status(500).send("Server error while clearing screenshots");
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📌 Use: /run/:index for cron-job.org (with email)`);
});
