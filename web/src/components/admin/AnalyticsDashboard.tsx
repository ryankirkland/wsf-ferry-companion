"use client";

// Internal-only dashboard: what's actually happening on the site, without
// pretending the numbers mean more than they do. Unique/returning visitors
// are inherently month-scoped per the backend contract (by_month, not
// by_day), so they're labeled to the specific month they come from rather
// than implied to cover the whole picked range. Ambient (wall-tablet)
// traffic is called out everywhere it could otherwise pollute a "real
// visitor" read, and missing days/months are stated, never zero-filled.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { AdminAnalyticsError, fetchAdminAnalytics } from "@/lib/data/analytics-data";
import type { AdminAnalyticsSummary } from "@/lib/analytics/types";
import tripStyles from "@/components/trip/trip.module.css";
import styles from "./analytics.module.css";

type LoadState = "idle" | "loading" | "loaded" | "forbidden" | "error";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 30);
  return { from: isoDate(from), to: isoDate(to) };
}

export function AnalyticsDashboard() {
  const { state } = useAuth();
  const pathname = usePathname();
  const [range, setRange] = useState(defaultRange);
  const [doc, setDoc] = useState<AdminAnalyticsSummary | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");

  // Primitive deps, not the whole auth object: useAuth.refresh rebuilds its
  // state object even when the token is byte-identical, and depending on
  // `state` re-issued this fetch on every refresh (rerender-dependencies).
  const idToken = state.status === "in" ? state.idToken : null;
  useEffect(() => {
    if (idToken === null) return;
    let alive = true;
    // Async resolution (same pattern as useAuth.refresh / StatsOverview)
    // keeps this out of the render/effect-sync path.
    const timer = window.setTimeout(() => {
      setLoadState("loading");
      fetchAdminAnalytics(idToken, range.from, range.to)
        .then((summary) => {
          if (!alive) return;
          if (summary) {
            setDoc(summary);
            setLoadState("loaded");
          } else {
            setDoc(null);
            setLoadState("error");
          }
        })
        .catch((e: unknown) => {
          if (!alive) return;
          setDoc(null);
          setLoadState(e instanceof AdminAnalyticsError && e.status === 403 ? "forbidden" : "error");
        });
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [idToken, range.from, range.to]);

  return (
    <main className={tripStyles.page}>
      <div className={tripStyles.column}>
        <div className={tripStyles.masthead}>
          <Link href="/" className={`display ${tripStyles.wordmark}`}>
            Ferry <span>Sound</span>
          </Link>
        </div>
        <h1 className={`display ${tripStyles.pairTitle}`}>Analytics</h1>

        {state.status === "loading" && <p className={tripStyles.rangeNote}>Checking session…</p>}

        {state.status === "out" && (
          <div className={styles.card}>
            <p style={{ margin: 0 }}>Sign in with an admin account to view analytics.</p>
            <Link
              className={tripStyles.go}
              style={{ textAlign: "center", textDecoration: "none" }}
              href={`/account?next=${encodeURIComponent(pathname)}`}
            >
              Sign in
            </Link>
          </div>
        )}

        {state.status === "in" && (
          <>
            <div className={styles.rangeRow}>
              <label>
                From
                <input
                  type="date"
                  value={range.from}
                  max={range.to}
                  onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
                />
              </label>
              <label>
                To
                <input
                  type="date"
                  value={range.to}
                  min={range.from}
                  onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
                />
              </label>
            </div>

            {loadState === "loading" && <p className={tripStyles.rangeNote}>Loading analytics…</p>}
            {loadState === "forbidden" && (
              <p className={styles.absent}>Not authorized - this dashboard is restricted.</p>
            )}
            {loadState === "error" && (
              <p className={styles.absent}>
                Analytics could not be loaded right now. Nothing is being estimated in their place.
              </p>
            )}
            {loadState === "loaded" && doc && <Dashboard doc={doc} />}
          </>
        )}
      </div>
    </main>
  );
}

function Dashboard({ doc }: { doc: AdminAnalyticsSummary }) {
  const days = useMemo(() => [...doc.by_day].sort((a, b) => a.date.localeCompare(b.date)), [doc.by_day]);
  const latestMonth = useMemo(
    () => [...doc.by_month].sort((a, b) => a.month.localeCompare(b.month)).at(-1) ?? null,
    [doc.by_month],
  );
  const totalPageviews = days.reduce((sum, d) => sum + d.pageviews, 0);
  const maxDay = Math.max(...days.map((d) => d.pageviews), 1);

  return (
    <>
      <div className={styles.tiles}>
        <div className={styles.tile}>
          <div className={styles.tileValue}>{totalPageviews.toLocaleString()}</div>
          <div className={styles.tileLabel}>
            pageviews · {doc.range.from} to {doc.range.to}
          </div>
        </div>
        <div className={styles.tile}>
          <div className={styles.tileValue}>
            {latestMonth ? latestMonth.unique_visitors.toLocaleString() : "-"}
          </div>
          <div className={styles.tileLabel}>
            {latestMonth
              ? `unique visitors · ${latestMonth.month}, as of ${latestMonth.days_covered} day${latestMonth.days_covered === 1 ? "" : "s"}`
              : "unique visitors · no month reported"}
          </div>
        </div>
        <div className={styles.tile}>
          <div className={styles.tileValue}>
            {latestMonth ? latestMonth.returning_visitors.toLocaleString() : "-"}
          </div>
          <div className={styles.tileLabel}>
            {latestMonth
              ? `returning visitors · ${latestMonth.month}, as of ${latestMonth.days_covered} day${latestMonth.days_covered === 1 ? "" : "s"}`
              : "returning visitors · no month reported"}
          </div>
        </div>
      </div>
      <p className={styles.foot}>
        Unique and returning visitors are counted per calendar month, not over the date range
        picked above - they describe {latestMonth ? latestMonth.month : "the latest reported month"}
        {" "}specifically, not the whole window.
      </p>

      <section className={styles.section}>
        <h2 className={`display ${styles.sectionTitle}`}>Visit trend</h2>
        <div className={styles.dayChart} data-testid="day-chart">
          {days.map((d) => {
            const nonAmbient = Math.max(0, d.pageviews - d.ambient_pageviews);
            const nonAmbientPct = (nonAmbient / maxDay) * 100;
            const ambientPct = (d.ambient_pageviews / maxDay) * 100;
            return (
              <div
                key={d.date}
                className={styles.dayCol}
                title={`${d.date}: ${d.pageviews} pageviews (${d.ambient_pageviews} ambient), ${d.clicks} clicks`}
              >
                <div className={styles.dayBarTrack}>
                  <div className={styles.dayBarAmbient} style={{ height: `${ambientPct}%`, bottom: `${nonAmbientPct}%` }} />
                  <div className={styles.dayBar} style={{ height: `${nonAmbientPct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
        <p className={styles.foot}>
          One bar per day, {doc.range.from} to {doc.range.to}. The lighter segment on top of each
          bar is ambient (wall-display) traffic - it is real, but it is not a person browsing, so
          it is kept visually distinct from the darker visitor segment beneath it.
        </p>
      </section>

      <BarList
        title="Top pages"
        rows={doc.top_pages.map((p) => ({ label: p.path, count: p.count }))}
        testId="top-pages"
      />
      <BarList
        title="Top clicked elements"
        rows={doc.top_clicks.map((c) => ({ label: c.label, count: c.count }))}
        testId="top-clicks"
      />
      <BarList
        title="Referrer sources"
        rows={doc.referrers.map((r) => ({ label: r.source, count: r.count }))}
        testId="referrers"
      />

      <section className={styles.section}>
        <h2 className={`display ${styles.sectionTitle}`}>Geography</h2>
        <p className={styles.lede}>Approximate, IP-derived - not exact locations.</p>
        {doc.geo.length === 0 ? (
          <p className={styles.absent}>No geographic data in this range.</p>
        ) : (
          <div className={styles.geoTable} data-testid="geo-table">
            {doc.geo.map((g, i) => (
              <div key={`${g.country}-${g.region}-${g.city}-${i}`} className={styles.geoRow}>
                <span className={styles.geoPlace}>
                  {[g.city, g.region, g.country].filter(Boolean).join(", ") || "Unknown"}
                </span>
                <span className={styles.geoCount}>{g.count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {(doc.missing_days.length > 0 || doc.missing_months.length > 0) && (
        <section className={styles.section}>
          <p className={styles.absent}>
            {doc.missing_days.length > 0 && (
              <>
                {doc.missing_days.length} day{doc.missing_days.length === 1 ? "" : "s"} in this
                range {doc.missing_days.length === 1 ? "has" : "have"} no data yet:{" "}
                {doc.missing_days.join(", ")}.
              </>
            )}
            {doc.missing_days.length > 0 && doc.missing_months.length > 0 && <br />}
            {doc.missing_months.length > 0 && (
              <>
                {doc.missing_months.length} month{doc.missing_months.length === 1 ? "" : "s"} in
                this range {doc.missing_months.length === 1 ? "has" : "have"} no visitor data yet:{" "}
                {doc.missing_months.join(", ")}.
              </>
            )}
          </p>
        </section>
      )}

      <p className={styles.foot}>Generated {doc.generated_at.slice(0, 10)}.</p>
    </>
  );
}

function BarList({
  title,
  rows,
  testId,
}: {
  title: string;
  rows: { label: string; count: number }[];
  testId: string;
}) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <section className={styles.section}>
      <h2 className={`display ${styles.sectionTitle}`}>{title}</h2>
      {rows.length === 0 ? (
        <p className={styles.absent}>Nothing recorded in this range.</p>
      ) : (
        <div className={styles.barList} data-testid={testId}>
          {rows.map((row) => (
            <div key={row.label} className={styles.barRow}>
              <span className={styles.barLabel}>{row.label}</span>
              <span className={styles.barTrack}>
                <span className={styles.barFill} style={{ width: `${(row.count / max) * 100}%` }} />
              </span>
              <span className={styles.barCount}>{row.count.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
