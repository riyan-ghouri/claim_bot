const fs = require('fs');

module.exports = {
  URLS: {
    home: 'https://goodwallet.xyz/en',
    claim: 'https://goodwallet.xyz/en/gooddollar'
  },

  BROWSER: {
    headless: false,
    slowMo: 50
  },

  CONCURRENCY: 1, // 🔥 how many accounts run at same time


  DELAYS: {
    betweenAccounts: 2000,
    afterLogin: 3000
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
    claimText: 'Claim',
    disabledText: 'span[class*="textDisabled"]'
  },
};