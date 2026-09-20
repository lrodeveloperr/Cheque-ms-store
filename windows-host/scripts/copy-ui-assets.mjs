import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceUi = join(hostRoot, "src", "ui");
const outputUi = join(hostRoot, "dist", "windows-host", "src", "ui");
const outputLocalization = join(hostRoot, "dist", "windows-host", "localization");
const sourceEngineLocalization = join(hostRoot, "..", "localization");
const outputEngineLocalization = join(hostRoot, "dist", "localization");
const iconSource = join(hostRoot, "node_modules", "@tabler", "icons-webfont", "dist");
const iconOutput = join(outputUi, "assets");

await mkdir(outputUi, { recursive: true });
await rm(iconOutput, { recursive: true, force: true });
await mkdir(iconOutput, { recursive: true });
await mkdir(outputLocalization, { recursive: true });
await mkdir(outputEngineLocalization, { recursive: true });

const sourceHtml = await readFile(join(sourceUi, "index.html"), "utf8");
await writeFile(
  join(outputUi, "index.html"),
  sourceHtml.replace(/renderer\.ts/g, "renderer.js"),
  "utf8",
);
await cp(join(sourceUi, "styles.css"), join(outputUi, "styles.css"));
await cp(
  join(iconSource, "tabler-icons.min.css"),
  join(iconOutput, "tabler-icons.min.css"),
);
await cp(join(sourceUi, "assets", "brand-mark.svg"), join(iconOutput, "brand-mark.svg"));
await mkdir(join(iconOutput, "fonts"), { recursive: true });
for (const font of ["tabler-icons.woff", "tabler-icons.woff2"]) {
  await cp(
    join(iconSource, "fonts", font),
    join(iconOutput, "fonts", font),
  );
}
await cp(join(hostRoot, "localization"), outputLocalization, { recursive: true });
await cp(sourceEngineLocalization, outputEngineLocalization, { recursive: true });
for (const locale of ["en-US", "en-CA", "fr-CA"]) {
  await access(join(outputEngineLocalization, `${locale}.json`));
}

console.log(`Copied renderer assets to ${outputUi}`);
