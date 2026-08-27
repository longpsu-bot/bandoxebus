import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const sourceHtml = resolve(
  'C:/Users/HOME/Documents/Codex/2026-08-25/pl/outputs/route61-2-maplibre-liberty/index.html'
);

const html = await readFile(sourceHtml, 'utf8');

function readInlineConstant(name) {
  const match = html.match(new RegExp(`^\\s*const ${name} = (.+);\\s*$`, 'm'));
  if (!match) throw new Error(`Không tìm thấy hằng ${name} trong gói hiện tại.`);
  return JSON.parse(match[1]);
}

const darkLibertyStyle = readInlineConstant('darkLibertyStyle');
const existingRouteLatLng = readInlineConstant('oldLatLng');
const proposedRouteLatLng = readInlineConstant('adjustedLatLng');
const stopLatLng = readInlineConstant('busStops');
const landmarks = readInlineConstant('landmarks');

await mkdir(resolve(projectRoot, 'src'), { recursive: true });
await writeFile(resolve(projectRoot, 'style.json'), `${JSON.stringify(darkLibertyStyle, null, 2)}\n`);

const dataModule = `// Dữ liệu được tách nguyên trạng từ gói Route61-2_DarkLiberty_AnimatedBuses hiện tại.\n`
  + `export const existingRouteLatLng = ${JSON.stringify(existingRouteLatLng)};\n`
  + `export const proposedRouteLatLng = ${JSON.stringify(proposedRouteLatLng)};\n`
  + `export const existingStopsLatLng = ${JSON.stringify(stopLatLng)};\n`
  + `export const proposedStopsLatLng = ${JSON.stringify(stopLatLng)};\n`
  + `export const landmarks = ${JSON.stringify(landmarks, null, 2)};\n`;

await writeFile(resolve(projectRoot, 'src/route-data.js'), dataModule);
console.log(`Đã tách ${existingRouteLatLng.length} điểm hiện hữu, ${proposedRouteLatLng.length} điểm điều chỉnh và ${stopLatLng.length} điểm dừng.`);
