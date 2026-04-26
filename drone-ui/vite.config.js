import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

/** Remove public/feeds copy from dist so Play Store AAB stays under 200 MB base-module limit. */
function stripFeedMp4FromDist() {
  return {
    name: "strip-feed-mp4-from-dist",
    closeBundle() {
      if (process.env.VITE_KEEP_FEED_MP4_IN_DIST === "true") return;
      const feedsDir = resolve(__dirname, "dist/feeds");
      if (!existsSync(feedsDir)) return;
      try {
        rmSync(feedsDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === "production" ? [stripFeedMp4FromDist()] : [])],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
}));

