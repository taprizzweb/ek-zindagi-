import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { AuditSink } from '@/lib/audit/audit';
import { normalizeIndianMobile } from '@/lib/domain/phone';
import { AppError } from '@/lib/errors';

export const MAX_WEBHOOK_BYTES = 1_000_000;

/** Constant-time compare of two strings (false if the lengths differ). */
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** `X-Hub-Signature-256` is "sha256=" + HMAC-SHA256 of the raw body with the app secret. */
export function verifySignature(
  rawBody: Buffer,
  header: string | null,
  appSecret: string,
): boolean {
  if (!header || !appSecret) return false;
  const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  return safeEqual(header.trim().toLowerCase(), expected);
}

/** Answer to Meta's setup request (GET with hub.* parameters): the challenge, or null to refuse. */
export function verifyChallenge(params: URLSearchParams, verifyToken: string): string | null {
  if (params.get('hub.mode') !== 'subscribe') return null;
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');
  if (!token || !challenge || !verifyToken || !safeEqual(token, verifyToken)) return null;
  return challenge.slice(0, 200);
}

const STOP_WORDS = new Set([
  'stop',
  'unsubscribe',
  'optout',
  'opt out',
  'cancel',
  'band',
  'band karo',
  'band kijiye',
  'band kare',
  'बंद',
  'बन्द',
  'बंद करें',
  'बंद करो',
  'बंद कीजिए',
  'रोकें',
  'रोको',
  'रुकें',
  'रुको',
]);

/**
 * True for a reply that asks us to stop: "STOP", "stop.", " Stop ", "बंद", "band karo" and the like.
 * Also "stop" or "unsubscribe" followed by up to three more words ("STOP sending me this").
 * Anything longer or unrelated is not an opt-out.
 */
export function isStopMessage(text: string): boolean {
  const t = text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return false;
  if (STOP_WORDS.has(t)) return true;
  const words = t.split(' ');
  return words.length <= 4 && (words[0] === 'stop' || words[0] === 'unsubscribe');
}

export interface ParsedStatus {
  messageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  at: Date;
  errorCode: string | null;
  category: 'utility' | 'marketing' | 'authentication' | 'service' | null;
}
export interface ParsedInbound {
  fromDigits: string;
  text: string;
}
export interface ParsedCategoryChange {
  from: string;
  to: string;
}
export interface ParsedWebhook {
  statuses: ParsedStatus[];
  inbound: ParsedInbound[];
  categoryChanges: ParsedCategoryChange[];
}

const CATEGORIES = ['utility', 'marketing', 'authentication', 'service'] as const;
const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const cat = (v: unknown) =>
  typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v.toLowerCase())
    ? (v.toLowerCase() as ParsedStatus['category'])
    : null;

/** Pulls what we care about out of a webhook payload. Unknown shapes are ignored, never an error. */
export function parseWebhook(json: unknown): ParsedWebhook {
  const out: ParsedWebhook = { statuses: [], inbound: [], categoryChanges: [] };
  for (const entry of asArray(asRecord(json)?.entry)) {
    for (const change of asArray(asRecord(entry)?.changes)) {
      const c = asRecord(change);
      const value = asRecord(c?.value);
      if (!value) continue;

      for (const st of asArray(value.statuses)) {
        const s = asRecord(st);
        const id = s?.id;
        const status = s?.status;
        if (typeof id !== 'string' || !id || typeof status !== 'string') continue;
        if (!['sent', 'delivered', 'read', 'failed'].includes(status)) continue; // e.g. "deleted", "warning"
        const ts = Number(s?.timestamp);
        const firstError = asRecord(asArray(s?.errors)[0]);
        out.statuses.push({
          messageId: id,
          status: status as ParsedStatus['status'],
          at: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date(),
          errorCode: status === 'failed' ? `wa_${firstError?.code ?? 'failed'}`.slice(0, 40) : null,
          category: cat(asRecord(s?.pricing)?.category),
        });
      }

      for (const m of asArray(value.messages)) {
        const msg = asRecord(m);
        const text = asRecord(msg?.text)?.body;
        const button = asRecord(msg?.button)?.text; // a tapped quick-reply button
        const from = msg?.from;
        if (typeof from !== 'string' || !/^\d{6,15}$/.test(from)) continue;
        const body = typeof text === 'string' ? text : typeof button === 'string' ? button : null;
        if (body !== null) out.inbound.push({ fromDigits: from, text: body.slice(0, 500) });
      }

      if (c?.field === 'template_category_update') {
        const from = value.previous_category;
        const to = value.new_category;
        if (typeof to === 'string')
          out.categoryChanges.push({
            from: String(from ?? '').toLowerCase(),
            to: to.toLowerCase(),
          });
      }
    }
  }
  return out;
}

export interface WebhookPorts {
  /** True the first time this exact body is seen, false for a replay. */
  registerBody(hash: string): Promise<boolean>;
  applyStatus(s: ParsedStatus): Promise<'applied' | 'ignored' | 'pending'>;
  addOptOut(phoneHash: string): Promise<void>;
}

export interface WebhookDeps {
  ports: WebhookPorts;
  audit: AuditSink;
  appSecret: string;
  hashPhone(e164: string): string;
  /** The category the template was approved under; a different one is a cost warning, not an error. */
  expectedCategory: string;
}

export interface WebhookResult {
  replay: boolean;
  statuses: number;
  optOuts: number;
  categoryWarnings: number;
}

/**
 * Handles one webhook delivery. The signature is checked on the raw bytes before anything is parsed;
 * the same body is processed only once; statuses only move forward; a STOP reply puts the number on
 * the opt-out list; a changed template category is recorded as a warning and never breaks anything.
 */
export async function handleWebhook(
  deps: WebhookDeps,
  rawBody: Buffer,
  signature: string | null,
): Promise<WebhookResult> {
  if (rawBody.length > MAX_WEBHOOK_BYTES) throw new AppError('bad_request', 413);
  if (!verifySignature(rawBody, signature, deps.appSecret))
    throw new AppError('unauthenticated', 401);

  const result: WebhookResult = { replay: false, statuses: 0, optOuts: 0, categoryWarnings: 0 };
  const hash = createHash('sha256').update(rawBody).digest('hex');
  if (!(await deps.ports.registerBody(hash))) return { ...result, replay: true };

  let json: unknown;
  try {
    json = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new AppError('bad_request', 400);
  }
  const parsed = parseWebhook(json);

  for (const s of parsed.statuses) {
    const applied = await deps.ports.applyStatus(s);
    if (applied === 'applied') result.statuses++;
    // WhatsApp reports the category it billed the message under. Anything but the approved one is a warning.
    if (s.status === 'sent' && s.category && s.category !== deps.expectedCategory.toLowerCase()) {
      result.categoryWarnings++;
      console.warn('whatsapp_category_differs', s.category);
      await deps.audit.record({
        action: 'template_category_changed',
        meta: { from: deps.expectedCategory.toLowerCase(), to: s.category, source: 'message' },
      });
    }
  }
  for (const c of parsed.categoryChanges) {
    result.categoryWarnings++;
    console.warn('whatsapp_template_category_changed', c.to);
    await deps.audit.record({
      action: 'template_category_changed',
      meta: { from: c.from.slice(0, 40), to: c.to.slice(0, 40), source: 'template' },
    });
  }
  for (const m of parsed.inbound) {
    if (!isStopMessage(m.text)) continue;
    const e164 = normalizeIndianMobile(`+${m.fromDigits}`);
    if (!e164) continue;
    await deps.ports.addOptOut(deps.hashPhone(e164));
    result.optOuts++;
    await deps.audit.record({ action: 'opt_out_recorded', meta: {} }); // no number, no text
  }
  return result;
}
