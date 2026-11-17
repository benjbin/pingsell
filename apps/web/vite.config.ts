import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
  preview: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/recharts|d3-|victory|decimal\.js|es-toolkit|immer|redux|reselect/.test(id)) return "charts";
          if (/react-router/.test(id)) return "router";
          if (/lucide-react/.test(id)) return "icons";
          if (/react-dom|scheduler|[\\/]react[\\/]/.test(id)) return "react";
          return undefined;
        },
      },
    },
  },
});
