import { describe, expect, it } from "vite-plus/test";

import {
  BACKDROP_CELL_HEIGHT,
  BACKDROP_CELL_WIDTH,
  BACKDROP_TUNING,
  backdropClearance,
  buildBackdropCells,
  easeBackdropTuning,
  paintBackdropCell,
} from "./tritiumBackdrop.logic";

describe("buildBackdropCells", () => {
  it("covers the area and draws the trefoil through its middle", () => {
    const cells = buildBackdropCells(600, 400, () => 0.5);
    expect(cells).toHaveLength(
      Math.ceil(600 / BACKDROP_CELL_WIDTH) * Math.ceil(400 / BACKDROP_CELL_HEIGHT),
    );
    // The trefoil's lobes pass close to the center, its corners stay empty.
    expect(Math.max(...cells.map((cell) => cell.core))).toBeGreaterThan(0.9);
    expect(cells[0]!.core).toBe(0);
    expect(cells[0]!.side).toBeGreaterThan(0.9);
  });

  it("returns nothing for an empty area", () => {
    expect(buildBackdropCells(0, 400)).toEqual([]);
  });
});

describe("paintBackdropCell", () => {
  const base = { x: 300, y: 200, core: 0, halo: 0, side: 0, along: 0, seed: 0.5 };
  const still = { phase: 0, seconds: 0, echo: 0 };

  it("lights a cell on the line in the accent tone", () => {
    expect(paintBackdropCell({ ...base, core: 1, halo: 1 }, still)).toEqual({
      alpha: 1,
      tone: "accent",
    });
  });

  it("leaves a middle cell off the line empty", () => {
    expect(paintBackdropCell(base, still)).toBeNull();
  });
});

describe("backdropClearance", () => {
  const rect = { left: 100, top: 100, right: 300, bottom: 140 };

  it("fades cells over marked text and leaves distant ones alone", () => {
    expect(backdropClearance(200, 120, [rect])).toBeCloseTo(0.08);
    expect(backdropClearance(200, 300, [rect])).toBe(1);
    expect(backdropClearance(200, 300, [])).toBe(1);
  });
});

describe("easeBackdropTuning", () => {
  it("blends toward the new mode and settles on it", () => {
    const { idle, working } = BACKDROP_TUNING;
    const halfway = easeBackdropTuning(idle, working, 450);
    expect(halfway.speed).toBeGreaterThan(idle.speed);
    expect(halfway.speed).toBeLessThan(working.speed);
    expect(easeBackdropTuning(idle, working, 10_000).speed).toBeCloseTo(working.speed);
    expect(easeBackdropTuning(idle, working, 0)).toEqual(idle);
  });
});
