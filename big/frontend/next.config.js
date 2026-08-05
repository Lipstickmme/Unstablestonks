const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { isServer, webpack }) => {
    config.resolve.fallback = { 
      fs: false, 
      net: false, 
      tls: false,
      crypto: false,
    };
    
    // Fix MetaMask SDK React Native dependency issue
    // Alias React Native modules to stub modules for web builds
    config.resolve.alias = {
      ...config.resolve.alias,
      '@react-native-async-storage/async-storage': path.resolve(__dirname, 'webpack/async-storage-stub.js'),
      'pino-pretty': path.resolve(__dirname, 'webpack/pino-pretty-stub.js'),
    };

    // RainbowKit's Base Account connector reaches @coinbase/cdp-sdk, which imports the
    // x402 payment packages across several subpaths. They ship as optional peers and we
    // do not use x402, but webpack treats a missing optional import as a hard error — so
    // ignore the whole scope rather than chasing subpaths one at a time.
    config.plugins.push(new webpack.IgnorePlugin({ resourceRegExp: /^@x402\// }));

    return config;
  },
  // Handle external resources
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;

