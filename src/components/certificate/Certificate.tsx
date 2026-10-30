/* eslint-disable @next/next/no-img-element -- logos are inline data: URIs; this component also renders to static HTML for the PDF, where next/image is not available */
import { CERTIFICATE_CHECKLIST, CERTIFICATE_TEXT as T } from '@/config/certificate';
import type { CertificateView } from './certificate-data';
import { FRAME_HEIGHT, FRAME_SRC, FRAME_WIDTH } from './certificate-frame';

/** Where the photo goes inside the frame image (its transparent window), in the image's own pixels. */
const WINDOW = { x: 96, y: 40, w: 272, h: 346 };

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
        viewBox={`0 0 ${FRAME_WIDTH} ${FRAME_HEIGHT}`}
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <clipPath id="cert-win">
            <rect x={WINDOW.x} y={WINDOW.y} width={WINDOW.w} height={WINDOW.h} />
          </clipPath>
        </defs>
        <rect x={WINDOW.x} y={WINDOW.y} width={WINDOW.w} height={WINDOW.h} fill="#cfc6b3" />
        {view.photoSrc ? (
          <image
            href={view.photoSrc}
            x={WINDOW.x}
            y={WINDOW.y}
            width={WINDOW.w}
            height={WINDOW.h}
            preserveAspectRatio="xMidYMid slice"
            clipPath="url(#cert-win)"
          />
        ) : (
          <g clipPath="url(#cert-win)">
            <circle cx="232" cy="190" r="52" fill="#8f8776" />
            <path d="M96 386 Q100 282 232 272 Q364 282 368 386Z" fill="#8f8776" />
          </g>
        )}
        <image href={FRAME_SRC} x="0" y="0" width={FRAME_WIDTH} height={FRAME_HEIGHT} />
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
