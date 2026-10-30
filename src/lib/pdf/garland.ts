/**
 * Marigold garland around the portrait: flowers spaced evenly (by arc length) along the same
 * curve the reference design uses. Computed once and emitted as static SVG, so the PDF render
 * needs no script.
 */
type Pt = [number, number];

const SEGMENTS: [Pt, Pt, Pt][] = [
  [
    [6, 9],
    [3, 54],
    [14, 77],
  ],
  [
    [14, 77],
    [41, 94],
    [68, 77],
  ],
  [
    [68, 77],
    [79, 54],
    [76, 9],
  ],
];
const FLOWERS = 45;
const STEPS_PER_SEGMENT = 400;

function quad(p0: Pt, p1: Pt, p2: Pt, t: number): Pt {
  const u = 1 - t;
  return [
    u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
    u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
  ];
}

export function garlandPoints(): Pt[] {
  const samples: Pt[] = [];
  for (const [a, b, c] of SEGMENTS) {
    for (let i = 0; i <= STEPS_PER_SEGMENT; i++) samples.push(quad(a, b, c, i / STEPS_PER_SEGMENT));
  }
  const cumulative = [0];
  for (let i = 1; i < samples.length; i++) {
    const [x0, y0] = samples[i - 1]!;
    const [x1, y1] = samples[i]!;
    cumulative.push(cumulative[i - 1]! + Math.hypot(x1 - x0, y1 - y0));
  }
  const total = cumulative[cumulative.length - 1]!;
  const points: Pt[] = [];
  let j = 0;
  for (let k = 0; k < FLOWERS; k++) {
    const target = (total * k) / (FLOWERS - 1);
    while (j < cumulative.length - 1 && cumulative[j + 1]! < target) j++;
    points.push(samples[j]!);
  }
  return points;
}

export function garlandSvg(): string {
  const flowers = garlandPoints()
    .map(
      ([x, y]) =>
        `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="2.3" fill="#f28c00"/><circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="1.2" fill="#ffc933"/>`,
    )
    .join('');
  return (
    '<svg class="garland" viewBox="0 0 82 92">' +
    '<path d="M6 9 Q3 54 14 77 Q41 94 68 77 Q79 54 76 9" fill="none" stroke="#2e6b2e" stroke-width="1"/>' +
    flowers +
    '</svg>'
  );
}
