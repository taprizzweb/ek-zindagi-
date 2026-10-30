/** An error whose code is safe to show to the caller. Never put personal data in `message`. */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly status: number,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'AppError';
  }
}

export type ErrorCode =
  | 'bad_request'
  | 'unauthenticated'
  | 'forbidden'
  | 'invalid_credentials'
  | 'rate_limited'
  | 'email_taken'
  | 'not_found'
  | 'cross_origin'
  | 'bad_photo'
  | 'pdf_failed'
  | 'busy'
  | 'not_ready'
  | 'not_implemented'
  | 'send_failed'
  | 'send_retrying'
  | 'campaign_paused'
  | 'gone'
  | 'gallery_disabled'
  | 'duplicate_recent'
  | 'opted_out'
  | 'mfa_required'
  | 'invalid_code'
  | 'internal';
