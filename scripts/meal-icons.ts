/**
 * The stock meal illustrations as small webp files next to their PNGs in
 * client/public/icons/meals. The app shows them at 96px at most, so 256px is
 * plenty for sharp screens. Run after adding or changing a PNG:
 *
 *   npm run icons
 *
 * The webp files are committed, so dev and the Docker build serve the same.
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const DIR = path.join(process.cwd(), 'client', 'public', 'icons', 'meals');
const SIZE = 256;

async function main() {
  const pngs = fs.readdirSync(DIR).filter((f) => f.endsWith('.png'));
  let made = 0;
  for (const png of pngs) {
    const source = path.join(DIR, png);
    const target = source.replace(/\.png$/, '.webp');
    if (fs.existsSync(target) && fs.statSync(target).mtimeMs >= fs.statSync(source).mtimeMs) continue;
    await sharp(source)
      .resize(SIZE, SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 82, alphaQuality: 90 })
      .toFile(target);
    made++;
  }
  console.log(`${made} van ${pngs.length} plaatjes omgezet naar webp`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
