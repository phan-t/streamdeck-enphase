import { action } from "@elgato/streamdeck";
import type { ActionSettings, EnphaseReadings } from "../enphase/types";
import { barsImage } from "../render";
import { PollingAction } from "./polling-action";

const DEFAULT_MAX_WATTS = 6000;

/** A single key showing both solar production (yellow) and household consumption (red). */
@action({ UUID: "tphan.enphase.overview" })
export class Overview extends PollingAction {
	protected override draw(readings: EnphaseReadings, settings: ActionSettings): string {
		const scale = (value?: number): number => (value && value > 0 ? value : settings.maxWatts || DEFAULT_MAX_WATTS);
		return barsImage({
			rows: [
				{ label: "Production", watts: readings.productionW, color: "#FFCC00", maxWatts: scale(settings.productionMax) },
				{ label: "Consumption", watts: readings.consumptionW, color: "#FF3B30", maxWatts: scale(settings.consumptionMax) },
			],
		});
	}
}
