/** Format watts for a Stream Deck key: "850 W" or "1.23 kW". */
export function formatWatts(w: number): string {
	if (Math.abs(w) >= 1000) {
		return `${(w / 1000).toFixed(2)} kW`;
	}
	return `${Math.round(w)} W`;
}
