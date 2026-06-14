import { request } from "node:http";
import streamDeck from "@elgato/streamdeck";
import type { EnphaseReadings, GlobalSettings, MeterReading, ProductionResponse } from "./types";

/** How long a fetched reading is reused so multiple keys share one request. */
const CACHE_TTL_MS = 4_000;
const REQUEST_TIMEOUT_MS = 5_000;

/** Errors with a user-facing message safe to show on a key / log. */
export class EnphaseError extends Error {}

let cache: { key: string; readings: EnphaseReadings } | undefined;
let inflight: Promise<EnphaseReadings> | undefined;

// Gateway host is read from global settings once and then kept fresh via the
// change event, so steady-state polls don't make a settings round-trip each cycle.
let cachedHost: string | undefined;
let subscribed = false;

const cleanHost = (host?: string): string | undefined => host?.trim() || undefined;

async function gatewayHost(): Promise<string | undefined> {
	if (!subscribed) {
		subscribed = true;
		streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>((ev) => {
			cachedHost = cleanHost(ev.settings.host);
		});
	}
	if (cachedHost === undefined) {
		const settings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
		cachedHost = cleanHost(settings.host);
	}
	return cachedHost;
}

/**
 * Fetch /production.json from the local gateway over plain HTTP.
 *
 * Older IQ Gateway firmware (pre-v7) serves this endpoint unauthenticated on
 * port 80 with both production and consumption arrays. Firmware v7+ locks it
 * behind a token over HTTPS — those gateways return 401/403 here, which surfaces
 * as a setup error on the key.
 */
function fetchProduction(host: string): Promise<ProductionResponse> {
	return new Promise((resolve, reject) => {
		const req = request(
			{
				host,
				port: 80,
				path: "/production.json",
				method: "GET",
				headers: { Accept: "application/json" },
				timeout: REQUEST_TIMEOUT_MS,
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (chunk: Buffer) => chunks.push(chunk));
				res.on("end", () => {
					const status = res.statusCode ?? 0;
					if (status === 401 || status === 403) {
						return reject(new EnphaseError("Gateway requires a token (firmware v7+)."));
					}
					if (status < 200 || status >= 300) {
						return reject(new EnphaseError(`Gateway returned HTTP ${status}.`));
					}
					try {
						resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as ProductionResponse);
					} catch {
						reject(new EnphaseError("Gateway returned invalid JSON."));
					}
				});
			},
		);
		req.on("timeout", () => req.destroy(new EnphaseError("Gateway request timed out.")));
		req.on("error", (err) => reject(err instanceof EnphaseError ? err : new EnphaseError(err.message)));
		req.end();
	});
}

/** Pick the most accurate watts value from a set of meter entries. */
function watts(readings: MeterReading[] | undefined, ...preferred: Array<(m: MeterReading) => boolean>): number {
	const list = readings ?? [];
	for (const match of preferred) {
		const found = list.find(match);
		if (found?.wNow != null) return found.wNow;
	}
	return list.find((m) => m.wNow != null)?.wNow ?? 0;
}

function normalize(data: ProductionResponse): EnphaseReadings {
	// Prefer the dedicated production CT meter ("eim"); fall back to inverter totals.
	const productionW = watts(
		data.production,
		(m) => m.type === "eim" && m.measurementType === "production",
		(m) => m.type === "inverters",
	);
	const consumptionW = watts(
		data.consumption,
		(m) => m.measurementType === "total-consumption",
	);
	const prod = Math.max(0, Math.round(productionW));
	const cons = Math.max(0, Math.round(consumptionW));
	return { productionW: prod, consumptionW: cons, netW: prod - cons, fetchedAt: Date.now() };
}

/**
 * Get current readings, reusing a recent fetch (and de-duplicating concurrent
 * calls) so a Stream Deck full of keys hits the gateway once per cycle.
 */
export async function getReadings(force = false): Promise<EnphaseReadings> {
	const host = await gatewayHost();
	if (!host) {
		throw new EnphaseError("Set the gateway host in the action settings.");
	}

	const key = host.toLowerCase();
	if (!force && cache?.key === key && Date.now() - cache.readings.fetchedAt < CACHE_TTL_MS) {
		return cache.readings;
	}
	if (inflight) return inflight;

	inflight = (async () => {
		try {
			const readings = normalize(await fetchProduction(host));
			cache = { key, readings };
			return readings;
		} finally {
			inflight = undefined;
		}
	})();
	return inflight;
}
