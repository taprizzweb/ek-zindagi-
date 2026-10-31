/* eslint-disable @next/next/no-img-element -- logos are inline data: URIs; this component also renders to static HTML for the PDF, where next/image is not available */
import { CERTIFICATE_CHECKLIST, CERTIFICATE_TEXT as T } from '@/config/certificate';
import type { CertificateView } from './certificate-data';

/** The picture frame is drawn in this 450 x 433 box; the photo goes into its window. */
const FRAME_WIDTH = 450;
const FRAME_HEIGHT = 433;
const WINDOW = { x: 96, y: 40, w: 272, h: 346 };

/** Where the glass "broke": a few cracks run from here to the edges of the window. */
const CRACKS = [
  '262,170 205,150 150,118 96,92',
  '262,170 240,120 190,80 150,40',
  '262,170 272,120 288,80 300,40',
  '262,170 310,150 340,100 368,70',
  '262,170 320,175 345,190 368,200',
  '262,170 300,230 335,290 368,330',
  '262,170 270,240 280,320 290,386',
  '262,170 240,250 210,320 180,386',
  '262,170 210,200 150,250 96,300',
  '262,170 200,175 140,180 96,190',
  // small branches
  '205,150 190,175 160,185',
  '310,150 322,126 352,120',
  '270,240 300,262 330,268',
  '240,250 220,236 182,240',
  // two broken rings around the impact point
  '262,132 290,143 300,170 288,198 262,208 232,196 224,168 236,141 262,132',
  '262,85 305,100 338,140',
  '215,112 180,150 172,205',
  '210,272 262,292 318,268',
];

/**
 * The certificate, 1123 x 794 px (A4 landscape at 96 dpi). The live preview and the PDF both
 * render this one component. It uses no inline styles (the app's CSP forbids them) and
 * no hooks, so it also renders to plain HTML on the server. Sizes that depend on the text are
 * set by fitAll() through the data-fit attributes.
 *
 * Stamp, watermark and disclaimer are always rendered: nothing in `view` can remove them.
 * The police name and logo are never printed on it.
 */
export default function Certificate({ view }: { view: CertificateView }) {
  return (
    <div className="cert" id="cert" data-testid="certificate">
      <div className="bd1" />
      <div className="bd2" />
      {view.ngoLogoSrc ? <img className="c-logo c-logo-ngo" src={view.ngoLogoSrc} alt="" /> : null}
      <div className="c-head" data-fit="830,150,95,60">
        {T.headline}
      </div>
      <div className="stamp">
        {T.stamp[0]}
        <br />
        {T.stamp[1]}
      </div>
      <div className="c-sub">{T.subtitleBase}</div>

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
        <linearGradient id="cert-wood" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9a6532" />
          <stop offset="0.5" stopColor="#6b411c" />
          <stop offset="1" stopColor="#8a5a2b" />
        </linearGradient>
        <pattern id="cert-grain" width="9" height="9" patternUnits="userSpaceOnUse">
          <path d="M0 2H9M0 6H9" stroke="#2a170a" strokeOpacity="0.18" strokeWidth="0.8" />
        </pattern>
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
        <g clipPath="url(#cert-win)" fill="none" strokeLinejoin="round" strokeLinecap="round">
          <polygon points="262,170 368,70 368,200" fill="#ffffff" fillOpacity="0.07" />
          {CRACKS.map((points) => (
            <polyline
              key={points}
              points={points}
              transform="translate(1 1)"
              stroke="#000000"
              strokeOpacity="0.28"
              strokeWidth="2"
            />
          ))}
          {CRACKS.map((points) => (
            <polyline
              key={`w${points}`}
              points={points}
              stroke="#ffffff"
              strokeOpacity="0.72"
              strokeWidth="1.2"
            />
          ))}
        </g>
        <path
          d={`M72 14H392V406H72Z M${WINDOW.x} ${WINDOW.y}V${WINDOW.y + WINDOW.h}H${WINDOW.x + WINDOW.w}V${WINDOW.y}Z`}
          fillRule="evenodd"
          fill="url(#cert-wood)"
          stroke="#3b2210"
          strokeWidth="2"
        />
        <path
          d={`M72 14H392V406H72Z M${WINDOW.x} ${WINDOW.y}V${WINDOW.y + WINDOW.h}H${WINDOW.x + WINDOW.w}V${WINDOW.y}Z`}
          fillRule="evenodd"
          fill="url(#cert-grain)"
        />
        <rect
          x="82"
          y="24"
          width="300"
          height="372"
          fill="none"
          stroke="#d9a566"
          strokeWidth="1.5"
        />
        <rect x="90" y="34" width="284" height="358" fill="none" stroke="#2a170a" strokeWidth="2" />
        <rect
          x={WINDOW.x}
          y={WINDOW.y}
          width={WINDOW.w}
          height={WINDOW.h}
          fill="none"
          stroke="#c9915a"
          strokeWidth="1.5"
        />
      </svg>

      <div className="certifies">{T.certifies}</div>
      <div className="c-name" data-fit="582,56,46,22">
        {view.name}
      </div>
      <div className="last">{T.caughtOnCamera}</div>
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
      ) : (
        <div className="credit">{T.partnerLine}</div>
      )}
      <div className="br">{T.signature}</div>
      <div className="disc">{T.disclaimer}</div>
      <div className="wm">{T.watermark}</div>
    </div>
  );
}
