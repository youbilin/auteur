import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const studioRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: studioRoot,
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:4310",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
