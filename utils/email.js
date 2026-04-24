const fetch = require("node-fetch");
const { addLog } = require("./logger");

async function sendClaimReport(account, status, message, screenshots = []) {
  try {
    const payload = {
      to: "riyanghouri7@gmail.com",
      subject: `GoodWallet Claim Report - ${account.name || `Index ${account.index}`}`,
      message: message,
      accountName: account.name || `Account ${account.index}`,
      index: `Index ${account.index || ""}`,
      todayReceive: "250",
      img1: screenshots[0] || "",
      img2: screenshots[1] || "",
      img3: screenshots[2] || "",
      apiKey: "RG_23456788ytfdsdfgn",
    };

    const response = await fetch("https://b3tr-wallet.vercel.app/api/send-mail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const result = await response.text();

    if (response.ok) {
      addLog(`📧 Email report sent successfully for ${account.name || account.index}`);
    } else {
      addLog(`⚠️ Email API error: ${result}`);
    }
  } catch (e) {
    addLog(`❌ Failed to send email: ${e.message}`);
    console.error("Full email error:", e);
  }
}

module.exports = { sendClaimReport };
