import { mkdir } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const preflightCss = await Bun.file(new URL("../../../t-components/node_modules/tailwindcss/preflight.css", root)).text();
const layeredPreflightCss = `@layer theme, base, components, utilities; @layer base {${preflightCss} *,::after,::before,::backdrop,::file-selector-button { border-color: var(--border); outline-color: color-mix(in oklab, var(--ring) 50%, transparent); }}`;
const componentCss = await Bun.file(new URL("../../../t-components/dist/style.css", root)).text();
const operationIcons = Object.entries({
  pocketing_2d: "pocketing-1.svg",
  profiling_2d: "profiling-1.svg",
  facing_2d: "facing-1.svg",
  parallel_finishing: "parallel_finishing.svg",
});
const operationIconTemplates = (await Promise.all(operationIcons.map(async ([type, file]) => {
  const svg = await Bun.file(new URL(`../../graphics/${file}`, root)).text();
  return `<template id="operation-icon-${type}">${svg}</template>`;
}))).join("");
const pages = [
  {
    template: "index.html",
    entrypoint: "src/panel.ts",
    script: "panel.js",
    scriptMarker: "<!-- OPENCAM_PANEL_SCRIPT -->",
    styleMarker: "<!-- T_COMPONENTS_STYLE -->",
    output: "index.html",
  },
  {
    template: "operation-dialog.html",
    entrypoint: "src/operation-dialog.ts",
    script: "operation-dialog.js",
    scriptMarker: "<!-- OPENCAM_OPERATION_SCRIPT -->",
    styleMarker: "<!-- T_COMPONENTS_STYLE -->",
    iconMarker: "<!-- OPENCAM_OPERATION_ICONS -->",
    output: "operation-dialog.html",
  },
];

await mkdir(new URL("dist/", root), { recursive: true });
const bundled = await Bun.build({
  entrypoints: pages.map((page) => new URL(page.entrypoint, root).pathname),
  outdir: new URL("dist/", root).pathname,
  alias: { "t-components/dom": new URL("../../../t-components/src/dom/index.ts", root).pathname },
  format: "iife",
  target: "browser",
  minify: false,
});
if (!bundled.success) throw new Error("Failed to bundle OpenCAM WebView scripts.");

for (const page of pages) {
  const template = await Bun.file(new URL(page.template, root)).text();
  const script = await Bun.file(new URL(`dist/${page.script}`, root)).text();
  if (!template.includes(page.scriptMarker)) throw new Error(`Missing ${page.scriptMarker} in ${page.template}.`);
  if (!template.includes(page.styleMarker)) throw new Error(`Missing ${page.styleMarker} in ${page.template}.`);
  if (page.iconMarker && !template.includes(page.iconMarker)) throw new Error(`Missing ${page.iconMarker} in ${page.template}.`);
  await Bun.write(
    new URL(`dist/${page.output}`, root),
    template
      .replace(page.styleMarker, `<style>${layeredPreflightCss.replaceAll("</style", "<\\/style")}</style><style>${componentCss.replaceAll("</style", "<\\/style")}</style>`)
      .replace(page.iconMarker ?? "<!-- OPENCAM_OPERATION_ICONS_NONE -->", operationIconTemplates)
      .replace(page.scriptMarker, `<script>${script.replaceAll("</script", "<\\/script")}</script>`),
  );
}
