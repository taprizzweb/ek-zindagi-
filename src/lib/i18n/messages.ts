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
  bad_photo: {
    hi: 'यह फ़ोटो इस्तेमाल नहीं हो सकती। दोबारा खींचें या फ़ोटो के बिना आगे बढ़ें।',
    en: 'This photo cannot be used. Retake it, or continue without a photo.',
  },
  gallery_disabled: {
    hi: 'गैलरी से फ़ोटो अभी बंद है। कैमरे से खींचें या फ़ोटो के बिना आगे बढ़ें।',
    en: 'Gallery photos are switched off. Use the camera, or continue without a photo.',
  },
  duplicate_recent: {
    hi: 'इस नंबर पर पिछले 24 घंटों में प्रमाणपत्र भेजा जा चुका है। दोबारा नहीं भेजा जाएगा।',
    en: 'A certificate was already sent to this number in the last 24 hours. It will not be sent again.',
  },
  opted_out: {
    hi: 'इस नंबर के धारक ने संदेश न भेजने को कहा है। प्रमाणपत्र नहीं भेजा जाएगा।',
    en: 'The holder of this number asked not to receive messages. No certificate will be sent.',
  },
  pdf_failed: {
    hi: 'प्रमाणपत्र नहीं बन सका। आपकी प्रविष्टि सुरक्षित है, फिर से कोशिश करें।',
    en: 'The certificate could not be created. Your entry is saved; try again.',
  },
  busy: {
    hi: 'प्रमाणपत्र बन रहा है। कुछ सेकंड रुकें।',
    en: 'The certificate is being created. Wait a few seconds.',
  },
  gone: {
    hi: 'इस प्रविष्टि का डेटा हटाया जा चुका है।',
    en: 'The data for this entry has already been deleted.',
  },
  not_ready: {
    hi: 'पहले प्रमाणपत्र बनाएँ।',
    en: 'Generate the certificate first.',
  },
  not_implemented: {
    hi: 'यह तरीका अभी चालू नहीं है।',
    en: 'This delivery mode is not available yet.',
  },
  send_failed: {
    hi: 'संदेश नहीं भेजा जा सका। पर्यवेक्षक को यह विफलता दिखेगी।',
    en: 'The message could not be sent. A supervisor can see this failure.',
  },
  send_retrying: {
    hi: 'अभी संदेश नहीं जा सका। अपने आप दोबारा कोशिश होगी।',
    en: 'The message could not be sent right now. It will be retried automatically.',
  },
  campaign_paused: {
    hi: 'अभियान अभी रोका गया है। कोई संदेश नहीं भेजा जाएगा।',
    en: 'The campaign is paused. No messages are being sent.',
  },
  mfa_required: {
    hi: 'पहले सुरक्षा कोड से पुष्टि करें।',
    en: 'Confirm with your security code first.',
  },
  invalid_code: {
    hi: 'कोड सही नहीं है या पहले इस्तेमाल हो चुका है। ऐप में नया कोड देखें।',
    en: 'The code is wrong or was already used. Wait for the next code in your app.',
  },
  internal: {
    hi: 'कुछ गड़बड़ हो गई। आपका डेटा सुरक्षित है, फिर से कोशिश करें।',
    en: 'Something went wrong on our side. Please try again.',
  },
};

export function messageFor(code: string | undefined): Bilingual {
  return ERROR_MESSAGES[(code ?? 'internal') as ErrorCode] ?? ERROR_MESSAGES.internal;
}
