const { chromium } = require("playwright");
const accounts = require("./accounts.json");
const fs = require("fs");
const config = require("./config");
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

let isRunning = false;
let logs = [];                    // Store logs to show on page
let lastRunTime = null;

const addLog = (message) => {
  const time = new Date().toLocaleTimeString();
  const entry = `[${time}] ${message}`;
  logs.push(entry);
  console.log(entry);             // Also print to Render console
  if (logs.length > 500) logs.shift(); // Keep only last 500 lines
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
      '--single-process'
    ]
  });

  const queue = [...accounts];
  const workers = [];

  for (let i = 0; i < Math.min(config.CONCURRENCY || 2, 3); i++) {   // limit max 3
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const acc = queue.shift();
          if (!acc) break;
          await runAccount(browser, acc);
          await delay(config.DELAYS.betweenTasks || 3000);
        }
      })()
    );
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
    await page.waitForTimeout(15000);

    addLog(`✅ Logged in: ${account.name}`);

    await page.goto(config.URLS.claim, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(15000);

    const claimBtn = page.locator(config.SELECTORS.claimContainer);

    if ((await claimBtn.count()) === 0) {
      addLog(`⚠️ UI missing: ${account.name}`);
      await page.screenshot({ path: `debug-${account.name}.png` });
      fs.appendFileSync("logs.txt", `${account.name} ui-missing\n`);
      return;
    }

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
      <meta http-equiv="refresh" content="3">
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f4f4f4; }
        h1 { color: #333; }
        .status { font-size: 18px; font-weight: bold; }
        button { padding: 15px 30px; font-size: 18px; background: #28a745; color: white; border: none; border-radius: 8px; cursor: pointer; }
        button:disabled { background: #ccc; cursor: not-allowed; }
        pre { background: #222; color: #0f0; padding: 15px; border-radius: 8px; max-height: 70vh; overflow-y: auto; white-space: pre-wrap; }
        .info { background: white; padding: 15px; border-radius: 8px; margin: 15px 0; }
      </style>
    </head>
    <body>
      <h1>🚀 GoodWallet Claim Bot</h1>
      
      <div class="info">
        <p class="status">Status: ${status}</p>
        <p>${lastRun}</p>
        <p>Accounts loaded: ${accounts.length} | Concurrency: ${config.CONCURRENCY || 2}</p>
      </div>

      <form action="/run" method="post">
        <button type="submit" ${isRunning ? 'disabled' : ''}>
          ${isRunning ? '⏳ Running... Please wait' : '🚀 Run Claim Now'}
        </button>
      </form>

      <h2>Live Logs:</h2>
      <pre>${logs.join('\n') || 'No logs yet. Click the button to start.'}</pre>

      <p><small>Page refreshes automatically every 3 seconds. Check debug-*.png files if any UI error occurs.</small></p>
    </body>
    </html>
  `);
});

app.post("/run", async (req, res) => {
  if (isRunning) {
    res.send(`<h2>Bot is already running! Check the live logs below.</h2><a href="/">← Back</a>`);
    return;
  }

  res.send(`
    <h2>✅ Claim process started!</h2>
    <p>You will see live logs on the next page refresh.</p>
    <a href="/">← Go to Dashboard (Live Logs)</a>
  `);

  // Run in background
  runAllAccounts().catch(err => {
    addLog(`💥 Fatal Error: ${err.message}`);
    isRunning = false;
  });
});

app.listen(PORT, () => {
  console.log(`✅ GoodWallet Claim Bot is running on port ${PORT}`);
});