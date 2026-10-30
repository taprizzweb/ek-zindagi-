import type { ErrorCode } from '@/lib/errors';

export interface Bilingual {
  hi: string;
  en: string;
}

export const ERROR_MESSAGES: Record<ErrorCode, Bilingual> = {
  bad_request: {
    hi: 'दी गई जानकारी जाँचें और फिर से कोशिश करें।',
    en: 'Please check the details and try again.',
  },
  unauthenticated: { hi: 'कृपया फिर से लॉगिन करें।', en: 'Please log in again.' },
  forbidden: {
    hi: 'इस खाते को यह काम करने की अनुमति नहीं है।',
    en: 'This account is not allowed to do that.',
  },
  invalid_credentials: {
    hi: 'ईमेल या पासवर्ड सही नहीं है। फिर से कोशिश करें।',
    en: 'Email or password is not correct. Please try again.',
  },
  rate_limited: {
    hi: 'बहुत कोशिशें हो गईं। कुछ मिनट बाद फिर से कोशिश करें।',
    en: 'Too many attempts. Please wait a few minutes and try again.',
  },
  email_taken: { hi: 'यह ईमेल पहले से पंजीकृत है।', en: 'This email is already registered.' },
  not_found: { hi: 'खाता नहीं मिला।', en: 'Account not found.' },
  cross_origin: {
    hi: 'पेज को रीफ़्रेश करके फिर से कोशिश करें।',
    en: 'Refresh the page and try again.',
  },
  internal: {
    hi: 'कुछ गड़बड़ हो गई। आपका डेटा सुरक्षित है, फिर से कोशिश करें।',
    en: 'Something went wrong on our side. Please try again.',
  },
};

export function messageFor(code: string | undefined): Bilingual {
  return ERROR_MESSAGES[(code ?? 'internal') as ErrorCode] ?? ERROR_MESSAGES.internal;
}
