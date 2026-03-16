import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks ---

const mockParseIntent = vi.fn();
vi.mock("../src/services/intent-parser.js", () => ({
	parseIntent: (...args: unknown[]) => mockParseIntent(...args),
}));

const mockExecuteAgent = vi.fn();
const mockGetLlmCircuitStatus = vi.fn();
vi.mock("../src/services/executor.js", () => ({
	executeAgent: (...args: unknown[]) => mockExecuteAgent(...args),
	getLlmCircuitStatus: () => mockGetLlmCircuitStatus(),
}));

const mockParseSchedule = vi.fn();
vi.mock("../src/services/schedule-parser.js", () => ({
	parseSchedule: (...args: unknown[]) => mockParseSchedule(...args),
}));

const mockScheduleAgent = vi.fn();
const mockRemoveAgent = vi.fn();
const mockGetScheduledJobs = vi.fn();
vi.mock("../src/services/scheduler.js", () => ({
	scheduleAgent: (...args: unknown[]) => mockScheduleAgent(...args),
	removeAgent: (...args: unknown[]) => mockRemoveAgent(...args),
	getScheduledJobs: () => mockGetScheduledJobs(),
}));

const mockSendPlainText = vi.fn();
const mockSendTypingAction = vi.fn();
vi.mock("../src/services/telegram-poller.js", () => ({
	sendPlainText: (...args: unknown[]) => mockSendPlainText(...args),
	sendTypingAction: (...args: unknown[]) => mockSendTypingAction(...args),
}));

const mockEnrichAgent = vi.fn();
const mockGetConsecutiveFailures = vi.fn();
vi.mock("../src/helpers/enrich-agent.js", () => ({
	enrichAgent: (...args: unknown[]) => mockEnrichAgent(...args),
	getConsecutiveFailures: (...args: unknown[]) => mockGetConsecutiveFailures(...args),
}));

vi.mock("../src/config/env.js", () => ({
	env: {
		TELEGRAM_BOT_TOKEN: "test-token",
		TELEGRAM_CHAT_ID: "123",
	},
}));

// Mock the DB
function createMockDb(agentRows: Array<Record<string, unknown>> = []) {
	const mockGet = vi.fn();
	const mockAll = vi.fn(() => agentRows);
	const mockRun = vi.fn();

	const mockWhere = vi.fn(() => ({
		get: mockGet,
		all: mockAll,
		run: mockRun,
	}));

	const mockSet = vi.fn(() => ({
		where: mockWhere,
	}));

	const mockFrom = vi.fn(() => ({
		where: mockWhere,
		all: mockAll,
		get: mockGet,
	}));

	return {
		select: vi.fn(() => ({
			from: mockFrom,
		})),
		update: vi.fn(() => ({
			set: mockSet,
		})),
		_mockGet: mockGet,
		_mockAll: mockAll,
		_mockWhere: mockWhere,
		_mockSet: mockSet,
		_mockFrom: mockFrom,
		_mockRun: mockRun,
	};
}

// Helper to build a TelegramMessage
function makeMessage(text: string) {
	return {
		message_id: 1,
		chat: { id: 123, type: "private" as const },
		text,
		date: Math.floor(Date.now() / 1000),
	};
}

describe("telegram-commands", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSendPlainText.mockResolvedValue(undefined);
		mockSendTypingAction.mockResolvedValue(undefined);
		mockExecuteAgent.mockResolvedValue({ status: "success", executionId: 1, output: {} });
		mockGetLlmCircuitStatus.mockReturnValue({ state: "CLOSED", failureCount: 0 });
		mockGetScheduledJobs.mockReturnValue(new Map());
		mockGetConsecutiveFailures.mockReturnValue(0);
		mockEnrichAgent.mockImplementation((agent: Record<string, unknown>) => ({
			...agent,
			enabled: Boolean(agent.enabled),
			nextRunAt: null,
			lastRunAt: null,
			healthy: true,
			consecutiveFailures: 0,
		}));
	});

	it("/start returns help text without LLM call", async () => {
		const { handleTelegramMessage } = await import(
			"../src/services/telegram-commands.js"
		);
		const db = createMockDb();
		await handleTelegramMessage(makeMessage("/start"), db as never);

		expect(mockSendPlainText).toHaveBeenCalledTimes(1);
		const sentText = mockSendPlainText.mock.calls[0][2] as string;
		expect(sentText).toContain("list agents");
		expect(sentText).toContain("run");
		expect(sentText).toContain("enable");
		expect(sentText).toContain("disable");
		expect(sentText).toContain("status");
		expect(mockParseIntent).not.toHaveBeenCalled();
	});

	it("/help returns help text without LLM call", async () => {
		const { handleTelegramMessage } = await import(
			"../src/services/telegram-commands.js"
		);
		const db = createMockDb();
		await handleTelegramMessage(makeMessage("/help"), db as never);

		expect(mockSendPlainText).toHaveBeenCalledTimes(1);
		const sentText = mockSendPlainText.mock.calls[0][2] as string;
		expect(sentText).toContain("list agents");
		expect(mockParseIntent).not.toHaveBeenCalled();
	});

	it("/help bypasses LLM call (parseIntent not called)", async () => {
		const { handleTelegramMessage } = await import(
			"../src/services/telegram-commands.js"
		);
		const db = createMockDb();
		await handleTelegramMessage(makeMessage("/help"), db as never);

		expect(mockParseIntent).not.toHaveBeenCalled();
		expect(mockSendTypingAction).not.toHaveBeenCalled();
	});

	it("list action returns agent list with status", async () => {
		const testAgents = [
			{ id: 1, name: "Morning Briefing", enabled: 1, cronSchedule: "0 9 * * *" },
			{ id: 2, name: "PR Reminder", enabled: 0, cronSchedule: "0 10 * * *" },
		];

		mockParseIntent.mockResolvedValueOnce({
			action: "list",
			agentName: null,
			scheduleInput: null,
		});

		// enrichAgent returns correct enabled/disabled + healthy per agent
		mockEnrichAgent.mockImplementation((agent: Record<string, unknown>) => ({
			...agent,
			enabled: Boolean(agent.enabled),
			nextRunAt: null,
			lastRunAt: null,
			healthy: true,
			consecutiveFailures: 0,
		}));

		const { handleTelegramMessage } = await import(
			"../src/services/telegram-commands.js"
		);

		// Build a mock DB that returns the test agents
		const db = createMockDb(testAgents);

		await handleTelegramMessage(makeMessage("show me agents"), db as never);

		expect(mockSendPlainText).toHaveBeenCalledTimes(1);
		const sentText = mockSendPlainText.mock.calls[0][2] as string;
		expect(sentText).toContain("Agents:");
		expect(sentText).toContain("Morning Briefing");
		expect(sentText).toContain("PR Reminder");
		expect(sentText).toContain("enabled");
		expect(sentText).toContain("disabled");
	});

	it("run action triggers executeAgent fire-and-forget", async () => {
		mockParseIntent.mockResolvedValueOnce({
			action: "run",
			agentName: "Morning Briefing",
			scheduleInput: null,
		});

		const testAgent = { id: 1, name: "Morning Briefing", enabled: 1, cronSchedule: "0 9 * * *" };

		const { handleTelegramMessage } = await import(
			"../src/services/telegram-commands.js"
		);

		const db = createMockDb([testAgent]);
		// Make the where().get() return the agent for findAgentByName
		db._mockGet.mockReturnValue(testAgent);

		await handleTelegramMessage(makeMessage("run morning briefing"), db as never);

		expect(mockExecuteAgent).toHaveBeenCalledTimes(1);
		const sentText = mockSendPlainText.mock.calls[0][2] as string;
		expect(sentText).toContain("Running Morning Briefing...");
	});

	it("run unknown agent returns guidance", async () => {
		mockParseIntent.mockResolvedValueOnce({
			action: "run",
			agentName: "NonExistent",
			scheduleInput: null,
		});

		const { handleTelegramMessage } = await import(
			"../src/services/telegram-commands.js"
		);

		const db = createMockDb([]);
		db._mockGet.mockReturnValue(undefined);

		await handleTelegramMessage(makeMessage("run nonexistent"), db as never);

		const sentText = mockSendPlainText.mock.calls[0][2] as string;
		expect(sentText).toContain("not found");
		expect(sentText).toContain("list agents");
	});

	it("enable action updates DB and schedules agent", async () => {
		const testAgent = { id: 1, name: "Morning Briefing", enabled: 0, cronSchedule: "0 9 * * *" };
		const updatedAgent = { ...testAgent, enabled: 1 };

		mockParseIntent.mockResolvedValueOnce({
			action: "enable",
			agentName: "Morning Briefing",
			scheduleInput: null,
		});

		const { handleTelegramMessage } = await import(
			"../src/services/telegram-commands.js"
		);

		const db = createMockDb([testAgent]);
		// First get returns the disabled agent, second returns the updated one
		db._mockGet.mockReturnValueOnce(testAgent).mockReturnValueOnce(updatedAgent);

		await handleTelegramMessage(makeMessage("enable morning briefing"), db as never);

		expect(db.update).toHaveBeenCalled();
		expect(mockScheduleAgent).toHaveBeenCalledTimes(1);
		const sentText = mockSendPlainText.mock.calls[0][2] as string;
		expect(sentText).toContain("Enabled Morning Briefing.");
	});

	it("disable action updates DB and removes agent from scheduler", async () => {
		const testAgent = { id: 1, name: "Morning Briefing", enabled: 1, cronSchedule: "0 9 * * *" };

		mockParseIntent.mockResolvedValueOnce({
			action: "disable",
			agentName: "Morning Briefing",
			scheduleInput: null,
		});

		const { handleTelegramMessage } = await import(
			"../src/services/telegram-commands.js"
		);

		const db = createMockDb([testAgent]);
		db._mockGet.mockReturnValue(testAgent);

		await handleTelegramMessage(makeMessage("disable morning briefing"), db as never);

		expect(db.update).toHaveBeenCalled();
		expect(mockRemoveAgent).toHaveBeenCalledWith(1);
		const sentText = mockSendPlainText.mock.calls[0][2] as string;
		expect(sentText).toContain("Disabled Morning Briefing.");
	});

	it("status action returns health summary", async () => {
		mockParseIntent.mockResolvedValueOnce({
			action: "status",
			agentName: null,
			scheduleInput: null,
		});

		const testAgents = [
			{ id: 1, name: "Agent A", enabled: 1, cronSchedule: "0 9 * * *" },
			{ id: 2, name: "Agent B", enabled: 0, cronSchedule: "0 10 * * *" },
		];

		const { handleTelegramMessage } = await import(
			"../src/services/telegram-commands.js"
		);

		const db = createMockDb(testAgents);

		await handleTelegramMessage(makeMessage("status"), db as never);

		const sentText = mockSendPlainText.mock.calls[0][2] as string;
		expect(sentText).toContain("System Status:");
		expect(sentText).toContain("2 total");
		expect(sentText).toContain("1 enabled");
		expect(sentText).toContain("1 disabled");
		expect(sentText).toContain("LLM circuit breaker: CLOSED");
	});

	it("reschedule action calls parseSchedule and updates DB", async () => {
		const testAgent = { id: 1, name: "Morning Briefing", enabled: 1, cronSchedule: "0 9 * * *" };

		mockParseIntent.mockResolvedValueOnce({
			action: "reschedule",
			agentName: "Morning Briefing",
			scheduleInput: "every weekday at 9am",
		});

		mockParseSchedule.mockResolvedValueOnce({
			input: "every weekday at 9am",
			cronExpression: "0 9 * * 1-5",
			humanReadable: "At 09:00, Monday through Friday",
			confidence: "high",
			interpretation: "Every weekday at 9am",
		});

		const { handleTelegramMessage } = await import(
			"../src/services/telegram-commands.js"
		);

		const db = createMockDb([testAgent]);
		db._mockGet.mockReturnValueOnce(testAgent).mockReturnValueOnce({ ...testAgent, cronSchedule: "0 9 * * 1-5" });

		await handleTelegramMessage(makeMessage("change morning briefing to every weekday at 9am"), db as never);

		expect(mockParseSchedule).toHaveBeenCalledWith("every weekday at 9am");
		expect(db.update).toHaveBeenCalled();
		const sentText = mockSendPlainText.mock.calls[0][2] as string;
		expect(sentText).toContain("Updated Morning Briefing schedule");
		expect(sentText).toContain("0 9 * * 1-5");
		expect(sentText).toContain("At 09:00, Monday through Friday");
	});

	it("unknown action returns fallback with help", async () => {
		mockParseIntent.mockResolvedValueOnce({
			action: "unknown",
			agentName: null,
			scheduleInput: null,
		});

		const { handleTelegramMessage } = await import(
			"../src/services/telegram-commands.js"
		);

		const db = createMockDb([]);

		await handleTelegramMessage(makeMessage("make me a sandwich"), db as never);

		const sentText = mockSendPlainText.mock.calls[0][2] as string;
		expect(sentText).toContain("I didn't understand that");
		expect(sentText).toContain("list agents");
	});

	it("error in intent parsing returns error guidance", async () => {
		mockParseIntent.mockRejectedValueOnce(new Error("LLM API failure"));

		const { handleTelegramMessage } = await import(
			"../src/services/telegram-commands.js"
		);

		const db = createMockDb([]);

		await handleTelegramMessage(makeMessage("some gibberish"), db as never);

		const sentText = mockSendPlainText.mock.calls[0][2] as string;
		expect(sentText).toContain("Something went wrong");
		expect(sentText).toContain("/help");
	});

	it("typing indicator sent for LLM-processed messages", async () => {
		mockParseIntent.mockResolvedValueOnce({
			action: "list",
			agentName: null,
			scheduleInput: null,
		});

		const { handleTelegramMessage } = await import(
			"../src/services/telegram-commands.js"
		);

		const db = createMockDb([]);

		await handleTelegramMessage(makeMessage("list agents"), db as never);

		expect(mockSendTypingAction).toHaveBeenCalledTimes(1);
		expect(mockSendTypingAction).toHaveBeenCalledWith("test-token", "123");
	});

	it("typing indicator NOT sent for /help", async () => {
		const { handleTelegramMessage } = await import(
			"../src/services/telegram-commands.js"
		);

		const db = createMockDb();

		await handleTelegramMessage(makeMessage("/help"), db as never);

		expect(mockSendTypingAction).not.toHaveBeenCalled();
	});
});
