import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version) },
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "safari13" },
});
