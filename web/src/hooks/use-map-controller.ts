"use client";

import { useEffect, useRef, useState } from "react";
import { STYLE_URL } from "@/config";
import { PaperSoundMap } from "@/lib/map/controller";
import type { Mode } from "@/lib/time/sound-time";

interface MapState {
  ready: boolean;
  failed: boolean;
  degraded: boolean;
}

/** Strict-mode-safe controller lifecycle: create on mount, total teardown on
 * unmount (the dev double-mount cycle is accepted - destroy() is idempotent
 * and complete, which the 24 h ambient requirement needs anyway). */
export function useMapController(
  containerRef: React.RefObject<HTMLDivElement | null>,
  mode: Mode,
  ambient: boolean,
  terminalClassName: string,
) {
  const controllerRef = useRef<PaperSoundMap | null>(null);
  const [state, setState] = useState<MapState>({ ready: false, failed: false, degraded: false });
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const controller = new PaperSoundMap(containerRef.current, {
      styleUrl: STYLE_URL,
      ambient,
      terminalClassName,
    });
    controllerRef.current = controller;
    const offs = [
      controller.on("ready", () => setState((s) => ({ ...s, ready: true, failed: false }))),
      controller.on("error", (detail) => {
        const { fatal } = (detail ?? {}) as { fatal?: boolean };
        setState((s) => (fatal ? { ...s, failed: true } : { ...s, degraded: true }));
      }),
    ];
    return () => {
      offs.forEach((off) => off());
      controller.destroy();
      controllerRef.current = null;
      setState({ ready: false, failed: false, degraded: false });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryToken, ambient, terminalClassName]);

  useEffect(() => {
    controllerRef.current?.setMode(mode);
  }, [mode, state.ready]);

  return { controllerRef, state, retry: () => setRetryToken((t) => t + 1) };
}
