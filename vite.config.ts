import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Honour PORT so a second instance can run alongside the first. The bridge
    // only accepts sockets from localhost:5173-5199, so stay inside that range
    // or set ULTRON_ALLOWED_ORIGINS to match.
    port: Number(process.env.PORT) || 5173,
    // Other devices open the page through `tailscale serve`, which arrives
    // with the machine's *.ts.net name as the host (docs/remote.md).
    allowedHosts: ['.ts.net'],
    proxy: {
      // The bridge, for pages that are not on this PC. Same origin as the
      // page, so the login cookie rides along on every request and socket.
      // `x-ultron-via` is what tells the bridge the request came from outside
      // and must be logged in (bridge/auth.mjs).
      '/bridge': {
        target: `http://127.0.0.1:${Number(process.env.ULTRON_BRIDGE_PORT) || 8787}`,
        ws: true,
        xfwd: true,
        headers: { 'x-ultron-via': 'proxy' },
        rewrite: (path) => {
          const rest = path.replace(/^\/bridge/, '')
          return rest.startsWith('/') ? rest : `/${rest}`
        },
      },
    },
  },
  optimizeDeps: {
    // kokoro-js pulls in `phonemizer`, which carries espeak-ng as inline WASM.
    // Vite's dependency pre-bundler rewrites that initialisation and the
    // language table ends up empty — the symptom is
    // `Invalid language identifier: "en". Should be one of: .` at generate()
    // time, long after the model has loaded successfully. Serving these
    // untouched fixes it.
    exclude: ['kokoro-js', 'phonemizer', '@huggingface/transformers'],
  },
})
