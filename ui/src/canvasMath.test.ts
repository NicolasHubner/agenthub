import { describe, expect, it } from "vitest";
import { rectContains } from "./canvasMath";

describe("rectContains", () => {
  it("returns true when inner rect is fully inside outer rect", () => {
    const outer = { x: 0, y: 0, width: 400, height: 300 };
    const inner = { x: 50, y: 50, width: 100, height: 80 };
    expect(rectContains(outer, inner)).toBe(true);
  });

  it("returns false when inner rect extends past the right edge", () => {
    const outer = { x: 0, y: 0, width: 400, height: 300 };
    const inner = { x: 350, y: 50, width: 100, height: 80 };
    expect(rectContains(outer, inner)).toBe(false);
  });

  it("returns false when inner rect extends past the top edge", () => {
    const outer = { x: 100, y: 100, width: 400, height: 300 };
    const inner = { x: 150, y: 50, width: 50, height: 50 };
    expect(rectContains(outer, inner)).toBe(false);
  });

  it("treats an inner rect exactly matching outer bounds as contained", () => {
    const outer = { x: 0, y: 0, width: 200, height: 200 };
    expect(rectContains(outer, outer)).toBe(true);
  });
});
