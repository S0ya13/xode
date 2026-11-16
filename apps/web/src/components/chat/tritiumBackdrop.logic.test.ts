import { describe, expect, it } from "vite-plus/test";

import {
  BACKDROP_CELL_HEIGHT,
  BACKDROP_CELL_WIDTH,
  BACKDROP_TUNING,
  backdropClearance,
  buildBackdropCells,
  easeBackdropTuning,
  paintBackdropCell,
  paintBackdropHeat,
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

  it("leaves the trefoil out of the rail and thickens its clouds toward the bottom", () => {
    const cells = buildBackdropCells(240, 600, () => 0.5, "rail");
    expect(Math.max(...cells.map((cell) => cell.core))).toBe(0);
    expect(cells[0]!.side).toBe(0);
    expect(cells.at(-1)!.side).toBeGreaterThan(0.7);
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

describe("paintBackdropHeat", () => {
  const cell = (x: number, y: number) => ({ x, y, core: 0, halo: 0, side: 0, along: 0, seed: 0 });
  const row = { left: 10, top: 100, right: 230, bottom: 140 };

  it("lights the edge of a working row, keeps its inside dim and leaves distant cells alone", () => {
    const rects = [{ ...row, tone: "working" as const }];
    // At this moment the band peaks on the cell just below the row.
    const edge = paintBackdropHeat(
      cell(120, 146),
      rects,
      (120 * 0.07 + 146 * 0.03 - Math.PI / 2) / 6,
    );
    const inside = paintBackdropHeat(
      cell(120, 120),
      rects,
      (120 * 0.07 + 120 * 0.03 - Math.PI / 2) / 6,
    );
    expect(edge?.tone).toBe("accent");
    expect(edge!.alpha).toBeGreaterThan(inside!.alpha);
    expect(paintBackdropHeat(cell(120, 300), rects, 0)).toBeNull();
  });

  it("glows in the warning tone around a row waiting on the user", () => {
    const rects = [{ ...row, tone: "attention" as const }];
    expect(paintBackdropHeat(cell(120, 144), rects, 0)?.tone).toBe("warning");
  });
});
