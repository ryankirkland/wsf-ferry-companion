"""Vessel class identity.

WSDOT ships two names per class: ClassName ("Issaquah 130") and
PublicDisplayName ("Issaquah"). The display name is what a rider reads,
but it is NOT unique - the Issaquah and Issaquah 130 classes both display
as "Issaquah" and have different drawings, so anything keyed on the
display name silently merges two classes.
"""

import re


def class_slug(class_name: str) -> str:
    """ClassName -> asset slug. "Jumbo Mark II" -> "jumbo-mark-ii"."""
    return re.sub(r"[^a-z0-9]+", "-", class_name.strip().lower()).strip("-")
