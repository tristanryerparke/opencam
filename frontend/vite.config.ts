import path from "path";
import { defineConfig, type PluginOption, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {
  frontendSchemaWatchPaths,
  generateFrontendSchemas,
  isFrontendSchemaSourcePath,
} from "./scripts/generate-cam-models";

function generatedSchemasPlugin(): PluginOption {
  let isGenerating = false;
  let shouldRegenerate = false;

  const regenerate = async () => {
    if (isGenerating) {
      shouldRegenerate = true;
      return;
    }

    isGenerating = true;
    try {
      await generateFrontendSchemas();
    } finally {
      isGenerating = false;
      if (shouldRegenerate) {
        shouldRegenerate = false;
        await regenerate();
      }
    }
  };

  return {
    name: "generated-schemas",
    async buildStart() {
      await regenerate();
    },
    configureServer(server: ViteDevServer) {
      server.watcher.add(frontendSchemaWatchPaths);

      const handleChange = (changedPath: string) => {
        if (!isFrontendSchemaSourcePath(changedPath)) {
          return;
        }

        server.config.logger.info(
          `[generated_schemas] ${path.relative(process.cwd(), changedPath)} changed`,
        );

        void regenerate().catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          server.config.logger.error(`[generated_schemas] ${message}`);
        });
      };

      server.watcher.on("add", handleChange);
      server.watcher.on("change", handleChange);
      server.watcher.on("unlink", handleChange);
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  plugins: [
    generatedSchemasPlugin(),
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler"]],
      },
    }),
    tailwindcss(),
  ],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:9090",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
