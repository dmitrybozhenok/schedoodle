import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentOutput } from "../src/schemas/agent-output.js";

const mockResendSend = vi.fn();
vi.mock("resend", () => {
	return {
		Resend: class {
			emails = { send: mockResendSend };
		},
	};
});

const mockSmtpSend = vi.fn();
vi.mock("nodemailer", () => ({
	default: {
		createTransport: () => ({ sendMail: mockSmtpSend }),
	},
}));

const mockEnv: Record<string, string | number | undefined> = {};
vi.mock("../src/config/env.js", () => ({
	env: new Proxy(
		{},
		{
			get(_target, prop: string) {
				return mockEnv[prop];
			},
		},
	),
}));

function setEnv(overrides: Record<string, string | number | undefined> = {}) {
	for (const key of Object.keys(mockEnv)) {
		delete mockEnv[key];
	}
	Object.assign(mockEnv, overrides);
}

const baseOutput: AgentOutput = {
	summary: "3 key items found",
	details: "Found items A, B, and C in the report.",
};

const resendEnv = {
	RESEND_API_KEY: "re_test_123",
	NOTIFICATION_EMAIL: "user@example.com",
	NOTIFICATION_FROM: "Schedoodle <noreply@example.com>",
};

const smtpEnv = {
	SMTP_HOST: "localhost",
	SMTP_PORT: 1025,
	NOTIFICATION_EMAIL: "user@example.com",
	NOTIFICATION_FROM: "Schedoodle <noreply@example.com>",
};

describe("sendNotification", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setEnv();
	});

	it("skips when no email config is set", async () => {
		const { sendNotification } = await import("../src/services/notifier.js");
		const result = await sendNotification("Test Agent", "2026-03-14T10:00:00Z", baseOutput);
		expect(result.status).toBe("skipped");
	});

	it("skips when NOTIFICATION_EMAIL is missing", async () => {
		setEnv({ RESEND_API_KEY: "re_test_123", NOTIFICATION_FROM: "noreply@example.com" });
		const { sendNotification } = await import("../src/services/notifier.js");
		const result = await sendNotification("Test Agent", "2026-03-14T10:00:00Z", baseOutput);
		expect(result.status).toBe("skipped");
		expect(mockResendSend).not.toHaveBeenCalled();
	});

	it("skips when NOTIFICATION_FROM is missing", async () => {
		setEnv({ RESEND_API_KEY: "re_test_123", NOTIFICATION_EMAIL: "user@example.com" });
		const { sendNotification } = await import("../src/services/notifier.js");
		const result = await sendNotification("Test Agent", "2026-03-14T10:00:00Z", baseOutput);
		expect(result.status).toBe("skipped");
	});

	it("skips when no transport is configured", async () => {
		setEnv({
			NOTIFICATION_EMAIL: "user@example.com",
			NOTIFICATION_FROM: "noreply@example.com",
		});
		const { sendNotification } = await import("../src/services/notifier.js");
		const result = await sendNotification("Test Agent", "2026-03-14T10:00:00Z", baseOutput);
		expect(result.status).toBe("skipped");
	});

	describe("Resend transport", () => {
		it("sends email via Resend", async () => {
			setEnv(resendEnv);
			mockResendSend.mockResolvedValue({ data: { id: "msg_1" }, error: null });
			const { sendNotification } = await import("../src/services/notifier.js");
			const result = await sendNotification("Morning Briefing", "2026-03-14T10:00:00Z", baseOutput);
			expect(result.status).toBe("sent");
			expect(mockResendSend).toHaveBeenCalledOnce();
			const callArgs = mockResendSend.mock.calls[0][0];
			expect(callArgs.from).toBe("Schedoodle <noreply@example.com>");
			expect(callArgs.to).toBe("user@example.com");
			expect(callArgs.subject).toContain("[Schedoodle]");
			expect(callArgs.subject).toContain("Morning Briefing");
		});

		it("returns failed on Resend error", async () => {
			setEnv(resendEnv);
			mockResendSend.mockResolvedValue({
				data: null,
				error: { message: "domain not verified", name: "validation_error" },
			});
			const { sendNotification } = await import("../src/services/notifier.js");
			const result = await sendNotification("Test Agent", "2026-03-14T10:00:00Z", baseOutput);
			expect(result.status).toBe("failed");
			expect(result.error).toBe("domain not verified");
		});

		it("returns failed on unexpected Resend error", async () => {
			setEnv(resendEnv);
			mockResendSend.mockRejectedValue(new Error("network timeout"));
			const { sendNotification } = await import("../src/services/notifier.js");
			const result = await sendNotification("Test Agent", "2026-03-14T10:00:00Z", baseOutput);
			expect(result.status).toBe("failed");
			expect(result.error).toBe("network timeout");
		});
	});

	describe("SMTP transport", () => {
		it("sends email via SMTP", async () => {
			setEnv(smtpEnv);
			mockSmtpSend.mockResolvedValue({ messageId: "123" });
			const { sendNotification } = await import("../src/services/notifier.js");
			const result = await sendNotification("Morning Briefing", "2026-03-14T10:00:00Z", baseOutput);
			expect(result.status).toBe("sent");
			expect(mockSmtpSend).toHaveBeenCalledOnce();
			const callArgs = mockSmtpSend.mock.calls[0][0];
			expect(callArgs.from).toBe("Schedoodle <noreply@example.com>");
			expect(callArgs.to).toBe("user@example.com");
			expect(callArgs.subject).toContain("[Schedoodle]");
			expect(callArgs.subject).toContain("Morning Briefing");
		});

		it("returns failed on SMTP error", async () => {
			setEnv(smtpEnv);
			mockSmtpSend.mockRejectedValue(new Error("connection refused"));
			const { sendNotification } = await import("../src/services/notifier.js");
			const result = await sendNotification("Test Agent", "2026-03-14T10:00:00Z", baseOutput);
			expect(result.status).toBe("failed");
			expect(result.error).toBe("connection refused");
		});

		it("prefers SMTP over Resend when both configured", async () => {
			setEnv({ ...resendEnv, ...smtpEnv });
			mockSmtpSend.mockResolvedValue({ messageId: "123" });
			const { sendNotification } = await import("../src/services/notifier.js");
			const result = await sendNotification("Test Agent", "2026-03-14T10:00:00Z", baseOutput);
			expect(result.status).toBe("sent");
			expect(mockSmtpSend).toHaveBeenCalledOnce();
			expect(mockResendSend).not.toHaveBeenCalled();
		});
	});

	describe("email content", () => {
		it("subject truncates long summary", async () => {
			setEnv(resendEnv);
			mockResendSend.mockResolvedValue({ data: { id: "msg_2" }, error: null });
			const longSummary = "A".repeat(100);
			const { sendNotification } = await import("../src/services/notifier.js");
			await sendNotification("Test Agent", "2026-03-14T10:00:00Z", {
				...baseOutput,
				summary: longSummary,
			});
			const subject = mockResendSend.mock.calls[0][0].subject;
			expect(subject).toContain("...");
			expect(subject.length).toBeLessThan("[Schedoodle] Test Agent — ".length + 100);
		});

		it("HTML contains agent name and timestamp", async () => {
			setEnv(resendEnv);
			mockResendSend.mockResolvedValue({ data: { id: "msg_3" }, error: null });
			const { sendNotification } = await import("../src/services/notifier.js");
			await sendNotification("Morning Briefing", "2026-03-14T10:00:00Z", baseOutput);
			const html = mockResendSend.mock.calls[0][0].html;
			expect(html).toContain("Morning Briefing");
			expect(html).toContain("2026");
		});

		it("HTML escapes special characters", async () => {
			setEnv(resendEnv);
			mockResendSend.mockResolvedValue({ data: { id: "msg_4" }, error: null });
			const { sendNotification } = await import("../src/services/notifier.js");
			await sendNotification("Test Agent", "2026-03-14T10:00:00Z", {
				summary: '<script>alert("xss")</script>',
				details: "Details with <b>bold</b> & special chars",
			});
			const html = mockResendSend.mock.calls[0][0].html;
			expect(html).toContain("&lt;script&gt;");
			expect(html).not.toContain("<script>");
			expect(html).toContain("&amp;");
		});

		it("HTML includes data section when present", async () => {
			setEnv(resendEnv);
			mockResendSend.mockResolvedValue({ data: { id: "msg_5" }, error: null });
			const { sendNotification } = await import("../src/services/notifier.js");
			await sendNotification("Test Agent", "2026-03-14T10:00:00Z", {
				...baseOutput,
				data: { key: "val", count: 42 },
			});
			const html = mockResendSend.mock.calls[0][0].html;
			expect(html).toContain("Data");
			expect(html).toContain("&quot;key&quot;");
			expect(html).toContain("<pre");
		});

		it("HTML omits data section when absent", async () => {
			setEnv(resendEnv);
			mockResendSend.mockResolvedValue({ data: { id: "msg_6" }, error: null });
			const { sendNotification } = await import("../src/services/notifier.js");
			await sendNotification("Test Agent", "2026-03-14T10:00:00Z", baseOutput);
			const html = mockResendSend.mock.calls[0][0].html;
			expect(html).not.toContain(">Data<");
		});
	});
});
