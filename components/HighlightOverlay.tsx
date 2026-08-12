'use client';

import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  containerRef: RefObject<HTMLElement | null>;
  /** `data-hl` values to span. Null or empty clears the overlay. */
  keys: string[] | null;
  shape: 'bracket' | 'outline';
}

function groupIntoRuns(rects: Rect[]): Rect[] {
  const rows = new Map<number, Rect[]>();
  for (const rect of rects) {
    const rowKey = Math.round(rect.y);
    const bucket = rows.get(rowKey);
    if (bucket) bucket.push(rect);
    else rows.set(rowKey, [rect]);
  }

  const runs: Rect[] = [];
  for (const bucket of rows.values()) {
    bucket.sort((a, b) => a.x - b.x);
    let current: Rect | null = null;
    for (const rect of bucket) {
      if (current && rect.x - (current.x + current.w) <= 4) {
        current.w = rect.x + rect.w - current.x;
        current.h = Math.max(current.h, rect.h);
      } else {
        if (current) runs.push(current);
        current = { ...rect };
      }
    }
    if (current) runs.push(current);
  }
  return runs;
}

function bracketPath(run: Rect): string {
  const left = run.x + 3;
  const right = run.x + run.w - 3;
  const baseline = run.y + run.h - 5;
  const tick = 7;
  return `M ${left} ${baseline - tick} V ${baseline} H ${right} V ${baseline - tick}`;
}

function outlinePath(runs: Rect[]): string {
  const left = Math.min(...runs.map((r) => r.x)) + 1;
  const top = Math.min(...runs.map((r) => r.y)) + 1;
  const right = Math.max(...runs.map((r) => r.x + r.w)) - 1;
  const bottom = Math.max(...runs.map((r) => r.y + r.h)) - 1;
  return `M ${left} ${top} H ${right} V ${bottom} H ${left} Z`;
}

/**
 * The one piece of motion in the app. Hovering a result draws a bracket across
 * the dates it covers, or outlines the block on the time grid.
 *
 * Positions are measured from the DOM rather than recomputed from geometry, so
 * the overlay stays correct through responsive column widths and month wrapping.
 */
export default function HighlightOverlay({ containerRef, keys, shape }: Props) {
  const [paths, setPaths] = useState<string[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const signature = keys ? keys.join(',') : '';

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !keys || keys.length === 0) {
      setPaths([]);
      return;
    }

    const measure = () => {
      const base = container.getBoundingClientRect();
      const rects: Rect[] = [];
      for (const key of keys) {
        const element = container.querySelector<HTMLElement>(`[data-hl="${key}"]`);
        if (!element) continue;
        const box = element.getBoundingClientRect();
        rects.push({
          x: box.left - base.left,
          y: box.top - base.top,
          w: box.width,
          h: box.height,
        });
      }
      if (rects.length === 0) {
        setPaths([]);
        return;
      }
      setSize({ width: container.offsetWidth, height: container.offsetHeight });
      const runs = groupIntoRuns(rects);
      setPaths(shape === 'outline' ? [outlinePath(runs)] : runs.map(bracketPath));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
    // `signature` stands in for `keys`, which is a fresh array on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, shape, containerRef]);

  useEffect(() => {
    if (!keys || keys.length === 0) setPaths([]);
  }, [keys]);

  if (paths.length === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute left-0 top-0 z-20"
      width={size.width}
      height={size.height}
      aria-hidden="true"
    >
      {paths.map((d, index) => (
        <g key={`${d}-${index}`}>
          <path d={d} fill="none" stroke="var(--color-paper)" strokeWidth={4} strokeLinecap="round" opacity={0.85} />
          <path
            className="bracket-path"
            d={d}
            pathLength={1}
            fill="none"
            stroke="var(--color-ramp-5)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      ))}
    </svg>
  );
}
