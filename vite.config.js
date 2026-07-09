import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served under /cgt-reform via a rewrite from bradenk.ing. The trailing
// slash matters — Vite prepends `base` to every emitted asset URL and
// resolves `<script src="/src/main.jsx">` in index.html against it.
// Runtime URL state (encodeState, Copy link) reads window.location so
// it survives the subpath automatically.
export default defineConfig({
  base: '/cgt-reform/',
  plugins: [react()],
});
