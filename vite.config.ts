import { defineConfig } from 'vite';

/*
 * `base` must match the GitHub Pages sub-path (https://<user>.github.io/<repo>/), and it
 * has to match for `vite preview` too.
 *
 * `command` is 'serve' for both the dev server and preview, so keying the base off
 * `command === 'build'` alone left preview serving at the root while the built HTML it
 * was serving asked for /wind_tunnel_simulator/. Every asset request fell through to the
 * SPA fallback and came back as index.html with a 200 and a text/html content type -
 * which a browser silently declines to run as a module. The page loaded, the markup was
 * all there, and not one line of the application executed. The verification scripts that
 * drive the built app were measuring an empty page.
 */
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/wind_tunnel_simulator/' : '/',
  build: { target: 'es2022', sourcemap: true },
  server: { host: true },
}));
