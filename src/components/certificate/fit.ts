/**
 * Shrinks text until it fits: every element with data-fit="maxWidth,maxHeight,startPx,minPx" is
 * set to the largest font size (stepping down 1 px) at which it no longer overflows.
 *
 * Used twice: by the live preview in the browser, and inlined (via toString) into the page that
 * Chromium prints to PDF. So it must stay one flat, self-contained function: no helpers, no
 * closures, no imports.
 */
export function fitAll(root: ParentNode): void {
  var els = root.querySelectorAll('[data-fit]');
  for (var i = 0; i < els.length; i++) {
    var el = els[i] as HTMLElement;
    var p = (el.getAttribute('data-fit') || '').split(',');
    var maxW = Number(p[0]);
    var maxH = Number(p[1]);
    var size = Number(p[2]);
    var min = Number(p[3]);
    el.style.fontSize = size + 'px';
    while ((el.scrollWidth > maxW || el.scrollHeight > maxH) && size > min) {
      size -= 1;
      el.style.fontSize = size + 'px';
    }
  }
}
