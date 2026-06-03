import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(root, "node_modules", "lucide-static", "icons");
const targetRoot = path.join(root, "app", "assets", "icons");

const icons = [
  "activity",
  "badge-help",
  "chevron-down",
  "code",
  "copy",
  "download",
  "eraser",
  "folder-open",
  "heart",
  "house",
  "image",
  "monitor",
  "more-horizontal",
  "panel-left",
  "refresh-cw",
  "server",
  "settings",
  "sliders-horizontal",
  "sparkles",
  "sun",
  "trash-2",
  "wand-sparkles"
];

fs.mkdirSync(targetRoot, { recursive: true });

for (const icon of icons) {
  const source = path.join(sourceRoot, `${icon}.svg`);
  const target = path.join(targetRoot, `${icon}.svg`);
  if (fs.existsSync(source)) {
    fs.copyFileSync(source, target);
  }
}

console.log(`Synced icons to ${targetRoot}`);
