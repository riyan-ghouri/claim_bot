const { chromium } = require("playwright");
const accounts = require("./accounts.json");
const fs = require("fs");
const config = require("./config");
const express = require("express");
const mongoose = require('mongoose');
const cloudinary = require('./config/cloudinary');
const DebugLog = require('./models/DebugLog');
const dotenv = require('dotenv');

 
dotenv.config();
// Connect MongoDB (add your connection string in Environment Variables on Render)
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

const app = express();
const PORT = process.env.PORT || 3000;

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

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

async function runAllAccounts() {
  if (isRunning) return;
  isRunning = true;
  logs = [];
  addLog("🚀 Starting claim process for all accounts...");

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--single-process',
    '--disable-dev-shm-usage', 
    '--memory-pressure-off'     // added
  
        ]
  });

  const queue = [...accounts];
  const workers = [];

  for (let i = 0; i < Math.min(config.CONCURRENCY || 2, 3); i++) {
    workers.push((async () => {
      while (queue.length > 0) {
        const acc = queue.shift();
        if (!acc) break;
        await runAccount(browser, acc);
        await delay(config.DELAYS.betweenTasks || 3000);
      }
    })());
  }

  await Promise.all(workers);
  await browser.close();

  lastRunTime = new Date();
  addLog("🎯 All accounts done!");
  isRunning = false;
}

async function runAccount(browser, account) {
  if (!fs.existsSync(account.session)) {
    addLog(`⚠️ Missing session: ${account.name}`);
    return;
  }

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  try {
    addLog(`🚀 Running: ${account.name}`);

    const localStorageItems = config.LOCAL_STORAGE_KEYS(account);
    await context.addInitScript((items) => {
      items.forEach((item) => localStorage.setItem(item.key, item.value));
    }, localStorageItems);

    await page.goto(config.URLS.home, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(20000);

    addLog(`✅ Logged in: ${account.name}`);

    await page.goto(config.URLS.claim, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(20000);

    const claimBtn = page.locator(config.SELECTORS.claimContainer);

    if ((await claimBtn.count()) === 0) {
      addLog(`⚠️ UI missing: ${account.name}`);

      // Take screenshot as Buffer (better for Cloudinary)
      const screenshotBuffer = await page.screenshot({ 
        timeout: 15000 
      }).catch(() => null);

      let cloudinaryUrl = null;

      if (screenshotBuffer) {
        try {
          // Upload to Cloudinary using stream
          cloudinaryUrl = await new Promise((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
              {
                folder: "goodwallet/debug",
                public_id: `${account.name}-${Date.now()}`,
                resource_type: "image"
              },
              (error, result) => {
                if (error) reject(error);
                else resolve(result.secure_url);
              }
            );
            require('streamifier').createReadStream(screenshotBuffer).pipe(uploadStream);
          });

          addLog(`📤 Screenshot uploaded to Cloudinary: ${cloudinaryUrl}`);

          // Save to MongoDB
          await DebugLog.create({
            accountName: account.name,
            errorType: 'ui-missing',
            screenshotUrl: cloudinaryUrl,
            message: 'Claim button UI not found',
            timestamp: new Date()
          });

        } catch (uploadErr) {
          addLog(`❌ Cloudinary upload failed: ${uploadErr.message}`);
        }
      }

      fs.appendFileSync("logs.txt", `${account.name} ui-missing\n`);
      return;
    }

    // Rest of your code (disabled check + claim)...
    const isDisabled = await page.locator(config.SELECTORS.disabledText).isVisible();

    if (isDisabled) {
      addLog(`⛔ Already claimed: ${account.name}`);
      fs.appendFileSync("logs.txt", `${account.name} already-claimed\n`);
    } else {
      await claimBtn.click();
      addLog(`💰 Claimed: ${account.name}`);
      fs.appendFileSync("logs.txt", `${account.name} claimed\n`);
      await page.waitForTimeout(10000);
    }

  } catch (err) {
    addLog(`❌ Error: ${account.name} - ${err.message}`);
    fs.appendFileSync("logs.txt", `${account.name} error\n`);
  } finally {
    await context.close();
  }
}

// ====================== WEB DASHBOARD ======================
app.get("/", (req, res) => {
  const status = isRunning ? 
    `<span style="color:orange;">🟡 Running...</span>` : 
    `<span style="color:green;">🟢 Idle</span>`;

  const lastRun = lastRunTime ? 
    `Last run: ${lastRunTime.toLocaleString()}` : "Never run yet";

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>GoodWallet Claim Bot</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f4f4f4; }
        h1 { color: #333; }
        .status { font-size: 18px; font-weight: bold; }
        button { padding: 15px 30px; font-size: 18px; background: #28a745; color: white; border: none; border-radius: 8px; cursor: pointer; }
        button:disabled { background: #ccc; cursor: not-allowed; }
        pre { 
          background: #222; color: #0f0; padding: 15px; border-radius: 8px; 
          max-height: 65vh; overflow-y: auto; white-space: pre-wrap; font-family: monospace;
        }
        .info { background: white; padding: 15px; border-radius: 8px; margin: 15px 0; }
        .log-container { position: relative; }
      </style>
    </head>
    <body>
      <h1>🚀 GoodWallet Claim Bot</h1>
      
      <div class="info">
        <p class="status">Status: ${status}</p>
        <p>${lastRun}</p>
        <p>Accounts: ${accounts.length} | Concurrency: ${config.CONCURRENCY || 2}</p>
      </div>

      <form action="/run" method="post">
        <button type="submit" ${isRunning ? 'disabled' : ''}>
          ${isRunning ? '⏳ Running... Please wait' : '🚀 Run Claim Now'}
        </button>
      </form>

      <h2>Live Logs:</h2>
      <div class="log-container">
        <pre id="logs">${logs.join('\n') || 'No logs yet. Click the button to start.'}</pre>
      </div>

      <p><small>Logs update automatically every 2 seconds • Check debug-*.png if UI is missing</small></p>

      <script>
        let lastLogCount = ${logs.length};

        async function updateLogs() {
          try {
            const res = await fetch('/logs');
            const data = await res.text();
            const logPre = document.getElementById('logs');
            
            if (data !== logPre.textContent) {
              logPre.textContent = data;
              // Auto scroll to bottom
              logPre.scrollTop = logPre.scrollHeight;
            }
          } catch(e) {}
        }

        // Update logs every 2 seconds
        setInterval(updateLogs, 2000);
        
        // Initial load
        window.onload = () => {
          document.getElementById('logs').scrollTop = document.getElementById('logs').scrollHeight;
        };
      </script>
    </body>
    </html>
  `);
});

// New endpoint to get only logs (for live update)
app.get("/logs", (req, res) => {
  res.send(logs.join('\n') || 'No logs yet.');
});

app.post("/run", async (req, res) => {
  if (isRunning) {
    return res.send(`<h2>Bot is already running!</h2><a href="/">← Back to Dashboard</a>`);
  }

  res.send(`
    <h2>✅ Claim started! Watch the live logs below.</h2>
    <a href="/">← Go to Dashboard</a>
  `);

  runAllAccounts().catch(err => {
    addLog(`💥 Fatal Error: ${err.message}`);
    isRunning = false;
  });
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});