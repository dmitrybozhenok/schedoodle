import { Resend } from "resend";
import { env } from "../config/env.js";
import type { AgentOutput } from "../schemas/agent-output.js";

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

function buildEmailHtml(
	agentName: string,
	executedAt: string,
	output: AgentOutput,
): string {
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

export async function sendNotification(
	agentName: string,
	executedAt: string,
	output: AgentOutput,
): Promise<NotifyResult> {
	if (
		!env.RESEND_API_KEY ||
		!env.NOTIFICATION_EMAIL ||
		!env.NOTIFICATION_FROM
	) {
		return { status: "skipped" };
	}

	try {
		const resend = new Resend(env.RESEND_API_KEY);
		const html = buildEmailHtml(agentName, executedAt, output);

		const truncatedSummary =
			output.summary.length > 80
				? `${output.summary.slice(0, 80)}...`
				: output.summary;
		const subject = `[Schedoodle] ${agentName} \u2014 ${truncatedSummary}`;

		const { error } = await resend.emails.send({
			from: env.NOTIFICATION_FROM,
			to: env.NOTIFICATION_EMAIL,
			subject,
			html,
		});

		if (error) {
			console.error(
				`[notify] Failed to send email for ${agentName}: ${error.message}`,
			);
			return { status: "failed", error: error.message };
		}

		return { status: "sent" };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[notify] Unexpected error for ${agentName}: ${message}`);
		return { status: "failed", error: message };
	}
}
