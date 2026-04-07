const fs = require('fs');

module.exports = {
  URLS: {
    home: 'https://goodwallet.xyz/en',
    claim: 'https://goodwallet.xyz/en/gooddollar'
  },

  BROWSER: { /* we override it in index.js */ },

  CONCURRENCY: 1,        // Change to 1 or 2 (max 3 recommended)

  DELAYS: {
    betweenTasks: 3000   // renamed for clarity
  },

  LOCAL_STORAGE_KEYS: (account) => [
    {
      key: 'SIGNER_SESSION',
      value: fs.readFileSync(account.session, 'utf-8')
    },
    { key: 'Tracking_Sentry', value: 'allowed' },
    { key: 'Tracking_Amplitude', value: 'allowed' },
    { key: 'defaultLoginMethod', value: 'google' }
  ],

  SELECTORS: {
    claimContainer: 'div[class*="claimButtonText"]',
    disabledText: 'span[class*="textDisabled"]'
  }
};