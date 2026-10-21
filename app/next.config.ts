import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // SIE- och CSV-filer skickas till serveråtgärder (standardgränsen är 1 MB).
  experimental: { serverActions: { bodySizeLimit: "4.5mb" } },
};

export default nextConfig;
