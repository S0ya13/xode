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
  /** 0 over the chat column, rising to 1 in the margins and thickest in the corners. */
  readonly side: number;
  /** Distance in pixels to the nearest edge of the area; rings run inward along it. */
  readonly inward: number;
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

/** `stage` draws the trefoil behind the chat; `rail` is the sidebar's knotless cloud field. */
export type BackdropLayout = "stage" | "rail";

// The rail's clouds thicken toward the bottom, so the header and top rows stay clean.
const railSide = (y: number, height: number) => 0.8 * smoothstep(0.1, 1, y / height);

/** Width of the chat column, the default `--chat-content-max-width` of 46rem. */
export const BACKDROP_DEFAULT_COLUMN = 736;
// Even a full-width chat leaves this band at each side for the margins.
const MIN_MARGIN = 48;
const MARGIN_FADE = 140;
// The field fades out under the header and above the bottom edge, so it has no hard rim.
const TOP_FADE = 110;
const BOTTOM_FADE = 50;

// The margins beside the chat column, so characters never sit behind its text.
const stageSide = (x: number, y: number, width: number, height: number, column: number) => {
  const half = width / 2;
  const inner = Math.max(0, Math.min(column / 2, half - MIN_MARGIN));
  const outer = Math.min(inner + MARGIN_FADE, half);
  const corner = smoothstep(0.4, 1, Math.abs(y - height / 2) / (height / 2));
  const rims = smoothstep(0, TOP_FADE, y) * smoothstep(0, BOTTOM_FADE, height - y);
  return smoothstep(inner, outer, Math.abs(x - half)) * (0.55 + 0.45 * corner) * rims;
};

export function buildBackdropCells(
  width: number,
  height: number,
  random: () => number = Math.random,
  layout: BackdropLayout = "stage",
  columnWidth: number = BACKDROP_DEFAULT_COLUMN,
): BackdropCell[] {
  if (width <= 0 || height <= 0) return [];
  const rail = layout === "rail";
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
      if (!rail && Math.abs(x - centerX) <= knotRadius && Math.abs(y - centerY) <= knotRadius) {
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
        side: rail ? railSide(y, height) : stageSide(x, y, width, height, columnWidth),
        inward: Math.min(x, width - x, y, height - y),
        along,
        seed: random(),
      });
    }
  }
  return cells;
}

/** Where the animation is: the wave's place along the trefoil and the clouds' drift. */
export interface BackdropFrame {
  /** 0 to 1 along the trefoil. */
  readonly phase: number;
  /** Seconds of cloud drift. */
  readonly seconds: number;
  /** Weight of a second wave half a loop behind the first, 0 to 1. */
  readonly echo: number;
  /** How much of the trefoil shows, 0 to 1. */
  readonly knot: number;
  /** 0 to 1: the margins trade drifting clouds for rings running in from the edges. */
  readonly pulse: number;
}

const waveAt = (along: number, phase: number) => {
  let offset = Math.abs(along - (((phase % 1) + 1) % 1));
  offset = Math.min(offset, 1 - offset);
  return Math.exp(-(offset * offset) / (2 * WAVE_WIDTH * WAVE_WIDTH));
};

/** How one cell looks in `frame`, or null when it stays empty. */
export function paintBackdropCell(
  cell: BackdropCell,
  frame: BackdropFrame,
): BackdropCellPaint | null {
  // Bright bands run along the trefoil.
  const wave = Math.max(
    waveAt(cell.along, frame.phase),
    frame.echo * waveAt(cell.along, frame.phase + 0.5),
  );
  const knot = frame.knot * (cell.core * (0.5 + 0.5 * wave) + cell.halo * 0.16);
  if (knot > 0.06) {
    return { alpha: Math.min(1, knot), tone: cell.core > 0.3 ? "accent" : "ink" };
  }
  // Slow clouds drift along the sides; their density decides which cells show.
  const { seconds } = frame;
  const cloud =
    0.5 +
    0.25 * Math.sin(cell.x * 0.018 + seconds * 0.22) * Math.sin(cell.y * 0.028 - seconds * 0.15) +
    0.25 * Math.sin((cell.x * 0.7 + cell.y) * 0.011 + seconds * 0.17);
  const ring = 0.5 + 0.5 * Math.sin(cell.inward * 0.03 - seconds * 1.2);
  const field = cloud + (ring - cloud) * frame.pulse;
  const density = cell.side * smoothstep(0.35, 0.9, field);
  if (cell.seed < density * 0.85) {
    // While working nearly every margin character takes the accent.
    return {
      alpha: 0.12 + 0.38 * density,
      tone: density > 0.6 * (1 - frame.pulse) + 0.05 ? "accent" : "ink",
    };
  }
  if (cell.seed > 0.985 && cell.side > 0.3) return { alpha: 0.08 * cell.side, tone: "ink" };
  return null;
}

/** What the thread is doing, which sets how the backdrop moves. */
export type BackdropMode = "hero" | "idle" | "working" | "attention";

export interface BackdropTuning {
  /** Overall opacity. */
  readonly strength: number;
  /** Wave speed: 1 runs the loop once in nine seconds. */
  readonly speed: number;
  /** Chance per frame that a cell changes its character. */
  readonly churn: number;
  readonly echo: number;
  /** 0 to 1: the margins breathe in the warning color while the agent waits on the user. */
  readonly attention: number;
  /** 0 to 1: only the empty thread shows the trefoil; a running one keeps its middle clear. */
  readonly knot: number;
  /** 0 to 1: slow rings run in from the edges while the agent works. */
  readonly pulse: number;
}

export const BACKDROP_TUNING: Record<BackdropMode, BackdropTuning> = {
  hero: { strength: 1, speed: 1, churn: 0.012, echo: 0, attention: 0, knot: 1, pulse: 0 },
  idle: { strength: 0.3, speed: 0.6, churn: 0.008, echo: 0, attention: 0, knot: 0, pulse: 0 },
  working: { strength: 0.6, speed: 1.6, churn: 0.02, echo: 1, attention: 0, knot: 0, pulse: 1 },
  attention: { strength: 0.6, speed: 0.5, churn: 0.01, echo: 0, attention: 1, knot: 0, pulse: 0 },
};

export const BACKDROP_WAVE_PERIOD_MS = WAVE_PERIOD_MS;
const EASE_MS = 450;

/** Moves `current` toward `target` over about half a second, so mode changes blend. */
export function easeBackdropTuning(
  current: BackdropTuning,
  target: BackdropTuning,
  elapsedMs: number,
): BackdropTuning {
  const k = 1 - Math.exp(-Math.max(0, elapsedMs) / EASE_MS);
  const ease = (from: number, to: number) => from + (to - from) * k;
  return {
    strength: ease(current.strength, target.strength),
    speed: ease(current.speed, target.speed),
    churn: ease(current.churn, target.churn),
    echo: ease(current.echo, target.echo),
    attention: ease(current.attention, target.attention),
    knot: ease(current.knot, target.knot),
    pulse: ease(current.pulse, target.pulse),
  };
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

/** A sidebar row whose thread is busy or waiting; the characters around it light up. */
export interface BackdropHotRect extends BackdropClearRect {
  readonly tone: "working" | "attention";
}

const HEAT_FEATHER = 14;
const INSIDE_HEAT = 0.3;

/** Characters streaming through a working row, or breathing around a waiting one; null elsewhere. */
export function paintBackdropHeat(
  cell: BackdropCell,
  rects: ReadonlyArray<BackdropHotRect>,
  seconds: number,
): { readonly alpha: number; readonly tone: "accent" | "warning" } | null {
  let best: { alpha: number; tone: "accent" | "warning" } | null = null;
  for (const rect of rects) {
    const dx = Math.max(rect.left - cell.x, 0, cell.x - rect.right);
    const dy = Math.max(rect.top - cell.y, 0, cell.y - rect.bottom);
    const distance = Math.hypot(dx, dy);
    // Inside the row the characters stay dim behind its text; the glow sits around its edges.
    const heat = distance === 0 ? INSIDE_HEAT : 1 - smoothstep(0, HEAT_FEATHER, distance);
    if (heat <= 0) continue;
    // Working rows carry bands that run left to right; waiting rows glow as one.
    const pulse =
      rect.tone === "working"
        ? 0.5 + 0.5 * Math.sin(cell.x * 0.07 - seconds * 6 + cell.y * 0.03)
        : 0.55 + 0.45 * Math.sin(seconds * 3.2);
    const density = heat * pulse;
    if (cell.seed > density * 0.7) continue;
    const alpha = 0.12 + 0.4 * density;
    if (!best || alpha > best.alpha) {
      best = { alpha, tone: rect.tone === "working" ? "accent" : "warning" };
    }
  }
  return best;
}
