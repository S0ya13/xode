import { useEffect, useRef } from "react";

import { observeResize } from "../../lib/observeResize";
import {
  BACKDROP_CELL_HEIGHT,
  BACKDROP_CHARS,
  BACKDROP_TUNING,
  BACKDROP_WAVE_PERIOD_MS,
  backdropClearance,
  buildBackdropCells,
  easeBackdropTuning,
  paintBackdropCell,
  type BackdropCell,
  type BackdropClearRect,
  type BackdropMode,
} from "./tritiumBackdrop.logic";

const FRAME_MS = 50;
// Reduced motion keeps the trefoil still and only follows mode changes.
const REDUCED_FRAME_MS = 500;
const COLOR_REFRESH_MS = 1000;
const BREATH_MS = 1800;

const randomChar = () => BACKDROP_CHARS[Math.floor(Math.random() * BACKDROP_CHARS.length)]!;

const readMode = (canvas: HTMLCanvasElement): BackdropMode => {
  const mode = canvas.dataset.tritiumBackdrop;
  return mode === "hero" || mode === "working" || mode === "attention" ? mode : "idle";
};

/**
 * Fork: the Tritium trefoil in drifting characters behind the chat. It runs in full on a new
 * thread, fades behind a conversation, races while the agent works, and breathes in the warning
 * color while the agent waits on the user. Mode changes blend instead of jumping.
 */
export function TritiumBackdrop({ mode }: { readonly mode: BackdropMode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the canvas drawn: a resize observer sizes it and animation frames paint it until unmount; the mode is read from its data attribute each frame.
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let cells: BackdropCell[] = [];
    let chars: string[] = [];
    let width = 0;
    let height = 0;
    // The class resolves theme colors: text is the ink, the border the accent, the outline the
    // warning color.
    let ink = "";
    let accent = "";
    let warning = "";
    let colorsReadAt = -Infinity;
    // Text marked `data-backdrop-clear` keeps the characters behind it faint, so it stays readable.
    let clearRects: BackdropClearRect[] = [];
    let tuning = BACKDROP_TUNING[readMode(canvas)];
    let phase = 0;
    let seconds = 0;
    let lastFrameAt: number | null = null;

    const draw = (now: number) => {
      if (now - colorsReadAt > COLOR_REFRESH_MS) {
        const style = getComputedStyle(canvas);
        ink = style.color;
        accent = style.borderTopColor;
        warning = style.outlineColor;
        const origin = canvas.getBoundingClientRect();
        clearRects = Array.from(document.querySelectorAll("[data-backdrop-clear]"), (element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          const rect = range.getBoundingClientRect();
          return {
            left: rect.left - origin.left,
            top: rect.top - origin.top,
            right: rect.right - origin.left,
            bottom: rect.bottom - origin.top,
          };
        }).filter((rect) => rect.right > rect.left);
        colorsReadAt = now;
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
        : 1 + 0.35 * tuning.attention * Math.sin((now / BREATH_MS) * Math.PI * 2);
      const frame = { phase, seconds, echo: tuning.echo };
      context.clearRect(0, 0, width, height);
      for (let index = 0; index < cells.length; index++) {
        const cell = cells[index]!;
        const paint = paintBackdropCell(cell, frame);
        if (!paint) continue;
        if (!reduceMotion && Math.random() < tuning.churn) chars[index] = randomChar();
        const alpha =
          paint.alpha *
          tuning.strength *
          breath *
          (clearRects.length > 0 ? backdropClearance(cell.x, cell.y, clearRects) : 1);
        const char = chars[index]!;
        if (paint.tone === "ink") {
          context.globalAlpha = Math.min(1, alpha);
          context.fillStyle = ink;
          context.fillText(char, cell.x, cell.y);
          continue;
        }
        // The accent turns to the warning color as attention rises; mid-blend draws both.
        if (tuning.attention < 0.99) {
          context.globalAlpha = Math.min(1, alpha * (1 - tuning.attention));
          context.fillStyle = accent;
          context.fillText(char, cell.x, cell.y);
        }
        if (tuning.attention > 0.01) {
          context.globalAlpha = Math.min(1, alpha * tuning.attention);
          context.fillStyle = warning;
          context.fillText(char, cell.x, cell.y);
        }
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
      cells = buildBackdropCells(width, height);
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
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      data-tritium-backdrop={mode}
      className="tritium-backdrop pointer-events-none absolute inset-0 -z-10 size-full"
    />
  );
}
