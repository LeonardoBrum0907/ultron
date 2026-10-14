import { defineConfig } from 'vite'

// The soul avatar as one drop-in file, three.js included: dist/soul-avatar/soul-avatar.mjs.
// Loading it registers <soul-avatar> (proto/soul/avatar-entry.js). It is an ES module, so
// a desktop app built on a web view (Electron, Tauri) loads it like any page does.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist/soul-avatar',
    emptyOutDir: true,
    lib: {
      entry: 'proto/soul/avatar-entry.js',
      formats: ['es'],
      fileName: () => 'soul-avatar.mjs',
    },
  },
})
