import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

type SchemaBundle = {
  generateToolpathRequest: Record<string, unknown>;
  pocket2dOperation: Record<string, unknown>;
};

const frontendRoot = process.cwd();
const repoRoot = path.resolve(frontendRoot, "..");
const backendSchemasRoot = path.join(repoRoot, "src", "opencam", "schemas");
const outputDir = path.join(frontendRoot, "src", "generated_schemas");
const outputSchemasPath = path.join(outputDir, "cam.schemas.ts");
const outputJsonPath = path.join(outputDir, "cam.schemas.json");
const json2tsCommand = "bun run frontend/node_modules/json-schema-to-typescript/dist/src/cli.js";
const excludedModels = ["CamelBaseModel", "BaseTool", "BaseCAMOperation"];
const typescriptSchemaModules = [
  "cam.py",
  "cl_data.py",
  "geometry_2_5d.py",
  "geometry_2d.py",
  "operations/base.py",
  "operations/pocketing.py",
  "setup.py",
  "tool_library.py",
  "tools.py",
].map((relativePath) => ({
  modulePath: path.join(backendSchemasRoot, relativePath),
  outputPath: path.join(outputDir, relativePath.replace(/\.py$/, ".ts")),
}));

export const frontendSchemaWatchPaths = [
  backendSchemasRoot,
  path.join(repoRoot, "scripts", "export_frontend_cam_schema.py"),
] as const;

export function isFrontendSchemaSourcePath(changedPath: string) {
  const resolvedPath = path.resolve(changedPath);
  return (
    resolvedPath === frontendSchemaWatchPaths[1] ||
    (resolvedPath.endsWith(".py") && resolvedPath.startsWith(`${frontendSchemaWatchPaths[0]}${path.sep}`))
  );
}

function runCommand(command: string, args: string[], cwd: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
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
      if (code === 0) {
        resolve();
        return;
      }

      const details = stderr || stdout || `${command} exited with code ${code}.`;
      reject(new Error(details.trim()));
    });
  });
}

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

async function generateTypescriptSchemas() {
  for (const { modulePath, outputPath } of typescriptSchemaModules) {
    await mkdir(path.dirname(outputPath), { recursive: true });

    const args = [
      "run",
      "pydantic2ts",
      "--module",
      path.relative(repoRoot, modulePath),
      "--output",
      path.relative(repoRoot, outputPath),
      "--json2ts-cmd",
      json2tsCommand,
      ...excludedModels.flatMap((modelName) => ["--exclude", modelName]),
    ];

    await runCommand("uv", args, repoRoot);
    console.log(`[generated_schemas] Generated ${path.relative(frontendRoot, outputPath)}`);
  }
}

async function generateSchemaBundle() {
  const bundle = await loadSchemaBundle();
  const schemaModule = `/**\n * This file is auto-generated from Python Pydantic models.\n * Do not edit it by hand.\n */\nexport const camSchemaBundle = ${JSON.stringify(bundle, null, 2)} as const;\n`;

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputSchemasPath, schemaModule);
  await writeFile(outputJsonPath, `${JSON.stringify(bundle, null, 2)}\n`);

  console.log(`[generated_schemas] Generated ${path.relative(frontendRoot, outputSchemasPath)}`);
}

export async function generateFrontendSchemas() {
  await generateTypescriptSchemas();
  await generateSchemaBundle();
}

const isDirectRun = process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  void generateFrontendSchemas().catch((error) => {
    console.error("[generated_schemas] Failed to generate schemas", error);
    process.exitCode = 1;
  });
}
