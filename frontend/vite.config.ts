import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const mobileHttps = process.env.MOBILE_HTTPS === "1";

export default defineConfig({
  plugins: [react()],
  server: {
    host: mobileHttps ? "0.0.0.0" : "127.0.0.1",
    port: 5173,
    strictPort: true,
    https: mobileHttps ? {
      cert: readFileSync(process.env.MOBILE_CERT_PATH ?? "../.certs/mobile.pem"),
      key: readFileSync(process.env.MOBILE_KEY_PATH ?? "../.certs/mobile-key.pem"),
    } : undefined,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./tests/setup.ts",
    globals: true,
    exclude: ["e2e/**", "node_modules/**"],
  },
});
