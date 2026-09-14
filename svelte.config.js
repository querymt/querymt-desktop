import adapter from '@sveltejs/adapter-static';

const embedded = process.argv.includes('embedded');
const outputDirectory = embedded ? 'build-embedded' : 'build';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    outDir: embedded ? '.svelte-kit-embedded' : '.svelte-kit',
    adapter: adapter({
      pages: outputDirectory,
      assets: outputDirectory,
      fallback: 'index.html',
      strict: false
    }),
    alias: {
      '$lib': 'src/lib',
      '$native': embedded ? 'src/lib/platform/embedded-native.ts' : 'src/lib/platform/desktop-native.ts'
    }
  }
};

export default config;
