import type { CertificateView } from './certificate-data';
import CertificateA from './CertificateA';
import CertificateB from './CertificateB';

/**
 * The certificate, 1123 x 794 px. Two designs share this one entry point (the live preview and the PDF both
 * render it): A, the default, with garland and incense; B, with a cracked-glass frame. `view.design` picks one.
 */
export default function Certificate({ view }: { view: CertificateView }) {
  return view.design === 'b' ? <CertificateB view={view} /> : <CertificateA view={view} />;
}
