const fs = require('fs');

module.exports = {
  URLS: {
    home: 'https://goodwallet.xyz/en',
    claim: 'https://goodwallet.xyz/en/gooddollar'
  },

  BROWSER: {
    headless: true,
    slowMo: 100
  },

  DELAYS: {
    betweenAccounts: 5000,
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
  }
};