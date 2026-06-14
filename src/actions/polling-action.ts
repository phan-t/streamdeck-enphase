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

type ActionState = { last?: EnphaseReadings; failures: number };

/**
 * Base class for keys that periodically poll the gateway and redraw an image.
 *
 * Each visible key keeps its own interval (keyed by action id); the shared
 * {@link getReadings} cache ensures the gateway is only hit once per cycle even
 * when several keys are on screen.
 */
export abstract class PollingAction extends SingletonAction<ActionSettings> {
	private readonly timers = new Map<string, ReturnType<typeof setInterval>>();
	private readonly state = new Map<string, ActionState>();

	/** Subclasses turn readings + settings into a key image (data URI). */
	protected abstract draw(readings: EnphaseReadings, settings: ActionSettings): string;

	override onWillAppear(ev: WillAppearEvent<ActionSettings>): Promise<void> {
		void ev.action.setTitle(""); // labels are baked into the image
		this.schedule(ev.action, ev.payload.settings);
		return this.tick(ev.action);
	}

	override onWillDisappear(ev: WillDisappearEvent<ActionSettings>): void {
		this.cancel(ev.action.id);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<ActionSettings>): Promise<void> {
		this.schedule(ev.action, ev.payload.settings);
		return this.tick(ev.action);
	}

	/** Pressing the key forces an immediate refresh. */
	override onKeyDown(ev: KeyDownEvent<ActionSettings>): Promise<void> {
		return this.tick(ev.action, true);
	}

	private schedule(action: ActionInstance, settings: ActionSettings): void {
		this.cancel(action.id);
		const seconds = Math.max(MIN_REFRESH_SECONDS, settings.refreshSeconds ?? DEFAULT_REFRESH_SECONDS);
		this.timers.set(
			action.id,
			setInterval(() => void this.tick(action), seconds * 1_000),
		);
	}

	private cancel(id: string): void {
		const timer = this.timers.get(id);
		if (timer !== undefined) {
			clearInterval(timer);
			this.timers.delete(id);
		}
		this.state.delete(id);
	}

	private async tick(action: ActionInstance, force = false): Promise<void> {
		const settings = await action.getSettings();
		const state = this.state.get(action.id) ?? { failures: 0 };
		this.state.set(action.id, state);

		try {
			const readings = await getReadings(force);
			state.last = readings;
			state.failures = 0;
			await action.setImage(this.draw(readings, settings));
		} catch (err) {
			state.failures += 1;
			const message = err instanceof EnphaseError ? err.message : String(err);
			streamDeck.logger.warn(`Enphase poll failed (${state.failures}x): ${message}`);

			// The gateway drops connections often; ride out transient failures by
			// keeping the last good reading on screen instead of flashing an error.
			if (state.last && state.failures < MAX_FAILURES_BEFORE_ERROR) {
				await action.setImage(this.draw(state.last, settings));
			} else {
				await action.setImage(errorImage());
				await action.showAlert();
			}
		}
	}
}
