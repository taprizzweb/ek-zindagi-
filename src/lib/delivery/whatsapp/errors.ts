/**
 * What to do about a failed WhatsApp Cloud API call.
 *
 *  - transient: the API answered with a temporary problem. Safe to try again.
 *  - permanent: this message cannot be delivered (for example the number is not on WhatsApp). Do not retry.
 *  - config: our setup is wrong (expired token, template missing or mismatched). Retrying will not help;
 *    a person has to fix it.
 *  - ambiguous: the request may or may not have reached WhatsApp (timeout, connection dropped after it
 *    was sent). NEVER retried automatically: a retry could send the person a second certificate.
 */
export type FailureKind = 'transient' | 'permanent' | 'config' | 'ambiguous';

const TRANSIENT_CODES = new Set([
  '4', // too many calls (app level)
  '80007', // rate limit
  '130429', // cloud API throughput reached
  '131000', // something went wrong
  '131016', // service unavailable
  '131056', // pair rate limit: too many messages to the same number, try later
  '133004', // server temporarily unavailable
  '133016', // account registration/deregistration limit, try later
]);

const CONFIG_CODES = new Set([
  '0', // auth exception
  '10', // permission denied
  '100', // invalid parameter
  '190', // access token expired or invalid
  '200', // permission error
  '131005', // access denied
  '131008', // required parameter missing
  '131009', // parameter value invalid
  '131031', // account locked
  '131037', // display name approval needed
  '131042', // payment problem
  '131045', // phone number not registered
  '132000', // template parameter count mismatch
  '132001', // template does not exist
  '132005', // template text too long after translation
  '132007', // template format policy violation
  '132012', // template parameter format mismatch
  '132015', // template paused
  '132016', // template disabled
  '132068', // flow blocked
  '368', // temporarily blocked for policy violations
  '33', // phone number id does not exist
]);

export function classifyHttpFailure(
  status: number,
  metaCode: number | string | undefined,
): FailureKind {
  const code = metaCode === undefined ? undefined : String(metaCode);
  if (code && TRANSIENT_CODES.has(code)) return 'transient';
  if (code && CONFIG_CODES.has(code)) return 'config';
  if (status === 429 || status >= 500) return 'transient';
  if (status === 401 || status === 403) return 'config';
  return 'permanent'; // other 4xx, including 131026 (not on WhatsApp) and 131049 (ecosystem limit)
}

/** The code we store on the entry: the Meta code when there is one, otherwise the HTTP status. No message text. */
export function failureCode(status: number, metaCode: number | string | undefined): string {
  return metaCode !== undefined ? `wa_${metaCode}` : `wa_http_${status}`;
}

/** Errors from fetch itself, before any answer came back. */
export function classifyNetworkFailure(err: unknown, phase: 'upload' | 'send'): FailureKind {
  const code = (err as { cause?: { code?: string } })?.cause?.code;
  // The connection was never made: the request cannot have arrived, so a retry is safe.
  if (code && ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)) return 'transient';
  // An upload only stores a file; repeating it can never double-send anything.
  if (phase === 'upload') return 'transient';
  return 'ambiguous';
}
