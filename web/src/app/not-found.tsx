import Link from "next/link";

export default function NotFound() {
  return (
    <main
      style={{
        height: "100svh",
        display: "grid",
        placeItems: "center",
        textAlign: "center",
        padding: "2rem",
      }}
    >
      <div>
        <h1 className="display" style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>
          This slip is empty.
        </h1>
        <p style={{ color: "var(--ink-soft)" }}>
          Nothing docks at this address. <Link href="/">The fleet is over here.</Link>
        </p>
      </div>
    </main>
  );
}
