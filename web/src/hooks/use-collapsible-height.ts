"use client";

// Drives a smooth open/close height for a disclosure whose content's own
// height isn't known up front - e.g. an inline panel that mounts a lazy
// chunk, then fills in from an async fetch. A plain CSS max-height/grid-row
// transition only eases the FIRST snap; every later content resize (the
// loading state swapping for the real one) still jumps instantly, because
// nothing about the transition's declared value changed. Measuring the
// content with a ResizeObserver and animating an explicit pixel height
// instead means each of those resizes gets its own eased leg, so a
// multi-stage reveal still reads as one continuous motion rather than a
// series of snaps.

import { useEffect, useRef, useState } from "react";

export function useCollapsibleHeight(active: boolean) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!active) {
      setHeight(0);
      return;
    }
    const node = contentRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setHeight(entry.contentRect.height);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [active]);

  return { contentRef, height };
}
