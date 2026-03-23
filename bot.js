const { chromium } = require('playwright');
const accounts = require('./accounts.json');
const fs = require('fs');
const config = require('./config');

const delay = (ms) => new Promise(res => setTimeout(res, ms));

async function runAccount(account) {
  if (!fs.existsSync(account.session)) {
    console.log(`⚠️ Missing session: ${account.name}`);
    return;
  }

  const browser = await chromium.launch(config.BROWSER);
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log(`🚀 Running: ${account.name}`);

    await page.goto(config.URLS.home, { waitUntil: 'domcontentloaded' });

    // ✅ Inject localStorage
    const localStorageItems = config.LOCAL_STORAGE_KEYS(account);

    await page.evaluate((items) => {
      items.forEach(item => {
        localStorage.setItem(item.key, item.value);
      });
    }, localStorageItems);

    await page.reload({ waitUntil: 'domcontentloaded' });

    console.log(`✅ Logged in: ${account.name}`);

    // 👉 Go to claim page
    await page.goto(config.URLS.claim, { waitUntil: 'domcontentloaded' });

    await page.waitForSelector(config.SELECTORS.claimContainer, { timeout: 15000 });

    const isDisabled = await page.locator(config.SELECTORS.disabledText).isVisible();

    if (isDisabled) {
      console.log(`⛔ Already claimed: ${account.name}`);
      fs.appendFileSync('logs.txt', `${account.name} already-claimed\n`);
    } else {
      let claimed = false;

      try {
        const btn1 = page.locator(config.SELECTORS.claimContainer);
        if (await btn1.isVisible()) {
          await btn1.click();
          claimed = true;
        }
      } catch {}

      if (!claimed) {
        try {
          const btn2 = page.getByText(config.SELECTORS.claimText, { exact: true });
          if (await btn2.isVisible()) {
            await btn2.click();
            claimed = true;
          }
        } catch {}
      }

      if (claimed) {
        console.log(`💰 Claimed: ${account.name}`);
        fs.appendFileSync('logs.txt', `${account.name} claimed\n`);
      } else {
        console.log(`⚠️ Claim failed: ${account.name}`);
        fs.appendFileSync('logs.txt', `${account.name} no-claim\n`);
      }
    }

  } catch (err) {
    console.log(`❌ Error with ${account.name}:`, err.message);
    fs.appendFileSync('logs.txt', `${account.name} error\n`);
  }

  await browser.close();
}

// 👉 Run all accounts
(async () => {
  for (const acc of accounts) {
    await runAccount(acc);
    await delay(config.DELAYS.betweenAccounts);
  }

  console.log("🎯 All accounts done");
})();