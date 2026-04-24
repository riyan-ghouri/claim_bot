const puppeteer = require("puppeteer");
const AccountSession = require("../models/AccountSession");
const { addLog, sleep, setLastRunTime } = require("../utils/logger");
const { getChromiumExecutablePath } = require("../utils/chromium");
const { uploadScreenshotAndLog } = require("../utils/screenshot");
const { sendClaimReport } = require("../utils/email");

let isRunning = false;

const getIsRunning = () => isRunning;

async function runAccountByIndex(index, isCronTrigger = false) {
  if (isRunning) return;

  isRunning = true;
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

    if (!page.url().includes("/gooddollar")) {
      await page.goto("https://goodwallet.xyz/en/gooddollar", {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await sleep(8000);
    }

    // Initial Screenshot
    let buffer = await page
      .screenshot({ encoding: "binary", type: "jpeg", quality: 65 })
      .catch(() => null);
    let url = await uploadScreenshotAndLog(account, buffer, "initial-load", "After navigation");
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
      url = await uploadScreenshotAndLog(account, buffer, "cooldown", "Cooldown screen");
      if (url) screenshots.push(url);

      await AccountSession.findOneAndUpdate(
        { index: Number(index) },
        { lastClaimed: new Date() },
      );

      if (isCronTrigger)
        await sendClaimReport(account, "Cooldown", "Account is in cooldown period.", screenshots);
      return;
    }

    // Button Detection with Retry
    addLog(`⏳ Waiting for claim button...`);
    let btnExists = false;
    for (let i = 0; i < 3; i++) {
      await sleep(6000);
      btnExists = await page.evaluate(
        () =>
          document.querySelectorAll('div[class*="claimButtonText"]').length > 0 ||
          document.querySelectorAll("button").length > 3,
      );
      if (btnExists) break;
    }

    if (!btnExists) {
      addLog(`⚠️ UI missing`);
      buffer = await page
        .screenshot({ encoding: "binary", type: "jpeg", quality: 65 })
        .catch(() => null);
      url = await uploadScreenshotAndLog(account, buffer, "ui-missing", "Claim button not found");
      if (url) screenshots.push(url);

      await AccountSession.findOneAndUpdate(
        { index: Number(index) },
        { status: "error", lastError: "UI missing" },
      );

      if (isCronTrigger)
        await sendClaimReport(account, "Error", "Claim button not found after retries.", screenshots);
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
        await sendClaimReport(account, "Already Claimed", "Daily claim already done.", screenshots);
    } else {
      // Before Claim Screenshot
      buffer = await page
        .screenshot({ encoding: "binary", type: "jpeg", quality: 65 })
        .catch(() => null);
      url = await uploadScreenshotAndLog(account, buffer, "before-claim", "Before click");
      if (url) screenshots.push(url);

      // Click
      await page.evaluate(() => {
        const btn =
          document.querySelector('div[class*="claimButtonText"]') ||
          document.querySelector("button");
        if (btn) btn.click();
      });

      addLog(`💰 Claim button clicked`);
      await sleep(12000);

      // After Claim Screenshot
      buffer = await page
        .screenshot({ encoding: "binary", type: "jpeg", quality: 65 })
        .catch(() => null);
      url = await uploadScreenshotAndLog(account, buffer, "after-claim", "After claim");
      if (url) screenshots.push(url);

      addLog(`✅ Claim completed`);
      await AccountSession.findOneAndUpdate(
        { index: Number(index) },
        { lastClaimed: new Date() },
      );

      if (isCronTrigger) {
        await sendClaimReport(account, "Success", "Claim successfully processed.", screenshots);
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
          { name: `Index-${index}` },
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
    setLastRunTime(new Date());
    addLog(`🏁 Finished processing account index ${index}`);
  }
}

module.exports = { runAccountByIndex, getIsRunning };
