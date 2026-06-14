import { formatWatts } from "./enphase/format";

const escapeXml = (s: string): string =>
	s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));

const toDataUri = (svg: string): string => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

// Key canvas is rendered at 144x144 (the @2x size); Stream Deck scales it down.
const SIZE = 144;
const MARGIN = 10;
const BAR_X = 14;
const BAR_W = SIZE - BAR_X * 2;
const BAR_H = 14;
const RADIUS = BAR_H / 2;
// Height of one row's stacked content (label + bar + value), used to center each
// row within its share of the key so the whole layout sits evenly top-to-bottom.
const CONTENT_H = 56;
// Extra vertical separation pushed between adjacent rows (first row up, last down).
const GROUP_GAP = 10;

const FONT = "Helvetica, Arial, sans-serif";

export type BarRow = {
	label: string;
	watts: number;
	color: string;
	/** Full-scale watts for this row (the value at 100% fill). */
	maxWatts: number;
};

/**
 * Stacked horizontal bar gauges on one key — one row per reading. Each row has
 * its own `maxWatts` scale.
 */
export function barsImage({ rows }: { rows: BarRow[] }): string {
	const blockH = (SIZE - MARGIN * 2) / rows.length;

	const body = rows
		.map((row, i) => {
			const top =
				MARGIN + i * blockH + Math.max(0, (blockH - CONTENT_H) / 2) + (i - (rows.length - 1) / 2) * GROUP_GAP;
			const labelY = top + 15;
			const barY = top + 22;
			const valueY = top + 56;
			const fraction = row.maxWatts > 0 ? Math.min(1, Math.max(0, row.watts / row.maxWatts)) : 0;
			const fillW = Math.round(BAR_W * fraction);
			const fill =
				fillW > 0
					? `<rect x="${BAR_X}" y="${barY}" width="${fillW}" height="${BAR_H}" rx="${RADIUS}" fill="${row.color}"/>`
					: "";

			// Three stacked lines per row: label, thin bar, then the value beneath it.
			return `<text x="${BAR_X}" y="${labelY}" text-anchor="start" font-family="${FONT}" font-size="17" font-weight="700" fill="${row.color}">${escapeXml(row.label)}</text>
	<rect x="${BAR_X}" y="${barY}" width="${BAR_W}" height="${BAR_H}" rx="${RADIUS}" fill="#333333"/>
	${fill}
	<text x="${BAR_X}" y="${valueY}" text-anchor="start" font-family="${FONT}" font-size="18" font-weight="600" fill="#FFFFFF">${escapeXml(formatWatts(row.watts))}</text>`;
		})
		.join("\n\t");

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
	<rect width="${SIZE}" height="${SIZE}" fill="#000000"/>
	${body}
</svg>`;

	return toDataUri(svg);
}

/** Fallback image shown when the gateway can't be reached / isn't configured. */
export function errorImage(label = "Enphase"): string {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
	<rect width="${SIZE}" height="${SIZE}" fill="#000000"/>
	<text x="${SIZE / 2}" y="38" text-anchor="middle" font-family="${FONT}" font-size="24" font-weight="600" fill="#FFFFFF">${escapeXml(label)}</text>
	<text x="${SIZE / 2}" y="86" text-anchor="middle" font-family="${FONT}" font-size="40" fill="#FFCC00">⚠</text>
	<text x="${SIZE / 2}" y="120" text-anchor="middle" font-family="${FONT}" font-size="22" fill="#AAAAAA">setup</text>
</svg>`;

	return toDataUri(svg);
}
