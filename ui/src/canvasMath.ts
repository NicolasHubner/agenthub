export type CanvasView = { x: number; y: number; zoom: number };

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function screenToCanvas(
  sx: number,
  sy: number,
  rect: DOMRect,
  view: CanvasView,
) {
  return {
    x: (sx - rect.left - view.x) / view.zoom,
    y: (sy - rect.top - view.y) / view.zoom,
  };
}

export function portPosition(
  x: number,
  y: number,
  w: number,
  h: number,
  side: "in" | "out",
) {
  const header = 36;
  const cy = y + header + (h - header) / 2;
  return side === "out" ? { x: x + w, y: cy } : { x, y: cy };
}

export function cablePath(x1: number, y1: number, x2: number, y2: number) {
  const dx = Math.max(72, Math.abs(x2 - x1) * 0.42);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

export type Rect = { x: number; y: number; width: number; height: number };

const TILE_GAP = 48;
const TILE_ORIGIN = { x: 80, y: 80 };
const TILE_COLS = 3;

function rectsOverlap(a: Rect, b: Rect, gap: number): boolean {
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  );
}

/** First grid slot that does not overlap any existing canvas object. */
export function nextCanvasPosition(
  existing: Rect[],
  width: number,
  height: number,
): { x: number; y: number } {
  for (let i = 0; i < 64; i++) {
    const col = i % TILE_COLS;
    const row = Math.floor(i / TILE_COLS);
    const x = TILE_ORIGIN.x + col * (width + TILE_GAP);
    const y = TILE_ORIGIN.y + row * (height + TILE_GAP);
    const candidate = { x, y, width, height };
    if (!existing.some((r) => rectsOverlap(candidate, r, TILE_GAP))) {
      return { x, y };
    }
  }
  const n = existing.length;
  return {
    x: TILE_ORIGIN.x + (n % TILE_COLS) * (width + TILE_GAP),
    y: TILE_ORIGIN.y + Math.floor(n / TILE_COLS) * (height + TILE_GAP) + n * 12,
  };
}

export const nextTerminalPosition = nextCanvasPosition;
