// Settings are `type` aliases (not interfaces) so they satisfy the SDK's
// JsonObject generic constraint via TypeScript's implicit index signatures.

/** Shared settings stored globally for the plugin (one gateway for all keys). */
export type GlobalSettings = {
	/** Gateway hostname or IP, e.g. "envoy.local" or "192.168.1.50". */
	host?: string;
};

/** Per-action settings. */
export type ActionSettings = {
	/** Polling interval in seconds (clamped to a sensible minimum). */
	refreshSeconds?: number;
	/** Full-scale watts for the production bar (the value at 100% fill). */
	productionMax?: number;
	/** Full-scale watts for the consumption bar (the value at 100% fill). */
	consumptionMax?: number;
	/** @deprecated legacy shared full-scale; used as a fallback for both bars. */
	maxWatts?: number;
};

/** A single meter entry from the gateway's /production.json response. */
export interface MeterReading {
	type: string; // "inverters" | "eim"
	measurementType?: string; // "production" | "total-consumption" | "net-consumption"
	activeCount?: number;
	wNow?: number;
	whLifetime?: number;
	whToday?: number;
}

/** Shape of the local gateway's /production.json response (subset we use). */
export interface ProductionResponse {
	production?: MeterReading[];
	consumption?: MeterReading[];
	storage?: MeterReading[];
}

/** Normalized readings the actions render. */
export interface EnphaseReadings {
	/** Current solar production, watts. */
	productionW: number;
	/** Current household consumption, watts (0 if no consumption CT meter). */
	consumptionW: number;
	/** production - consumption: positive = exporting, negative = importing. */
	netW: number;
	/** Epoch millis when these readings were fetched. */
	fetchedAt: number;
}
