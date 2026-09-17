import { defineConfig } from 'vite';

// `base` must match the GitHub Pages sub-path (https://<user>.github.io/<repo>/).
// Locally (`npm run dev`) we serve from the root instead.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/wind_tunnel_simulator/' : '/',
  build: { target: 'es2022', sourcemap: true },
  server: { host: true },
}));
