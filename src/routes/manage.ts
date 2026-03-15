import { Hono } from "hono";
import { html } from "hono/html";

/**
 * Factory function to create the management UI route.
 * Serves a single-page HTML dashboard at GET /manage.
 */
export function createManageRoute(): Hono {
	const app = new Hono();

	app.get("/", (c) => {
		const page = html`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Schedoodle - Agent Manager</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
	--bg:#f8f9fa;--surface:#fff;--border:#dee2e6;--text:#212529;
	--text-muted:#6c757d;--primary:#4263eb;--primary-hover:#364fc7;
	--danger:#e03131;--danger-hover:#c92a2a;--success:#2f9e44;
	--warning:#e8590c;--radius:6px;--shadow:0 1px 3px rgba(0,0,0,.08);
}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
	background:var(--bg);color:var(--text);line-height:1.5}
.container{max-width:960px;margin:0 auto;padding:24px 16px}
h1{font-size:1.5rem;font-weight:600;margin-bottom:24px;display:flex;align-items:center;gap:8px}
h1 span{color:var(--primary)}

/* Card */
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
	padding:20px;margin-bottom:16px;box-shadow:var(--shadow)}
.card h2{font-size:1.1rem;font-weight:600;margin-bottom:16px}

/* Form */
.form-group{margin-bottom:14px}
.form-group label{display:block;font-size:.85rem;font-weight:500;margin-bottom:4px;color:var(--text-muted)}
.form-group input,.form-group textarea,.form-group select{
	width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius);
	font-size:.9rem;font-family:inherit;background:var(--surface);color:var(--text)}
.form-group textarea{resize:vertical;min-height:64px}
.form-group input:focus,.form-group textarea:focus,.form-group select:focus{
	outline:none;border-color:var(--primary);box-shadow:0 0 0 2px rgba(66,99,235,.15)}
.form-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.form-hint{font-size:.75rem;color:var(--text-muted);margin-top:2px}

/* Buttons */
button{cursor:pointer;font-family:inherit;font-size:.85rem;border:none;border-radius:var(--radius);
	padding:7px 14px;font-weight:500;transition:background .15s}
.btn-primary{background:var(--primary);color:#fff}
.btn-primary:hover{background:var(--primary-hover)}
.btn-primary:disabled{opacity:.6;cursor:not-allowed}
.btn-danger{background:var(--danger);color:#fff}
.btn-danger:hover{background:var(--danger-hover)}
.btn-outline{background:transparent;border:1px solid var(--border);color:var(--text)}
.btn-outline:hover{background:var(--bg)}
.btn-success{background:var(--success);color:#fff}
.btn-success:hover{background:#278f3a}
.btn-warning{background:var(--warning);color:#fff}
.btn-warning:hover{background:#d14b07}
.btn-sm{padding:4px 10px;font-size:.8rem}
.btn-group{display:flex;gap:6px;flex-wrap:wrap}

/* Agent list */
.agent-item{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
	padding:16px;margin-bottom:10px;box-shadow:var(--shadow)}
.agent-header{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.agent-name{font-weight:600;font-size:1rem}
.agent-meta{font-size:.8rem;color:var(--text-muted);margin-top:6px}
.agent-meta span{margin-right:16px}
.agent-actions{margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;align-items:center}

/* Toggle switch */
.toggle{position:relative;display:inline-block;width:40px;height:22px}
.toggle input{opacity:0;width:0;height:0}
.toggle .slider{position:absolute;cursor:pointer;inset:0;background:#adb5bd;border-radius:22px;
	transition:background .2s}
.toggle .slider::before{content:"";position:absolute;height:16px;width:16px;left:3px;bottom:3px;
	background:#fff;border-radius:50%;transition:transform .2s}
.toggle input:checked+.slider{background:var(--success)}
.toggle input:checked+.slider::before{transform:translateX(18px)}

/* Status badge */
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:.75rem;font-weight:500}
.badge-enabled{background:#d3f9d8;color:#2b8a3e}
.badge-disabled{background:#ffe3e3;color:#c92a2a}

/* Execution result */
.exec-result{margin-top:10px;padding:12px;border-radius:var(--radius);font-size:.85rem;
	border:1px solid var(--border);background:var(--bg)}
.exec-result.success{border-color:#b2f2bb;background:#ebfbee}
.exec-result.failure{border-color:#ffc9c9;background:#fff5f5}
.exec-result pre{white-space:pre-wrap;word-break:break-word;margin-top:6px;font-size:.8rem}
.exec-result strong{display:block;margin-bottom:4px}

/* Modal overlay */
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;
	align-items:center;justify-content:center;z-index:100;padding:16px}
.modal{background:var(--surface);border-radius:var(--radius);padding:24px;width:100%;
	max-width:560px;max-height:90vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.15)}
.modal h2{margin-bottom:16px}
.modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}

/* Empty state */
.empty{text-align:center;padding:40px 20px;color:var(--text-muted)}
.empty p{margin-top:8px}

/* Loading */
.loading{color:var(--text-muted);font-size:.85rem;padding:12px}
.spinner{display:inline-block;width:14px;height:14px;border:2px solid var(--border);
	border-top-color:var(--primary);border-radius:50%;animation:spin .6s linear infinite;
	vertical-align:middle;margin-right:6px}
@keyframes spin{to{transform:rotate(360deg)}}

/* Responsive */
@media(max-width:600px){.form-row{grid-template-columns:1fr}.agent-header{flex-direction:column;align-items:flex-start}}
</style>
</head>
<body>
<div class="container">
	<h1><span>Schedoodle</span> Agent Manager</h1>

	<!-- Create Agent Form -->
	<div class="card" id="create-card">
		<h2>Create Agent</h2>
		<form id="create-form">
			<div class="form-group">
				<label for="c-name">Name</label>
				<input type="text" id="c-name" required maxlength="100" placeholder="e.g. Morning Briefing">
			</div>
			<div class="form-group">
				<label for="c-task">Task Description</label>
				<textarea id="c-task" required placeholder="e.g. Summarise top tech news from HN"></textarea>
			</div>
			<div class="form-group">
				<label for="c-cron">Schedule</label>
				<input type="text" id="c-cron" required maxlength="500" placeholder="e.g. every weekday at 9am">
				<div class="form-hint">Cron expression or natural language (e.g. "every weekday at 9am", "0 9 * * 1-5")</div>
			</div>
			<div class="form-row">
				<div class="form-group">
					<label for="c-prompt">System Prompt (optional)</label>
					<textarea id="c-prompt" placeholder="e.g. Be concise. Focus on AI."></textarea>
				</div>
				<div class="form-group">
					<label for="c-model">Model (optional)</label>
					<input type="text" id="c-model" placeholder="e.g. claude-sonnet-4-20250514">
				</div>
			</div>
			<button type="submit" class="btn-primary" id="create-btn">Create Agent</button>
		</form>
	</div>

	<!-- Agent List -->
	<div class="card">
		<h2>Agents</h2>
		<div id="agent-list"><div class="loading"><span class="spinner"></span>Loading agents...</div></div>
	</div>
</div>

<!-- Edit Modal (hidden) -->
<div class="modal-overlay" id="edit-overlay" style="display:none">
	<div class="modal">
		<h2>Edit Agent</h2>
		<form id="edit-form">
			<input type="hidden" id="e-id">
			<div class="form-group">
				<label for="e-name">Name</label>
				<input type="text" id="e-name" required maxlength="100">
			</div>
			<div class="form-group">
				<label for="e-task">Task Description</label>
				<textarea id="e-task" required></textarea>
			</div>
			<div class="form-group">
				<label for="e-cron">Schedule</label>
				<input type="text" id="e-cron" required maxlength="500">
				<div class="form-hint">Cron expression or natural language</div>
			</div>
			<div class="form-row">
				<div class="form-group">
					<label for="e-prompt">System Prompt</label>
					<textarea id="e-prompt"></textarea>
				</div>
				<div class="form-group">
					<label for="e-model">Model</label>
					<input type="text" id="e-model">
				</div>
			</div>
			<div class="modal-actions">
				<button type="button" class="btn-outline" onclick="closeEditModal()">Cancel</button>
				<button type="submit" class="btn-primary" id="edit-btn">Save Changes</button>
			</div>
		</form>
	</div>
</div>

<script>
const API = '/agents';
let agents = [];

// --- API helpers ---
async function api(path, opts = {}) {
	const res = await fetch(path, {
		headers: { 'Content-Type': 'application/json', ...opts.headers },
		...opts,
	});
	if (res.status === 204) return null;
	const data = await res.json();
	if (!res.ok) throw new Error(data.error || data.message || 'Request failed');
	return data;
}

// --- Load agents ---
async function loadAgents() {
	try {
		agents = await api(API);
		renderAgents();
	} catch (err) {
		document.getElementById('agent-list').innerHTML =
			'<div class="empty"><p>Failed to load agents: ' + escapeHtml(err.message) + '</p></div>';
	}
}

// --- Render agent list ---
function renderAgents() {
	const el = document.getElementById('agent-list');
	if (!agents.length) {
		el.innerHTML = '<div class="empty"><p>No agents yet. Create one above.</p></div>';
		return;
	}
	el.innerHTML = agents.map(a => {
		const enabled = a.enabled;
		const badgeClass = enabled ? 'badge-enabled' : 'badge-disabled';
		const badgeText = enabled ? 'Enabled' : 'Disabled';
		const nextRun = a.nextRunAt ? new Date(a.nextRunAt).toLocaleString() : 'N/A';
		const lastRun = a.lastRunAt ? new Date(a.lastRunAt).toLocaleString() : 'Never';
		return '<div class="agent-item" id="agent-' + a.id + '">' +
			'<div class="agent-header">' +
				'<div>' +
					'<span class="agent-name">' + escapeHtml(a.name) + '</span> ' +
					'<span class="badge ' + badgeClass + '">' + badgeText + '</span>' +
				'</div>' +
				'<label class="toggle" title="' + (enabled ? 'Disable' : 'Enable') + ' agent">' +
					'<input type="checkbox" ' + (enabled ? 'checked' : '') +
					' onchange="toggleAgent(' + a.id + ', this.checked)">' +
					'<span class="slider"></span>' +
				'</label>' +
			'</div>' +
			'<div class="agent-meta">' +
				'<span>Schedule: ' + escapeHtml(a.cronSchedule) + '</span>' +
				'<span>Next: ' + escapeHtml(nextRun) + '</span>' +
				'<span>Last: ' + escapeHtml(lastRun) + '</span>' +
				(a.model ? '<span>Model: ' + escapeHtml(a.model) + '</span>' : '') +
			'</div>' +
			'<div class="agent-meta">' +
				'<span>Task: ' + escapeHtml(truncate(a.taskDescription, 120)) + '</span>' +
			'</div>' +
			'<div class="agent-actions">' +
				'<button class="btn-primary btn-sm" onclick="runAgent(' + a.id + ')">Run Now</button>' +
				'<button class="btn-outline btn-sm" onclick="openEditModal(' + a.id + ')">Edit</button>' +
				'<button class="btn-danger btn-sm" onclick="deleteAgent(' + a.id +
				', ' + escapeAttr(JSON.stringify(a.name)) + ')">Delete</button>' +
			'</div>' +
			'<div id="exec-result-' + a.id + '"></div>' +
		'</div>';
	}).join('');
}

// --- Create agent ---
document.getElementById('create-form').addEventListener('submit', async (e) => {
	e.preventDefault();
	const btn = document.getElementById('create-btn');
	btn.disabled = true;
	btn.textContent = 'Creating...';
	try {
		const body = {
			name: document.getElementById('c-name').value.trim(),
			taskDescription: document.getElementById('c-task').value.trim(),
			cronSchedule: document.getElementById('c-cron').value.trim(),
		};
		const prompt = document.getElementById('c-prompt').value.trim();
		const model = document.getElementById('c-model').value.trim();
		if (prompt) body.systemPrompt = prompt;
		if (model) body.model = model;

		await api(API, { method: 'POST', body: JSON.stringify(body) });
		document.getElementById('create-form').reset();
		await loadAgents();
	} catch (err) {
		alert('Error creating agent: ' + err.message);
	} finally {
		btn.disabled = false;
		btn.textContent = 'Create Agent';
	}
});

// --- Toggle enable/disable ---
async function toggleAgent(id, enabled) {
	try {
		await api(API + '/' + id, {
			method: 'PATCH',
			body: JSON.stringify({ enabled }),
		});
		await loadAgents();
	} catch (err) {
		alert('Error toggling agent: ' + err.message);
		await loadAgents();
	}
}

// --- Delete agent ---
async function deleteAgent(id, name) {
	if (!confirm('Delete agent "' + name + '"? This cannot be undone.')) return;
	try {
		await api(API + '/' + id, { method: 'DELETE' });
		await loadAgents();
	} catch (err) {
		alert('Error deleting agent: ' + err.message);
	}
}

// --- Run agent ---
async function runAgent(id) {
	const el = document.getElementById('exec-result-' + id);
	el.innerHTML = '<div class="loading"><span class="spinner"></span>Executing agent...</div>';
	try {
		const result = await api(API + '/' + id + '/execute', { method: 'POST' });
		if (result.status === 'success') {
			const r = result.result || {};
			el.innerHTML = '<div class="exec-result success">' +
				'<strong>Execution succeeded</strong>' +
				(r.summary ? '<p>' + escapeHtml(r.summary) + '</p>' : '') +
				(r.details ? '<pre>' + escapeHtml(r.details) + '</pre>' : '') +
				(result.durationMs ? '<div class="form-hint">Duration: ' + result.durationMs + 'ms</div>' : '') +
			'</div>';
		} else {
			el.innerHTML = '<div class="exec-result failure">' +
				'<strong>Execution failed</strong>' +
				'<pre>' + escapeHtml(result.error || 'Unknown error') + '</pre>' +
			'</div>';
		}
	} catch (err) {
		el.innerHTML = '<div class="exec-result failure">' +
			'<strong>Execution failed</strong>' +
			'<pre>' + escapeHtml(err.message) + '</pre>' +
		'</div>';
	}
	await loadAgents();
}

// --- Edit modal ---
function openEditModal(id) {
	const agent = agents.find(a => a.id === id);
	if (!agent) return;
	document.getElementById('e-id').value = agent.id;
	document.getElementById('e-name').value = agent.name;
	document.getElementById('e-task').value = agent.taskDescription;
	document.getElementById('e-cron').value = agent.cronSchedule;
	document.getElementById('e-prompt').value = agent.systemPrompt || '';
	document.getElementById('e-model').value = agent.model || '';
	document.getElementById('edit-overlay').style.display = 'flex';
}

function closeEditModal() {
	document.getElementById('edit-overlay').style.display = 'none';
}

document.getElementById('edit-overlay').addEventListener('click', (e) => {
	if (e.target === document.getElementById('edit-overlay')) closeEditModal();
});

document.getElementById('edit-form').addEventListener('submit', async (e) => {
	e.preventDefault();
	const btn = document.getElementById('edit-btn');
	btn.disabled = true;
	btn.textContent = 'Saving...';
	const id = document.getElementById('e-id').value;
	try {
		const body = {
			name: document.getElementById('e-name').value.trim(),
			taskDescription: document.getElementById('e-task').value.trim(),
			cronSchedule: document.getElementById('e-cron').value.trim(),
			systemPrompt: document.getElementById('e-prompt').value.trim() || undefined,
			model: document.getElementById('e-model').value.trim() || undefined,
		};
		await api(API + '/' + id, { method: 'PATCH', body: JSON.stringify(body) });
		closeEditModal();
		await loadAgents();
	} catch (err) {
		alert('Error updating agent: ' + err.message);
	} finally {
		btn.disabled = false;
		btn.textContent = 'Save Changes';
	}
});

// --- Helpers ---
function escapeHtml(str) {
	const div = document.createElement('div');
	div.textContent = String(str);
	return div.innerHTML;
}

function escapeAttr(str) {
	return JSON.stringify(str);
}

function truncate(str, max) {
	return str.length > max ? str.slice(0, max) + '...' : str;
}

// --- Init ---
loadAgents();
</script>
</body>
</html>`;

		return c.html(page);
	});

	return app;
}
