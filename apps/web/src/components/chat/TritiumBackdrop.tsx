import { useEffect, useRef } from "react";

import { observeResize } from "../../lib/observeResize";
import {
  BACKDROP_CELL_HEIGHT,
  BACKDROP_DEFAULT_COLUMN,
  BACKDROP_CHARS,
  BACKDROP_TUNING,
  BACKDROP_WAVE_PERIOD_MS,
  backdropClearance,
  buildBackdropCells,
  easeBackdropTuning,
  paintBackdropCell,
  paintBackdropHeat,
  type BackdropCell,
  type BackdropClearRect,
  type BackdropHotRect,
  type BackdropLayout,
  type BackdropMode,
} from "./tritiumBackdrop.logic";
import {
  createParticles,
  drawAura,
  drawParticles,
  drawWaves,
  maskStage,
  type BackdropParticle,
} from "./tritiumBackdropStyles";

const FRAME_MS = 50;
// Reduced motion keeps the trefoil still and only follows mode changes.
const REDUCED_FRAME_MS = 500;
const COLOR_REFRESH_MS = 1000;
const BREATH_MS = 1800;
const BREATH_DEPTH = 0.5;

const randomChar = () => BACKDROP_CHARS[Math.floor(Math.random() * BACKDROP_CHARS.length)]!;

const readMode = (canvas: HTMLCanvasElement): BackdropMode => {
  const mode = canvas.dataset.tritiumBackdrop;
  return mode === "hero" || mode === "working" || mode === "attention" ? mode : "idle";
};

// The style setting lands on the root element, so a change applies on the next frame.
const readStyle = () => {
  const style = document.documentElement.dataset.backdropStyle;
  return style === "aura" || style === "waves" || style === "particles" || style === "off"
    ? style
    : "characters";
};

const relativeRect = (rect: DOMRect, origin: DOMRect): BackdropClearRect => ({
  left: rect.left - origin.left,
  top: rect.top - origin.top,
  right: rect.right - origin.left,
  bottom: rect.bottom - origin.top,
});

/**
 * Fork: drifting characters around the chat, with the Tritium trefoil only on an empty thread.
 * Rings run in from the margins while the agent works and breathe in the warning color while it
 * waits. The `rail` layout lights up around sidebar rows marked `data-tritium-status`.
 */
export function TritiumBackdrop({
  mode,
  layout = "stage",
}: {
  readonly mode: BackdropMode;
  readonly layout?: BackdropLayout;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the canvas drawn: a resize observer sizes it and animation frames paint it until unmount; the mode is read from its data attribute each frame.
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const rail = layout === "rail";
    let cells: BackdropCell[] = [];
    let chars: string[] = [];
    let width = 0;
    let height = 0;
    let column = BACKDROP_DEFAULT_COLUMN;
    let particles: BackdropParticle[] = [];
    // The class resolves theme colors: text is the ink, the border the accent, the outline the
    // warning color.
    let ink = "";
    let accent = "";
    let warning = "";
    let colorsReadAt = -Infinity;
    // Text marked `data-backdrop-clear` keeps the characters behind it faint, so it stays readable.
    let clearRects: BackdropClearRect[] = [];
    let hotRects: BackdropHotRect[] = [];
    let tuning = BACKDROP_TUNING[readMode(canvas)];
    let phase = 0;
    let seconds = 0;
    let lastFrameAt: number | null = null;

    const drawChar = (char: string, cell: BackdropCell, color: string, alpha: number) => {
      context.globalAlpha = Math.min(1, alpha);
      context.fillStyle = color;
      context.fillText(char, cell.x, cell.y);
    };

    const draw = (now: number) => {
      if (now - colorsReadAt > COLOR_REFRESH_MS) {
        const style = getComputedStyle(canvas);
        ink = style.color;
        accent = style.borderTopColor;
        warning = style.outlineColor;
        if (!rail) {
          const origin = canvas.getBoundingClientRect();
          clearRects = Array.from(document.querySelectorAll("[data-backdrop-clear]"), (element) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            return relativeRect(range.getBoundingClientRect(), origin);
          }).filter((rect) => rect.right > rect.left);
        }
        colorsReadAt = now;
      }
      if (rail) {
        // Rows move as the list scrolls, so they are measured every frame; only marked rows count.
        const origin = canvas.getBoundingClientRect();
        hotRects = Array.from(
          canvas.parentElement?.querySelectorAll<HTMLElement>("[data-tritium-status]") ?? [],
          (element): BackdropHotRect => ({
            ...relativeRect(element.getBoundingClientRect(), origin),
            tone: element.dataset.tritiumStatus === "working" ? "working" : "attention",
          }),
        ).filter((rect) => rect.bottom > 0 && rect.top < height && rect.right > rect.left);
      }
      const elapsed = lastFrameAt === null ? 0 : now - lastFrameAt;
      lastFrameAt = now;
      const target = BACKDROP_TUNING[readMode(canvas)];
      tuning = reduceMotion ? target : easeBackdropTuning(tuning, target, elapsed);
      if (!reduceMotion) {
        phase = (phase + (elapsed / BACKDROP_WAVE_PERIOD_MS) * tuning.speed) % 1;
        seconds += (elapsed / 1000) * (0.5 + 0.5 * tuning.speed);
      }
      const breath = reduceMotion
        ? 1
        : 1 + BREATH_DEPTH * tuning.attention * Math.sin((now / BREATH_MS) * Math.PI * 2);
      const frame = { phase, seconds, echo: tuning.echo, knot: tuning.knot, pulse: tuning.pulse };
      const heatSeconds = reduceMotion ? 0 : now / 1000;
      context.clearRect(0, 0, width, height);
      const style = readStyle();
      if (style === "off") return;
      // The abstract styles fill the stage margins; characters still draw the trefoil and the rail.
      const shapes = !rail && style !== "characters";
      if (shapes) {
        const styleFrame = { context, width, height, column, seconds, tuning, accent, warning };
        if (style === "aura") drawAura(styleFrame);
        else if (style === "waves") drawWaves(styleFrame);
        else drawParticles(styleFrame, particles);
        maskStage(styleFrame);
        if (tuning.knot < 0.01) {
          context.globalAlpha = 1;
          return;
        }
      }
      for (let index = 0; index < cells.length; index++) {
        const cell = cells[index]!;
        if (shapes && cell.halo === 0) continue;
        const heat = hotRects.length > 0 ? paintBackdropHeat(cell, hotRects, heatSeconds) : null;
        const paint = heat ? null : paintBackdropCell(cell, frame);
        if (!heat && !paint) continue;
        if (!reduceMotion && Math.random() < (heat ? 0.04 : tuning.churn)) {
          chars[index] = randomChar();
        }
        const char = chars[index]!;
        if (heat) {
          drawChar(char, cell, heat.tone === "accent" ? accent : warning, heat.alpha);
          continue;
        }
        const alpha =
          paint!.alpha *
          tuning.strength *
          breath *
          (clearRects.length > 0 ? backdropClearance(cell.x, cell.y, clearRects) : 1);
        if (paint!.tone === "ink") {
          drawChar(char, cell, ink, alpha);
          continue;
        }
        // The accent turns to the warning color as attention rises; mid-blend draws both.
        if (tuning.attention < 0.99) drawChar(char, cell, accent, alpha * (1 - tuning.attention));
        if (tuning.attention > 0.01) drawChar(char, cell, warning, alpha * tuning.attention);
      }
      context.globalAlpha = 1;
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.font = `${BACKDROP_CELL_HEIGHT - 1}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      // The canvas carries the chat column width in `text-indent`, a length or a percentage.
      const indent = getComputedStyle(canvas).textIndent;
      column = indent.endsWith("%")
        ? (width * Number.parseFloat(indent)) / 100
        : Number.parseFloat(indent) || BACKDROP_DEFAULT_COLUMN;
      cells = buildBackdropCells(width, height, Math.random, layout, column);
      particles = createParticles(Math.round(height / 9));
      chars = cells.map(randomChar);
      colorsReadAt = -Infinity;
      draw(performance.now());
    };

    resize();
    const stopResize = observeResize(canvas, resize);
    const frameMs = reduceMotion ? REDUCED_FRAME_MS : FRAME_MS;
    let frameRequest = 0;
    let drawnAt = 0;
    const tick = (now: number) => {
      frameRequest = window.requestAnimationFrame(tick);
      if (now - drawnAt < frameMs) return;
      drawnAt = now;
      draw(now);
    };
    frameRequest = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frameRequest);
      stopResize();
    };
  }, [layout]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      data-tritium-backdrop={mode}
      className="tritium-backdrop pointer-events-none absolute inset-0 -z-10 size-full"
    />
  );
}
