"use client";

// Drives a smooth open/close height for a disclosure whose content's own
// height isn't known up front - e.g. an inline panel that mounts a lazy
// chunk, then fills in from an async fetch. A plain CSS max-height/grid-row
// transition only eases the FIRST snap; every later content resize (the
// loading state swapping for the real one) still jumps instantly, because
// nothing about the transition's declared value changed. Measuring the
// content with a ResizeObserver and animating an explicit pixel height
// instead means each of those resizes gets its own eased leg, so a
// multi-stage reveal still reads as one continuous motion no matter how
// many stages the content goes through.
//
// `render` also stays true for COLLAPSE_MS after `active` goes false, so the
// height-to-0 transition and the content's own removal happen together.
// Gating a caller's content on `active` directly (`active && <Content/>`)
// unmounts it the instant collapse *starts*, leaving an empty box to
// visibly shrink for the rest of the transition - callers should render
// their collapsible content on `render`, not `active`. The active->inactive
// edge is caught synchronously during render (React's "adjusting state
// when a prop changes" pattern, same one VesselCard uses for prevFixId),
// not in an effect: an effect runs after the commit that already flipped
// `active` false, which is one render too late and reproduces the exact
// same disappear-then-shrink bug this hook exists to fix.

import { useEffect, useRef, useState } from "react";

// Must match .scheduleCollapse's `transition: height ...` duration in
// vessel-card.module.css - there's no way to read a CSS duration from JS
// without extra machinery, so the two are kept in sync by hand.
export const COLLAPSE_MS = 320;

export function useCollapsibleHeight(active: boolean) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(0);
  const [pendingCollapse, setPendingCollapse] = useState(false);

  const prevActiveRef = useRef(active);
  if (prevActiveRef.current !== active) {
    prevActiveRef.current = active;
    if (!active) setPendingCollapse(true);
  }

  useEffect(() => {
    if (active) {
      setPendingCollapse(false);
      const node = contentRef.current;
      if (!node) return;
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) setHeight(entry.contentRect.height);
      });
      observer.observe(node);
      return () => observer.disconnect();
    }
    // Closing: the height has already been dropped to 0 (VesselCard reads
    // `active` directly for that), so the collapse transition is already
    // underway by the time this effect runs. Just clear the pending flag
    // once that transition has had time to finish.
    setHeight(0);
    const timer = setTimeout(() => setPendingCollapse(false), COLLAPSE_MS);
    return () => clearTimeout(timer);
  }, [active]);

  return { contentRef, height, render: active || pendingCollapse };
}
