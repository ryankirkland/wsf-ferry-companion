// React face of the shared weather glyphs (lib/weather-glyphs owns the
// artwork; the map's DOM-built terminal chips use the same strings).
// The markup is self-authored static SVG - no user content near it.

import { glyphMarkup } from "@/lib/weather-glyphs";

export function WeatherIcon({ token, size = 18 }: { token: string; size?: number }) {
  return <span style={{ display: "inline-flex" }} dangerouslySetInnerHTML={{ __html: glyphMarkup(token, size) }} />;
}
