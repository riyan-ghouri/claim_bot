const fs = require("fs");

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

module.exports = { getChromiumExecutablePath };
