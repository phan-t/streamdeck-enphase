import streamDeck, { LogLevel } from "@elgato/streamdeck";
import { Overview } from "./actions/overview";

streamDeck.logger.setLevel(LogLevel.INFO);

streamDeck.actions.registerAction(new Overview());

streamDeck.connect();
