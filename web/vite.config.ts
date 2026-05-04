import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // ExcelJS ships a large browser bundle; it is loaded only when exporting.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("exceljs")) return "exceljs";
          if (id.includes("jszip") || id.includes("pako")) return "xlsx-zip";
          if (
            id.includes("readable-stream") ||
            id.includes("buffer") ||
            id.includes("string_decoder") ||
            id.includes("process-nextick-args")
          ) {
            return "stream-polyfills";
          }
          if (id.includes("react") || id.includes("react-dom") || id.includes("react-router")) return "react-vendor";
        }
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8788"
    }
  }
});
