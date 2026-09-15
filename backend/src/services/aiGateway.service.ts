import axios from 'axios';
import { Config } from '../models/Config';
import { Log } from '../models/Log';
import { mailerService } from './mailer.service';

export interface AiGatewayPayload {
  prompt?: string;
  system_prompt?: string;
  temperature?: number;
  max_tokens?: number;
}

// ── Rate Limiting State ──────────────────────────────────────────────────────
let lastAiRequestTime = 0;
const MIN_DELAY_MS = 4500; // Strictly 1 request per 4.5s (~13 RPM) to respect Gemini free tier limit

// ── Key Rotation State ─────────────────────────────────────────────────────
// In-memory rotation index: persists for the lifetime of the process.
// When a key gets 429, we move to the next. When we wrap around, alert is sent.
let currentKeyIndex = 0;
let allKeysExhaustedAlertSentAt: number | null = null;
const ALL_KEYS_ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

function getApiKeys(): string[] {
  const keys: string[] = [];
  // Collect up to 5 named keys
  for (let i = 1; i <= 5; i++) {
    const k = (process.env[`GEMINI_API_KEY_${i}`] || '').trim();
    if (k && k !== `your_gemini_api_key_${i}_here` && k.length > 10) {
      keys.push(k);
    }
  }
  // Fallback: legacy single key
  if (keys.length === 0) {
    const legacy = (process.env.GEMINI_API_KEY || '').trim();
    if (legacy && legacy !== 'your_gemini_api_key_here' && legacy.length > 10) {
      keys.push(legacy);
    }
  }
  return keys;
}

function getCurrentKey(keys: string[]): string | null {
  if (keys.length === 0) return null;
  // Clamp index to valid range
  if (currentKeyIndex >= keys.length) currentKeyIndex = 0;
  return keys[currentKeyIndex];
}

async function rotateToNextKey(keys: string[], exhaustedIndex: number): Promise<string | null> {
  const nextIndex = exhaustedIndex + 1;

  if (nextIndex < keys.length) {
    currentKeyIndex = nextIndex;
    console.warn(`[AI-GATEWAY] Key ${exhaustedIndex + 1} quota exhausted — rotating to Key ${nextIndex + 1}`);
    // Log rotation to DB
    await Log.create({
      execution_id: `exec-${Date.now()}`,
      workflow: 'VYNORA-W00-AI-Gateway',
      entity_id: 'gemini',
      action: `key_rotation_key${nextIndex + 1}`,
      result: `Rotated from Key ${exhaustedIndex + 1} to Key ${nextIndex + 1}`,
      error: '',
      severity: 'WARNING',
      human_approval: false,
      log_time: new Date()
    }).catch(() => {});
    return keys[nextIndex];
  }

  // All keys exhausted — send alert and reset to key 1 for next cycle
  currentKeyIndex = 0;
  await handleAllKeysExhausted(keys.length);
  return null;
}

async function handleAllKeysExhausted(totalKeys: number) {
  const now = Date.now();
  // Cooldown: don't spam alert
  if (allKeysExhaustedAlertSentAt && (now - allKeysExhaustedAlertSentAt) < ALL_KEYS_ALERT_COOLDOWN_MS) {
    return;
  }
  allKeysExhaustedAlertSentAt = now;

  console.error(`[AI-GATEWAY] ⚠️ ALL ${totalKeys} Gemini API keys exhausted! Sending alert...`);

  // DB Log
  await Log.create({
    execution_id: `exec-${Date.now()}`,
    workflow: 'VYNORA-W00-AI-Gateway',
    entity_id: 'gemini',
    action: 'all_keys_exhausted',
    result: 'alert_sent',
    error: `All ${totalKeys} Gemini API keys hit quota limit. Engine will retry Key 1 on next request.`,
    severity: 'HIGH',
    human_approval: true,
    log_time: new Date()
  }).catch(() => {});

  // Email Alert
  const recipient = process.env.REPORT_EMAIL;
  if (!recipient) return;

  try {
    await mailerService.sendEmail(
      recipient,
      `⚠️ VYNORA ALERT: ALL ${totalKeys} Gemini API Keys Exhausted`,
      [
        `VYNORA AI Gateway: All ${totalKeys} Gemini API keys have hit their quota limit.`,
        ``,
        `The engine has automatically reset to Key 1 and will retry on the next cycle.`,
        `Daily quota resets at midnight PST, so operations will resume automatically.`,
        ``,
        `To avoid this in future cycles, add more API keys to backend/.env:`,
        `GEMINI_API_KEY_1=...  GEMINI_API_KEY_2=... etc.`,
        ``,
        `Alert sent at: ${new Date().toISOString()}`,
        `Total keys configured: ${totalKeys}`,
        ``,
        `This alert will not repeat for 1 hour.`
      ].join('\n')
    );
  } catch (err) {
    console.error('[AI-GATEWAY] Failed to send all-keys-exhausted alert:', err);
  }
}

// ── Main Service ───────────────────────────────────────────────────────────
export const aiGatewayService = {
  /**
   * Process the AI Request with automatic key rotation.
   * On quota error, rotates to next key and retries in same call.
   * Returns success:false only if ALL keys are exhausted.
   */
  async processAiRequest(payload: AiGatewayPayload): Promise<any> {
    // 0. Enforce Global Rate Limit (Mutex Queue)
    const now = Date.now();
    const timeSinceLast = now - lastAiRequestTime;
    if (timeSinceLast < MIN_DELAY_MS) {
      const waitTime = MIN_DELAY_MS - timeSinceLast;
      lastAiRequestTime = now + waitTime;
      await new Promise(r => setTimeout(r, waitTime));
    } else {
      lastAiRequestTime = Date.now();
    }

    // 1. Get AI Config
    const configs = await Config.find({ category: 'ai', is_active: true });
    const cfg: Record<string, string> = {};
    configs.forEach(c => { cfg[c.config_key] = c.config_value; });

    const model = (cfg.ai_model_name || '').trim();
    const endpointBase = (cfg.ai_endpoint_url || '').trim();

    let base = endpointBase;
    while (base.slice(-1) === '/') base = base.slice(0, -1);
    const url = endpointBase ? `${base}/${encodeURIComponent(model)}:generateContent` : '';
    const ready = !!url && endpointBase !== 'NEEDS_INPUT' && !!model && model !== 'NEEDS_INPUT';

    if (!ready) {
      return { success: false, text: '', error: 'AI endpoint not configured in vynora_config.' };
    }

    // 2. Build request body
    const contents: any[] = [];
    if (payload.system_prompt) {
      contents.push({ role: 'user', parts: [{ text: String(payload.system_prompt) }] });
    }
    contents.push({ role: 'user', parts: [{ text: String(payload.prompt || '') }] });

    const temp = (payload.temperature !== undefined && payload.temperature !== null) ? Number(payload.temperature) : 0.3;
    const maxTok = Math.max((payload.max_tokens !== undefined && payload.max_tokens !== null) ? Number(payload.max_tokens) : 2048, 2048);
    const body = { contents, generationConfig: { temperature: temp, maxOutputTokens: maxTok } };

    // 3. Try each key in rotation pool
    const keys = getApiKeys();
    if (keys.length === 0) {
      return { success: false, text: '', error: 'No valid Gemini API keys configured in .env' };
    }

    const startIndex = currentKeyIndex >= keys.length ? 0 : currentKeyIndex;
    let triedCount = 0;

    while (triedCount < keys.length) {
      const keyIndex = (startIndex + triedCount) % keys.length;
      const apiKey = keys[keyIndex];
      currentKeyIndex = keyIndex;

      try {
        const requestUrl = `${url}?key=${apiKey}`;
        const response = await axios.post(requestUrl, body, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 120000
        });

        const r = response.data;
        let text = '';
        if (Array.isArray(r.candidates) && r.candidates[0]) {
          const parts = r.candidates[0].content?.parts || [];
          text = parts.map((p: any) => p?.text || '').join('');
        }
        text = text.trim();
        return { success: text.length > 0, text, error: text.length > 0 ? '' : 'AI returned no usable text' };

      } catch (error: any) {
        const errResp = error.response?.data?.error || error;
        const code = errResp.code || error.response?.status;
        const status = String(errResp.status || '');
        const msg = String(errResp.message || error.message || '');
        const hay = `${status} ${msg}`.toLowerCase();

        const isQuota = (Number(code) === 429) ||
                        status === 'RESOURCE_EXHAUSTED' ||
                        /resource.?exhausted|exceeded your current quota|insufficient_quota|quota|too many requests|rate limit exceeded/i.test(hay);

        if (isQuota) {
          console.warn(`[AI-GATEWAY] Key ${keyIndex + 1}/${keys.length} quota exhausted. Trying next...`);
          triedCount++;
          currentKeyIndex = (keyIndex + 1) % keys.length;

          if (triedCount >= keys.length) {
            // All keys tried — send alert, reset, return error
            await handleAllKeysExhausted(keys.length);
            
            // If it gave a retry hint, sleep temporarily to let the engine recover on the next cycle
            const retryMatch = msg.match(/retry in ([\d.]+)s/i);
            if (retryMatch && retryMatch[1]) {
              const waitSeconds = parseFloat(retryMatch[1]);
              console.warn(`[AI-GATEWAY] Global rate limit hit. Pausing engine for ${waitSeconds} seconds...`);
              await new Promise(r => setTimeout(r, waitSeconds * 1000));
            }

            return {
              success: false,
              ai_available: false,
              quota_exhausted: true,
              text: '',
              error: `All ${keys.length} Gemini API keys exhausted. Alert sent to ${process.env.REPORT_EMAIL}. Retrying Key 1 next cycle.`
            };
          }
          // Continue loop to try next key
          continue;
        }

        // Non-quota error — return immediately
        return { success: false, text: '', error: msg, __transient_error: true };
      }
    }

    return { success: false, text: '', error: 'All API keys exhausted.' };
  },

  /**
   * Return current key rotation status for health check
   */
  getKeyStatus(): { total: number; current: number; keys_configured: string[] } {
    const keys = getApiKeys();
    return {
      total: keys.length,
      current: Math.min(currentKeyIndex + 1, keys.length),
      keys_configured: keys.map((_, i) => `Key ${i + 1}`)
    };
  }
};
