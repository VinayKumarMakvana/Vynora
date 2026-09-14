import { Config } from '../models/Config';
import { Company } from '../models/Company';
import { Contact } from '../models/Contact';
import { Lead } from '../models/Lead';
import { Research } from '../models/Research';
import { LeadScore } from '../models/LeadScore';
import { Log } from '../models/Log';
import axios from 'axios';
import https from 'https';
import dns from 'dns/promises';

// Force IPv4 to avoid ENETUNREACH on Render (which doesn't support IPv6 outbound)
const ipv4Agent = new https.Agent({ family: 4 });
import { aiGatewayService } from './aiGateway.service';

export class LeadSourcingService {
  private async getConfig() {
    const configs = await Config.find({ is_active: true });
    const cfg: Record<string, string> = {};
    configs.forEach(c => cfg[c.config_key] = c.config_value);
    return cfg;
  }

  private async logEvent(execution_id: string, entity_id: string, action: string, result: string, severity: string, error?: string) {
    await Log.create({
      execution_id, workflow: 'VYNORA-W10-Lead-Sourcing', entity_id, action, result, severity, error, human_approval: false, log_time: new Date()
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

  private async fetchSafe(url: string) {
    try {
      const res = await axios.get(url, { timeout: 12000, maxRedirects: 3, validateStatus: () => true });
      return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    } catch (e) {
      return '';
    }
  }

  private pickEmail(text: string, domain: string) {
    const list = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
    for (const e of list) {
      const el = e.toLowerCase();
      if (el.endsWith('@' + domain) || el.includes(domain.split('.')[0])) return el;
    }
    return '';
  }

  async runSourcing(sourceId?: string) {
    const execution_id = sourceId || `exec-src-${Date.now()}`;
    const cfg = await this.getConfig();
    
    const areaList = String(cfg.sourcing_areas || cfg.sourcing_area || 'Manchester,London,Birmingham,Leeds,Glasgow,Dubai,Abu Dhabi,Sharjah,New York,Los Angeles,Chicago,Sydney,Melbourne,Brisbane').split(',').map(s => s.trim()).filter(Boolean);
    const areas = areaList.length ? areaList : ['Manchester'];
    const rotIdx = Math.floor(Date.now() / (4 * 3600 * 1000)) % areas.length;
    const area = areas[rotIdx];
    console.log(`[Sourcing] Target city this rotation: ${area} (${rotIdx + 1}/${areas.length})`);


    // RESEARCH TARGET = 200 RAW BUSINESSES
    const cap = 200;

    const defaultGroups = 'amenity=dentist;amenity=clinic;amenity=doctors|office=it;office=telecommunication;office=company|office=lawyer;office=estate_agent;office=accountant;office=financial|industrial=factory;industrial=manufacturing;craft=builder|healthcare=hospital;tourism=hotel;leisure=resort|office=advertising_agency;office=consulting;office=architect|shop=jewelry;shop=beauty;shop=clothes;amenity=restaurant';
    const filterGroups = String(cfg.sourcing_osm_filters || defaultGroups).split('|').map(s => s.trim()).filter(Boolean);
    const groups = filterGroups.length ? filterGroups : ['office=company'];
    const filterGroup = groups[rotIdx % groups.length];
    const rawFilters = filterGroup.split(';').map(s => s.trim()).filter(Boolean);

    const clauses = [];
    for (const f of rawFilters) {
      let tag;
      if (f.indexOf('=') !== -1) {
        const parts = f.split('='); const k = parts[0].trim(); const v = parts.slice(1).join('=').trim();
        if (!k || !v) continue;
        tag = '["' + k + '"="' + v + '"]';
      } else { tag = '["' + f + '"]'; }
      clauses.push(`  nwr${tag}["website"](area.searchArea);`);
      clauses.push(`  nwr${tag}["contact:website"](area.searchArea);`);
      clauses.push(`  nwr${tag}["contact:email"](area.searchArea);`);
      clauses.push(`  nwr${tag}["email"](area.searchArea);`);
    }

    // Shared data structures for both Overpass and fallback
    const seenDomain: any = {};
    const businesses: any[] = [];

    // Optimized timeout to prevent 504 hanging
    const ql = `[out:json][timeout:140];\narea["name"="${area}"]->.searchArea;\n(\n${clauses.join('\n')}\n);\nout tags center ${cap * 3};`;

    let elements = [];
    const endpoints = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
      'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
    ];

    let success = false;
    let lastError = '';

    for (const url of endpoints) {
      try {
        const payload = 'data=' + encodeURIComponent(ql);
        const res = await axios.post(url, payload, { 
          headers: { 
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'VynoraAIAgency/1.0 (vinaytailor8432@gmail.com)'
          }, 
          timeout: 150000,
          httpsAgent: ipv4Agent  // Force IPv4 — fixes ENETUNREACH on Render
        });
        if (res.data && Array.isArray(res.data.elements)) {
          elements = res.data.elements;
          success = true;
          break; // Success! Exit the fallback loop.
        }
      } catch (e: any) {
        lastError = e.message;
        console.warn(`Overpass API timeout/error on ${url}: ${e.message}. Trying next mirror...`);
      }
    }

    if (!success) {
      console.warn(`[Sourcing] All Overpass mirrors failed. Switching to UK Business Directory fallback...`);
      
      // ── FALLBACK: UK Business Directory Scraping ────────────────────────
      // Yell.com and FreeIndex are reliable UK directory sources
      const keywords = rawFilters.map(f => f.split('=').pop() || 'company').join(',');
      const yellUrl = `https://www.yell.com/ucs/UcsSearchAction.do?keywords=${encodeURIComponent(keywords)}&location=${encodeURIComponent(area)}&pageNum=1`;
      const freeidxUrl = `https://www.freeindex.co.uk/search.htm?q=${encodeURIComponent(keywords)}&l=${encodeURIComponent(area)}`;
      
      let fallbackHtml = '';
      const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(keywords + ' in ' + area)}`;
      for (const dirUrl of [yellUrl, freeidxUrl, ddgUrl]) {
        try {
          const r = await axios.get(dirUrl, { 
            timeout: 30000, 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
            httpsAgent: ipv4Agent 
          });
          if (typeof r.data === 'string' && r.data.length > 500) {
            fallbackHtml += r.data;
            break;
          }
        } catch (e: any) {
          console.warn(`[Sourcing] Directory fallback failed on ${dirUrl}: ${e.message}`);
        }
      }

      // Parse business websites from directory HTML
      if (fallbackHtml.length > 0) {
        const websiteMatches = fallbackHtml.match(/https?:\/\/(?!www\.yell|www\.freeindex|duckduckgo|google)[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s"'<>]*)?/gi) || [];
        const uniqueUrls = [...new Set(websiteMatches)].slice(0, cap);
        for (const url of uniqueUrls) {
          const domain = this.domainFromUrl(url);
          if (!domain || seenDomain[domain]) continue;
          seenDomain[domain] = true;
          const slug = domain.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
          businesses.push({
            raw_name: domain, norm_name: domain, company: domain, domain,
            website: `https://${domain}`, city: area, category: keywords,
            phone: '', osm_email: '', website_present: true,
            company_id: 'CO-DIR-' + slug, lead_dedupe_key: 'dir:' + domain,
            source: 'UK-Directory/Yell', source_ref: 'directory'
          });
        }
        console.log(`[Sourcing] Directory fallback extracted ${businesses.length} potential leads.`);
      }

      if (businesses.length === 0) {
        await this.logEvent(execution_id, 'none', `All sourcing endpoints failed. Last Overpass error: ${lastError}`, 'Failed', 'High');
        return { status: 'error', message: 'All sourcing endpoints failed' };
      }
      // Skip to processing if fallback found leads
    } else {
      // ── OVERPASS SUCCESS: Parse elements into businesses array ─────────────
      if (elements.length === 0) {
        await this.logEvent(execution_id, 'none', 'No workable businesses discovered (empty/failed source or all filtered)', 'Empty', 'Low');
        return { status: 'success', message: 'No businesses found' };
      }

      for (const el of elements) {
        const t = el.tags || {};
        const name = String(t.name || '').trim();
        const website = String(t.website || t['contact:website'] || '').trim();
        const osmEmail = String(t['contact:email'] || t.email || '').trim().toLowerCase();
        let domain = this.domainFromUrl(website);
        
        if (!domain && osmEmail.indexOf('@') !== -1) {
          const cand = osmEmail.split('@')[1];
          if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(cand)) domain = cand;
        }
        if (!name || !domain) continue;
        if (seenDomain[domain]) continue;
        seenDomain[domain] = true;

        const city = String(t['addr:city'] || t['addr:town'] || '').trim();
        let category = '';
        if (t.amenity) category = String(t.amenity);
        else if (t.office) category = 'office:' + String(t.office);
        else if (t.shop) category = 'shop:' + String(t.shop);

        const phone = String(t.phone || t['contact:phone'] || '').trim();
        const norm = this.normName(name);
        const slug = domain.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');

        businesses.push({
          raw_name: name, norm_name: norm, company: name, domain, website: website.replace(/\/$/, ''),
          city, category, phone, osm_email: /^(example|test|noreply|no-reply)@/.test(osmEmail) ? '' : osmEmail,
          website_present: !!website, company_id: 'CO-OSM-' + slug, lead_dedupe_key: 'osm:' + domain,
          source: 'OpenStreetMap/Overpass', source_ref: `${el.type || 'node'}/${el.id || ''}`
        });
        if (businesses.length >= cap) break;
      }

      if (businesses.length === 0) {
        await this.logEvent(execution_id, 'none', 'No workable businesses discovered (empty/failed source or all filtered)', 'Empty', 'Low');
        return { status: 'success', message: 'No viable businesses extracted' };
      }
    } // end else (Overpass success)

    let processedCount = 0;
    
    for (const biz of businesses) {
      const existingCompanyDomain = await Company.findOne({ domain: biz.domain });
      const existingCompanyName = await Company.findOne({ name: biz.company });
      const company_is_duplicate = !!existingCompanyDomain || !!existingCompanyName;
      const existing_company_id = existingCompanyDomain ? existingCompanyDomain.company_id : (existingCompanyName ? existingCompanyName.company_id : '');
      const company_id = company_is_duplicate ? existing_company_id : biz.company_id;

      const base = biz.website || `https://${biz.domain}`;
      
      // PASS 1 & 2: MULTI-PASS ENRICHMENT (Website + Contact + About + Locations/Booking)
      const [html, contactHtml, aboutHtml, locationHtml, bookingHtml] = await Promise.all([
        this.fetchSafe(base),
        this.fetchSafe(`${base}/contact`),
        this.fetchSafe(`${base}/about`),
        this.fetchSafe(`${base}/locations`),
        this.fetchSafe(`${base}/booking`)
      ]);

      const site_ok = html.length > 0 || contactHtml.length > 0;
      let description = '';
      const m = (html + ' ' + aboutHtml).match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
      if (m) description = m[1].trim();

      const domain = biz.domain;
      let email = this.pickEmail(contactHtml, domain) || this.pickEmail(html, domain) || this.pickEmail(aboutHtml, domain) || this.pickEmail(locationHtml, domain) || this.pickEmail(bookingHtml, domain);
      
      if (!email) {
        // Fallback: any email
        const all = (contactHtml + ' ' + html + ' ' + aboutHtml).match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
        if (all.length) email = all[0].toLowerCase();
      }
      if (/^(example|test|noreply|no-reply|sales|info)@/.test(email) && email !== biz.osm_email) {
          // If we found a generic one, keep searching OSM
      }
      
      // PASS 3: Fallback to OSM / public listings data we have
      if (!email && biz.osm_email.includes('@') && !/^(example|test|noreply|no-reply)@/.test(biz.osm_email)) {
        email = biz.osm_email;
      }

      const email_found = email.length > 0;
      const email_source = email ? (this.pickEmail(contactHtml, domain) ? 'contact_page' : (this.pickEmail(html, domain) ? 'homepage' : (this.pickEmail(aboutHtml, domain) ? 'about_page' : 'osm'))) : 'NO_PUBLIC_BUSINESS_EMAIL';

      const freeProviders = ['gmail.com','yahoo.com','hotmail.com','outlook.com','aol.com','icloud.com','proton.me','protonmail.com','gmx.com','live.com','msn.com','yandex.com','mail.com'];
      const disposable = ['mailinator.com','guerrillamail.com','10minutemail.com','tempmail.com','trashmail.com','yopmail.com','sharklasers.com'];
      const syntaxOk = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email);
      const emailDom = email.includes('@') ? email.split('@')[1] : '';
      const isFreeProvider = freeProviders.includes(emailDom);
      const isDisposable = disposable.includes(emailDom);
      const isBusinessDomainEmail = syntaxOk && !isFreeProvider && !isDisposable && emailDom === domain;

      // PASS 4: REAL EMAIL VERIFICATION (DNS/MX)
      let mxFound = false;
      if (syntaxOk && !isDisposable) {
        try {
          const mxRecords = await dns.resolveMx(emailDom);
          mxFound = mxRecords && mxRecords.length > 0;
        } catch (e) {
          mxFound = false;
        }
      }

      let email_status = 'none';
      let email_verified = false;
      if (email_found) {
        if (!syntaxOk || isDisposable) email_status = 'invalid';
        else if (isBusinessDomainEmail && mxFound) { email_status = 'verified'; email_verified = true; }
        else if (isBusinessDomainEmail && !mxFound) email_status = 'uncertain';
        else if (!isBusinessDomainEmail && mxFound) { email_status = 'verified'; email_verified = true; } // e.g. legitimate generic business gmail
        else email_status = 'found';
      }

      let dm_name = ''; let dm_title = '';
      const dm = html.match(/(?:practice manager|managing director|founder|owner|ceo|principal|director)\s*[:-]?\s*(?:Dr\.?\s*)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/);
      if (dm) {
        dm_name = dm[1].trim();
        const roleMatch = html.match(/(practice manager|managing director|founder|owner|ceo|principal|director)/i);
        dm_title = roleMatch ? roleMatch[1] : '';
      }
      const decision_maker = dm_name.length > 0;

      let contact_key = '';
      if (email_found) contact_key = email;
      else if (dm_name) contact_key = `${dm_name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}@${domain}`;
      const has_contact = contact_key.length > 0;
      const contact_id = has_contact ? `CT-${company_id}-${contact_key.replace(/[^a-z0-9]+/gi, '-')}` : '';

      // ── STRICT EMAIL & MX GATE (BEFORE AI) ─────────────────────────────────
      // We ONLY want leads with a verified working email to save tokens and time.
      if (!email_found || !syntaxOk || isDisposable || !mxFound) {
        continue; // Discard immediately
      }

      try {
        await Company.findOneAndUpdate({ company_id }, {
          company_id, name: biz.company, domain, industry: biz.category, country: biz.city, website: biz.website,
          status: 'sourced', source: biz.source
        } as any, { upsert: true });
      } catch (e: any) {
        await this.logEvent(execution_id, company_id, `CRM write failed — company ${domain} not saved; skipped`, 'Write Failed', 'High', e.message);
        continue;
      }

      if (has_contact) {
        try {
          await Contact.findOneAndUpdate({ contact_id }, {
            contact_id, company_id, name: dm_name, title: dm_title, email, email_status, phone: biz.phone,
            decision_maker, opt_out: false, status: 'sourced', source: biz.source
          } as any, { upsert: true });
        } catch (e) { }
      }

      const existingLead = await Lead.findOne({ dedupe_key: biz.lead_dedupe_key });
      if (existingLead) {
        continue;
      }

      // RESEARCH BUSINESS NEED VIA AI
      let relevant_service = 'Website development / redesign';
      let likely_pain_point = 'Manual processes';
      let service_fit = 40;
      let evidenceText = description;

      const ind = String(biz.category).toLowerCase();
      const isPremiumCategory = /health|clinic|dentist|hospital|shop|store|estate_agent|lawyer|architect/.test(ind);

      if (!site_ok && isPremiumCategory) {
        // NO-WEBSITE PREMIUM PRIORITIZATION
        relevant_service = 'Website development';
        service_fit = 95;
        likely_pain_point = 'No digital presence or website';
        evidenceText = 'Business is in a premium category but has no public website. Urgent need for digital presence to capture local search traffic.';
      } else if (site_ok) {
        // RUN AI ONLY IF WEBSITE EXISTS AND MX IS VERIFIED
        const textToAnalyze = (html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 1500) + ' ' + description).trim();
        const systemPrompt = `You are a B2B research assistant. Analyze the following public business text and return ONLY a strict JSON object with:
{
  "relevant_service": "One of: website development, website redesign, web apps/software, UI/UX, mobile apps, AI automation, business workflow automation",
  "likely_pain_point": "A concise 3-5 word description of the biggest likely digital pain point (e.g., 'manual patient intake', 'poor mobile conversion')",
  "service_fit_score": integer 1-100,
  "evidence": "1-2 short sentences justifying the score and pain point based strictly on the provided text"
}
Do not include markdown tags.`;
        
        try {
          const aiResult = await aiGatewayService.processAiRequest({ prompt: textToAnalyze, system_prompt: systemPrompt, temperature: 0.2, max_tokens: 300 });
          if (aiResult.success) {
             const cleanedText = aiResult.text.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
             const data = JSON.parse(cleanedText);
             if (data.relevant_service) relevant_service = data.relevant_service;
             if (data.likely_pain_point) likely_pain_point = data.likely_pain_point;
             if (data.service_fit_score) service_fit = Number(data.service_fit_score);
             if (data.evidence) evidenceText = data.evidence;
          }
        } catch (e) {
          // Fallback to basic heuristics if AI fails
          if (/health|clinic|dentist|hospital/.test(ind)) { relevant_service = 'business workflow automation'; service_fit = 85; likely_pain_point = 'Manual patient intake'; }
          else if (/hotel|hospitality|resort/.test(ind)) { relevant_service = 'UI/UX'; service_fit = 82; likely_pain_point = 'Direct booking friction'; }
          else if (/factory|manufacturing|builder/.test(ind)) { relevant_service = 'business workflow automation'; service_fit = 80; likely_pain_point = 'Supply chain visibility'; }
          else if (/estate_agent|architect/.test(ind)) { relevant_service = 'website development'; service_fit = 85; likely_pain_point = 'Poor portfolio display'; }
          else { relevant_service = 'website redesign'; service_fit = 75; likely_pain_point = 'Outdated digital presence'; }
        }
      }

      let digital_gap = 30;
      if (!site_ok) digital_gap = 90;
      else if (description && description.length < 60) digital_gap = 55;
      else digital_gap = 40;

      const evidenceScore = (site_ok ? 60 : 20) + (description ? 20 : 0) + (email_source === 'contact_page' ? 20 : (email_source === 'homepage' ? 15 : 5));
      const contactability = email_verified ? 95 : (email_found ? 50 : 10);
      const business_quality = decision_maker ? 70 : 50;
      const geography = /manchester|uk|united kingdom/.test((biz.city).toLowerCase()) ? 80 : 50;

      // QUALITY SCORE
      let fit_score = Math.round(service_fit * 0.28 + digital_gap * 0.20 + evidenceScore * 0.16 + contactability * 0.18 + business_quality * 0.10 + geography * 0.08);

      // Force 95+ score for Premium No-Website leads so they go to the top of the queue
      if (!site_ok && isPremiumCategory) fit_score = Math.max(fit_score, 95);

      const priority = fit_score >= 80 ? 'High' : (fit_score >= 60 ? 'Medium' : 'Low');
      const lead_id = `LEAD-OSM-${domain.replace(/[^a-z0-9]+/gi, '-')}`;
      const notes = `Sourced via ${biz.source} (${biz.source_ref}). Website: ${biz.website}. Email ${email_found ? `found via ${email_source} (${email_verified ? 'MX Verified' : 'Unverified'})` : 'NO_PUBLIC_BUSINESS_EMAIL'}. DM ${decision_maker ? 'identified' : 'unknown'}. Fit Score: ${fit_score}.`;

      try {
        await LeadScore.findOneAndUpdate({ lead_id }, {
          score_id: `SCORE-${lead_id}`, lead_id,
          fit_score, total_score: fit_score, priority,
          rationale: 'Scored by W10 Lead Sourcing AI.'
        }, { upsert: true });
        await Lead.findOneAndUpdate({ lead_id }, {
          lead_id, company_id, contact_id, opportunity_id: '', lead_source: biz.source,
          qualification_status: fit_score >= 60 && email_verified ? 'Qualified' : 'Unqualified', 
          outreach_eligible: fit_score >= 60 && email_verified, bdm_owner: 'Unassigned',
          stage: 'sourced', status: 'new', dedupe_key: biz.lead_dedupe_key, notes, source: biz.source
        } as any, { upsert: true });

        await Research.findOneAndUpdate({ research_id: `RES-${biz.lead_dedupe_key}` }, {
          research_id: `RES-${biz.lead_dedupe_key}`, company_id, lead_id,
          summary: description || `${biz.company} — ${biz.category}`,
          signals: `fit_score:${fit_score}; website:${site_ok ? 'reachable' : 'unavailable'}; email:${email_status}; dm:${decision_maker}`,
          likely_pain_point, relevant_service, evidence: evidenceText,
          source: biz.source, status: 'sourced'
        } as any, { upsert: true });

        if (email_verified) {
          await this.logEvent(execution_id, lead_id, `Sourced high-fit ${biz.company} (${domain}). email=${email_status}, fit=${fit_score}`, 'Sourced', 'Low');
        }
        processedCount++;
        
        // Target specifically 200 fully verified leads per shift
        if (processedCount >= 200) {
          break;
        }
      } catch (e) { }
    }

    return { status: 'success', processedCount };
  }
}

export const leadSourcingService = new LeadSourcingService();
