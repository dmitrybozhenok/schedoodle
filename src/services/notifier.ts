import nodemailer from "nodemailer";
import { Resend } from "resend";
import { env } from "../config/env.js";
import type { AgentOutput } from "../schemas/agent-output.js";
import { escapeMdV2, escapeMdV2CodeBlock, sendTelegramMessage } from "./telegram.js";

export interface NotifyResult {
	status: "sent" | "failed" | "skipped";
	error?: string;
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export function buildEmailHtml(agentName: string, executedAt: string, output: AgentOutput): string {
	const timestamp = new Date(executedAt).toLocaleString();
	const dataSection = output.data
		? `<h2 style="font-size:16px;margin:0 0 8px;">Data</h2><pre style="background:#f4f4f4;padding:12px;border-radius:4px;overflow-x:auto;">${escapeHtml(JSON.stringify(output.data, null, 2))}</pre>`
		: "";

	return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="border-bottom:2px solid #333;padding-bottom:12px;margin-bottom:20px;">
    <h1 style="margin:0;font-size:20px;">${escapeHtml(agentName)}</h1>
    <p style="margin:4px 0 0;color:#666;font-size:14px;">${timestamp}</p>
  </div>
  <div style="margin-bottom:20px;">
    <h2 style="font-size:16px;margin:0 0 8px;">Summary</h2>
    <p style="margin:0;">${escapeHtml(output.summary)}</p>
  </div>
  <div style="margin-bottom:20px;">
    <h2 style="font-size:16px;margin:0 0 8px;">Details</h2>
    <p style="margin:0;white-space:pre-wrap;">${escapeHtml(output.details)}</p>
  </div>
  ${dataSection}
</body>
</html>`;
}

function buildFailureEmailHtml(agentName: string, executedAt: string, errorMsg: string): string {
	const timestamp = new Date(executedAt).toLocaleString();

	return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="border-bottom:2px solid #c0392b;padding-bottom:12px;margin-bottom:20px;">
    <h1 style="margin:0;font-size:20px;color:#c0392b;">FAILED: ${escapeHtml(agentName)}</h1>
    <p style="margin:4px 0 0;color:#666;font-size:14px;">${timestamp}</p>
  </div>
  <div style="margin-bottom:20px;">
    <h2 style="font-size:16px;margin:0 0 8px;">Error</h2>
    <pre style="background:#fdf2f2;padding:12px;border-radius:4px;border-left:4px solid #c0392b;overflow-x:auto;white-space:pre-wrap;">${escapeHtml(errorMsg)}</pre>
  </div>
</body>
</html>`;
}

function buildSubject(agentName: string, summary: string): string {
	const truncated = summary.length > 80 ? `${summary.slice(0, 80)}...` : summary;
	return `[Schedoodle] ${agentName} \u2014 ${truncated}`;
}

async function sendViaSmtp(
	to: string,
	from: string,
	subject: string,
	html: string,
): Promise<NotifyResult> {
	const transport = nodemailer.createTransport({
		host: env.SMTP_HOST,
		port: env.SMTP_PORT ?? 1025,
		secure: false,
	});

	try {
		await transport.sendMail({ from, to, subject, html });
		return { status: "sent" };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[notify] SMTP error: ${message}`);
		return { status: "failed", error: message };
	}
}

async function sendViaResend(
	to: string,
	from: string,
	subject: string,
	html: string,
): Promise<NotifyResult> {
	const resend = new Resend(env.RESEND_API_KEY);
	const { error } = await resend.emails.send({ from, to, subject, html });

	if (error) {
		console.error(`[notify] Resend error: ${error.message}`);
		return { status: "failed", error: error.message };
	}
	return { status: "sent" };
}

export async function sendNotification(
	agentName: string,
	executedAt: string,
	output: AgentOutput,
): Promise<NotifyResult> {
	const useSmtp = env.SMTP_HOST;
	const useResend = env.RESEND_API_KEY;

	if (!env.NOTIFICATION_EMAIL || !env.NOTIFICATION_FROM) {
		return { status: "skipped" };
	}
	if (!useSmtp && !useResend) {
		return { status: "skipped" };
	}

	const html = buildEmailHtml(agentName, executedAt, output);
	const subject = buildSubject(agentName, output.summary);

	try {
		if (useSmtp) {
			return await sendViaSmtp(env.NOTIFICATION_EMAIL, env.NOTIFICATION_FROM, subject, html);
		}
		return await sendViaResend(env.NOTIFICATION_EMAIL, env.NOTIFICATION_FROM, subject, html);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[notify] Unexpected error for ${agentName}: ${message}`);
		return { status: "failed", error: message };
	}
}

export async function sendFailureNotification(
	agentName: string,
	executedAt: string,
	errorMsg: string,
): Promise<NotifyResult> {
	const useSmtp = env.SMTP_HOST;
	const useResend = env.RESEND_API_KEY;

	if (!env.NOTIFICATION_EMAIL || !env.NOTIFICATION_FROM) {
		return { status: "skipped" };
	}
	if (!useSmtp && !useResend) {
		return { status: "skipped" };
	}

	const html = buildFailureEmailHtml(agentName, executedAt, errorMsg);
	const subject = `[Schedoodle] FAILED: ${agentName}`;

	try {
		if (useSmtp) {
			return await sendViaSmtp(env.NOTIFICATION_EMAIL, env.NOTIFICATION_FROM, subject, html);
		}
		return await sendViaResend(env.NOTIFICATION_EMAIL, env.NOTIFICATION_FROM, subject, html);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[notify] Unexpected error for ${agentName} failure: ${message}`);
		return { status: "failed", error: message };
	}
}

// --- Telegram transport ---

const TELEGRAM_MAX_LENGTH = 3800;

export function buildTelegramMarkdown(
	agentName: string,
	executedAt: string,
	output: AgentOutput,
): string {
	const esc = escapeMdV2;
	const timestamp = new Date(executedAt).toLocaleString();

	const parts: string[] = [
		`*${esc(agentName)}*`,
		esc(timestamp),
		"",
		"*Summary*",
		esc(output.summary),
		"",
		"*Details*",
		esc(output.details),
	];

	if (output.data) {
		const dataStr =
			typeof output.data === "string" ? output.data : JSON.stringify(output.data, null, 2);
		parts.push("", "*Data*", `\`\`\`\n${escapeMdV2CodeBlock(dataStr)}\n\`\`\``);
	}

	let message = parts.join("\n");
	if (message.length > TELEGRAM_MAX_LENGTH) {
		message = `${message.slice(0, TELEGRAM_MAX_LENGTH)}\n\\.\\.\\. \\[truncated, see email for full output\\]`;
	}
	return message;
}

export function buildTelegramFailureMarkdown(
	agentName: string,
	executedAt: string,
	errorMsg: string,
): string {
	const esc = escapeMdV2;
	const timestamp = new Date(executedAt).toLocaleString();

	const parts: string[] = [
		`\u26a0\ufe0f *FAILED: ${esc(agentName)}*`,
		esc(timestamp),
		"",
		"*Error*",
		esc(errorMsg),
	];

	let message = parts.join("\n");
	if (message.length > TELEGRAM_MAX_LENGTH) {
		message = `${message.slice(0, TELEGRAM_MAX_LENGTH)}\n\\.\\.\\. \\[truncated, see email for full output\\]`;
	}
	return message;
}

async function sendViaTelegram(
	botToken: string,
	chatId: string,
	text: string,
): Promise<NotifyResult> {
	try {
		const result = await sendTelegramMessage(botToken, chatId, text);
		if (!result.ok) {
			console.error(`[notify] Telegram error: ${result.description}`);
			return { status: "failed", error: result.description };
		}
		return { status: "sent" };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[notify] Telegram error: ${message}`);
		return { status: "failed", error: message };
	}
}

export async function sendTelegramNotification(
	agentName: string,
	executedAt: string,
	output: AgentOutput,
): Promise<NotifyResult> {
	if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
		return { status: "skipped" };
	}

	try {
		const text = buildTelegramMarkdown(agentName, executedAt, output);
		return await sendViaTelegram(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, text);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[notify] Unexpected Telegram error for ${agentName}: ${message}`);
		return { status: "failed", error: message };
	}
}

export async function sendTelegramFailureNotification(
	agentName: string,
	executedAt: string,
	errorMsg: string,
): Promise<NotifyResult> {
	if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
		return { status: "skipped" };
	}

	try {
		const text = buildTelegramFailureMarkdown(agentName, executedAt, errorMsg);
		return await sendViaTelegram(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, text);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[notify] Unexpected Telegram error for ${agentName} failure: ${message}`);
		return { status: "failed", error: message };
	}
}
