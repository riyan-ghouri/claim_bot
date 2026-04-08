const { chromium } = require("playwright");
const express = require("express");
const mongoose = require('mongoose');
const cloudinary = require('./config/cloudinary');
const DebugLog = require('./models/DebugLog');
const AccountSession = require('./models/AccountSession');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

// Force Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

console.log("Cloudinary Config Check:", {
  cloud_name: !!process.env.CLOUDINARY_CLOUD_NAME,
  api_key: !!process.env.CLOUDINARY_API_KEY,
  api_secret: !!process.env.CLOUDINARY_API_SECRET
});

// Connect MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));

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

// ====================== HELPER: Upload Screenshot ======================
async function uploadScreenshotAndLog(account, screenshotBuffer, type, message) {
  if (!screenshotBuffer) {
    addLog(`⚠️ Screenshot buffer empty for ${type}`);
    return;
  }

  try {
    const cloudinaryUrl = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: "goodwallet/debug",
          public_id: `${account.name.replace(/\s+/g, '-')}-${type}-${Date.now()}`,
          resource_type: "image"
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result.secure_url);
        }
      );
      require('streamifier').createReadStream(screenshotBuffer).pipe(uploadStream);
    });

    addLog(`📤 ${type} screenshot uploaded for ${account.name}`);

    await DebugLog.create({
      accountName: account.name,
      errorType: type,
      screenshotUrl: cloudinaryUrl,
      message: message,
      timestamp: new Date()
    });

  } catch (uploadErr) {
    addLog(`❌ Failed to upload ${type} screenshot: ${uploadErr.message}`);
    console.error(`Cloudinary Upload Error (${type}):`, uploadErr);
  }
}

// ====================== RUN SINGLE ACCOUNT BY INDEX (Optimized) ======================
async function runAccountByIndex(index) {
  if (isRunning) {
    addLog(`⚠️ Bot is already running. Request for index ${index} ignored.`);
    return;
  }

  isRunning = true;
  logs = [];
  addLog(`🚀 Starting claim for account index: ${index}`);

  let browser, context;

  try {
    const account = await AccountSession.findOne({ index: Number(index) });

    if (!account) {
      addLog(`❌ Account with index ${index} not found`);
      return;
    }

    if (account.status !== 'active') {
      addLog(`⛔ Account ${index} (${account.name}) is ${account.status} - skipping`);
      return;
    }

    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--memory-pressure-off'
      ]
    });

    context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    addLog(`🚀 Running: ${account.name} (Index ${index})`);

    // Inject session
    await context.addInitScript((sessionJson) => {
      localStorage.setItem('SIGNER_SESSION', sessionJson);
      localStorage.setItem('Tracking_Sentry', 'allowed');
      localStorage.setItem('Tracking_Amplitude', 'allowed');
      localStorage.setItem('defaultLoginMethod', 'google');
    }, account.sessionData);

    // Faster navigation with better waiting
    await page.goto('https://goodwallet.xyz/en', { 
      waitUntil: "domcontentloaded", 
      timeout: 45000 
    });
    await page.waitForTimeout(8000);   // Reduced from 15s

    await page.goto('https://goodwallet.xyz/en/gooddollar', { 
      waitUntil: "domcontentloaded", 
      timeout: 45000 
    });
    await page.waitForTimeout(8000);   // Reduced from 15s

    const claimBtn = page.locator('div[class*="claimButtonText"]');

    // Check if claim button exists
    const btnCount = await claimBtn.count();

    if (btnCount === 0) {
      addLog(`⚠️ UI missing for ${account.name}`);

      // Take screenshot immediately when UI is missing
      let screenshotBuffer = null;
      try {
        screenshotBuffer = await page.screenshot({ timeout: 15000 });
        addLog(`📸 Took UI missing screenshot for ${account.name}`);
      } catch (shotErr) {
        addLog(`❌ Screenshot capture failed: ${shotErr.message}`);
      }

      if (screenshotBuffer) {
        await uploadScreenshotAndLog(account, screenshotBuffer, 'ui-missing', 'Claim button UI not found');
      }

      await AccountSession.findOneAndUpdate({ index: Number(index) }, { status: 'error', lastError: 'UI missing' });
    } 
    else {
      const isDisabled = await page.locator('span[class*="textDisabled"]').isVisible({ timeout: 5000 }).catch(() => false);

      if (isDisabled) {
        addLog(`⛔ Already claimed: ${account.name}`);
      } else {
        // BEFORE screenshot
        addLog(`📸 Taking BEFORE screenshot for ${account.name}`);
        const beforeBuffer = await page.screenshot({ timeout: 15000 }).catch(() => null);
        if (beforeBuffer) await uploadScreenshotAndLog(account, beforeBuffer, 'before-claim', 'Page before clicking claim');

        // Click claim
        await claimBtn.click();
        addLog(`💰 Claim button clicked for ${account.name}`);

        await page.waitForTimeout(8000);   // Reduced wait time

        // AFTER screenshot
        addLog(`📸 Taking AFTER screenshot for ${account.name}`);
        const afterBuffer = await page.screenshot({ timeout: 15000 }).catch(() => null);
        if (afterBuffer) await uploadScreenshotAndLog(account, afterBuffer, 'after-claim', 'Page after clicking claim');

        addLog(`✅ Claim process completed for ${account.name}`);
        await AccountSession.findOneAndUpdate({ index: Number(index) }, { lastClaimed: new Date() });
      }
    }

  } catch (err) {
    addLog(`❌ Error on index ${index}: ${err.message}`);
    await AccountSession.findOneAndUpdate({ index: Number(index) }, { status: 'error', lastError: err.message });
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    
    lastRunTime = new Date();
    isRunning = false;
    addLog(`🏁 Finished processing account index ${index}`);
  }
}

// ====================== ROUTES ======================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

app.get("/logs", (req, res) => res.send(logs.join('\n') || 'No logs yet.'));

app.get("/status", async (req, res) => {
  const totalAccounts = await AccountSession.countDocuments().catch(() => 0);
  res.json({ isRunning, lastRunTime, totalAccounts });
});

app.get("/gallery", async (req, res) => {
  try {
    const debugLogs = await DebugLog.find().sort({ timestamp: -1 }).limit(30);
    res.json(debugLogs);
  } catch (err) {
    console.error("Gallery error:", err);
    res.json([]);
  }
});

app.post("/run", async (req, res) => {
  const index = req.body.index;
  if (!index) return res.send(`<h2>❌ Please enter a valid index</h2><a href="/">← Back</a>`);
  if (isRunning) return res.send(`<h2>❌ Bot is already running!</h2><a href="/">← Back</a>`);

  res.send(`<h2>✅ Started account index <strong>${index}</strong>!</h2><p>Check logs and gallery.</p><a href="/">← Back</a>`);

  runAccountByIndex(index).catch(err => {
    console.error(err);
    addLog(`💥 Fatal Error: ${err.message}`);
    isRunning = false;
  });
});

app.delete("/delete-image/:id", async (req, res) => {
  try {
    const debugLog = await DebugLog.findById(req.params.id);
    if (!debugLog) return res.status(404).send("Image not found");

    if (debugLog.screenshotUrl) {
      try {
        const filename = debugLog.screenshotUrl.split('/').pop();
        const publicId = `goodwallet/debug/${filename.split('.')[0]}`;
        await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
      } catch (cErr) {
        console.error("Cloudinary delete warning:", cErr.message);
      }
    }

    await DebugLog.findByIdAndDelete(req.params.id);
    res.sendStatus(200);
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).send("Server error");
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});