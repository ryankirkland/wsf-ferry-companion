// Site-wide honesty about the site itself (owner's call, 2026-08-20):
// visitors should know this is a work in progress before they plan a
// real crossing around it. Rendered from the root layout on every page;
// pointer-events: none so it can never block a control. Remove when the
// site graduates.

import styles from "./chrome.module.css";

export function ConstructionNotice() {
  return (
    <p className={styles.construction} role="note" data-testid="construction-notice">
      Under construction - not yet ready for real use.
    </p>
  );
}
