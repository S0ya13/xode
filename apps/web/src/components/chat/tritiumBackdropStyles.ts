/** Fork: the abstract backdrop styles, drawn in the margins beside the chat column. */
import {
  BACKDROP_BOTTOM_FADE,
  BACKDROP_TOP_FADE,
  stageMargins,
  type BackdropTuning,
} from "./tritiumBackdrop.logic";

export interface BackdropParticle {
  /** 0 at the outer edge of its margin, 1 at the chat column. */
  readonly across: number;
  readonly left: boolean;
  /** Starting height, 0 to 1. */
  readonly start: number;
  readonly radius: number;
  /** Rise speed in heights per second. */
  readonly rise: number;
  readonly phase: number;
}

export function createParticles(count: number, random: () => number = Math.random) {
  return Array.from({ length: count }, (): BackdropParticle => ({
    across: random() ** 1.6,
    left: random() < 0.5,
    start: random(),
    radius: 0.7 + random() * 1.5,
    rise: 0.012 + random() * 0.03,
    phase: random() * Math.PI * 2,
  }));
}

export interface StyleFrame {
  readonly context: CanvasRenderingContext2D;
  readonly width: number;
  readonly height: number;
  readonly column: number;
  readonly seconds: number;
  readonly tuning: BackdropTuning;
  readonly accent: string;
  readonly warning: string;
}

/** The same color fully transparent, so gradients fade without passing through black. */
export function transparentOf(color: string): string {
  if (color.startsWith("rgb(") && color.includes(",")) {
    return color.replace("rgb(", "rgba(").replace(/\)$/, ", 0)");
  }
  return color.replace(/\)$/, " / 0)");
}

// Draws once in the accent and once in the warning color, weighted by how much the agent waits.
const inTones = (frame: StyleFrame, paint: (color: string, weight: number) => void) => {
  const { attention } = frame.tuning;
  if (attention < 0.99) paint(frame.accent, 1 - attention);
  if (attention > 0.01) paint(frame.warning, attention);
};

const marginWidth = (frame: StyleFrame) =>
  frame.width / 2 - stageMargins(frame.width, frame.column).inner;

/** Soft light pooling in the corners, swelling while the agent works. */
export function drawAura(frame: StyleFrame) {
  const { context, width, height, seconds, tuning } = frame;
  const margin = marginWidth(frame);
  const swell = 1 + 0.25 * tuning.pulse * Math.sin(seconds * 1.4);
  const blobs: Array<readonly [number, number, number]> = [
    [
      margin * (0.2 + 0.15 * Math.sin(seconds * 0.3)),
      height * (0.75 + 0.08 * Math.sin(seconds * 0.21)),
      1,
    ],
    [
      width - margin * (0.25 + 0.15 * Math.sin(seconds * 0.27 + 2)),
      height * (0.35 + 0.1 * Math.sin(seconds * 0.18 + 1)),
      0.95,
    ],
    [width - margin * 0.3, height * (0.92 + 0.04 * Math.sin(seconds * 0.33)), 0.85],
    [margin * 0.3, height * (0.32 + 0.08 * Math.sin(seconds * 0.25 + 3)), 0.75],
  ];
  inTones(frame, (color, weight) => {
    const clear = transparentOf(color);
    for (const [x, y, size] of blobs) {
      const radius = Math.max(margin * 1.4, height * 0.32) * size * swell;
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, color);
      gradient.addColorStop(1, clear);
      context.globalAlpha =
        0.32 * tuning.strength * weight * (0.85 + 0.15 * Math.sin(seconds * 0.9 + y));
      context.fillStyle = gradient;
      context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
  });
}

const WAVE_LINES = 6;

/** Thin lines flowing down each side, stirring faster while the agent works. */
export function drawWaves(frame: StyleFrame) {
  const { context, width, height, seconds, tuning } = frame;
  const margin = marginWidth(frame);
  const amplitude = 6 + 6 * tuning.pulse;
  context.lineWidth = 1;
  inTones(frame, (color, weight) => {
    context.strokeStyle = color;
    for (const left of [true, false]) {
      for (let line = 0; line < WAVE_LINES; line++) {
        const base = ((line + 0.5) / WAVE_LINES) * Math.min(margin * 0.55, 220);
        context.globalAlpha = (0.1 + 0.3 * (1 - line / WAVE_LINES)) * tuning.strength * weight;
        context.beginPath();
        for (let y = 0; y <= height; y += 6) {
          const offset =
            base +
            amplitude * Math.sin(y * 0.02 + seconds * 0.9 + line * 0.7) +
            (amplitude / 2) * Math.sin(y * 0.05 - seconds * 0.6 + line);
          const x = left ? offset : width - offset;
          if (y === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.stroke();
      }
    }
  });
}

/** Sparse points rising through the margins and twinkling. */
export function drawParticles(frame: StyleFrame, particles: ReadonlyArray<BackdropParticle>) {
  const { context, width, height, seconds, tuning } = frame;
  const margin = marginWidth(frame);
  inTones(frame, (color, weight) => {
    context.fillStyle = color;
    for (const particle of particles) {
      const rise = (((particle.start - seconds * particle.rise) % 1) + 1) % 1;
      const offset = particle.across * margin;
      const x = particle.left ? offset : width - offset;
      const twinkle = 0.55 + 0.45 * Math.sin(seconds * 1.6 + particle.phase);
      context.globalAlpha = (0.3 + 0.5 * twinkle) * tuning.strength * weight;
      context.beginPath();
      context.arc(x, rise * height, particle.radius, 0, Math.PI * 2);
      context.fill();
    }
  });
}

/** Erases the chat column and the top and bottom rims, so shapes only live in the margins. */
export function maskStage(frame: StyleFrame) {
  const { context, width, height, column } = frame;
  const { inner, outer } = stageMargins(width, column);
  const half = width / 2;
  const solid = "#000";
  const clear = "rgba(0, 0, 0, 0)";
  context.globalAlpha = 1;
  context.globalCompositeOperation = "destination-out";
  if (width > 0 && inner > 0) {
    const across = context.createLinearGradient(0, 0, width, 0);
    across.addColorStop(Math.max(0, (half - outer) / width), clear);
    across.addColorStop((half - inner) / width, solid);
    across.addColorStop((half + inner) / width, solid);
    across.addColorStop(Math.min(1, (half + outer) / width), clear);
    context.fillStyle = across;
    context.fillRect(0, 0, width, height);
  }
  const top = context.createLinearGradient(0, 0, 0, BACKDROP_TOP_FADE);
  top.addColorStop(0, solid);
  top.addColorStop(1, clear);
  context.fillStyle = top;
  context.fillRect(0, 0, width, BACKDROP_TOP_FADE);
  const bottom = context.createLinearGradient(0, height, 0, height - BACKDROP_BOTTOM_FADE);
  bottom.addColorStop(0, solid);
  bottom.addColorStop(1, clear);
  context.fillStyle = bottom;
  context.fillRect(0, height - BACKDROP_BOTTOM_FADE, width, BACKDROP_BOTTOM_FADE);
  context.globalCompositeOperation = "source-over";
}
