// tmux-style prefix keymap for the agent canvas.
// Prefix (default Ctrl-b) then a command key drives pane actions.

export type PaneCommand =
  | { kind: "new" }
  | { kind: "close" }
  | { kind: "cycle"; dir: 1 | -1 }
  | { kind: "nav"; dx: -1 | 0 | 1; dy: -1 | 0 | 1 }
  | { kind: "zoom" }
  | { kind: "jump"; index: number }
  | { kind: "cancel" };

// Map a key (KeyboardEvent.key) pressed after the prefix to a command.
// Returns null when the key is not bound (caller should drop the prefix).
export function resolvePrefixCommand(key: string): PaneCommand | null {
  switch (key) {
    case "c":
    case "C":
      return { kind: "new" };
    case "x":
    case "X":
      return { kind: "close" };
    case "n":
      return { kind: "cycle", dir: 1 };
    case "p":
      return { kind: "cycle", dir: -1 };
    case "z":
    case "Z":
      return { kind: "zoom" };
    case "ArrowRight":
      return { kind: "nav", dx: 1, dy: 0 };
    case "ArrowLeft":
      return { kind: "nav", dx: -1, dy: 0 };
    case "ArrowUp":
      return { kind: "nav", dx: 0, dy: -1 };
    case "ArrowDown":
      return { kind: "nav", dx: 0, dy: 1 };
    case "Escape":
      return { kind: "cancel" };
    default:
      if (key >= "1" && key <= "9") return { kind: "jump", index: Number(key) - 1 };
      if (key === "0") return { kind: "jump", index: 9 };
      return null;
  }
}

// True for modifier-only keydowns — these must not consume the pending prefix.
export function isModifierKey(key: string): boolean {
  return key === "Control" || key === "Shift" || key === "Alt" || key === "Meta";
}

// Is this keydown the prefix chord? Default chord is Ctrl-b.
export function isPrefixChord(
  e: { ctrlKey: boolean; altKey: boolean; metaKey: boolean; key: string },
  chordKey = "b",
): boolean {
  return e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === chordKey;
}

export interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function center(b: Box): { x: number; y: number } {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

// Next id when cycling forward (+1) or backward (-1) through ids.
export function cycleSelection(ids: string[], currentId: string | null, dir: 1 | -1): string | null {
  if (ids.length === 0) return null;
  const i = currentId ? ids.indexOf(currentId) : -1;
  if (i === -1) return dir === 1 ? ids[0] : ids[ids.length - 1];
  const next = (i + dir + ids.length) % ids.length;
  return ids[next];
}

// id at a 0-based position, or null when out of range.
export function jumpSelection(ids: string[], index: number): string | null {
  return ids[index] ?? null;
}

// Nearest box in the (dx, dy) direction from the current box's center.
// Distance is biased so candidates aligned with the travel axis win ties.
export function spatialNavigate(
  boxes: Box[],
  currentId: string | null,
  dx: -1 | 0 | 1,
  dy: -1 | 0 | 1,
): string | null {
  const current = boxes.find((b) => b.id === currentId);
  if (!current) return cycleSelection(boxes.map((b) => b.id), currentId, dx + dy >= 0 ? 1 : -1);
  const from = center(current);

  let best: { id: string; score: number } | null = null;
  for (const b of boxes) {
    if (b.id === currentId) continue;
    const c = center(b);
    const vx = c.x - from.x;
    const vy = c.y - from.y;
    // Must move in the requested direction along the dominant axis.
    const along = dx !== 0 ? vx * dx : vy * dy;
    if (along <= 0) continue;
    const cross = dx !== 0 ? Math.abs(vy) : Math.abs(vx);
    const score = along + cross * 2; // prefer aligned, then close
    if (!best || score < best.score) best = { id: b.id, score };
  }
  return best?.id ?? null;
}
