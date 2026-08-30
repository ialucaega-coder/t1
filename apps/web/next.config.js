/** @type {import('next').NextConfig} */
const nextConfig = {
  // 'standalone' genera un bundle autocontenido (server.js) ideal para Docker,
  // reduce drasticamente el tamano de la imagen de produccion.
  output: 'standalone',
  transpilePackages: ['shared'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
};

module.exports = nextConfig;
