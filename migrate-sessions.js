const mongoose = require('mongoose');
const dotenv = require('dotenv');
const AccountSession = require('./models/AccountSession');
const accounts = require('./accounts.json'); // your current file
const fs = require('fs');

dotenv.config();

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('✅ Connected to MongoDB for migration');

    for (let i = 0; i < accounts.length; i++) {
      const acc = accounts[i];
      const sessionPath = acc.session;

      if (!fs.existsSync(sessionPath)) {
        console.log(`⚠️ Missing session file: ${sessionPath}`);
        continue;
      }

      const sessionData = fs.readFileSync(sessionPath, 'utf-8');

      await AccountSession.findOneAndUpdate(
        { index: i + 1 },
        {
          index: i + 1,
          name: acc.name,
          sessionData: sessionData,
          status: 'active'
        },
        { upsert: true, new: true }
      );

      console.log(`✅ Migrated → Index ${i + 1} | ${acc.name}`);
    }

    console.log('🎉 Migration completed successfully!');
    process.exit(0);
  })
  .catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  });