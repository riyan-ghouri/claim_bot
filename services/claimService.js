const puppeteer = require("puppeteer");
const AccountSession = require("../models/AccountSession");
const { addLog, sleep, setLastRunTime } = require("../utils/logger");
const { getChromiumExecutablePath } = require("../utils/chromium");
const { uploadScreenshotAndLog } = require("../utils/screenshot");

let isRunning = false;

const getIsRunning = () => isRunning;

// ── Cooldown detection (checks all known cooldown signals) ──
async function isCooldownActive(page) {
  return page.evaluate(() => {
    const text = document.body.innerText || "";

    const hasCooldownText =
      text.includes("Just a little longer") ||
      text.includes("coming soon") ||
      text.includes("Coming soon") ||
      text.includes("More G$ coming soon");

    // Timer circle with HH:MM:SS pattern e.g. "03:36:46"
    const hasTimerText = /\d{1,2}:\d{2}:\d{2}/.test(text);

    // Any element whose class suggests a countdown/timer
    const hasTimerElement =
      !!document.querySelector('[class*="timer"]') ||
      !!document.querySelector('[class*="countdown"]') ||
      !!document.querySelector('[class*="cooldown"]') ||
      !!document.querySelector('[class*="Clock"]') ||
      !!document.querySelector('[class*="Timer"]');

    return hasCooldownText || hasTimerText || hasTimerElement;
  });
}

// ── Find the real claim button (not just any button) ──
async function findClaimButton(page) {
  return page.evaluate(() => {
    // Priority 1: element with claimButtonText class
    const claimText = document.querySelector('[class*="claimButtonText"]');
    if (claimText) return { found: true, type: "claimButtonText" };

    // Priority 2: button/div that literally says "Claim"
    const allButtons = [
      ...document.querySelectorAll("button"),
      ...document.querySelectorAll('[role="button"]'),
      ...document.querySelectorAll('[class*="button"]'),
      ...document.querySelectorAll('[class*="Button"]'),
    ];

    for (const btn of allButtons) {
      const txt = (btn.innerText || btn.textContent || "").trim().toLowerCase();
      if (txt === "claim" || txt === "claim now" || txt === "claim g$") {
        const disabled =
          btn.disabled ||
          btn.getAttribute("aria-disabled") === "true" ||
          btn.classList.toString().toLowerCase().includes("disabled");
        return { found: true, type: "claimText", disabled };
      }
    }

    // Priority 3: claimButton class wrapper
    const claimBtn = document.querySelector('[class*="claimButton"]');
    if (claimBtn) {
      const disabled =
        claimBtn.getAttribute("aria-disabled") === "true" ||
        claimBtn.classList.toString().toLowerCase().includes("disabled");
      return { found: true, type: "claimButton", disabled };
    }

    return { found: false };
  });
}

// ── Check if claim button is disabled / already claimed ──
async function isAlreadyClaimed(page) {
  return page.evaluate(() => {
    if (document.querySelector('[class*="textDisabled"]')) return true;
    if (document.querySelector("button:disabled")) return true;

    const allButtons = [
      ...document.querySelectorAll("button"),
      ...document.querySelectorAll('[role="button"]'),
      ...document.querySelectorAll('[class*="button"]'),
      ...document.querySelectorAll('[class*="Button"]'),
    ];

    for (const btn of allButtons) {
      const txt = (btn.innerText || btn.textContent || "").trim().toLowerCase();
      if (txt === "claim" || txt === "claim now" || txt === "claim g$") {
        if (
          btn.disabled ||
          btn.getAttribute("aria-disabled") === "true" ||
          btn.classList.toString().toLowerCase().includes("disabled")
        ) {
          return true;
        }
      }
    }

    return false;
  });
}

// ── Actually click the claim button with full mouse events ──
async function clickClaimButton(page) {
  return page.evaluate(() => {
    // Priority 1: claimButtonText element
    let btn = document.querySelector('[class*="claimButtonText"]');

    // Priority 2: button/div with exact "Claim" text
    if (!btn) {
      const candidates = [
        ...document.querySelectorAll("button"),
        ...document.querySelectorAll('[role="button"]'),
        ...document.querySelectorAll('[class*="claimButton"]'),
      ];
      for (const el of candidates) {
        const txt = (el.innerText || el.textContent || "").trim().toLowerCase();
        if (txt === "claim" || txt === "claim now" || txt === "claim g$") {
          btn = el;
          break;
        }
      }
    }

    // Priority 3: any claimButton wrapper
    if (!btn) btn = document.querySelector('[class*="claimButton"]');

    if (!btn) return { clicked: false, reason: "No button found" };

    // Scroll into view then fire full mouse event sequence
    btn.scrollIntoView({ behavior: "smooth", block: "center" });
    btn.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    btn.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    btn.dispatchEvent(new MouseEvent("mouseup",   { bubbles: true }));
    btn.dispatchEvent(new MouseEvent("click",     { bubbles: true }));
    btn.click();

    return {
      clicked: true,
      tag: btn.tagName,
      type: btn.className.substring(0, 80),
    };
  });
}

// ═══════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════
async function runAccountByIndex(index, isCronTrigger = false) {
  if (isRunning) return;

  isRunning = true;
  addLog(`🚀 Starting claim for account index: ${index} ${isCronTrigger ? "(Cron)" : "(Manual)"}`);

  let browser;

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

    addLog(`🌐 Navigating: ${account.name}`);

    // Inject session
    await page.evaluateOnNewDocument((sessionJson) => {
      localStorage.clear();
      localStorage.setItem("SIGNER_SESSION", sessionJson);
      localStorage.setItem("Tracking_Sentry", "allowed");
      localStorage.setItem("Tracking_Amplitude", "allowed");
      localStorage.setItem("defaultLoginMethod", "google");
    }, account.sessionData);

    // Navigation
    await page.goto("https://goodwallet.xyz/en/gooddollar", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await sleep(10000);

    // Retry if redirected away
    if (!page.url().includes("/gooddollar")) {
      addLog(`🔁 Redirected — retrying navigation`);
      await page.goto("https://goodwallet.xyz/en/gooddollar", {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await sleep(8000);
    }

    addLog(`🚀 Running: ${account.name}`);

    // Initial Screenshot
    let buffer = await page
      .screenshot({ encoding: "binary", type: "jpeg", quality: 65 })
      .catch(() => null);
    await uploadScreenshotAndLog(account, buffer, "initial-load", "After navigation");

    // ── COOLDOWN CHECK 1 — right after page load ──
    const cooldown1 = await isCooldownActive(page);
    if (cooldown1) {
      addLog(`⏳ Cooldown detected (early check)`);
      buffer = await page
        .screenshot({ encoding: "binary", type: "jpeg", quality: 65 })
        .catch(() => null);
      await uploadScreenshotAndLog(account, buffer, "cooldown", "Cooldown screen");
      await AccountSession.findOneAndUpdate(
        { index: Number(index) },
        { lastClaimed: new Date() },
      );
      return;
    }

    // ── WAIT FOR CLAIM BUTTON with retry + cooldown re-check each round ──
    addLog(`⏳ Waiting for claim button...`);
    let btnInfo = { found: false };

    for (let i = 0; i < 4; i++) {
      await sleep(5000);

      // Re-check cooldown — page may still be rendering
      const cooldownRetry = await isCooldownActive(page);
      if (cooldownRetry) {
        addLog(`⏳ Cooldown detected (retry ${i + 1}) — stopping`);
        buffer = await page
          .screenshot({ encoding: "binary", type: "jpeg", quality: 65 })
          .catch(() => null);
        await uploadScreenshotAndLog(account, buffer, "cooldown", "Cooldown during wait");
        await AccountSession.findOneAndUpdate(
          { index: Number(index) },
          { lastClaimed: new Date() },
        );
        return;
      }

      btnInfo = await findClaimButton(page);
      addLog(`🔍 Attempt ${i + 1}/4: found=${btnInfo.found} type=${btnInfo.type || "none"}`);
      if (btnInfo.found) break;
    }

    if (!btnInfo.found) {
      addLog(`⚠️ Claim button not found after all retries`);
      buffer = await page
        .screenshot({ encoding: "binary", type: "jpeg", quality: 65 })
        .catch(() => null);
      await uploadScreenshotAndLog(account, buffer, "ui-missing", "Claim button not found");
      await AccountSession.findOneAndUpdate(
        { index: Number(index) },
        { status: "error", lastError: "UI missing" },
      );
      return;
    }

    // ── COOLDOWN CHECK 2 — final check right before clicking ──
    const cooldown2 = await isCooldownActive(page);
    if (cooldown2) {
      addLog(`⏳ Cooldown detected (pre-click) — skipping`);
      buffer = await page
        .screenshot({ encoding: "binary", type: "jpeg", quality: 65 })
        .catch(() => null);
      await uploadScreenshotAndLog(account, buffer, "cooldown-preclick", "Cooldown before click");
      await AccountSession.findOneAndUpdate(
        { index: Number(index) },
        { lastClaimed: new Date() },
      );
      return;
    }

    // ── ALREADY CLAIMED CHECK — button exists but is disabled ──
    const alreadyClaimed = await isAlreadyClaimed(page);
    if (alreadyClaimed) {
      addLog(`⛔ Button found but disabled — already claimed today`);
      buffer = await page
        .screenshot({ encoding: "binary", type: "jpeg", quality: 65 })
        .catch(() => null);
      await uploadScreenshotAndLog(account, buffer, "already-claimed", "Button disabled");
      await AccountSession.findOneAndUpdate(
        { index: Number(index) },
        { lastClaimed: new Date() },
      );
      return;
    }

    // ── BEFORE CLICK SCREENSHOT ──
    buffer = await page
      .screenshot({ encoding: "binary", type: "jpeg", quality: 65 })
      .catch(() => null);
    await uploadScreenshotAndLog(account, buffer, "before-claim", "Before click");

    // ── CLICK ──
    const clickResult = await clickClaimButton(page);
    if (!clickResult.clicked) {
      addLog(`❌ Click failed: ${clickResult.reason}`);
      await AccountSession.findOneAndUpdate(
        { index: Number(index) },
        { status: "error", lastError: `Click failed: ${clickResult.reason}` },
      );
      return;
    }

    addLog(`💰 Claim clicked — element: ${clickResult.type}`);
    await sleep(12000);

    // ── VERIFY: check page changed to cooldown/disabled (confirms click worked) ──
    const verifiedCooldown = await isCooldownActive(page);
    const verifiedDisabled = await isAlreadyClaimed(page);

    buffer = await page
      .screenshot({ encoding: "binary", type: "jpeg", quality: 65 })
      .catch(() => null);
    await uploadScreenshotAndLog(account, buffer, "after-claim", "After click");

    if (verifiedCooldown || verifiedDisabled) {
      addLog(`✅ Claim verified — page entered cooldown/disabled state`);
    } else {
      addLog(`✅ Claim completed — page state updated`);
    }

    await AccountSession.findOneAndUpdate(
      { index: Number(index) },
      { lastClaimed: new Date() },
    );

  } catch (err) {
    addLog(`❌ Error: ${err.message}`);
    await AccountSession.findOneAndUpdate(
      { index: Number(index) },
      { status: "error", lastError: err.message },
    );

    if (browser) {
      try {
        const page = (await browser.pages())[0];
        const errBuffer = await page
          .screenshot({ encoding: "binary", type: "jpeg", quality: 65 })
          .catch(() => null);
        await uploadScreenshotAndLog(
          { name: `Index-${index}` },
          errBuffer,
          "error",
          err.message,
        );
      } catch (_) {}
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    isRunning = false;
    setLastRunTime(new Date());
    addLog(`🏁 Finished processing account index ${index}`);
  }
}

module.exports = { runAccountByIndex, getIsRunning };