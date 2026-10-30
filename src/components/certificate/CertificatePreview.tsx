'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import Certificate from './Certificate';
import type { CertificateView } from './certificate-data';
import { fitAll } from './fit';
import './certificate-fonts.css';
import './certificate.css';

const W = 1123;
const H = 794;

/**
 * The live preview: the same Certificate component the PDF is printed from, scaled to the width of
 * the screen. Text that has to shrink is fitted with the same function the PDF page uses.
 * Scaling and fitting are done through the DOM (not inline style attributes), which the app's CSP allows.
 */
export default function CertificatePreview({
  view,
  label,
}: {
  view: CertificateView;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);

  // Fit the text after every change, and again once the fonts have loaded.
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    fitAll(el);
    let cancelled = false;
    void document.fonts?.ready.then(() => {
      if (!cancelled) fitAll(el);
    });
    return () => {
      cancelled = true;
    };
  }, [view]);

  // Scale to the available width.
  useEffect(() => {
    const b = box.current;
    const s = stage.current;
    if (!b || !s) return;
    const apply = () => {
      s.style.transform = `scale(${Math.min(1, b.clientWidth / W)})`;
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(b);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={box}
      role="img"
      aria-label={label}
      className="relative w-full overflow-hidden rounded border-2 border-line bg-[#faf3e0]"
      data-testid="certificate-preview"
    >
      <div className="aspect-[1123/794] w-full" />
      <div
        ref={stage}
        aria-hidden="true"
        className="absolute top-0 left-0 origin-top-left"
        data-fit-stage
      >
        <Certificate view={view} />
      </div>
      <span className="sr-only">{`${W} x ${H}`}</span>
    </div>
  );
}
