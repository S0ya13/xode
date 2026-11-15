/** Fork: the ASCII backdrop behind the chat, a Tritium trefoil drawn in characters. */

export const BACKDROP_CELL_WIDTH = 6;
export const BACKDROP_CELL_HEIGHT = 10;
export const BACKDROP_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

const TREFOIL_POINTS = 360;
const CORE_SIGMA = 4.5;
const HALO_SIGMA = 13;
// Past three halo sigmas a cell gets nothing from the knot, so its distance is not measured.
const KNOT_REACH = HALO_SIGMA * 3;
const WAVE_PERIOD_MS = 9000;
const WAVE_WIDTH = 0.05;

export interface BackdropCell {
  readonly x: number;
  readonly y: number;
  /** Closeness to the trefoil line, 0 to 1. */
  readonly core: number;
  /** Soft glow around the line, 0 to 1. */
  readonly halo: number;
  /** How far toward the left or right edge the cell sits, 0 at the middle. */
  readonly side: number;
  /** Where along the trefoil the nearest point lies, 0 to 1. */
  readonly along: number;
  /** Fixed per cell, so sparse cells stay put between frames. */
  readonly seed: number;
}

export interface BackdropCellPaint {
  readonly alpha: number;
  readonly tone: "accent" | "ink";
}

const smoothstep = (from: number, to: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

export function buildBackdropCells(
  width: number,
  height: number,
  random: () => number = Math.random,
): BackdropCell[] {
  if (width <= 0 || height <= 0) return [];
  const scale = Math.min(width, height) * 0.1;
  const centerX = width / 2;
  const centerY = height * 0.42;
  const points: Array<readonly [number, number]> = [];
  for (let index = 0; index < TREFOIL_POINTS; index++) {
    const t = (index / TREFOIL_POINTS) * Math.PI * 2;
    points.push([
      centerX + scale * (Math.sin(t) + 2 * Math.sin(2 * t)),
      centerY - scale * (Math.cos(t) - 2 * Math.cos(2 * t)),
    ]);
  }
  const knotRadius = scale * 3 + KNOT_REACH;
  const cells: BackdropCell[] = [];
  const columns = Math.ceil(width / BACKDROP_CELL_WIDTH);
  const rows = Math.ceil(height / BACKDROP_CELL_HEIGHT);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x = column * BACKDROP_CELL_WIDTH + BACKDROP_CELL_WIDTH / 2;
      const y = row * BACKDROP_CELL_HEIGHT + BACKDROP_CELL_HEIGHT / 2;
      let core = 0;
      let halo = 0;
      let along = 0;
      if (Math.abs(x - centerX) <= knotRadius && Math.abs(y - centerY) <= knotRadius) {
        let nearest = Infinity;
        for (let index = 0; index < points.length; index++) {
          const point = points[index]!;
          const distance = (point[0] - x) ** 2 + (point[1] - y) ** 2;
          if (distance < nearest) {
            nearest = distance;
            along = index / points.length;
          }
        }
        core = Math.exp(-nearest / (2 * CORE_SIGMA * CORE_SIGMA));
        halo = Math.exp(-nearest / (2 * HALO_SIGMA * HALO_SIGMA));
      }
      cells.push({
        x,
        y,
        core,
        halo,
        side: smoothstep(0.4, 1.05, (Math.abs(x - centerX) / width) * 2),
        along,
        seed: random(),
      });
    }
  }
  return cells;
}

/** How one cell looks at `timeMs`, or null when it stays empty. */
export function paintBackdropCell(cell: BackdropCell, timeMs: number): BackdropCellPaint | null {
  const phase = (timeMs / WAVE_PERIOD_MS) % 1;
  let offset = Math.abs(cell.along - phase);
  offset = Math.min(offset, 1 - offset);
  // A bright band runs along the trefoil.
  const wave = Math.exp(-(offset * offset) / (2 * WAVE_WIDTH * WAVE_WIDTH));
  const knot = cell.core * (0.5 + 0.5 * wave) + cell.halo * 0.16;
  if (knot > 0.06) {
    return { alpha: Math.min(1, knot), tone: cell.core > 0.3 ? "accent" : "ink" };
  }
  // Slow clouds drift along the sides; their density decides which cells show.
  const seconds = timeMs / 1000;
  const cloud =
    0.5 +
    0.25 * Math.sin(cell.x * 0.018 + seconds * 0.22) * Math.sin(cell.y * 0.028 - seconds * 0.15) +
    0.25 * Math.sin((cell.x * 0.7 + cell.y) * 0.011 + seconds * 0.17);
  const density = cell.side * smoothstep(0.35, 0.9, cloud);
  if (cell.seed < density * 0.85) {
    return { alpha: 0.12 + 0.38 * density, tone: density > 0.6 ? "accent" : "ink" };
  }
  if (cell.seed > 0.985) return { alpha: 0.08, tone: "ink" };
  return null;
}

export interface BackdropClearRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

const CLEAR_FEATHER = 24;
const CLEAR_FLOOR = 0.08;

/** How much of a cell shows near text marked to stay clear: faint inside, full past the feather. */
export function backdropClearance(
  x: number,
  y: number,
  rects: ReadonlyArray<BackdropClearRect>,
): number {
  let factor = 1;
  for (const rect of rects) {
    const dx = Math.max(rect.left - x, 0, x - rect.right);
    const dy = Math.max(rect.top - y, 0, y - rect.bottom);
    const distance = Math.hypot(dx, dy);
    factor = Math.min(
      factor,
      CLEAR_FLOOR + (1 - CLEAR_FLOOR) * smoothstep(0, CLEAR_FEATHER, distance),
    );
  }
  return factor;
}
