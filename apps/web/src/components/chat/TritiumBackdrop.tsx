import { useEffect, useRef } from "react";

import { observeResize } from "../../lib/observeResize";
import {
  BACKDROP_CELL_HEIGHT,
  BACKDROP_CHARS,
  backdropClearance,
  buildBackdropCells,
  paintBackdropCell,
  type BackdropCell,
  type BackdropClearRect,
} from "./tritiumBackdrop.logic";

const FRAME_MS = 66;
const COLOR_REFRESH_MS = 1000;
const CHAR_CHANGE_RATE = 0.012;

const randomChar = () => BACKDROP_CHARS[Math.floor(Math.random() * BACKDROP_CHARS.length)]!;

/**
 * Fork: the Tritium trefoil in drifting characters behind the chat. `dim` fades it behind a
 * conversation; a new thread shows it in full.
 */
export function TritiumBackdrop({ dim }: { readonly dim: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the canvas drawn: a resize observer sizes it and animation frames paint it until unmount or a strength change.
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const strength = dim ? 0.2 : 1;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let cells: BackdropCell[] = [];
    let chars: string[] = [];
    let width = 0;
    let height = 0;
    // The class resolves theme colors: text is the ink, the border the accent.
    let ink = "";
    let accent = "";
    let colorsReadAt = -Infinity;
    // Text marked `data-backdrop-clear` keeps the characters behind it faint, so it stays readable.
    let clearRects: BackdropClearRect[] = [];

    const draw = (now: number) => {
      if (now - colorsReadAt > COLOR_REFRESH_MS) {
        const style = getComputedStyle(canvas);
        ink = style.color;
        accent = style.borderTopColor;
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
      context.clearRect(0, 0, width, height);
      for (let index = 0; index < cells.length; index++) {
        const paint = paintBackdropCell(cells[index]!, now);
        if (!paint) continue;
        if (!reduceMotion && Math.random() < CHAR_CHANGE_RATE) chars[index] = randomChar();
        const cell = cells[index]!;
        context.globalAlpha =
          paint.alpha *
          strength *
          (clearRects.length > 0 ? backdropClearance(cell.x, cell.y, clearRects) : 1);
        context.fillStyle = paint.tone === "accent" ? accent : ink;
        context.fillText(chars[index]!, cell.x, cell.y);
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
    if (reduceMotion) return stopResize;

    let frame = 0;
    let drawnAt = 0;
    const tick = (now: number) => {
      frame = window.requestAnimationFrame(tick);
      if (now - drawnAt < FRAME_MS) return;
      drawnAt = now;
      draw(now);
    };
    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
      stopResize();
    };
  }, [dim]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      data-tritium-backdrop={dim ? "dim" : "full"}
      className="tritium-backdrop pointer-events-none absolute inset-0 -z-10 size-full"
    />
  );
}
