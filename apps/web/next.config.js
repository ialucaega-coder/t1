const { withSentryConfig } = require('@sentry/nextjs/config');

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['shared'],
  images: {
    // Acotado a Supabase Storage (único host remoto plausible para next/image).
    // Antes era `hostname: '**'`, un proxy de imágenes ABIERTO vía /_next/image
    // (cualquiera optimizaba imágenes de cualquier host a través de nuestro
    // server) y el vector del DoS del Image Optimizer. Las imágenes de la app
    // (galería, chat, config) usan <img> y no pasan por el optimizador.
    remotePatterns: [
      { protocol: 'https', hostname: '**.supabase.co' },
    ],
  },
  async headers() {
    return [
      {
        source: '/chat/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
    ];
  },
};

module.exports = withSentryConfig(nextConfig, {
  // Suppress logs when SENTRY_AUTH_TOKEN is not set
  silent: !process.env.SENTRY_AUTH_TOKEN,
  // Skip source map upload when no auth token is configured
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
});
