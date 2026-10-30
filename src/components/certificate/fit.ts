/**
 * Shrinks text until it fits: every element with data-fit="maxWidth,maxHeight,startPx,minPx" is
 * set to the largest font size (stepping down 1 px) at which it no longer overflows.
 *
 * Used twice: by the live preview in the browser, and inlined (via toString) into the page that
 * Chromium prints to PDF. So it must stay one flat, self-contained function: no helpers, no
 * closures, no imports.
 */
export function fitAll(root: ParentNode): void {
  const els = root.querySelectorAll('[data-fit]');
  for (let i = 0; i < els.length; i++) {
    const el = els[i] as HTMLElement;
    const p = (el.getAttribute('data-fit') || '').split(',');
    const maxW = Number(p[0]);
    const maxH = Number(p[1]);
    let size = Number(p[2]);
    const min = Number(p[3]);
    el.style.fontSize = size + 'px';
    while ((el.scrollWidth > maxW || el.scrollHeight > maxH) && size > min) {
      size -= 1;
      el.style.fontSize = size + 'px';
    }
  }
}
