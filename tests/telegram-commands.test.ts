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
	const mockReturning = vi.fn(() => ({ get: mockGet }));

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

	const mockValues = vi.fn(() => ({
		returning: mockReturning,
		run: mockRun,
	}));

	return {
		select: vi.fn(() => ({
			from: mockFrom,
		})),
		update: vi.fn(() => ({
			set: mockSet,
		})),
		insert: vi.fn(() => ({
			values: mockValues,
		})),
		delete: vi.fn(() => ({
			where: mockWhere,
		})),
		_mockGet: mockGet,
		_mockAll: mockAll,
		_mockWhere: mockWhere,
		_mockSet: mockSet,
		_mockFrom: mockFrom,
		_mockRun: mockRun,
		_mockValues: mockValues,
		_mockReturning: mockReturning,
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
	beforeEach(async () => {
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

		// Reset pending deletions between tests
		const { _resetPendingDeletions } = await import("../src/services/telegram-commands.js");
		_resetPendingDeletions();
	});

	it("/start returns help text without LLM call", async () => {
		const { handleTelegramMessage } = await import("../src/services/telegram-commands.js");
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
		const { handleTelegramMessage } = await import("../src/services/telegram-commands.js");
		const db = createMockDb();
		await handleTelegramMessage(makeMessage("/help"), db as never);

		expect(mockSendPlainText).toHaveBeenCalledTimes(1);
		const sentText = mockSendPlainText.mock.calls[0][2] as string;
		expect(sentText).toContain("list agents");
		expect(mockParseIntent).not.toHaveBeenCalled();
	});

	it("/help bypasses LLM call (parseIntent not called)", async () => {
		const { handleTelegramMessage } = await import("../src/services/telegram-commands.js");
		const db = createMockDb();
		await handleTelegramMessage(makeMessage("/help"), db as never);

		expect(mockParseIntent).not.toHaveBeenCalled();
		expect(mockSendTypingAction).not.toHaveBeenCalled();
	});

	it("help text includes create, delete, update task, rename", async () => {
		const { handleTelegramMessage } = await import("../src/services/telegram-commands.js");
		const db = createMockDb();
		await handleTelegramMessage(makeMessage("/help"), db as never);

		const sentText = mockSendPlainText.mock.calls[0][2] as string;
		expect(sentText).toContain("create");
		expect(sentText).toContain("delete");
		expect(sentText).toContain("update");
		expect(sentText).toContain("rename");
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
			taskDescription: null,
			newName: null,
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

		const { handleTelegramMessage } = await import("../src/services/telegram-commands.js");

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
			taskDescription: null,
			newName: null,
		});

		const testAgent = { id: 1, name: "Morning Briefing", enabled: 1, cronSchedule: "0 9 * * *" };

		const { handleTelegramMessage } = await import("../src/services/telegram-commands.js");

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
			taskDescription: null,
			newName: null,
		});

		const { handleTelegramMessage } = await import("../src/services/telegram-commands.js");

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
			taskDescription: null,
			newName: null,
		});

		const { handleTelegramMessage } = await import("../src/services/telegram-commands.js");

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
			taskDescription: null,
			newName: null,
		});

		const { handleTelegramMessage } = await import("../src/services/telegram-commands.js");

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
			taskDescription: null,
			newName: null,
		});

		const testAgents = [
			{ id: 1, name: "Agent A", enabled: 1, cronSchedule: "0 9 * * *" },
			{ id: 2, name: "Agent B", enabled: 0, cronSchedule: "0 10 * * *" },
		];

		const { handleTelegramMessage } = await import("../src/services/telegram-commands.js");

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
			taskDescription: null,
			newName: null,
		});

		mockParseSchedule.mockResolvedValueOnce({
			input: "every weekday at 9am",
			cronExpression: "0 9 * * 1-5",
			humanReadable: "At 09:00, Monday through Friday",
			confidence: "high",
			interpretation: "Every weekday at 9am",
		});

		const { handleTelegramMessage } = await import("../src/services/telegram-commands.js");

		const db = createMockDb([testAgent]);
		db._mockGet
			.mockReturnValueOnce(testAgent)
			.mockReturnValueOnce({ ...testAgent, cronSchedule: "0 9 * * 1-5" });

		await handleTelegramMessage(
			makeMessage("change morning briefing to every weekday at 9am"),
			db as never,
		);

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
			taskDescription: null,
			newName: null,
		});

		const { handleTelegramMessage } = await import("../src/services/telegram-commands.js");

		const db = createMockDb([]);

		await handleTelegramMessage(makeMessage("make me a sandwich"), db as never);

		const sentText = mockSendPlainText.mock.calls[0][2] as string;
		expect(sentText).toContain("I didn't understand that");
		expect(sentText).toContain("list agents");
	});

	it("error in intent parsing returns error guidance", async () => {
		mockParseIntent.mockRejectedValueOnce(new Error("LLM API failure"));

		const { handleTelegramMessage } = await import("../src/services/telegram-commands.js");

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
			taskDescription: null,
			newName: null,
		});

		const { handleTelegramMessage } = await import("../src/services/telegram-commands.js");

		const db = createMockDb([]);

		await handleTelegramMessage(makeMessage("list agents"), db as never);

		expect(mockSendTypingAction).toHaveBeenCalledTimes(1);
		expect(mockSendTypingAction).toHaveBeenCalledWith("test-token", "123");
	});

	it("typing indicator NOT sent for /help", async () => {
		const { handleTelegramMessage } = await import("../src/services/telegram-commands.js");

		const db = createMockDb();

		await handleTelegramMessage(makeMessage("/help"), db as never);

		expect(mockSendTypingAction).not.toHaveBeenCalled();
	});

	// --- Create handler tests ---

	it("create action inserts agent with schedule and echoes confirmation", async () => {
		mockParseIntent.mockResolvedValueOnce({
			action: "create",
			agentName: "Morning Briefing",
			scheduleInput: "every day at 7am",
			taskDescription: "summarize my emails",
			newName: null,
		});

		mockParseSchedule.mockResolvedValueOnce({
			input: "every day at 7am",
			cronExpression: "0 7 * * *",
			humanReadable: "At 07:00",
			confidence: "high",
			interpretation: "every day at 7am",
		});

		const createdAgent = {
			id: 10,
			name: "Morning Briefing",
			taskDescription: "summarize my emails",
			cronSchedule: "0 7 * * *",
			enabled: 1,
		};

		const { handleTelegramMessage } = await import("../src/services/telegram-commands.js");
		const db = createMockDb([]);
		// findAgentByName returns undefined (no duplicate)
		db._mockGet.mockReturnValueOnce(undefined);
		// insert().values().returning().get() returns the created agent
		db._mockGet.mockReturnValueOnce(createdAgent);

		await handleTelegramMessage(makeMessage("create Morning Briefing that summarizes my emails every day at 7am"), db as never);

		expect(db.insert).toHaveBeenCalled();
		expect(mockScheduleAgent).toHaveBeenCalledTimes(1);
		const sentText = mockSendPlainText.mock.calls[0][2] as string;
		expect(sentText).toContain('Created "Morning Briefing"');
		expect(sentText).toContain("summarize my emails");
		expect(sentText).toContain("0 7 * * *");
		expect(sentText).toContain("enabled");
	});

	it("create without schedule creates disabled agent", async () => {
		mockParseIntent.mockResolvedValueOnce({
			action: "create",
			agentName: "Test Agent",
			scheduleInput: null,
			taskDescription: "do something",
			newName: null,
		});

		const createdAgent = {
			id: 11,
			name: "Test Agent",
			taskDescription: "do something",
			cronSchedule: "",
			enabled: 0,
		};

		const { handleTelegramMessage } = await import("../src/services/telegram-commands.js");
		const db = createMockDb([]);
		db._mockGet.mockReturnValueOnce(undefined); // no duplicate
		db._mockGet.mockReturnValueOnce(createdAgent); // insert result

		await handleTelegramMessage(makeMessage("create Test Agent that does something"), db as never);

		expect(db.insert).toHaveBeenCalled();
		expect(mockScheduleAgent).not.toHaveBeenCalled();
		const sentText = mockSendPlainText.mock.calls[0][2] as string;
		expect(sentText).toContain('Created "Test Agent"');
		expect(sentText).toContain("disabled");
	});

	it("create with duplicate name returns guidance", async () => {
		const existingAgent = { id: 1, name: "Morning Briefing", enabled: 1 };

		mockParseIntent.mockResolvedValueOnce({
			action: "create",
			agentName: "Morning Briefing",
			scheduleInput: null,
			taskDescription: "something",
			newName: null,
		});

		const { handleTelegramMessage } = await import("../src/services/telegram-commands.js");
		const db = createMockDb([existingAgent]);
		db._mockGet.mockReturnValue(existingAgent); // findAgentByName finds duplicate

		await handleTelegramMessage(makeMessage("create Morning Briefing that does something"), db as never);

		const sentText = mockSendPlainText.mock.calls[0][2] as string;
		expect(sentText).toContain("already exists");
		expect(sentText).toContain("update");
	});

	it("create with missing name or task returns guidance", async () => {
		mockParseIntent.mockResolvedValueOnce({
			action: "create",
			agentName: null,
			scheduleInput: null,
			taskDescription: null,
			newName: null,
		});

		const { handleTelegramMessage } = await import("../src/services/telegram-commands.js");
		const db = createMockDb([]);

		await handleTelegramMessage(makeMessage("create an agent"), db as never);

		const sentText = mockSendPlainText.mock.calls[0][2] as string;
		expect(sentText).toContain("Missing name or task");
		expect(sentText).toContain("Example:");
	});

	// --- Delete handler tests ---

	it("delete action triggers confirmation prompt", async () => {
		const testAgent = { id: 1, name: "Morning Briefing", enabled: 1, cronSchedule: "0 9 * * *" };

		mockParseIntent.mockResolvedValueOnce({
			action: "delete",
			agentName: "Morning Briefing",
			scheduleInput: null,
			taskDescription: null,
			newName: null,
		});

		const { handleTelegramMessage } = await import("../src/services/telegram-commands.js");
		const db = createMockDb([testAgent]);
		db._mockGet.mockReturnValue(testAgent);

		await handleTelegramMessage(makeMessage("delete morning briefing"), db as never);

		const sentText = mockSendPlainText.mock.calls[0][2] as string;
		expect(sentText).toContain('Delete "Morning Briefing"?');
		expect(sentText).toContain("yes");
		expect(sentText).toContain("60s");
		// Agent should NOT be deleted yet
		expect(db.delete).not.toHaveBeenCalled();
	});

	it("yes confirms pending deletion and removes agent", async () => {
		const testAgent = { id: 1, name: "Morning Briefing", enabled: 1, cronSchedule: "0 9 * * *" };

		// First message: "delete morning briefing"
		mockParseIntent.mockResolvedValueOnce({
			action: "delete",
			agentName: "Morning Briefing",
			scheduleInput: null,
			taskDescription: null,
			newName: null,
		});

		const { handleTelegramMessage } = await import("../src/services/telegram-commands.js");
		const db = createMockDb([testAgent]);
		db._mockGet.mockReturnValue(testAgent);

		await handleTelegramMessage(makeMessage("delete morning briefing"), db as never);

		// Second message: "yes"
		await handleTelegramMessage(makeMessage("yes"), db as never);

		const sentText = mockSendPlainText.mock.calls[1][2] as string;
		expect(sentText).toContain("Deleted");
		expect(sentText).toContain("Morning Briefing");
		expect(mockRemoveAgent).toHaveBeenCalledWith(1);
		expect(db.delete).toHaveBeenCalled();
	});

	it("no cancels pending deletion", async () => {
		const testAgent = { id: 1, name: "Morning Briefing", enabled: 1, cronSchedule: "0 9 * * *" };

		mockParseIntent.mockResolvedValueOnce({
			action: "delete",
			agentName: "Morning Briefing",
			scheduleInput: null,
			taskDescription: null,
			newName: null,
		});

		const { handleTelegramMessage } = await import("../src/services/telegram-commands.js");
		const db = createMockDb([testAgent]);
		db._mockGet.mockReturnValue(testAgent);

		await handleTelegramMessage(makeMessage("delete morning briefing"), db as never);

		// Cancel
		await handleTelegramMessage(makeMessage("no"), db as never);

		const sentText = mockSendPlainText.mock.calls[1][2] as string;
		expect(sentText).toContain("cancelled");
		expect(db.delete).not.toHaveBeenCalled();
	});

	it("other message clears pending deletion and processes normally", async () => {
		const testAgent = { id: 1, name: "Morning Briefing", enabled: 1, cronSchedule: "0 9 * * *" };

		// First: delete request
		mockParseIntent.mockResolvedValueOnce({
			action: "delete",
			agentName: "Morning Briefing",
			scheduleInput: null,
			taskDescription: null,
			newName: null,
		});

		// Second: "list agents" processed normally after clearing pending
		mockParseIntent.mockResolvedValueOnce({
			action: "list",
			agentName: null,
			scheduleInput: null,
			taskDescription: null,
			newName: null,
		});

		const { handleTelegramMessage } = await import("../src/services/telegram-commands.js");
		const db = createMockDb([testAgent]);
		db._mockGet.mockReturnValue(testAgent);

		await handleTelegramMessage(makeMessage("delete morning briefing"), db as never);
		await handleTelegramMessage(makeMessage("list agents"), db as never);

		// Second reply should be the list, not deletion
		expect(mockSendPlainText).toHaveBeenCalledTimes(2);
		const secondReply = mockSendPlainText.mock.calls[1][2] as string;
		expect(secondReply).not.toContain("Deleted");
		expect(db.delete).not.toHaveBeenCalled();
	});

	// --- Update task handler tests ---

	it("update_task action modifies task description", async () => {
		const testAgent = { id: 1, name: "PR Reminder", enabled: 1, cronSchedule: "0 10 * * *" };

		mockParseIntent.mockResolvedValueOnce({
			action: "update_task",
			agentName: "PR Reminder",
			scheduleInput: null,
			taskDescription: "check open PRs and send summary",
			newName: null,
		});

		const { handleTelegramMessage } = await import("../src/services/telegram-commands.js");
		const db = createMockDb([testAgent]);
		db._mockGet.mockReturnValue(testAgent);

		await handleTelegramMessage(makeMessage("update PR Reminder task to check open PRs"), db as never);

		expect(db.update).toHaveBeenCalled();
		const sentText = mockSendPlainText.mock.calls[0][2] as string;
		expect(sentText).toContain("Updated PR Reminder task");
	});

	it("update_task with missing fields returns guidance", async () => {
		mockParseIntent.mockResolvedValueOnce({
			action: "update_task",
			agentName: null,
			scheduleInput: null,
			taskDescription: null,
			newName: null,
		});

		const { handleTelegramMessage } = await import("../src/services/telegram-commands.js");
		const db = createMockDb([]);

		await handleTelegramMessage(makeMessage("update task"), db as never);

		const sentText = mockSendPlainText.mock.calls[0][2] as string;
		expect(sentText).toContain("specify agent and new task");
	});

	// --- Rename handler tests ---

	it("rename action changes agent name", async () => {
		const testAgent = { id: 1, name: "Morning Briefing", enabled: 1, cronSchedule: "0 9 * * *" };

		mockParseIntent.mockResolvedValueOnce({
			action: "rename",
			agentName: "Morning Briefing",
			scheduleInput: null,
			taskDescription: null,
			newName: "Daily Digest",
		});

		const { handleTelegramMessage } = await import("../src/services/telegram-commands.js");
		const db = createMockDb([testAgent]);
		// First get: findAgentByName finds the agent
		db._mockGet.mockReturnValueOnce(testAgent);
		// Second get: findAgentByName for conflict check returns undefined
		db._mockGet.mockReturnValueOnce(undefined);

		await handleTelegramMessage(makeMessage("rename Morning Briefing to Daily Digest"), db as never);

		expect(db.update).toHaveBeenCalled();
		const sentText = mockSendPlainText.mock.calls[0][2] as string;
		expect(sentText).toContain("Renamed");
		expect(sentText).toContain("Morning Briefing");
		expect(sentText).toContain("Daily Digest");
	});

	it("rename with conflicting name returns guidance", async () => {
		const agentA = { id: 1, name: "Morning Briefing", enabled: 1 };
		const agentB = { id: 2, name: "Daily Digest", enabled: 1 };

		mockParseIntent.mockResolvedValueOnce({
			action: "rename",
			agentName: "Morning Briefing",
			scheduleInput: null,
			taskDescription: null,
			newName: "Daily Digest",
		});

		const { handleTelegramMessage } = await import("../src/services/telegram-commands.js");
		const db = createMockDb([agentA, agentB]);
		// First get: findAgentByName finds agentA
		db._mockGet.mockReturnValueOnce(agentA);
		// Second get: findAgentByName finds agentB (conflict)
		db._mockGet.mockReturnValueOnce(agentB);

		await handleTelegramMessage(makeMessage("rename Morning Briefing to Daily Digest"), db as never);

		const sentText = mockSendPlainText.mock.calls[0][2] as string;
		expect(sentText).toContain("already taken");
	});

	it("rename with missing fields returns guidance", async () => {
		mockParseIntent.mockResolvedValueOnce({
			action: "rename",
			agentName: null,
			scheduleInput: null,
			taskDescription: null,
			newName: null,
		});

		const { handleTelegramMessage } = await import("../src/services/telegram-commands.js");
		const db = createMockDb([]);

		await handleTelegramMessage(makeMessage("rename something"), db as never);

		const sentText = mockSendPlainText.mock.calls[0][2] as string;
		expect(sentText).toContain("specify current and new name");
	});
});
