import { Hono } from "hono";

/**
 * Factory function to create the dashboard route.
 * Serves a single-page HTML dashboard with inline CSS and vanilla JS.
 */
export function createDashboardRoute(): Hono {
	const app = new Hono();

	app.get("/", (c) => {
		return c.html(dashboardHtml());
	});

	return app;
}

function dashboardHtml(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Schedoodle Dashboard</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#f5f6f8;color:#1a1a2e;line-height:1.5;padding:0}
a{color:#4361ee;text-decoration:none}
header{background:#1a1a2e;color:#fff;padding:16px 24px;display:flex;align-items:center;justify-content:space-between}
header h1{font-size:20px;font-weight:600;letter-spacing:.3px}
header .meta{font-size:13px;color:#a0a4b8}
.container{max-width:1100px;margin:0 auto;padding:20px 24px}

/* Summary bar */
.summary{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:24px}
.summary .card{flex:1;min-width:140px;background:#fff;border-radius:8px;padding:16px 20px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.summary .card .label{font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;margin-bottom:4px}
.summary .card .value{font-size:28px;font-weight:700}
.summary .card .value.green{color:#16a34a}
.summary .card .value.red{color:#dc2626}
.summary .card .value.blue{color:#4361ee}
.summary .card .value.gray{color:#6b7280}

/* Agent table */
.agents-section h2{font-size:16px;font-weight:600;margin-bottom:12px;color:#374151}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)}
th{text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;padding:12px 16px;border-bottom:2px solid #e5e7eb;background:#fafafa}
td{padding:12px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;vertical-align:middle}
tr.agent-row{cursor:pointer;transition:background .15s}
tr.agent-row:hover{background:#f9fafb}
tr.agent-row.expanded{background:#f0f4ff}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:600}
.badge.enabled{background:#dcfce7;color:#166534}
.badge.disabled{background:#fee2e2;color:#991b1b}
.badge.success{background:#dcfce7;color:#166534}
.badge.failure{background:#fee2e2;color:#991b1b}
.badge.running{background:#dbeafe;color:#1e40af}
.badge.none{background:#f3f4f6;color:#6b7280}
.time{color:#6b7280;font-size:13px}

/* Execution history (expanded) */
tr.exec-row{display:none}
tr.exec-row.visible{display:table-row}
tr.exec-row td{padding:0}
.exec-panel{background:#f9fafb;padding:12px 16px 16px}
.exec-panel h3{font-size:13px;font-weight:600;margin-bottom:8px;color:#374151}
.exec-table{width:100%;border-collapse:collapse;font-size:13px}
.exec-table th{font-size:11px;padding:6px 10px;background:#f0f0f0;border-bottom:1px solid #e5e7eb}
.exec-table td{padding:6px 10px;border-bottom:1px solid #f0f0f0}
.exec-table .snippet{max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#374151}
.empty{color:#9ca3af;font-style:italic;padding:12px 0}

/* Refresh indicator */
.refresh-bar{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.refresh-bar .countdown{font-size:12px;color:#9ca3af}
.refresh-bar button{padding:4px 12px;font-size:12px;border:1px solid #d1d5db;border-radius:4px;background:#fff;cursor:pointer;color:#374151}
.refresh-bar button:hover{background:#f3f4f6}

/* Loading / error */
.loading{text-align:center;padding:40px;color:#9ca3af}
.error-banner{background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:14px}
</style>
</head>
<body>
<header>
	<h1>Schedoodle</h1>
	<div class="meta" id="header-meta">Dashboard</div>
</header>
<div class="container">
	<div id="error-container"></div>
	<div class="summary" id="summary">
		<div class="card"><div class="label">Total Agents</div><div class="value blue" id="s-total">--</div></div>
		<div class="card"><div class="label">Enabled</div><div class="value green" id="s-enabled">--</div></div>
		<div class="card"><div class="label">Disabled</div><div class="value gray" id="s-disabled">--</div></div>
		<div class="card"><div class="label">Recent Successes (24h)</div><div class="value green" id="s-success">--</div></div>
		<div class="card"><div class="label">Recent Failures (24h)</div><div class="value red" id="s-failure">--</div></div>
	</div>
	<div class="agents-section">
		<div class="refresh-bar">
			<h2>Agents</h2>
			<div>
				<span class="countdown" id="countdown"></span>
				<button onclick="refresh()">Refresh</button>
			</div>
		</div>
		<div id="agents-container"><div class="loading">Loading...</div></div>
	</div>
</div>
<script>
(function(){
const REFRESH_INTERVAL = 30;
let agents = [];
let health = null;
let expandedId = null;
let execCache = {};
let secondsLeft = REFRESH_INTERVAL;
let timer = null;

function formatTime(iso) {
	if (!iso) return '<span class="time">--</span>';
	const d = new Date(iso);
	const now = new Date();
	const diff = now - d;
	if (diff < 60000) return '<span class="time">just now</span>';
	if (diff < 3600000) return '<span class="time">' + Math.floor(diff/60000) + 'm ago</span>';
	if (diff < 86400000) return '<span class="time">' + Math.floor(diff/3600000) + 'h ago</span>';
	return '<span class="time">' + d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) + '</span>';
}

function formatFutureTime(iso) {
	if (!iso) return '<span class="time">--</span>';
	const d = new Date(iso);
	const now = new Date();
	const diff = d - now;
	if (diff < 0) return '<span class="time">overdue</span>';
	if (diff < 60000) return '<span class="time">in &lt;1m</span>';
	if (diff < 3600000) return '<span class="time">in ' + Math.floor(diff/60000) + 'm</span>';
	if (diff < 86400000) return '<span class="time">in ' + Math.floor(diff/3600000) + 'h ' + Math.floor((diff%3600000)/60000) + 'm</span>';
	return '<span class="time">' + d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) + '</span>';
}

function formatDuration(ms) {
	if (ms == null) return '--';
	if (ms < 1000) return ms + 'ms';
	return (ms / 1000).toFixed(1) + 's';
}

function getLastExecStatus(agentId) {
	const execs = execCache[agentId];
	if (!execs || execs.length === 0) return 'none';
	return execs[0].status;
}

function getSnippet(exec) {
	if (exec.error) return exec.error;
	if (exec.result) {
		try {
			const r = typeof exec.result === 'string' ? JSON.parse(exec.result) : exec.result;
			return r.summary || r.details || JSON.stringify(r).slice(0, 100);
		} catch { return String(exec.result).slice(0, 100); }
	}
	return '--';
}

function renderSummary() {
	const total = agents.length;
	const enabled = agents.filter(a => a.enabled).length;
	document.getElementById('s-total').textContent = total;
	document.getElementById('s-enabled').textContent = enabled;
	document.getElementById('s-disabled').textContent = total - enabled;
	if (health) {
		document.getElementById('s-success').textContent = health.recentExecutions.success;
		document.getElementById('s-failure').textContent = health.recentExecutions.failure;
	}
}

function renderAgents() {
	if (agents.length === 0) {
		document.getElementById('agents-container').innerHTML = '<div class="empty">No agents configured.</div>';
		return;
	}
	let html = '<table><thead><tr><th>Name</th><th>Status</th><th>Schedule</th><th>Last Run</th><th>Last Result</th><th>Next Run</th></tr></thead><tbody>';
	for (const a of agents) {
		const lastStatus = getLastExecStatus(a.id);
		const isExpanded = expandedId === a.id;
		html += '<tr class="agent-row' + (isExpanded ? ' expanded' : '') + '" data-id="' + a.id + '">';
		html += '<td><strong>' + esc(a.name) + '</strong></td>';
		html += '<td><span class="badge ' + (a.enabled ? 'enabled' : 'disabled') + '">' + (a.enabled ? 'Enabled' : 'Disabled') + '</span></td>';
		html += '<td class="time">' + esc(a.cronSchedule) + '</td>';
		html += '<td>' + formatTime(a.lastRunAt) + '</td>';
		html += '<td><span class="badge ' + lastStatus + '">' + lastStatus + '</span></td>';
		html += '<td>' + formatFutureTime(a.nextRunAt) + '</td>';
		html += '</tr>';
		html += '<tr class="exec-row' + (isExpanded ? ' visible' : '') + '" id="exec-' + a.id + '"><td colspan="6">';
		html += renderExecPanel(a.id);
		html += '</td></tr>';
	}
	html += '</tbody></table>';
	document.getElementById('agents-container').innerHTML = html;
	document.querySelectorAll('.agent-row').forEach(row => {
		row.addEventListener('click', function(){ toggleAgent(Number(this.dataset.id)); });
	});
}

function renderExecPanel(agentId) {
	const execs = execCache[agentId];
	if (!execs) return '<div class="exec-panel"><div class="empty">Loading execution history...</div></div>';
	if (execs.length === 0) return '<div class="exec-panel"><div class="empty">No executions yet.</div></div>';
	let html = '<div class="exec-panel"><h3>Execution History</h3><table class="exec-table"><thead><tr><th>Time</th><th>Status</th><th>Duration</th><th>Summary</th></tr></thead><tbody>';
	for (const e of execs.slice(0, 20)) {
		html += '<tr>';
		html += '<td class="time">' + new Date(e.startedAt).toLocaleString() + '</td>';
		html += '<td><span class="badge ' + e.status + '">' + e.status + '</span></td>';
		html += '<td>' + formatDuration(e.durationMs) + '</td>';
		html += '<td><span class="snippet" title="' + esc(getSnippet(e)) + '">' + esc(getSnippet(e)) + '</span></td>';
		html += '</tr>';
	}
	html += '</tbody></table></div>';
	return html;
}

function esc(s) {
	if (s == null) return '';
	const d = document.createElement('div');
	d.textContent = String(s);
	return d.innerHTML;
}

async function toggleAgent(id) {
	if (expandedId === id) {
		expandedId = null;
		renderAgents();
		return;
	}
	expandedId = id;
	if (!execCache[id]) {
		renderAgents();
		await fetchExecs(id);
	}
	renderAgents();
}

async function fetchExecs(id) {
	try {
		const res = await fetch('/agents/' + id + '/executions?limit=20');
		if (res.ok) execCache[id] = await res.json();
		else execCache[id] = [];
	} catch {
		execCache[id] = [];
	}
}

async function fetchAll() {
	try {
		const [agentsRes, healthRes] = await Promise.all([
			fetch('/agents'),
			fetch('/health')
		]);
		if (agentsRes.ok) agents = await agentsRes.json();
		if (healthRes.ok) health = await healthRes.json();
		document.getElementById('error-container').innerHTML = '';

		const execPromises = agents.map(a => fetchExecs(a.id));
		await Promise.all(execPromises);
	} catch (err) {
		document.getElementById('error-container').innerHTML = '<div class="error-banner">Failed to fetch data: ' + esc(err.message) + '</div>';
	}
	renderSummary();
	renderAgents();
	updateMeta();
}

function updateMeta() {
	const now = new Date();
	document.getElementById('header-meta').textContent = 'Last updated: ' + now.toLocaleTimeString();
}

function startCountdown() {
	secondsLeft = REFRESH_INTERVAL;
	if (timer) clearInterval(timer);
	timer = setInterval(function(){
		secondsLeft--;
		document.getElementById('countdown').textContent = 'Auto-refresh in ' + secondsLeft + 's';
		if (secondsLeft <= 0) {
			refresh();
		}
	}, 1000);
}

window.refresh = async function() {
	await fetchAll();
	startCountdown();
};

fetchAll().then(startCountdown);
})();
</script>
</body>
</html>`;
}
