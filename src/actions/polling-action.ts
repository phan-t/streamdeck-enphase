import streamDeck, {
	type DidReceiveSettingsEvent,
	type KeyDownEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import { EnphaseError, getReadings } from "../enphase/client";
import type { ActionSettings, EnphaseReadings } from "../enphase/types";
import { errorImage } from "../render";

/** The concrete action instance type for keypad keys. */
type ActionInstance = WillAppearEvent<ActionSettings>["action"];

const DEFAULT_REFRESH_SECONDS = 15;
const MIN_REFRESH_SECONDS = 5;

/**
 * The gateway drops ~half of polls even when healthy, so a single miss shouldn't
 * change anything. Once the last good reading is older than this many poll
 * periods, the key dims to read as "stale / not live".
 */
const STALE_AFTER_PERIODS = 2.5;

/** One visible key (action context) the plugin is currently driving. */
type KeyEntry = {
	action: ActionInstance;
	settings: ActionSettings;
	/** Last image pushed to this key, so we can skip redundant setImage calls. */
	lastImage?: string;
};

/**
 * Base class for keys that periodically poll the gateway and redraw an image.
 *
 * All visible keys share **one** timer and **one** poll cycle: each cycle fetches
 * once (via {@link getReadings}) and fans the result out to every key, rendered
 * with that key's own settings. The gateway/error state is global because every
 * key reads the same gateway, so failures are logged once — not once per key.
 */
export abstract class PollingAction extends SingletonAction<ActionSettings> {
	private readonly keys = new Map<string, KeyEntry>();

	private timer?: ReturnType<typeof setInterval>;
	private timerPeriodMs = 0;
	private polling = false;

	private lastReadings?: EnphaseReadings;
	/** True while polls are currently failing — used to log transitions once. */
	private failing = false;

	/**
	 * Subclasses turn readings + settings into a key image (data URI). `stale` is
	 * true when the reading is too old to be considered live (dim it).
	 */
	protected abstract draw(readings: EnphaseReadings, settings: ActionSettings, stale: boolean): string;

	override async onWillAppear(ev: WillAppearEvent<ActionSettings>): Promise<void> {
		void ev.action.setTitle(""); // labels are baked into the image
		this.keys.set(ev.action.id, { action: ev.action, settings: ev.payload.settings });
		this.ensureTimer();
		await this.renderKey(this.keys.get(ev.action.id)); // paint immediately from current state
		await this.poll();
	}

	override onWillDisappear(ev: WillDisappearEvent<ActionSettings>): void {
		this.keys.delete(ev.action.id);
		this.ensureTimer(); // stops the shared timer once no keys remain
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<ActionSettings>): Promise<void> {
		const entry = this.keys.get(ev.action.id) ?? { action: ev.action, settings: ev.payload.settings };
		entry.settings = ev.payload.settings;
		entry.lastImage = undefined; // force a repaint so new scales/labels take effect
		this.keys.set(ev.action.id, entry);
		this.ensureTimer();
		await this.renderKey(entry);
		await this.poll();
	}

	/** Pressing any key forces an immediate refresh for all keys. */
	override onKeyDown(_ev: KeyDownEvent<ActionSettings>): Promise<void> {
		return this.poll(true);
	}

	/** (Re)create the shared timer at the shortest refresh interval any key wants. */
	private ensureTimer(): void {
		const period = this.computePeriodMs();
		if (period === 0) {
			if (this.timer !== undefined) {
				clearInterval(this.timer);
				this.timer = undefined;
				this.timerPeriodMs = 0;
			}
			return;
		}
		if (this.timer !== undefined && period === this.timerPeriodMs) return;
		if (this.timer !== undefined) clearInterval(this.timer);
		this.timerPeriodMs = period;
		this.timer = setInterval(() => void this.poll(), period);
	}

	private computePeriodMs(): number {
		let min = Number.POSITIVE_INFINITY;
		for (const { settings } of this.keys.values()) {
			const requested = settings.refreshSeconds;
			const seconds = Math.max(
				MIN_REFRESH_SECONDS,
				Number.isFinite(requested) ? (requested as number) : DEFAULT_REFRESH_SECONDS,
			);
			if (seconds < min) min = seconds;
		}
		return Number.isFinite(min) ? min * 1_000 : 0;
	}

	/** Fetch once and fan the result (or error) out to every visible key. */
	private async poll(force = false): Promise<void> {
		if (this.keys.size === 0 || this.polling) return;
		this.polling = true;
		try {
			try {
				this.lastReadings = await getReadings(force);
				if (this.failing) {
					streamDeck.logger.info("Enphase poll recovered.");
					this.failing = false;
				}
			} catch (err) {
				// Keep the last good reading on screen (it dims once stale); only show the
				// error image when there's never been a reading. Log once per outage.
				if (!this.failing) {
					const message = err instanceof EnphaseError ? err.message : String(err);
					const mode = this.lastReadings ? "showing last reading" : "no data yet";
					streamDeck.logger.warn(`Enphase poll failing (${mode}): ${message}`);
					this.failing = true;
				}
			}

			await Promise.all([...this.keys.values()].map((entry) => this.renderKey(entry)));
		} finally {
			this.polling = false;
		}
	}

	/** Number of ms after which the last good reading is considered stale. */
	private staleThresholdMs(): number {
		const period = this.timerPeriodMs || DEFAULT_REFRESH_SECONDS * 1_000;
		return period * STALE_AFTER_PERIODS;
	}

	/** Render one key from the current global state, painting only if it changed. */
	private renderKey(entry?: KeyEntry): Promise<void> {
		if (entry === undefined) return Promise.resolve();
		let image: string;
		if (this.lastReadings) {
			const stale = Date.now() - this.lastReadings.fetchedAt > this.staleThresholdMs();
			image = this.draw(this.lastReadings, entry.settings, stale);
		} else {
			image = errorImage(); // never read the gateway — show the setup hint
		}
		if (entry.lastImage === image) return Promise.resolve();
		entry.lastImage = image;
		return entry.action.setImage(image);
	}
}
