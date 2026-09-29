import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
export default defineConfig({
  root: resolve("demo"),
  publicDir: resolve("public"),
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    watch: { useFsEvents: false, usePolling: true },
  },
  build: { outDir: resolve("demo-dist"), emptyOutDir: true },
});
