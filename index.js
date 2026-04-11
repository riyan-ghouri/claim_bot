const puppeteer = require('puppeteer');
const express = require("express");
const mongoose = require('mongoose');
const cloudinary = require('./config/cloudinary');
const DebugLog = require('./models/DebugLog');
const AccountSession = require('./models/AccountSession');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB error:', err));

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

// Sleep function to replace removed page.waitForTimeout()
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ====================== CHROMIUM PATH FINDER ======================
function getChromiumExecutablePath() {
  try {
    const baseDir = '/ms-playwright';
    
    if (!fs.existsSync(baseDir)) {
      console.log('❌ /ms-playwright directory not found');
      return null;
    }

    const items = fs.readdirSync(baseDir);
    console.log('📂 Folders in /ms-playwright:', items);

    const chromiumDir = items.find(dir => dir.includes('chromium') && !dir.includes('headless'));
    
    if (!chromiumDir) {
      console.log('❌ No chromium folder found');
      return null;
    }

    const fullPath = `${baseDir}/${chromiumDir}/chrome-linux64/chrome`;

    if (fs.existsSync(fullPath)) {
      console.log(`✅ Chromium binary found at: ${fullPath}`);
      return fullPath;
    } else {
      console.log(`⚠️ Binary not found at: ${fullPath}`);
      return null;
    }
  } catch (err) {
    console.log(`❌ Error locating Chromium: ${err.message}`);
    return null;
  }
}

// ====================== UPLOAD HELPER ======================
async function uploadScreenshotAndLog(account, buffer, type, message) {
  if (!buffer) return;
  try {
    const cloudinaryUrl = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream({
        folder: "goodwallet/debug",
        public_id: `${account.name.replace(/\s+/g, '-')}-${type}-${Date.now()}`,
        resource_type: "image"
      }, (error, result) => error ? reject(error) : resolve(result.secure_url));

      require('streamifier').createReadStream(buffer).pipe(uploadStream);
    });

    addLog(`📤 ${type} screenshot uploaded for ${account.name}`);

    await DebugLog.create({
      accountName: account.name,
      errorType: type,
      screenshotUrl: cloudinaryUrl,
      message: message,
      timestamp: new Date()
    });
  } catch (e) {
    addLog(`❌ Upload failed for ${type}: ${e.message}`);
  }
}

// ====================== MAIN FUNCTION (Improved with longer waits) ======================
// ====================== MAIN FUNCTION (Optimized for Render) ======================
async function runAccountByIndex(index) {
  if (isRunning) return;

  isRunning = true;
  logs = [];
  addLog(`🚀 Starting claim for account index: ${index}`);

  let browser;

  try {
    let account = await AccountSession.findOne({ index: Number(index) });
    if (!account) {
      addLog(`❌ Account ${index} not found`);
      return;
    }

    if (account.status === 'error') {
      addLog(`🔄 Resetting error status for ${account.name}`);
      await AccountSession.findOneAndUpdate({ index: Number(index) }, { status: 'active', lastError: null });
      account = await AccountSession.findOne({ index: Number(index) });
    }

    if (account.status !== 'active') {
      addLog(`⛔ Skipping ${account.name} - status: ${account.status}`);
      return;
    }

    const executablePath = getChromiumExecutablePath();
    if (!executablePath) {
      throw new Error('Chromium binary not found in the Docker image');
    }

    browser = await puppeteer.launch({
      headless: true,
      executablePath: executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--no-zygote'
      ],
      timeout: 90000,
      dumpio: false
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    addLog(`🚀 Running: ${account.name}`);

    // Inject session
    await page.evaluateOnNewDocument((sessionJson) => {
      localStorage.clear();
      localStorage.setItem('SIGNER_SESSION', sessionJson);
      localStorage.setItem('Tracking_Sentry', 'allowed');
      localStorage.setItem('Tracking_Amplitude', 'allowed');
      localStorage.setItem('defaultLoginMethod', 'google');
    }, account.sessionData);

    // === OPTIMIZED NAVIGATION ===
    addLog(`🌐 Navigating directly to claim page for ${account.name}`);

    await page.goto('https://goodwallet.xyz/en/gooddollar', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    await sleep(10000); // Initial hydration time

    // Check if redirected away from claim page
    const currentUrl = page.url();
    if (!currentUrl.includes('/gooddollar')) {
      addLog(`🔄 Redirected, forcing claim page again...`);
      await page.goto('https://goodwallet.xyz/en/gooddollar', {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });
      await sleep(8000);
    }

    // Take initial screenshot (compressed)
    const initialBuffer = await page.screenshot({ 
      encoding: 'binary',
      type: 'jpeg',
      quality: 65 
    }).catch(() => null);

    if (initialBuffer) await uploadScreenshotAndLog(account, initialBuffer, 'initial-load', 'After navigation');

    // Check for cooldown
    const cooldown = await page.evaluate(() => 
      document.body.innerText.includes("Just a little longer") || 
      document.body.innerText.includes("Coming soon")
    );

    if (cooldown) {
      addLog(`⏳ Cooldown detected for ${account.name}`);
      const buf = await page.screenshot({ encoding: 'binary', type: 'jpeg', quality: 65 }).catch(() => null);
      if (buf) await uploadScreenshotAndLog(account, buf, 'cooldown', 'Cooldown screen');
      await AccountSession.findOneAndUpdate({ index: Number(index) }, { lastClaimed: new Date() });
      return;
    }

    // Wait + Retry for claim button
    addLog(`⏳ Waiting for claim button to appear...`);
    let btnExists = false;
    for (let i = 0; i < 3; i++) {   // 3 attempts
      await sleep(6000);
      
      btnExists = await page.evaluate(() => {
        return document.querySelectorAll('div[class*="claimButtonText"]').length > 0 ||
               document.querySelectorAll('button').length > 3 ||   // fallback
               document.querySelector('claim-button') !== null;    // in case they use web component
      });

      if (btnExists) break;
      addLog(`🔄 Retry ${i+1}/3 for button detection...`);
    }

    if (!btnExists) {
      addLog(`⚠️ UI missing for ${account.name}`);
      const buf = await page.screenshot({ encoding: 'binary', type: 'jpeg', quality: 65 }).catch(() => null);
      if (buf) await uploadScreenshotAndLog(account, buf, 'ui-missing', 'Claim button not found after retries');
      await AccountSession.findOneAndUpdate({ index: Number(index) }, { 
        status: 'error', 
        lastError: 'UI missing after retries' 
      });
    } else {
      const isDisabled = await page.evaluate(() => 
        !!document.querySelector('span[class*="textDisabled"]') ||
        !!document.querySelector('button:disabled')
      );

      if (isDisabled) {
        addLog(`⛔ Already claimed today: ${account.name}`);
      } else {
        // Before click screenshot
        const before = await page.screenshot({ 
          encoding: 'binary', 
          type: 'jpeg', 
          quality: 65 
        }).catch(() => null);
        if (before) await uploadScreenshotAndLog(account, before, 'before-claim', 'Before clicking claim');

        // Click the button
        await page.evaluate(() => {
          const btn = document.querySelector('div[class*="claimButtonText"]') || 
                      document.querySelector('button') ||
                      document.querySelector('claim-button');
          if (btn) btn.click();
        });

        addLog(`💰 Claim button clicked for ${account.name}`);
        await sleep(12000);   // Wait for transaction / success message

        // After click screenshot
        const after = await page.screenshot({ 
          encoding: 'binary', 
          type: 'jpeg', 
          quality: 65 
        }).catch(() => null);
        if (after) await uploadScreenshotAndLog(account, after, 'after-claim', 'After claim attempt');

        addLog(`✅ Claim process completed for ${account.name}`);
        await AccountSession.findOneAndUpdate({ index: Number(index) }, { lastClaimed: new Date() });
      }
    }

  } catch (err) {
    addLog(`❌ Error on index ${index}: ${err.message}`);
    await AccountSession.findOneAndUpdate({ index: Number(index) }, { 
      status: 'error', 
      lastError: err.message 
    });
  } finally {
    if (browser) await browser.close().catch(() => {});
    isRunning = false;
    lastRunTime = new Date();
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
// Delete Image Route
app.delete("/delete-image/:id", async (req, res) => {
  try {
    const debugLog = await DebugLog.findById(req.params.id);
    if (!debugLog) {
      return res.status(404).send("Image not found");
    }

    // Delete from Cloudinary
    if (debugLog.screenshotUrl) {
      try {
        const filename = debugLog.screenshotUrl.split('/').pop();
        const publicId = `goodwallet/debug/${filename.split('.')[0]}`;
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

app.post("/run", async (req, res) => {
  const index = req.body.index;
  if (!index) return res.send(`<h2>❌ Please enter index</h2><a href="/">← Back</a>`);
  if (isRunning) return res.send(`<h2>❌ Bot is running!</h2><a href="/">← Back</a>`);

  res.send(`<h2>✅ Started index ${index}</h2><a href="/">← Back to Dashboard</a>`);
  runAccountByIndex(index);
});

app.delete("/clear-all-screenshots", async (req, res) => {
  try {
    const allLogs = await DebugLog.find({}, 'screenshotUrl');

    // Delete from Cloudinary
    for (const log of allLogs) {
      if (log.screenshotUrl) {
        try {
          const filename = log.screenshotUrl.split('/').pop();
          const publicId = `goodwallet/debug/${filename.split('.')[0]}`;
          await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
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
});