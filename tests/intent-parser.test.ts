import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGenerateText = vi.fn();
const mockIsInstance = vi.fn(() => false);

vi.mock("ai", () => ({
	generateText: (...args: unknown[]) => mockGenerateText(...args),
	Output: { object: vi.fn((config: unknown) => ({ type: "object", ...config })) },
	NoObjectGeneratedError: { isInstance: (err: unknown) => mockIsInstance(err) },
}));

vi.mock("../src/config/llm-provider.js", () => ({
	DEFAULT_MODEL: "test-model",
	resolveModel: vi.fn(async () => "mock-model"),
}));

describe("intent-parser", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIsInstance.mockReturnValue(false);
	});

	it("returns 'list' action for 'show me all agents'", async () => {
		mockGenerateText.mockResolvedValueOnce({
			output: { action: "list", agentName: null, scheduleInput: null, taskDescription: null, newName: null },
		});

		const { parseIntent } = await import("../src/services/intent-parser.js");
		const result = await parseIntent("show me all agents", ["Agent A"]);

		expect(result).toEqual({
			action: "list",
			agentName: null,
			scheduleInput: null,
			taskDescription: null,
			newName: null,
		});
	});

	it("returns 'run' action with agent name", async () => {
		mockGenerateText.mockResolvedValueOnce({
			output: { action: "run", agentName: "Morning Briefing", scheduleInput: null, taskDescription: null, newName: null },
		});

		const { parseIntent } = await import("../src/services/intent-parser.js");
		const result = await parseIntent("run morning briefing", ["Morning Briefing"]);

		expect(result).toEqual({
			action: "run",
			agentName: "Morning Briefing",
			scheduleInput: null,
			taskDescription: null,
			newName: null,
		});
	});

	it("returns 'reschedule' with scheduleInput", async () => {
		mockGenerateText.mockResolvedValueOnce({
			output: {
				action: "reschedule",
				agentName: "PR Reminder",
				scheduleInput: "every weekday at 9am",
				taskDescription: null,
				newName: null,
			},
		});

		const { parseIntent } = await import("../src/services/intent-parser.js");
		const result = await parseIntent("change PR reminder to every weekday at 9am", ["PR Reminder"]);

		expect(result).toEqual({
			action: "reschedule",
			agentName: "PR Reminder",
			scheduleInput: "every weekday at 9am",
			taskDescription: null,
			newName: null,
		});
	});

	it("retries on NoObjectGeneratedError", async () => {
		const fakeError = new Error("Failed to generate object");
		mockIsInstance.mockImplementation((err: unknown) => err === fakeError);

		mockGenerateText.mockRejectedValueOnce(fakeError);
		mockGenerateText.mockResolvedValueOnce({
			output: { action: "list", agentName: null, scheduleInput: null, taskDescription: null, newName: null },
		});

		const { parseIntent } = await import("../src/services/intent-parser.js");
		const result = await parseIntent("list agents", ["Agent A"]);

		expect(mockGenerateText).toHaveBeenCalledTimes(2);
		expect(result).toEqual({
			action: "list",
			agentName: null,
			scheduleInput: null,
			taskDescription: null,
			newName: null,
		});

		// Verify retry prompt contains error feedback
		const retryCall = mockGenerateText.mock.calls[1][0];
		expect(retryCall.prompt).toContain("[Previous attempt failed:");
		expect(retryCall.prompt).toContain("Failed to generate object");
	});

	it("re-throws non-NoObjectGeneratedError", async () => {
		const regularError = new Error("Network failure");
		mockIsInstance.mockReturnValue(false);
		mockGenerateText.mockRejectedValueOnce(regularError);

		const { parseIntent } = await import("../src/services/intent-parser.js");
		await expect(parseIntent("list", ["Agent A"])).rejects.toThrow("Network failure");
		expect(mockGenerateText).toHaveBeenCalledTimes(1);
	});

	it("passes agent names in system prompt", async () => {
		mockGenerateText.mockResolvedValueOnce({
			output: { action: "list", agentName: null, scheduleInput: null, taskDescription: null, newName: null },
		});

		const { parseIntent } = await import("../src/services/intent-parser.js");
		await parseIntent("list agents", ["Morning Briefing", "PR Reminder"]);

		const call = mockGenerateText.mock.calls[0][0];
		expect(call.system).toContain("Morning Briefing");
		expect(call.system).toContain("PR Reminder");
		expect(call.system).toContain("1. Morning Briefing");
		expect(call.system).toContain("2. PR Reminder");
	});

	it("handles empty agent list gracefully", async () => {
		mockGenerateText.mockResolvedValueOnce({
			output: { action: "unknown", agentName: null, scheduleInput: null, taskDescription: null, newName: null },
		});

		const { parseIntent } = await import("../src/services/intent-parser.js");
		await parseIntent("run something", []);

		const call = mockGenerateText.mock.calls[0][0];
		expect(call.system).toContain("(no agents configured)");
	});

	it("returns 'create' action with name, task, and schedule", async () => {
		mockGenerateText.mockResolvedValueOnce({
			output: {
				action: "create",
				agentName: "Morning Briefing",
				scheduleInput: "every day at 7am",
				taskDescription: "summarize my emails",
				newName: null,
			},
		});

		const { parseIntent } = await import("../src/services/intent-parser.js");
		const result = await parseIntent(
			"create Morning Briefing that summarizes my emails every day at 7am",
			["Existing Agent"],
		);

		expect(result.action).toBe("create");
		expect(result.agentName).toBe("Morning Briefing");
		expect(result.taskDescription).toBe("summarize my emails");
		expect(result.scheduleInput).toBe("every day at 7am");
		expect(result.newName).toBeNull();
	});

	it("returns 'create' action without schedule", async () => {
		mockGenerateText.mockResolvedValueOnce({
			output: {
				action: "create",
				agentName: "Test Agent",
				scheduleInput: null,
				taskDescription: "do something useful",
				newName: null,
			},
		});

		const { parseIntent } = await import("../src/services/intent-parser.js");
		const result = await parseIntent(
			"create Test Agent that does something useful",
			[],
		);

		expect(result.action).toBe("create");
		expect(result.agentName).toBe("Test Agent");
		expect(result.taskDescription).toBe("do something useful");
		expect(result.scheduleInput).toBeNull();
	});

	it("returns 'delete' action with agent name", async () => {
		mockGenerateText.mockResolvedValueOnce({
			output: {
				action: "delete",
				agentName: "Morning Briefing",
				scheduleInput: null,
				taskDescription: null,
				newName: null,
			},
		});

		const { parseIntent } = await import("../src/services/intent-parser.js");
		const result = await parseIntent("delete morning briefing", ["Morning Briefing"]);

		expect(result.action).toBe("delete");
		expect(result.agentName).toBe("Morning Briefing");
	});

	it("returns 'update_task' action with task description", async () => {
		mockGenerateText.mockResolvedValueOnce({
			output: {
				action: "update_task",
				agentName: "PR Reminder",
				scheduleInput: null,
				taskDescription: "check open PRs and send summary",
				newName: null,
			},
		});

		const { parseIntent } = await import("../src/services/intent-parser.js");
		const result = await parseIntent(
			"update PR Reminder task to check open PRs and send summary",
			["PR Reminder"],
		);

		expect(result.action).toBe("update_task");
		expect(result.agentName).toBe("PR Reminder");
		expect(result.taskDescription).toBe("check open PRs and send summary");
	});

	it("returns 'rename' action with new name", async () => {
		mockGenerateText.mockResolvedValueOnce({
			output: {
				action: "rename",
				agentName: "Morning Briefing",
				scheduleInput: null,
				taskDescription: null,
				newName: "Daily Digest",
			},
		});

		const { parseIntent } = await import("../src/services/intent-parser.js");
		const result = await parseIntent(
			"rename Morning Briefing to Daily Digest",
			["Morning Briefing"],
		);

		expect(result.action).toBe("rename");
		expect(result.agentName).toBe("Morning Briefing");
		expect(result.newName).toBe("Daily Digest");
	});

	it("system prompt includes create/delete/update_task/rename action descriptions", async () => {
		mockGenerateText.mockResolvedValueOnce({
			output: {
				action: "list",
				agentName: null,
				scheduleInput: null,
				taskDescription: null,
				newName: null,
			},
		});

		const { parseIntent } = await import("../src/services/intent-parser.js");
		await parseIntent("list agents", ["Agent A"]);

		const call = mockGenerateText.mock.calls[0][0];
		expect(call.system).toContain("create");
		expect(call.system).toContain("delete");
		expect(call.system).toContain("update_task");
		expect(call.system).toContain("rename");
		expect(call.system).toContain("taskDescription");
		expect(call.system).toContain("newName");
		expect(call.system).toContain("Disambiguation");
	});
});
