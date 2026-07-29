import type { NextConfig } from "next";

// Static export: no server anywhere (scale-to-zero rule, ADR-0001).
// trailingSlash makes the export emit index.html/ambient/index.html, which
// the CloudFront viewer-request function maps URLs onto.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  reactStrictMode: true,
  images: { unoptimized: true },
};

export default nextConfig;
