import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import { Lead } from '../src/models/Lead';
import { Contact } from '../src/models/Contact';

dotenv.config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || '');
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
