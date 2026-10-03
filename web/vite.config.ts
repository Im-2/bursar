import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Allow importing ../deployments/arbitrum-sepolia.json, and nothing else outside web/.
    fs: { allow: [".", "../deployments"] },
  },
});
