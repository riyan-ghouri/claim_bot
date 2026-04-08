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

// ====================== HELPER ======================
async function uploadScreenshotAndLog(account, screenshotBuffer, type, message) {
  if (!screenshotBuffer) return;

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
  }
}

// ====================== MAIN FUNCTION ======================
async function runAccountByIndex(index) {
  if (isRunning) return;

  isRunning = true;
  logs = [];
  addLog(`🚀 Starting claim for account index: ${index}`);

  let browser, context;

  try {
    const account = await AccountSession.findOne({ index: Number(index) });
    if (!account) {
      addLog(`❌ Account index ${index} not found`);
      return;
    }

    if (account.status !== 'active') {
      addLog(`⛔ Account ${index} is ${account.status}`);
      return;
    }

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--memory-pressure-off']
    });

    context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();

    addLog(`🚀 Running: ${account.name} (Index ${index})`);

    // Strong session injection
    await context.addInitScript((sessionJson) => {
      localStorage.clear();
      localStorage.setItem('SIGNER_SESSION', sessionJson);
      localStorage.setItem('Tracking_Sentry', 'allowed');
      localStorage.setItem('Tracking_Amplitude', 'allowed');
      localStorage.setItem('defaultLoginMethod', 'google');
    }, account.sessionData);

    await page.goto('https://goodwallet.xyz/en', { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(8000);

    await page.goto('https://goodwallet.xyz/en/gooddollar', { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(10000);   // Increased slightly for dynamic content

    // Take initial screenshot for debugging
    const initialBuffer = await page.screenshot({ timeout: 15000 }).catch(() => null);
    if (initialBuffer) {
      await uploadScreenshotAndLog(account, initialBuffer, 'initial-load', 'Initial page state');
    }

    // Check for "Just a little longer..." message (Cooldown state)
    const cooldownText = await page.locator('text=Just a little longer').isVisible({ timeout: 3000 }).catch(() => false);

    if (cooldownText) {
      addLog(`⏳ Cooldown detected for ${account.name} (Coming soon screen)`);
      const cooldownBuffer = await page.screenshot({ timeout: 15000 }).catch(() => null);
      if (cooldownBuffer) {
        await uploadScreenshotAndLog(account, cooldownBuffer, 'cooldown', 'Cooldown - Just a little longer screen');
      }
      await AccountSession.findOneAndUpdate({ index: Number(index) }, { lastClaimed: new Date() });
      return;
    }

    // Check for claim button
    const claimBtn = page.locator('div[class*="claimButtonText"]');
    const btnCount = await claimBtn.count();

    if (btnCount === 0) {
      addLog(`⚠️ UI missing for ${account.name}`);
      const missingBuffer = await page.screenshot({ timeout: 15000 }).catch(() => null);
      if (missingBuffer) {
        await uploadScreenshotAndLog(account, missingBuffer, 'ui-missing', 'Claim button not found');
      }
      await AccountSession.findOneAndUpdate({ index: Number(index) }, { status: 'error', lastError: 'UI missing' });
    } 
    else {
      const isDisabled = await page.locator('span[class*="textDisabled"]').isVisible({ timeout: 5000 }).catch(() => false);

      if (isDisabled) {
        addLog(`⛔ Already claimed: ${account.name}`);
      } else {
        // BEFORE
        const beforeBuffer = await page.screenshot({ timeout: 15000 }).catch(() => null);
        if (beforeBuffer) await uploadScreenshotAndLog(account, beforeBuffer, 'before-claim', 'Before click');

        await claimBtn.click();
        addLog(`💰 Claim button clicked for ${account.name}`);

        await page.waitForTimeout(8000);

        // AFTER
        const afterBuffer = await page.screenshot({ timeout: 15000 }).catch(() => null);
        if (afterBuffer) await uploadScreenshotAndLog(account, afterBuffer, 'after-claim', 'After click');

        addLog(`✅ Claim completed for ${account.name}`);
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
app.get("/", (req, res) => res.sendFile(path.join(__dirname, 'views', 'dashboard.html')));

app.get("/logs", (req, res) => res.send(logs.join('\n') || 'No logs yet.'));

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

app.post("/run", async (req, res) => {
  const index = req.body.index;
  if (!index) return res.send(`<h2>❌ Please enter index</h2><a href="/">← Back</a>`);
  if (isRunning) return res.send(`<h2>❌ Bot is running!</h2><a href="/">← Back</a>`);

  res.send(`<h2>✅ Started index ${index}</h2><a href="/">← Back to Dashboard</a>`);

  runAccountByIndex(index).catch(err => {
    console.error(err);
    addLog(`💥 Fatal: ${err.message}`);
    isRunning = false;
  });
});

app.delete("/delete-image/:id", async (req, res) => {
  try {
    const log = await DebugLog.findById(req.params.id);
    if (!log) return res.status(404).send("Not found");

    if (log.screenshotUrl) {
      try {
        const filename = log.screenshotUrl.split('/').pop();
        const publicId = `goodwallet/debug/${filename.split('.')[0]}`;
        await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
      } catch (e) {}
    }

    await DebugLog.findByIdAndDelete(req.params.id);
    res.sendStatus(200);
  } catch (err) {
    res.status(500).send("Error");
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});