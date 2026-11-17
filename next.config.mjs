import JavaScriptObfuscator from 'javascript-obfuscator';

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://rfquvkfjymaivlwklxcl.supabase.co').replace(/\/$/, '');
const SUPABASE_WSS = SUPABASE_URL.replace(/^https:/, 'wss:');

const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${SUPABASE_URL} https://*.supabase.co`,
  `connect-src 'self' ${SUPABASE_URL} ${SUPABASE_WSS} https://*.supabase.co wss://*.supabase.co`,
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

class SecurityChunkObfuscatorPlugin {
  apply(compiler) {
    const { Compilation, sources } = compiler.webpack;
    compiler.hooks.thisCompilation.tap('SecurityChunkObfuscatorPlugin', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'SecurityChunkObfuscatorPlugin',
          stage: Compilation.PROCESS_ASSETS_STAGE_REPORT,
        },
        (assets) => {
          for (const filename of Object.keys(assets)) {
            if (!filename.includes('security-core') || !filename.endsWith('.js')) {
              continue;
            }
            const originalSource = assets[filename].source().toString();
            const obfuscated = JavaScriptObfuscator.obfuscate(originalSource, {
              compact: true,
              controlFlowFlattening: true,
              controlFlowFlatteningThreshold: 0.75,
              deadCodeInjection: false,
              debugProtection: false,
              disableConsoleOutput: false,
              identifierNamesGenerator: 'hexadecimal',
              renameGlobals: false,
              selfDefending: true,
              splitStrings: true,
              splitStringsChunkLength: 8,
              stringArray: true,
              stringArrayEncoding: ['base64'],
              stringArrayRotate: true,
              stringArrayShuffle: true,
              stringArrayThreshold: 0.85,
              unicodeEscapeSequence: false,
            });
            compilation.updateAsset(
              filename,
              new sources.RawSource(obfuscated.getObfuscatedCode()),
            );
          }
        },
      );
    });
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  productionBrowserSourceMaps: false,
  poweredByHeader: false,
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: CSP_DIRECTIVES },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(self), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
  webpack(config, { isServer, dev }) {
    if (!isServer && !dev) {
      config.devtool = false;

      if (config.optimization?.splitChunks && typeof config.optimization.splitChunks === 'object') {
        config.optimization.splitChunks.cacheGroups = {
          ...(config.optimization.splitChunks.cacheGroups || {}),
          securityCore: {
            name: 'security-core',
            test: /[\\/](securityClient|useAntiTamper|requestSigner|watermarker|SecurityShield|CameraCaptureSheet)\.(ts|tsx|js)$/,
            chunks: 'all',
            priority: 40,
            enforce: true,
          },
        };
      }

      config.plugins.push(new SecurityChunkObfuscatorPlugin());
    }
    return config;
  },
};

export default nextConfig;
