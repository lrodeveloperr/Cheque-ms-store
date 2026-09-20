import { defineConfig } from "vite";

export default defineConfig({
  root: "src/ui",
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
  },
});
