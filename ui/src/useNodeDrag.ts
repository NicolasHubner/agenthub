import { useEffect, useRef } from "react";

type DragOpts = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zoom: number;
  screenToCanvas: (sx: number, sy: number) => { x: number; y: number };
  onMove: (id: string, x: number, y: number) => void;
  onResize?: (id: string, width: number, height: number) => void;
  minWidth?: number;
  minHeight?: number;
};

export function useNodeDrag({
  id,
  x,
  y,
  width,
  height,
  zoom,
  screenToCanvas,
  onMove,
  onResize,
  minWidth = 160,
  minHeight = 100,
}: DragOpts) {
  const dragRef = useRef<{ ox: number; oy: number } | null>(null);
  const resizeRef = useRef<{ w: number; h: number; sx: number; sy: number } | null>(null);

  function startDrag(e: React.MouseEvent) {
    const c = screenToCanvas(e.clientX, e.clientY);
    dragRef.current = { ox: c.x - x, oy: c.y - y };
    e.preventDefault();
  }

  function startResize(e: React.MouseEvent) {
    e.stopPropagation();
    resizeRef.current = { w: width, h: height, sx: e.clientX, sy: e.clientY };
  }

  useEffect(() => {
    function handleMove(e: MouseEvent) {
      if (dragRef.current) {
        const c = screenToCanvas(e.clientX, e.clientY);
        onMove(id, c.x - dragRef.current.ox, c.y - dragRef.current.oy);
      }
      if (resizeRef.current && onResize) {
        const dw = (e.clientX - resizeRef.current.sx) / zoom;
        const dh = (e.clientY - resizeRef.current.sy) / zoom;
        onResize(
          id,
          Math.max(minWidth, resizeRef.current.w + dw),
          Math.max(minHeight, resizeRef.current.h + dh),
        );
      }
    }
    function onUp() {
      dragRef.current = null;
      resizeRef.current = null;
    }
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [id, width, height, zoom, screenToCanvas, onMove, onResize, minWidth, minHeight]);

  return { startDrag, startResize };
}
