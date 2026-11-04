import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';

loadEnv({ path: resolve(import.meta.dirname, '../../.env') });

const config: NextConfig = {
  output: process.env.MYBUSINESS_HOSTING === 'passenger' ? undefined : 'standalone',
  allowedDevOrigins: [
    'localhost',
    '127.0.0.1',
    ...(process.env.LAN_ORIGIN ? [new URL(process.env.LAN_ORIGIN).hostname] : []),
  ],
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_URL ?? 'http://127.0.0.1:4000'}/api/:path*`,
      },
    ];
  },
};
export default config;
