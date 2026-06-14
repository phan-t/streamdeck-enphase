// Generates the plugin's PNG icons. Run with: npm run gen:icons
//  - Plugin + category icon: the Enphase logomark (.claude/assets/enphase_logomark_white.svg)
//  - Action icon + key default: the MDI "solar-panel" glyph
import { Resvg } from "@resvg/resvg-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sdPlugin = `${root}/tphan.enphase.sdPlugin`;

const COLOR = "#FFFFFF"; // white — the default Stream Deck icon color

// MDI "solar-panel" (https://pictogrammers.com/library/mdi/icon/solar-panel/), 24x24 viewBox.
const PANEL_PATH =
	"M4,2H20A2,2 0 0,1 22,4V14A2,2 0 0,1 20,16H15V20H18V22H13V16H11V22H6V20H9V16H4A2,2 0 0,1 2,14V4A2,2 0 0,1 4,2M4,4V8H11V4H4M4,14H11V10H4V14M20,14V10H13V14H20M20,4H13V8H20V4Z";
const panelSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 28 28"><path d="${PANEL_PATH}" fill="${COLOR}"/></svg>`;

// Enphase logomark — read the path from the asset and center it in a square canvas.
const logoAsset = readFileSync(`${root}/.claude/assets/enphase_logomark_white.svg`, "utf8");
const logoPath = logoAsset.match(/<path[^>]*\bd="([^"]+)"/)?.[1];
if (!logoPath) throw new Error("Could not find a <path> in the Enphase logomark asset");
const LOGO_W = 1566;
const LOGO_H = 1610;
const PAD = 14; // of 100 units, so the mark doesn't touch the edges
const scale = (100 - PAD * 2) / Math.max(LOGO_W, LOGO_H);
const tx = (100 - LOGO_W * scale) / 2;
const ty = (100 - LOGO_H * scale) / 2;
const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path transform="translate(${tx} ${ty}) scale(${scale})" d="${logoPath}" fill="${COLOR}"/></svg>`;

const toPng = (svg, size) => new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();

function emit(svg, relPath, size) {
	const path = `${sdPlugin}/${relPath}`;
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(`${path}.png`, toPng(svg, size)); // @1x
	writeFileSync(`${path}@2x.png`, toPng(svg, size * 2)); // @2x
}

emit(logoSvg, "imgs/plugin/icon", 28);
emit(logoSvg, "imgs/plugin/category-icon", 28);
emit(panelSvg, "imgs/actions/overview/icon", 20);
emit(panelSvg, "imgs/actions/overview/key", 72);

console.log("Generated icons under", sdPlugin.replace(`${root}/`, ""));
