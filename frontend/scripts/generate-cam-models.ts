import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import chokidar from "chokidar";
import { compile } from "json-schema-to-typescript";

type SchemaBundle = {
  generateToolpathRequest: Record<string, unknown>;
  pocket2dOperation: Record<string, unknown>;
};

const frontendRoot = process.cwd();
const repoRoot = path.resolve(frontendRoot, "..");
const outputDir = path.join(frontendRoot, "src", "generated");
const outputTypesPath = path.join(outputDir, "cam-types.ts");
const outputSchemasPath = path.join(outputDir, "cam-schemas.ts");
const outputJsonPath = path.join(outputDir, "cam-schemas.json");
const watchPatterns = [
  path.join(repoRoot, "src", "opencam", "schemas", "**", "*.py"),
  path.join(repoRoot, "src", "opencam", "services", "operations", "**", "*.py"),
  path.join(repoRoot, "scripts", "export_frontend_cam_schema.py"),
];

async function loadSchemaBundle(): Promise<SchemaBundle> {
  return new Promise((resolve, reject) => {
    const child = spawn("uv", ["run", "python", "scripts/export_frontend_cam_schema.py"], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `Schema export failed with exit code ${code}.`));
        return;
      }

      try {
        resolve(JSON.parse(stdout) as SchemaBundle);
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function generateCamModels() {
  const bundle = await loadSchemaBundle();
  const types = await compile(bundle.generateToolpathRequest, "GenerateToolpathRequest", {
    bannerComment:
      "/**\n * This file is auto-generated from Python Pydantic models.\n * Do not edit it by hand.\n */",
    style: {
      singleQuote: false,
    },
  });

  const schemaModule = `/**\n * This file is auto-generated from Python Pydantic models.\n * Do not edit it by hand.\n */\nexport const camSchemaBundle = ${JSON.stringify(bundle, null, 2)} as const;\n`;

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputTypesPath, types);
  await writeFile(outputSchemasPath, schemaModule);
  await writeFile(outputJsonPath, `${JSON.stringify(bundle, null, 2)}\n`);

  console.log(`[cam-models] Generated ${path.relative(frontendRoot, outputTypesPath)}`);
}

async function main() {
  const watch = process.argv.includes("--watch");

  await generateCamModels();

  if (!watch) {
    return;
  }

  let isGenerating = false;
  let shouldRegenerate = false;

  const watcher = chokidar.watch(watchPatterns, {
    ignoreInitial: true,
  });

  const regenerate = async () => {
    if (isGenerating) {
      shouldRegenerate = true;
      return;
    }

    isGenerating = true;
    try {
      await generateCamModels();
    } catch (error) {
      console.error("[cam-models] Failed to generate models", error);
    } finally {
      isGenerating = false;
      if (shouldRegenerate) {
        shouldRegenerate = false;
        await regenerate();
      }
    }
  };

  watcher.on("all", (_eventName, changedPath) => {
    console.log(`[cam-models] Detected change in ${path.relative(repoRoot, changedPath)}`);
    void regenerate();
  });

  console.log("[cam-models] Watching Python CAM schema files...");
}

void main().catch((error) => {
  console.error("[cam-models] Failed to generate models", error);
  process.exitCode = 1;
});
