import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so the built game also works from a sub-path (GitHub Pages, itch.io, ...).
  base: "./",
  server: {
    // `npm run dev -- --host` exposes it on the LAN so we can open it on a real phone.
    port: 5173,
  },
  build: {
    target: "es2022",
  },
});
