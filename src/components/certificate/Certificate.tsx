import { CERTIFICATE_CHECKLIST, CERTIFICATE_TEXT as T } from '@/config/certificate';
import type { CertificateView } from './certificate-data';

type Flower = { x: number; y: number; r: number; alt: boolean };

/** Marigold garland: an arc across the top and a column down each side of the frame. */
function garland(): Flower[] {
  const flowers: Flower[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    flowers.push({ x: 14 + 272 * t, y: 22 + 120 * t * (1 - t), r: 10, alt: i % 2 === 1 });
  }
  for (let i = 1; i <= 22; i++) {
    const y = 26 + i * 15.4;
    flowers.push({ x: 10, y, r: 9.5, alt: i % 2 === 1 });
    flowers.push({ x: 290, y, r: 9.5, alt: (i + 1) % 2 === 1 });
  }
  return flowers;
}
const GARLAND = garland();

/**
 * The certificate, 1123 x 794 px (A4 landscape at 96 dpi). The live preview and the PDF both
 * render this one component. It uses no inline styles (the app's CSP forbids them) and
 * no hooks, so it also renders to plain HTML on the server. Sizes that depend on the text are
 * set by fitAll() through the data-fit attributes.
 *
 * Stamp, watermark and disclaimer are always rendered: nothing in `view` can remove them.
 */
export default function Certificate({ view }: { view: CertificateView }) {
  const policeLogo = view.showPolice && view.policeLogoSrc ? view.policeLogoSrc : null;
  const subtitleTail = view.showPolice ? T.subtitlePolice : T.subtitleCampaign;

  return (
    <div className="cert" id="cert" data-testid="certificate">
      <div className="bd1" />
      <div className="bd2" />
      {policeLogo ? <img className="c-logo c-logo-police" src={policeLogo} alt="" /> : null}
      {view.ngoLogoSrc ? (
        <img
          className={`c-logo c-logo-ngo${policeLogo ? ' beside' : ''}`}
          src={view.ngoLogoSrc}
          alt=""
        />
      ) : null}
      <div className="wm">
        {T.watermark[0]}
        <br />
        {T.watermark[1]}
      </div>
      <div className="c-head" data-fit="830,150,95,60">
        {T.headline}
      </div>
      <div className="stamp">
        {T.stamp[0]}
        <br />
        {T.stamp[1]}
      </div>
      <div className="c-sub">
        {T.subtitleBase} · {subtitleTail}
      </div>

      <svg
        className="c-art"
        viewBox="0 0 300 430"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <clipPath id="cert-win">
            <rect x="14" y="16" width="272" height="349" />
          </clipPath>
        </defs>
        <rect x="0" y="0" width="300" height="381" fill="#8b4a1a" />
        <rect x="8" y="10" width="284" height="361" fill="#f4ecd8" />
        <rect x="14" y="16" width="272" height="349" fill="#cfc6b3" />
        {view.photoSrc ? (
          <image
            href={view.photoSrc}
            x="14"
            y="16"
            width="272"
            height="349"
            preserveAspectRatio="xMidYMid slice"
            clipPath="url(#cert-win)"
          />
        ) : (
          <g clipPath="url(#cert-win)">
            <circle cx="150" cy="197" r="52" fill="#8f8776" />
            <path d="M50 365 Q54 262 150 254 Q246 262 250 365Z" fill="#8f8776" />
          </g>
        )}
        <g fill="none" stroke="#9a9a9a" strokeWidth="2.4" strokeLinecap="round">
          <path d="M78 281 C70 262 86 250 78 232 C70 214 86 202 78 184" />
          <path d="M149 263 C141 244 157 232 149 214 C141 196 157 184 149 176" />
          <path d="M221 281 C213 262 229 250 221 232 C213 214 229 202 221 184" />
        </g>
        <g stroke="#4a2a14" strokeWidth="4.5" strokeLinecap="round">
          <line x1="106" y1="402" x2="78" y2="287" />
          <line x1="149" y1="402" x2="149" y2="269" />
          <line x1="192" y1="402" x2="221" y2="287" />
        </g>
        <circle cx="78" cy="287" r="3.4" fill="#e5481b" />
        <circle cx="149" cy="269" r="3.4" fill="#e5481b" />
        <circle cx="221" cy="287" r="3.4" fill="#e5481b" />
        <path d="M86 396 L214 396 L204 424 L96 424 Z" fill="#b8860b" />
        <rect x="82" y="391" width="136" height="10" rx="3" fill="#d9a520" />
        <g>
          {GARLAND.map((f, i) => (
            <g key={i}>
              <circle
                cx={f.x.toFixed(2)}
                cy={f.y.toFixed(2)}
                r={f.r}
                fill={f.alt ? '#f0a010' : '#e8760f'}
              />
              <circle
                cx={f.x.toFixed(2)}
                cy={f.y.toFixed(2)}
                r={f.r * 0.55}
                fill={f.alt ? '#fbc02d' : '#fdb827'}
              />
              {f.alt ? null : (
                <circle cx={f.x.toFixed(2)} cy={f.y.toFixed(2)} r="1.4" fill="#6b1e0a" />
              )}
            </g>
          ))}
        </g>
      </svg>

      <div className="certifies">{T.certifies}</div>
      <div className="c-name" data-fit="582,56,46,22">
        {view.name}
      </div>
      <div className="last">
        {T.lastSeenPrefix} <b>{T.alive}</b> {T.lastSeenSuffix}
      </div>
      <div className="c-datebox">
        <div className="lbl">{T.dateLabel}</div>
        <div className="big" data-fit="290,110,35,22">
          {view.dateText}
          <br />
          {view.timeText}
        </div>
      </div>
      <div className="c-locbox">
        <div className="lbl">{T.placeLabel}</div>
        <div className="big" data-fit="268,112,35,18">
          {view.place}
        </div>
      </div>
      <div className="committing">{T.committing}</div>
      <div className="c-viol">
        {CERTIFICATE_CHECKLIST.map((o) => (
          <div
            key={o.key}
            className={`opt${o.key === view.violation ? ' sel' : ''}`}
            data-checked={o.key === view.violation}
          >
            <i />
            <span>{o.label}</span>
          </div>
        ))}
      </div>
      <div className="rule" />
      <div className="bl">
        <div>Certificate No. {view.certNo}</div>
        <div>{T.issuedAt}</div>
      </div>
      <div className="bc">{T.centreLine}</div>
      {view.partnerCredit ? (
        <div className="credit">
          {T.technologyPartner}: {view.partnerCredit}
        </div>
      ) : null}
      <div className="br">{view.showPolice ? T.signaturePolice : T.signatureCampaign}</div>
      <div className="disc">{T.disclaimer}</div>
    </div>
  );
}
