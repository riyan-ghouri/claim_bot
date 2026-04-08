const fs = require('fs');

module.exports = {
  // URLs
  URLS: {
    home: 'https://goodwallet.xyz/en',
    claim: 'https://goodwallet.xyz/en/gooddollar'
  },

  // Selectors
  SELECTORS: {
    claimContainer: 'div[class*="claimButtonText"]',   // Main claim button
    disabledText: 'span[class*="textDisabled"]'       // "Already claimed" text
  },

  // Timing settings (you can adjust these)
  TIMING: {
    pageLoadTimeout: 45000,      // 45 seconds
    initialWait: 8000,           // Wait after page load
    afterClickWait: 8000,        // Wait after clicking claim button
    screenshotTimeout: 20000
  },

  // Note: LOCAL_STORAGE_KEYS is no longer needed here
  // because we are injecting session directly from MongoDB in index.js
};