const { chromium } = require("playwright");
const accounts = require("./accounts.json");
const fs = require("fs");
const config = require("./config");

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

async function runAccount(browser, account) {
  if (!fs.existsSync(account.session)) {
    console.log(`⚠️ Missing session: ${account.name}`);
    return;
  }

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();

  try {
    console.log(`🚀 Running: ${account.name}`);

    const localStorageItems = config.LOCAL_STORAGE_KEYS(account);

    // ✅ ALWAYS inject BEFORE load (works for both modes)
    await context.addInitScript((items) => {
      items.forEach((item) => {
        localStorage.setItem(item.key, item.value);
      });
    }, localStorageItems);

    // ✅ Use safe loading strategy
    await page.goto(config.URLS.home, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForTimeout(20000);

    console.log(`✅ Logged in: ${account.name}`);

    // 👉 Go to claim page
    await page.goto(config.URLS.claim, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForTimeout(20000);

    const claimBtn = page.locator(config.SELECTORS.claimContainer);

    // ❗ Check if UI exists (no crash)
    if ((await claimBtn.count()) === 0) {
      console.log(`⚠️ UI missing: ${account.name}`);
      await page.screenshot({ path: `debug-${account.name}.png` });
      fs.appendFileSync("logs.txt", `${account.name} ui-missing\n`);
      return;
    }

    // ❗ Check if disabled
    const isDisabled = await page
      .locator(config.SELECTORS.disabledText)
      .isVisible();

    if (isDisabled) {
      console.log(`⛔ Already claimed: ${account.name}`);
      fs.appendFileSync("logs.txt", `${account.name} already-claimed\n`);

      // ❌ no wait, close fast
    } else {
      await claimBtn.click();

      console.log(`💰 Claimed: ${account.name}`);
      fs.appendFileSync("logs.txt", `${account.name} claimed\n`);

      // ✅ wait ONLY after successful claim
      await page.waitForTimeout(10000);
    }
  } catch (err) {
    console.log(`❌ Error: ${account.name}`, err.message);
    fs.appendFileSync("logs.txt", `${account.name} error\n`);
  }

  await context.close();
}

// 🚀 PARALLEL RUNNER
(async () => {
  const browser = await chromium.launch(config.BROWSER);

  const queue = [...accounts];
  const workers = [];

  for (let i = 0; i < config.CONCURRENCY; i++) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const acc = queue.shift();
          if (!acc) break;

          await runAccount(browser, acc);
          await delay(config.DELAYS.betweenTasks);
        }
      })(),
    );
  }

  await Promise.all(workers);

  await browser.close();

  console.log("🎯 All accounts done");
})();
