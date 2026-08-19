"use client";

// Persistent navigation for every page that isn't the map (owner's walk,
// 2026-08-19: "the sidebar menu should stay displayed on any page that
// isn't the map"). Wide screens get this fixed rail in the column's left
// margin; narrow screens keep the boat-button drawer, which the (site)
// layout also renders.

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./nav.module.css";

const LINKS = [
  { href: "/trip", label: "Trip planner" },
  { href: "/stats", label: "On-time record" },
  { href: "/alerts", label: "Ferry Alerts" },
  { href: "/ambient", label: "Ambient mode" },
  { href: "/account", label: "Account" },
];

export function SideNav() {
  const pathname = usePathname();
  return (
    <nav className={styles.sideNav} aria-label="Site">
      <Link href="/" className={`display ${styles.sideNavBrand}`}>
        Ferry <span>Sound</span>
      </Link>
      <Link href="/" className={styles.sideNavBack}>
        ← Back to map
      </Link>
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={pathname === l.href || pathname.startsWith(`${l.href}/`) ? "page" : undefined}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
