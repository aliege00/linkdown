// Run: node scripts/generate-icons.js
// Requires: npm install sharp
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../public");

const sizes = [192, 512];
const svgBuffer = fs.readFileSync(path.resolve(publicDir, "icon.svg"));

async function generate() {
  for (const size of sizes) {
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(path.resolve(publicDir, `icon-${size}.png`));
    console.log(`Generated icon-${size}.png`);
  }
  console.log("Done! Icons generated in public/");
}

generate().catch(console.error);
