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
 * The IQ Gateway's embedded web server frequently drops/refuses connections, so
 * individual polls fail often. Keep showing the last good reading through this
 * many consecutive failures before falling back to the error image.
 */
const MAX_FAILURES_BEFORE_ERROR = 5;

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
	private failures = 0;
	private errored = false;

	/** Subclasses turn readings + settings into a key image (data URI). */
	protected abstract draw(readings: EnphaseReadings, settings: ActionSettings): string;

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
			let enteredError = false;
			try {
				this.lastReadings = await getReadings(force);
				this.failures = 0;
				if (this.errored) {
					streamDeck.logger.info("Enphase poll recovered.");
					this.errored = false;
				}
			} catch (err) {
				this.failures += 1;
				// Ride out transient failures by keeping the last good reading on screen;
				// only fall to the error image once there's nothing good or it stays down.
				const showError = !this.lastReadings || this.failures >= MAX_FAILURES_BEFORE_ERROR;
				if (showError && !this.errored) {
					const message = err instanceof EnphaseError ? err.message : String(err);
					streamDeck.logger.warn(`Enphase poll failing: ${message}`);
					this.errored = true;
					enteredError = true;
				}
			}

			await Promise.all([...this.keys.values()].map((entry) => this.renderKey(entry)));

			// Alert each key once, only on the transition into the error state.
			if (enteredError) {
				await Promise.all([...this.keys.values()].map((entry) => entry.action.showAlert()));
			}
		} finally {
			this.polling = false;
		}
	}

	/** Render one key from the current global state, painting only if it changed. */
	private renderKey(entry?: KeyEntry): Promise<void> {
		if (entry === undefined) return Promise.resolve();
		let image: string | undefined;
		if (this.errored) {
			image = errorImage();
		} else if (this.lastReadings) {
			image = this.draw(this.lastReadings, entry.settings);
		}
		if (image === undefined || entry.lastImage === image) return Promise.resolve();
		entry.lastImage = image;
		return entry.action.setImage(image);
	}
}
