// The single home for localStorage keys and access. The opt-out flag's
// writer (ConsentBanner) and reader (beacon) used to be separate string
// literals in separate modules - a typo in either would silently re-enable
// tracking for everyone who opted out. Keys live here once; access is
// wrapped so private mode / disabled storage degrades to "no persistence",
// never a thrown error.
//
// Key STRINGS are frozen: renaming one orphans every value users already
// stored (an opt-out that stops being honored is the worst possible bug
// here). New keys get a `:v1` suffix so future migrations have a handle;
// pre-existing keys keep their shipped names.

export const YOUR_RUN_KEY = "fs.your-run";
export const CONSENT_SEEN_KEY = "wsf_analytics_consent_seen";
export const ANALYTICS_OPTOUT_KEY = "wsf_analytics_optout";
export const DATA_NOTICE_SEEN_KEY = "fs.data-notice-seen:v1";
export const HIDDEN_ROUTES_KEY = "fs.hidden-routes:v1";

export function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode / storage disabled: nothing to persist.
  }
}
