import { defineConfig } from "vite";
import { resolve } from "node:path";
export default defineConfig({
  publicDir: false,
  build: {
    target: "es2022",
    lib: {
      entry: {
        index: resolve("src/index.ts"),
        data: resolve("src/data.ts"),
        leaflet: resolve("src/leaflet.ts"),
      },
      formats: ["es"],
      fileName: (_format, name) => `${name}.js`,
    },
    rolldownOptions: {
      external: [
        /^react(?:\/|$)/,
        /^maplibre-gl(?:\/|$)/,
        /^leaflet(?:\/|$)/,
        "@mapbox/vector-tile",
        "pbf",
      ],
      output: {
        chunkFileNames: "[name].js",
        banner: (chunk) => (chunk.name === "index" ? '"use client";' : ""),
      },
    },
  },
});
