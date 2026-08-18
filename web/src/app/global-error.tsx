"use client";

// Last-resort error boundary. This site has no server: every failure is a
// client-side render failure, and without this boundary React unmounts to
// a permanently blank document with nothing logged anywhere we can see.
// Renders its own <html>/<body> and inlines all styling - global-error
// mounts OUTSIDE the root layout, so globals.css, the fonts, and the
// data-mode stamp do not exist here.

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#f5f1e8",
          color: "#2b2a26",
          fontFamily: "Georgia, 'Times New Roman', serif",
          textAlign: "center",
          padding: "2rem",
        }}
      >
        <main>
          <h1 style={{ fontSize: "1.6rem", marginBottom: "0.5rem" }}>
            The Sound slipped away for a moment
          </h1>
          <p style={{ margin: "0 0 1.5rem", opacity: 0.75 }}>
            Something went wrong drawing this page. Your data is fine - this is a display problem
            on our side.
          </p>
          <p style={{ display: "flex", gap: "1rem", justifyContent: "center", margin: 0 }}>
            <button
              onClick={() => reset()}
              style={{
                font: "inherit",
                padding: "0.5rem 1.25rem",
                border: "1px solid #2b2a26",
                borderRadius: "999px",
                background: "transparent",
                color: "inherit",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages --
                deliberately a full-document link: after a fatal render error
                a hard reload is the recovery, not client-side navigation
                through the React tree that just crashed */}
            <a
              href="/"
              style={{
                padding: "0.5rem 1.25rem",
                border: "1px solid transparent",
                color: "inherit",
              }}
            >
              Back to the map
            </a>
          </p>
        </main>
      </body>
    </html>
  );
}
