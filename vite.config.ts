import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const embedded = mode === 'embedded';
  const proxyTarget = process.env.QMT_EMBEDDED_PROXY_TARGET ?? 'http://127.0.0.1:3000';

  const buildMetadata = {
    application: 'querymt-ui',
    version: process.env.npm_package_version ?? '0.1.0',
    revision: process.env.QUERYMT_UI_REVISION ?? process.env.GITHUB_SHA ?? 'unknown',
    target: embedded ? 'embedded' : 'desktop',
    acpWebSocketPath: embedded ? '/acp/ws' : null
  };

  return {
    plugins: [
      tailwindcss(),
      sveltekit(),
      {
        name: 'querymt-ui-build-metadata',
        apply: 'build' as const,
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'querymt-ui.json',
            source: `${JSON.stringify(buildMetadata, null, 2)}\n`
          });
        }
      }
    ],
    server: {
      port: 5173,
      strictPort: true,
      proxy: embedded
        ? {
            '/acp/ws': {
              target: proxyTarget,
              ws: true,
              changeOrigin: true,
              rewriteWsOrigin: true
            }
          }
        : undefined
    },
    preview: {
      proxy: embedded
        ? {
            '/acp/ws': {
              target: proxyTarget,
              ws: true,
              changeOrigin: true,
              rewriteWsOrigin: true
            }
          }
        : undefined
    },
    resolve: {
      conditions: ['browser']
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.{test,spec}.ts'],
      setupFiles: ['src/lib/testing/vitest-setup.ts']
    }
  };
});
