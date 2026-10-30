import { resolveCertificateLink } from '@/lib/delivery/link';
import { supabaseLinkPorts } from '@/lib/delivery/delivery-store-supabase';
import { AppError } from '@/lib/errors';
import { clientIp } from '@/lib/security/ip';
import { createAdminClient } from '@/lib/supabase/admin';

const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

function page(status: number, hi: string, en: string): Response {
  return new Response(
    `<!doctype html><html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EK ZINDAGI</title></head><body><h1>EK ZINDAGI</h1><p>${hi}</p><p>${en}</p></body></html>`,
    { status, headers: PAGE_HEADERS },
  );
}

/**
 * The link in the WhatsApp message. Public (the person has no account): the token is the only
 * credential, it is unguessable, and it stops working 24 hours after it was made. It serves one
 * PDF, the one the token belongs to, and nothing else.
 */
export async function GET(request: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  try {
    const pdf = await resolveCertificateLink(
      { ports: supabaseLinkPorts(createAdminClient()), maxPerIp10Min: 30 },
      token,
      clientIp(request.headers),
    );
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="EK-ZINDAGI-certificate.pdf"',
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  } catch (err) {
    if (err instanceof AppError && err.status === 410) {
      return page(
        410,
        'यह लिंक अब काम नहीं करता (24 घंटे पूरे हो गए या डेटा हटा दिया गया)।',
        'This link no longer works (24 hours have passed, or the data was deleted).',
      );
    }
    if (err instanceof AppError && err.status === 429) {
      return page(
        429,
        'बहुत अनुरोध हुए। थोड़ी देर बाद कोशिश करें।',
        'Too many requests. Please try again in a few minutes.',
      );
    }
    if (err instanceof AppError && err.status === 404) {
      return page(404, 'यह लिंक सही नहीं है।', 'This link is not valid.');
    }
    console.error('certificate_link_error', err instanceof Error ? err.name : typeof err);
    return page(500, 'कुछ गड़बड़ हो गई।', 'Something went wrong.');
  }
}
