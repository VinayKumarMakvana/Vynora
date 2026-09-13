const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

// Simple mongoose schema for Lead and Contact since we just need to delete
const leadSchema = new mongoose.Schema({}, { strict: false });
const Lead = mongoose.model('Lead', leadSchema);

const contactSchema = new mongoose.Schema({}, { strict: false });
const Contact = mongoose.model('Contact', contactSchema);

async function run() {
  await mongoose.connect(process.env.MONGO_URI || '');
  console.log('Connected to MongoDB');

  const res1 = await Lead.deleteMany({
    $or: [
      { email: { $exists: false } },
      { email: null },
      { email: '' },
      { email_source: 'NO_PUBLIC_BUSINESS_EMAIL' }
    ]
  });
  console.log(`Deleted ${res1.deletedCount} leads without email.`);

  const res2 = await Contact.deleteMany({
    $or: [
      { email: { $exists: false } },
      { email: null },
      { email: '' }
    ]
  });
  console.log(`Deleted ${res2.deletedCount} contacts without email.`);

  await mongoose.disconnect();
}

run().catch(console.error);
