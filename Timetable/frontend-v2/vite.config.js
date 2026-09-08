import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// No backend proxy here on purpose - this app talks to Supabase directly
// (see src/lib/supabaseClients.js), never to a Timetable-owned API server.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5178,
  },
});
