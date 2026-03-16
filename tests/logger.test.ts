import { afterEach, describe, expect, it, vi } from "vitest";
import { log } from "../src/helpers/logger.js";

describe("logger", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("log.cron.info prefixes with [cron]", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		log.cron.info("tick");
		expect(spy).toHaveBeenCalledWith("[cron] tick");
	});

	it("log.shutdown.error prefixes with [shutdown]", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		log.shutdown.error("failure");
		expect(spy).toHaveBeenCalledWith("[shutdown] failure");
	});

	it("log.startup.warn prefixes with [startup]", () => {
		const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
		log.startup.warn("caution");
		expect(spy).toHaveBeenCalledWith("[startup] caution");
	});

	it("log.info outputs without prefix", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		log.info("plain message");
		expect(spy).toHaveBeenCalledWith("plain message");
	});

	it("log.error outputs without prefix", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		log.error("plain error");
		expect(spy).toHaveBeenCalledWith("plain error");
	});

	it("log.telegram.info prefixes with [telegram-bot]", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		log.telegram.info("connected");
		expect(spy).toHaveBeenCalledWith("[telegram-bot] connected");
	});
});
