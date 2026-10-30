import {
  classifyHttpFailure,
  classifyNetworkFailure,
  failureCode,
  type FailureKind,
} from './errors';

export interface WhatsAppConfig {
  /** https://graph.facebook.com in production; tests point this at a local fake. */
  baseUrl: string;
  apiVersion: string;
  phoneNumberId: string;
  token: string;
  templateName: string;
  templateLanguage: string;
}

/** A failed call. The message never contains the recipient, the text or the API's own message. */
export class WhatsAppError extends Error {
  constructor(
    public readonly kind: FailureKind,
    public readonly code: string,
    public readonly httpStatus?: number,
    public readonly retryAfterMs?: number,
  ) {
    super(code);
    this.name = 'WhatsAppError';
  }
}

export interface SendTemplateInput {
  /** E.164, for example +919876543210. */
  toE164: string;
  mediaId: string;
  filename: string;
  bodyParams: string[];
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Template message parameters may not hold newlines, tabs or runs of four spaces, and are limited in
 * length. Our values are short single lines already; this keeps it true whatever is passed in.
 */
export function sanitizeTemplateParam(value: string): string {
  const flat = value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {4,}/g, '   ')
    .trim();
  return flat.slice(0, 500) || '-';
}

export class WhatsAppClient {
  constructor(
    private readonly cfg: WhatsAppConfig,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly timeoutMs = 20_000,
  ) {}

  private url(path: string): string {
    return `${this.cfg.baseUrl.replace(/\/+$/, '')}/${this.cfg.apiVersion}/${this.cfg.phoneNumberId}/${path}`;
  }

  private async call(path: string, init: RequestInit, phase: 'upload' | 'send'): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.url(path), {
        ...init,
        headers: {
          ...(init.headers as Record<string, string>),
          Authorization: `Bearer ${this.cfg.token}`,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new WhatsAppError(classifyNetworkFailure(err, phase), 'network');
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* an empty or non-JSON error body */
    }
    if (res.ok) return body;
    const metaCode = (body as { error?: { code?: number | string } } | null)?.error?.code;
    const retryAfter = Number(res.headers.get('retry-after'));
    throw new WhatsAppError(
      classifyHttpFailure(res.status, metaCode),
      failureCode(res.status, metaCode),
      res.status,
      Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 300) * 1000 : undefined,
    );
  }

  /** Uploads the PDF and returns the media id to use as the template's document header. */
  async uploadPdf(pdf: Buffer, filename: string): Promise<string> {
    const form = new FormData();
    form.set('messaging_product', 'whatsapp');
    form.set('type', 'application/pdf');
    form.set('file', new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), filename);
    const body = (await this.call('media', { method: 'POST', body: form }, 'upload')) as {
      id?: string;
    } | null;
    if (!body?.id) throw new WhatsAppError('transient', 'wa_no_media_id');
    return body.id;
  }

  /** Sends the approved template: PDF as the document header, parameters in the body. */
  async sendTemplate(input: SendTemplateInput): Promise<{ messageId: string }> {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: input.toE164.replace(/\D/g, ''),
      type: 'template',
      template: {
        name: this.cfg.templateName,
        language: { code: this.cfg.templateLanguage },
        components: [
          {
            type: 'header',
            parameters: [
              { type: 'document', document: { id: input.mediaId, filename: input.filename } },
            ],
          },
          {
            type: 'body',
            parameters: input.bodyParams.map((t) => ({
              type: 'text',
              text: sanitizeTemplateParam(t),
            })),
          },
        ],
      },
    };
    const body = (await this.call(
      'messages',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      'send',
    )) as { messages?: { id?: string }[] } | null;
    const id = body?.messages?.[0]?.id;
    // WhatsApp answered 200 but gave no message id: we cannot tell whether it was accepted.
    if (!id) throw new WhatsAppError('ambiguous', 'wa_no_message_id');
    return { messageId: id };
  }
}
