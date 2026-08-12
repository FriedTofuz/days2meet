'use client';

import { useEffect, useState } from 'react';

export interface TooltipData {
  heading: string;
  count: number;
  total: number;
  available: string[];
  unavailable: string[];
  anchor: { x: number; y: number };
  pinned: boolean;
}

/**
 * Fixed-position so it escapes the grid's scroll container, and clamped to the
 * viewport so it stays readable at 360px.
 */
export default function CellTooltip({ data }: { data: TooltipData | null }) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  useEffect(() => {
    if (!data || !element) return;
    const box = element.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(
      Math.max(margin, data.anchor.x - box.width / 2),
      window.innerWidth - box.width - margin,
    );
    const above = data.anchor.y - box.height - 10;
    const top = above > margin ? above : data.anchor.y + 22;
    setPosition({ left, top });
  }, [data, element]);

  if (!data) return null;

  return (
    <div
      ref={setElement}
      role="tooltip"
      className="pointer-events-none fixed z-50 max-w-[min(17rem,calc(100vw-1rem))] rounded-lg border border-line bg-surface px-3 py-2 text-[0.8125rem] shadow-[0_6px_24px_rgba(20,22,26,0.12)]"
      style={{ left: position.left, top: position.top }}
    >
      <p className="num font-semibold">
        {data.count}/{data.total} available
      </p>
      <p className="mt-0.5 text-[0.75rem] text-muted">{data.heading}</p>

      {data.available.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5">
          {data.available.map((name) => (
            <li key={name} className="truncate">
              {name}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-muted">No one</p>
      )}

      {data.unavailable.length > 0 ? (
        <>
          <div className="my-1.5 border-t border-line" />
          <ul className="space-y-0.5 text-muted">
            {data.unavailable.map((name) => (
              <li key={name} className="truncate line-through decoration-[0.5px]">
                {name}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
