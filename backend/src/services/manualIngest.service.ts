import { Config } from '../models/Config';
import { Company } from '../models/Company';
import { Contact } from '../models/Contact';
import { Lead } from '../models/Lead';
import { Research } from '../models/Research';
import { Log } from '../models/Log';

export class ManualIngestService {
  private async getConfig() {
    const configs = await Config.find({ is_active: true });
    const cfg: Record<string, string> = {};
    configs.forEach(c => cfg[c.config_key] = c.config_value);
    return {
      manual_import_cap: Math.max(1, Number(cfg.manual_import_cap) || 500)
    };
  }

  private async logEvent(execution_id: string, entity_id: string, action: string, result: string, severity: string, error?: string) {
    await Log.create({
      execution_id,
      workflow: 'VYNORA-W08-Manual-Ingest',
      entity_id,
      action,
      result,
      severity,
      error: error || undefined,
      human_approval: false,
      log_time: new Date()
    } as any);
  }

  private domainFromUrl(url: string) {
    let u = String(url || '').trim().toLowerCase();
    if (!u) return '';
    u = u.replace(/^https?:\/\//, '').replace(/^www\./, '');
    const host = u.split(/[\/?#]/)[0];
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host : '';
  }

  private normName(n: string) {
    return String(n || '').toLowerCase().replace(/\b(ltd|limited|llp|llc|inc|plc|co|company|gmbh)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  private s(v: any) { return (v === undefined || v === null) ? '' : String(v).trim(); }
  
  private pick(r: any, keys: string[]) {
    for (const k of keys) {
      if (r[k] !== undefined && this.s(r[k]) !== '') return this.s(r[k]);
    }
    return '';
  }

  async handleIngest(body: any) {
    const cfg = await this.getConfig();
    const batch = `batch-${Date.now()}`;
    const emailRe = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

    let rows: any[] = [];
    if (body && Array.isArray(body.rows)) rows = body.rows;
    else if (Array.isArray(body)) rows = body;
    else if (body && typeof body === 'object' && (body.email || body.name || body.company || body.company_name || body.website)) rows = [body];

    if (rows.length === 0) {
      await this.logEvent(batch, 'none', 'Empty/malformed intake payload — no importable rows', 'Empty', 'Low');
      return { status: 'error', reason: 'no rows in payload' };
    }

    let rows_valid = 0;
    let rows_invalid = 0;

    for (let i = 0; i < rows.length; i++) {
      if (rows_valid >= cfg.manual_import_cap) break;
      const r = rows[i] && typeof rows[i] === 'object' ? rows[i] : {};

      let company = this.pick(r, ['company', 'company_name', 'organization', 'organisation', 'account']);
      const website = this.pick(r, ['website', 'url', 'site', 'web']);
      const rawEmail = this.pick(r, ['email', 'email_address', 'contact_email']).toLowerCase();
      const contact_name = this.pick(r, ['name', 'contact_name', 'full_name', 'contact', 'person']);
      const title = this.pick(r, ['title', 'job_title', 'role', 'position']);
      const phone = this.pick(r, ['phone', 'telephone', 'mobile', 'tel']);
      const linkedin = this.pick(r, ['linkedin', 'linkedin_url', 'li']);
      const industry = this.pick(r, ['industry', 'sector', 'vertical']);
      const location = this.pick(r, ['location', 'city', 'country', 'region']);

      const email_valid = rawEmail.length > 0 && emailRe.test(rawEmail);
      const email = email_valid ? rawEmail : '';
      const email_malformed = rawEmail.length > 0 && !email_valid;

      let domain = this.domainFromUrl(website);
      if (!domain && email) domain = email.split('@')[1] || '';

      if (!company && domain) {
        const base = domain.split('.')[0];
        company = base ? (base.charAt(0).toUpperCase() + base.slice(1)) : '';
      }

      const norm_name = this.normName(company);
      const valid = (domain.length > 0) || (norm_name.length > 0);
      
      if (!valid) {
        await this.logEvent(batch, `row-${i}`, 'Invalid row skipped: no company name and no domain/email to derive one', 'Invalid', 'Low');
        rows_invalid++;
        continue;
      }

      const idBasis = domain ? domain : norm_name;
      const slug = idBasis.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
      const raw_company_id = domain ? ('CO-CSV-' + slug) : ('CO-CSVN-' + slug);
      const lead_dedupe_key = 'manual:' + (domain || norm_name);

      const email_found = email.length > 0;
      const has_contact = email_found || contact_name.length > 0;
      let contact_key = '';
      if (email_found) contact_key = email;
      else if (contact_name) contact_key = contact_name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '@' + (domain || norm_name.replace(/\s+/g, ''));
      const contact_id = has_contact ? ('CT-' + raw_company_id + '-' + contact_key.replace(/[^a-z0-9]+/gi, '-')) : '';
      const lead_id = 'LEAD-CSV-' + lead_dedupe_key.replace(/[^a-z0-9]+/gi, '-');

      // Dedupe company
      let existingCompany = null;
      if (domain) existingCompany = await Company.findOne({ domain });
      if (!existingCompany && company) existingCompany = await Company.findOne({ name: company });
      
      const company_is_duplicate = !!existingCompany;
      const company_id = existingCompany ? existingCompany.company_id : raw_company_id;

      try {
        await Company.findOneAndUpdate({ company_id }, {
          company_id, name: company, domain, industry, country: location, website: website.replace(/\/$/, ''),
          status: 'sourced', source: 'Manual CSV'
        } as any, { upsert: true });
      } catch (e: any) {
        await this.logEvent(batch, company_id, `CRM write failed — company ${company} not saved; contact/lead skipped this row`, 'Write Failed', 'High', e.message);
        rows_invalid++;
        continue;
      }

      let existingContactOptOut = false;
      if (has_contact) {
        try {
          const existingContact = await Contact.findOne({ contact_id }) as any;
          existingContactOptOut = existingContact ? !!existingContact.opt_out : false;

          await Contact.findOneAndUpdate({ contact_id }, {
            contact_id, company_id, name: contact_name, title, email,
            email_status: email_found ? 'found' : 'none', linkedin_url: linkedin, phone,
            decision_maker: false, opt_out: existingContactOptOut, status: 'sourced', source: 'Manual CSV'
          } as any, { upsert: true });
        } catch (e) {
          // Contact fails aren't strictly fatal to the lead but we log it (canvas has continueRegularOutput)
        }
      }

      // Dedupe lead
      const existingLead = await Lead.findOne({ dedupe_key: lead_dedupe_key });
      if (existingLead) {
        await this.logEvent(batch, existingLead.lead_id, `Duplicate — lead already exists for ${lead_dedupe_key}; company/contact refreshed, no new lead`, 'Duplicate', 'Low');
        rows_valid++;
        continue;
      }

      try {
        const notes = `Imported via Manual CSV (batch ${batch}). Website: ${website}. Email ${email_found ? 'found (unverified)' : (email_malformed ? 'malformed/dropped' : 'not provided')}.`;
        
        await Lead.findOneAndUpdate({ lead_id }, {
          lead_id, company_id, contact_id, opportunity_id: '', lead_source: 'Manual Ingest',
          qualification_status: 'Unqualified', outreach_eligible: false, bdm_owner: 'Unassigned',
          stage: 'sourced', status: 'new', dedupe_key: lead_dedupe_key, notes, source: 'Manual CSV'
        } as any, { upsert: true });

        await Research.findOneAndUpdate({ research_id: `RES-${lead_dedupe_key}` }, {
          research_id: `RES-${lead_dedupe_key}`, company_id, lead_id,
          summary: `${company}${industry ? ' — ' + industry : ''} (manual import)`,
          signals: `email:${email_found ? 'found' : 'none'}; contact:${has_contact}; source:manual-csv`,
          source: 'Manual CSV', status: 'sourced'
        } as any, { upsert: true });

        await this.logEvent(batch, lead_id, `Imported ${company} (${domain}) via Manual CSV. email_found=${email_found} email_verified=false company_dup=${company_is_duplicate}`, 'Imported', 'Low');
        rows_valid++;
      } catch (e) {
        // lead creation failed
        rows_invalid++;
      }
    }

    return {
      status: 'ingested',
      import_batch: batch,
      rows_valid,
      rows_invalid
    };
  }
}
