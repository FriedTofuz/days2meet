'use client';

import { useEffect, useRef } from 'react';

interface Saved {
  position: string;
  top: string;
  width: string;
  overflow: string;
  scrollY: number;
}

/**
 * Pins the page while a touch paint drag is in flight.
 *
 * `touch-action: none` only stops a scroll gesture that starts on the grid. A
 * scroll already in motion — momentum from an earlier swipe, the URL bar
 * collapsing, an ancestor container reacting — keeps sliding content under a
 * stationary finger, and `elementFromPoint` then paints cells nobody touched.
 */
export function useScrollLock(locked: boolean): void {
  const saved = useRef<Saved | null>(null);

  useEffect(() => {
    if (!locked) return;

    const body = document.body;

    // Locking twice would record the locked styles as the ones to put back.
    if (!saved.current) {
      const scrollY = window.scrollY;
      saved.current = {
        position: body.style.position,
        top: body.style.top,
        width: body.style.width,
        overflow: body.style.overflow,
        scrollY,
      };
      // iOS Safari scrolls straight through `overflow: hidden`; only taking the
      // body out of flow actually holds it still.
      body.style.position = 'fixed';
      body.style.top = `-${scrollY}px`;
      body.style.width = '100%';
      body.style.overflow = 'hidden';
    }

    // Unlocking from cleanup rather than a `locked === false` branch is what
    // makes unmounting mid-drag safe: a stuck lock freezes the whole app.
    return () => {
      const previous = saved.current;
      if (!previous) return;
      saved.current = null;

      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.width = previous.width;
      body.style.overflow = previous.overflow;

      // A plain scrollTo would animate under an ancestor `scroll-behavior:
      // smooth` and drift the page after the drag has already committed.
      window.scrollTo({ top: previous.scrollY, left: 0, behavior: 'instant' });
    };
  }, [locked]);
}
