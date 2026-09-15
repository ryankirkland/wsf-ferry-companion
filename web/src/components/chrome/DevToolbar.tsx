"use client";

// Agentation annotation toolbar, development only. The import is gated
// (not just the render) so the ~430 KB chunk is dead-code-eliminated from
// the static export instead of shipping async on every page. ssr: false
// because the toolbar reads window/document on mount and there is no
// value in prerendering a dev-only overlay.

import dynamic from "next/dynamic";

const Agentation =
  process.env.NODE_ENV === "development"
    ? dynamic(() => import("agentation").then((m) => m.Agentation), { ssr: false })
    : null;

// Without an endpoint the toolbar keeps annotations in localStorage only
// and never reaches the MCP server (agentation-mcp's HTTP side, port 4747
// by default) - the agent then sees zero sessions. Overridable for a
// non-default port via NEXT_PUBLIC_AGENTATION_ENDPOINT.
const ENDPOINT = process.env.NEXT_PUBLIC_AGENTATION_ENDPOINT ?? "http://localhost:4747";

export function DevToolbar() {
  return Agentation ? <Agentation endpoint={ENDPOINT} /> : null;
}
