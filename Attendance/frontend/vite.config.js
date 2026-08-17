import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// No backend proxy here on purpose - this app talks to Supabase directly
// (see src/lib/supabaseClients.js), same serverless pattern as
// Timetable/frontend-v2, never a Python API server.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5179,
  },
});
