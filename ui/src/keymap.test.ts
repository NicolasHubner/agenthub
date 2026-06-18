import { describe, expect, it } from "vitest";
import {
  cycleSelection,
  isModifierKey,
  isPrefixChord,
  jumpSelection,
  resolvePrefixCommand,
  spatialNavigate,
  type Box,
} from "./keymap";

describe("resolvePrefixCommand", () => {
  it("maps core tmux-style keys", () => {
    expect(resolvePrefixCommand("c")).toEqual({ kind: "new" });
    expect(resolvePrefixCommand("x")).toEqual({ kind: "close" });
    expect(resolvePrefixCommand("n")).toEqual({ kind: "cycle", dir: 1 });
    expect(resolvePrefixCommand("p")).toEqual({ kind: "cycle", dir: -1 });
    expect(resolvePrefixCommand("z")).toEqual({ kind: "zoom" });
    expect(resolvePrefixCommand("Escape")).toEqual({ kind: "cancel" });
  });

  it("maps arrows to spatial nav", () => {
    expect(resolvePrefixCommand("ArrowRight")).toEqual({ kind: "nav", dx: 1, dy: 0 });
    expect(resolvePrefixCommand("ArrowUp")).toEqual({ kind: "nav", dx: 0, dy: -1 });
  });

  it("maps digits to jumps (1-9 then 0)", () => {
    expect(resolvePrefixCommand("1")).toEqual({ kind: "jump", index: 0 });
    expect(resolvePrefixCommand("9")).toEqual({ kind: "jump", index: 8 });
    expect(resolvePrefixCommand("0")).toEqual({ kind: "jump", index: 9 });
  });

  it("returns null for unbound keys", () => {
    expect(resolvePrefixCommand("q")).toBeNull();
  });
});

describe("isPrefixChord / isModifierKey", () => {
  it("detects Ctrl-b", () => {
    expect(isPrefixChord({ ctrlKey: true, altKey: false, metaKey: false, key: "b" })).toBe(true);
    expect(isPrefixChord({ ctrlKey: true, altKey: false, metaKey: false, key: "B" })).toBe(true);
    expect(isPrefixChord({ ctrlKey: true, altKey: true, metaKey: false, key: "b" })).toBe(false);
    expect(isPrefixChord({ ctrlKey: false, altKey: false, metaKey: false, key: "b" })).toBe(false);
  });
  it("flags modifier-only keys", () => {
    expect(isModifierKey("Control")).toBe(true);
    expect(isModifierKey("Shift")).toBe(true);
    expect(isModifierKey("a")).toBe(false);
  });
});

describe("cycleSelection", () => {
  const ids = ["a", "b", "c"];
  it("wraps forward and backward", () => {
    expect(cycleSelection(ids, "a", 1)).toBe("b");
    expect(cycleSelection(ids, "c", 1)).toBe("a");
    expect(cycleSelection(ids, "a", -1)).toBe("c");
  });
  it("handles missing / empty", () => {
    expect(cycleSelection(ids, null, 1)).toBe("a");
    expect(cycleSelection(ids, null, -1)).toBe("c");
    expect(cycleSelection([], "a", 1)).toBeNull();
  });
});

describe("jumpSelection", () => {
  it("returns id at index or null", () => {
    expect(jumpSelection(["a", "b"], 1)).toBe("b");
    expect(jumpSelection(["a", "b"], 5)).toBeNull();
  });
});

describe("spatialNavigate", () => {
  const boxes: Box[] = [
    { id: "left", x: 0, y: 100, width: 100, height: 100 },
    { id: "mid", x: 300, y: 100, width: 100, height: 100 },
    { id: "right", x: 600, y: 100, width: 100, height: 100 },
    { id: "below", x: 300, y: 400, width: 100, height: 100 },
  ];
  it("moves right to the nearest box on the right", () => {
    expect(spatialNavigate(boxes, "left", 1, 0)).toBe("mid");
    expect(spatialNavigate(boxes, "mid", 1, 0)).toBe("right");
  });
  it("moves left", () => {
    expect(spatialNavigate(boxes, "right", -1, 0)).toBe("mid");
  });
  it("moves down", () => {
    expect(spatialNavigate(boxes, "mid", 0, 1)).toBe("below");
  });
  it("returns null when nothing lies in the direction", () => {
    expect(spatialNavigate(boxes, "right", 1, 0)).toBeNull();
  });
});
