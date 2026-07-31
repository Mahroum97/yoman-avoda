/**
 * Bundles a TypeScript entry point for Node.
 *
 * Used by `npm run sample`. Vite-only asset imports (`…​.ttf?url`) are stubbed:
 * the Node path always supplies the font bytes explicitly, so the browser URL
 * that the stub replaces is never read.
 */
import { build } from 'esbuild';

const stubAssetUrls = {
  name: 'stub-asset-urls',
  setup(builder) {
    builder.onResolve({ filter: /\?url$/ }, (args) => ({
      path: args.path,
      namespace: 'asset-url',
    }));
    builder.onLoad({ filter: /.*/, namespace: 'asset-url' }, () => ({
      contents: 'export default "";',
      loader: 'js',
    }));
  },
};

const [entry, outfile] = process.argv.slice(2);
if (!entry || !outfile) {
  console.error('usage: node scripts/bundle.mjs <entry.ts> <out.mjs>');
  process.exit(1);
}

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  plugins: [stubAssetUrls],
  logLevel: 'warning',
});
