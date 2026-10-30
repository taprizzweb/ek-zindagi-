import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AppError } from '@/lib/errors';

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

const MAX_BODY_BYTES = 10_000;

export async function readJson(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) throw new AppError('bad_request', 413);
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new AppError('bad_request', 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError('bad_request', 400);
  }
}

/** Turns thrown errors into JSON. Logs the error name only: messages can carry personal data. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AppError) return json({ error: { code: err.code } }, err.status);
    if (err instanceof ZodError) return json({ error: { code: 'bad_request' } }, 400);
    console.error('unhandled_error', err instanceof Error ? err.name : typeof err);
    return json({ error: { code: 'internal' } }, 500);
  }
}
