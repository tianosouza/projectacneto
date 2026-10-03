import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const frontendRoot = fileURLToPath(new URL("./frontend", import.meta.url));
  const env = loadEnv(mode, frontendRoot, "");

  return {
    root: frontendRoot,
    build: {
      outDir: "../dist",
      emptyOutDir: true,
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./frontend/src", import.meta.url)),
      },
    },
    optimizeDeps: {
      exclude: ["lucide-react"],
    },
    server: {
      proxy: {
        "/api": {
          target: env.VITE_API_URL || "http://127.0.0.1:3000",
          changeOrigin: true,
        },
      },
    },
  };
});
