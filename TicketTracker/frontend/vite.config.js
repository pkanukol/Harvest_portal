import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: {
      "/api": {
        target: "http://localhost:8020",
        changeOrigin: true,
      },
      "/uploads": {
        target: "http://localhost:8020",
        changeOrigin: true,
      },
    },
  },
});
