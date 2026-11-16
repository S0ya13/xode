import { describe, expect, it } from "vite-plus/test";

import { createParticles, transparentOf } from "./tritiumBackdropStyles";

describe("transparentOf", () => {
  it("clears legacy rgb, modern and color() syntaxes", () => {
    expect(transparentOf("rgb(31, 95, 168)")).toBe("rgba(31, 95, 168, 0)");
    expect(transparentOf("oklch(0.488 0.217 264)")).toBe("oklch(0.488 0.217 264 / 0)");
    expect(transparentOf("color(srgb 0.1 0.2 0.3)")).toBe("color(srgb 0.1 0.2 0.3 / 0)");
  });
});

describe("createParticles", () => {
  it("keeps every particle inside its margin and rising", () => {
    const particles = createParticles(50);
    expect(particles).toHaveLength(50);
    for (const particle of particles) {
      expect(particle.across).toBeGreaterThanOrEqual(0);
      expect(particle.across).toBeLessThanOrEqual(1);
      expect(particle.rise).toBeGreaterThan(0);
    }
  });
});
