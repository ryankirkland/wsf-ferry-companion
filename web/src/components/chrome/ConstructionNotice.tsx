// Site-wide honesty about the site itself (owner's call, 2026-08-20;
// softened to "In Beta" 2026-08-30): visitors should know this is still
// maturing, and that the numbers come from WSDOT rather than from us.
// Rendered from the root layout on every page; pointer-events: none so it
// can never block a control. Remove when the site graduates.

import styles from "./chrome.module.css";

export function ConstructionNotice() {
  return (
    <p className={styles.construction} role="note" data-testid="construction-notice">
      In Beta - Uses WSDOT ferry data.
    </p>
  );
}
