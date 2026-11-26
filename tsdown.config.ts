import { defineConfig } from 'tsdown';

// Builds the server + CLI into dist/server/cli.js. Runtime dependencies stay
// external (installed in node_modules); the web app is built separately by Vite
// into dist/web, which the server serves.
export default defineConfig({
  entry: { cli: 'src/server/cli.ts' },
  outDir: 'dist/server',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  fixedExtension: false,
  dts: false,
  sourcemap: true,
  clean: true,
});
