import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import { Lead } from '../src/models/Lead';
import { Contact } from '../src/models/Contact';
import { Company } from '../src/models/Company';
import { LeadScore } from '../src/models/LeadScore';

dotenv.config({ path: '../.env' }); // Ensure it reads from backend/.env

async function run() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/vynora');
  console.log('Connected to MongoDB');

  // Find all contacts that have NO email or invalid email
  const badContacts = await Contact.find({
    $or: [
      { email: { $exists: false } },
      { email: null },
      { email: '' }
    ]
  });

  const badContactIds = badContacts.map(c => c.contact_id);
  console.log(`Found ${badContactIds.length} contacts without email.`);

  if (badContactIds.length > 0) {
    // Delete those contacts
    const resContact = await Contact.deleteMany({ contact_id: { $in: badContactIds } });
    console.log(`Deleted ${resContact.deletedCount} contacts.`);

    // Find and delete leads associated with these bad contacts
    const leadsToDelete = await Lead.find({ contact_id: { $in: badContactIds } });
    const leadIds = leadsToDelete.map(l => l.lead_id);
    
    if (leadIds.length > 0) {
      const resLead = await Lead.deleteMany({ lead_id: { $in: leadIds } });
      console.log(`Deleted ${resLead.deletedCount} leads.`);

      const resScore = await LeadScore.deleteMany({ lead_id: { $in: leadIds } });
      console.log(`Deleted ${resScore.deletedCount} lead scores.`);
    }
  }

  // Also delete any leads that have NO contact_id at all
  const resOrphanLeads = await Lead.deleteMany({
    $or: [
      { contact_id: { $exists: false } },
      { contact_id: null },
      { contact_id: '' }
    ]
  });
  console.log(`Deleted ${resOrphanLeads.deletedCount} orphan leads.`);

  await mongoose.disconnect();
}

run().catch(console.error);
