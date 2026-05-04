import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    'pdf-parse',
    'mammoth',
    'xlsx',
    'nodejieba',
  ],
  outputFileTracingExcludes: {
    '*': ['./uploads/**'],
  },
};

export default nextConfig;
