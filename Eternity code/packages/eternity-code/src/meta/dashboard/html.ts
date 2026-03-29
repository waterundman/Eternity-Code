export function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Eternity Code</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0d1117;
    --surface: #161b22;
    --surface-2: #21262d;
    --border: #30363d;
    --text: #e6edf3;
    --text-muted: #8b949e;
    --primary: #58a6ff;
    --success: #3fb950;
    --warning: #d29922;
    --danger: #f85149;
    --accent: #bc8cff;
  }
  
  body {
    background: var(--bg);
    color: var(--text);
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    min-height: 100vh;
  }

  .layout { display: flex; flex-direction: column; min-height: 100vh; }
  .main { flex: 1; padding: 24px; overflow-y: auto; }
  
  .footer {
    background: var(--surface);
    border-top: 1px solid var(--border);
    padding: 12px 24px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .brand { font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
  .brand-icon { width: 24px; height: 24px; background: linear-gradient(135deg, var(--primary), var(--accent)); border-radius: 6px; }

  .hero {
    background: linear-gradient(135deg, rgba(88, 166, 255, 0.1), rgba(188, 140, 255, 0.1));
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 48px;
    text-align: center;
    margin-bottom: 32px;
  }
  .hero h1 { font-size: 28px; margin-bottom: 8px; }
  .hero p { color: var(--text-muted); margin-bottom: 24px; max-width: 600px; margin-left: auto; margin-right: auto; }
  .hero-actions { display: flex; gap: 12px; justify-content: center; }

  .workspace { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 32px; }
  .workspace-full { grid-column: 1 / -1; }

  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
  .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--border); }
  .card-title { font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 8px; }

  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 32px; }
  .stat { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
  .stat-label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .stat-value { font-size: 24px; font-weight: 700; }
  .stat-value.primary { color: var(--primary); }
  .stat-value.success { color: var(--success); }
  .stat-value.warning { color: var(--warning); }

  .req-list { display: flex; flex-direction: column; gap: 12px; }
  .req-item { background: var(--surface-2); border-radius: 8px; padding: 12px; }
  .req-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .req-id { font-weight: 600; font-size: 12px; color: var(--primary); }
  .req-coverage { font-size: 12px; font-weight: 600; }
  .req-bar { height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; margin-top: 8px; }
  .req-bar-fill { height: 100%; background: var(--success); transition: width 0.3s; }
  .req-text { font-size: 13px; color: var(--text-muted); }

  .constraint-list, .neg-list { display: flex; flex-direction: column; gap: 8px; }
  .constraint-item { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--surface-2); border-radius: 6px; font-size: 13px; }
  .neg-item { padding: 10px 12px; background: var(--surface-2); border-radius: 6px; border-left: 3px solid var(--danger); }
  .neg-text { font-size: 13px; margin-bottom: 4px; }
  .neg-reason { font-size: 11px; color: var(--text-muted); }

  .eval-list { display: flex; flex-direction: column; gap: 12px; }
  .eval-item { background: var(--surface-2); border-radius: 8px; padding: 12px; }
  .eval-header { display: flex; justify-content: space-between; margin-bottom: 8px; }
  .eval-name { font-weight: 500; }

  .btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 8px; border: none; cursor: pointer; font-size: 13px; font-weight: 500; transition: all 0.2s; }
  .btn-primary { background: var(--primary); color: #fff; }
  .btn-primary:hover { background: #4999ea; }
  .btn-success { background: var(--success); color: #fff; }
  .btn-success:hover { background: #4dc960; }
  .btn-danger { background: var(--danger); color: #fff; }
  .btn-ghost { background: transparent; border: 1px solid var(--border); color: var(--text); }
  .btn-ghost:hover { background: var(--surface-2); }
  .btn-sm { padding: 4px 10px; font-size: 12px; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .form-group { margin-bottom: 16px; }
  .form-label { display: block; font-size: 12px; font-weight: 500; color: var(--text-muted); margin-bottom: 6px; }
  .form-input, .form-select, .form-textarea { width: 100%; padding: 10px 12px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 14px; }
  .form-textarea { min-height: 100px; resize: vertical; font-family: inherit; }
  .form-input:focus, .form-select:focus, .form-textarea:focus { outline: none; border-color: var(--primary); }

  .empty { text-align: center; padding: 32px; color: var(--text-muted); }

  .model-bar { display: flex; align-items: center; gap: 12px; }
  .model-current { display: flex; align-items: center; gap: 8px; padding: 6px 12px; background: var(--surface-2); border-radius: 8px; }
  .model-badge { background: var(--primary); color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; }
  .model-name { font-size: 13px; font-weight: 500; }
  .usage-bar { display: flex; gap: 16px; font-size: 12px; color: var(--text-muted); }
  .usage-item { display: flex; align-items: center; gap: 4px; }
  .usage-value { font-weight: 600; color: var(--text); }

  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 1000; }
  .modal { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 24px; max-width: 800px; width: 90%; max-height: 85vh; overflow-y: auto; }
  .modal h2 { font-size: 20px; margin-bottom: 16px; }
  .modal-actions { display: flex; gap: 12px; justify-content: flex-end; margin-top: 20px; }

  .provider-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; margin-bottom: 20px; }
  .provider-item { background: var(--surface-2); border: 2px solid transparent; border-radius: 10px; padding: 16px 12px; text-align: center; cursor: pointer; transition: all 0.2s; }
  .provider-item:hover { border-color: var(--border); }
  .provider-item.selected { border-color: var(--primary); background: rgba(88, 166, 255, 0.1); }
  .provider-name { font-weight: 600; margin-bottom: 4px; }
  .provider-desc { font-size: 11px; color: var(--text-muted); }

  .model-list { max-height: 300px; overflow-y: auto; border: 1px solid var(--border); border-radius: 8px; }
  .model-option { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-bottom: 1px solid var(--border); cursor: pointer; }
  .model-option:last-child { border-bottom: none; }
  .model-option:hover { background: var(--surface-2); }
  .model-option.selected { background: rgba(88, 166, 255, 0.15); }
  .model-info { display: flex; flex-direction: column; }
  .model-id { font-weight: 500; }
  .model-context { font-size: 11px; color: var(--text-muted); }
  .model-cost { font-size: 11px; color: var(--text-muted); }

  .hidden { display: none !important; }

  .phase-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    margin-bottom: 24px;
  }
  .phase-dot { width: 12px; height: 12px; border-radius: 50%; }
  .phase-dot.idle { background: var(--text-muted); }
  .phase-dot.analyzing { background: var(--primary); animation: pulse 1s infinite; }
  .phase-dot.deciding { background: var(--warning); animation: pulse 1s infinite; }
  .phase-dot.executing { background: var(--success); animation: pulse 1s infinite; }
  .phase-dot.evaluating { background: var(--accent); animation: pulse 1s infinite; }
  .phase-dot.complete { background: var(--success); }
  .phase-text { font-weight: 500; }
  .phase-desc { font-size: 12px; color: var(--text-muted); margin-left: auto; }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .decision-cards { display: flex; flex-direction: column; gap: 16px; }
  .decision-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px;
    position: relative;
  }
  .decision-card.accepted { border-color: var(--success); background: rgba(63, 185, 80, 0.1); }
  .decision-card.rejected { border-color: var(--danger); background: rgba(248, 81, 73, 0.1); }
  .card-obj { font-weight: 600; margin-bottom: 8px; }
  .card-detail { font-size: 13px; color: var(--text-muted); margin-bottom: 4px; }
  .card-actions { display: flex; gap: 8px; margin-top: 12px; }

  .execution-plans { display: flex; flex-direction: column; gap: 16px; }
  .plan-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px;
  }
  .plan-card.ready { border-color: var(--success); }
  .plan-card.warning { border-color: var(--warning); }
  .plan-card.blocked { border-color: var(--danger); }
  .plan-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .plan-title { font-weight: 600; }
  .plan-status { font-size: 12px; padding: 4px 8px; border-radius: 4px; }
  .plan-status.ready { background: var(--success); color: #fff; }
  .plan-status.warning { background: var(--warning); color: #fff; }
  .plan-status.blocked { background: var(--danger); color: #fff; }
  .plan-tasks { margin-top: 12px; }
  .task-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    background: var(--surface-2);
    border-radius: 6px;
    margin-bottom: 8px;
  }
  .task-name { font-size: 13px; }
  .task-status { font-size: 11px; padding: 2px 6px; border-radius: 4px; }
  .task-status.pending { background: var(--border); }
  .task-status.running { background: var(--primary); color: #fff; animation: pulse 1s infinite; }
  .task-status.done { background: var(--success); color: #fff; }
  .task-status.failed { background: var(--danger); color: #fff; }
  .plan-actions { display: flex; gap: 8px; margin-top: 12px; }

  .task-status-list { display: flex; flex-direction: column; gap: 12px; }
  .task-status-item {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
  }
  .task-status-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .task-status-title { font-weight: 600; }
  .task-status-time { font-size: 11px; color: var(--text-muted); }
  .task-status-body { font-size: 13px; color: var(--text-muted); }
</style>
</head>
<body>
<div class="layout">
  <div class="main">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
      <div class="brand">
        <div class="brand-icon"></div>
        Eternity Code
      </div>
      <div class="usage-bar" id="usage-stats">
        <span class="usage-item">Tokens: <span class="usage-value" id="total-tokens">0</span></span>
        <span class="usage-item">Cost: $<span class="usage-value" id="total-cost">0.00</span></span>
      </div>
    </div>

    <div id="section-init" class="hero">
      <h1>Welcome to MetaDesign</h1>
      <p>Two agents (Plan & Build) work together automatically.<br>You define the goals, they execute the work.</p>
      <div class="hero-actions">
        <button class="btn btn-primary" onclick="showInitModal()">Get Started</button>
      </div>
    </div>

    <div id="section-workspace" class="hidden">
      <div class="phase-indicator">
        <div class="phase-dot" id="phase-dot"></div>
        <span class="phase-text" id="phase-text">Idle</span>
        <span class="phase-desc" id="phase-desc">Ready to start</span>
        <button class="btn btn-primary" id="start-loop-btn" onclick="startLoop()">Start Loop</button>
      </div>

      <div id="decision-section" class="hidden">
        <h3 style="margin-bottom:16px">Plan Agent Generated Cards</h3>
        <div id="decision-cards" class="decision-cards"></div>
        <div style="margin-top:16px;display:flex;gap:12px">
          <button class="btn btn-success" id="submit-decisions-btn" onclick="submitDecisions()">Submit Decisions</button>
        </div>
      </div>

      <div id="execution-section" class="hidden">
        <h3 style="margin-bottom:16px">Execution Plans</h3>
        <div id="execution-plans"></div>
        <div style="margin-top:16px;display:flex;gap:12px">
          <button class="btn btn-primary" onclick="executeAllPlans()">Execute All Plans</button>
          <button class="btn btn-success" onclick="autoExecute()">⚡ One-Click Execute</button>
        </div>
        <div id="auto-execute-status" style="margin-top:12px"></div>
      </div>

      <div id="task-status-section" class="hidden">
        <h3 style="margin-bottom:16px">Task Execution Status</h3>
        <div id="task-status-list"></div>
      </div>

      <div id="agent-tasks-section">
        <div class="card workspace-full" style="margin-top:24px">
          <div class="card-header">
            <div class="card-title">🤖 Agent Tasks</div>
            <button class="btn btn-ghost btn-sm" onclick="refresh()">Refresh</button>
          </div>
          <div id="agent-tasks-stats" style="margin-bottom:16px"></div>
          <div id="agent-tasks-list"></div>
        </div>
      </div>

      <div class="stats">
        <div class="stat"><div class="stat-label">Requirements</div><div class="stat-value primary" id="stat-reqs">0</div></div>
        <div class="stat"><div class="stat-label">Avg Coverage</div><div class="stat-value success" id="stat-coverage">0%</div></div>
        <div class="stat"><div class="stat-label">Active Negatives</div><div class="stat-value warning" id="stat-negs">0</div></div>
        <div class="stat"><div class="stat-label">Loops Completed</div><div class="stat-value" id="stat-loops">0</div></div>
      </div>

      <div class="workspace">
        <div class="card">
          <div class="card-header">
            <div class="card-title">🎯 Core Value</div>
            <button class="btn btn-ghost btn-sm" onclick="showEditCoreValue()">Edit</button>
          </div>
          <div id="core-value-display" style="margin-bottom:12px"></div>
          <div style="font-size:12px;color:var(--text-muted)">Anti-value:</div>
          <div id="anti-value-display" style="font-size:13px;color:var(--danger)"></div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">📊 Eval Factors</div>
          </div>
          <div id="eval-list" class="eval-list"></div>
        </div>

        <div class="card workspace-full">
          <div class="card-header">
            <div class="card-title">📋 Requirements</div>
            <div style="display:flex;gap:8px">
              <button class="btn btn-ghost btn-sm" id="coverage-assess-btn" onclick="runCoverageAssessment()">Re-assess</button>
              <button class="btn btn-primary btn-sm" onclick="showAddReqModal()">+ Add</button>
            </div>
          </div>
          <div id="req-list" class="req-list"></div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">📊 Coverage Stats</div>
          </div>
          <div id="coverage-stats"></div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">🔄 Prompt Feedback</div>
          </div>
          <div id="feedback-stats"></div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">Context Budget</div>
          </div>
          <div id="context-stats"></div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">🔒 Constraints</div>
            <button class="btn btn-ghost btn-sm" onclick="showAddConstraintModal()">+ Add</button>
          </div>
          <div id="constraint-list" class="constraint-list"></div>
        </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">🚫 Rejected Directions</div>
        </div>
        <div id="neg-list" class="neg-list"><div class="empty">No rejected directions yet</div></div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">💡 Insights</div>
        </div>
        <div id="insights-list" class="insights-list"><div class="empty">No insights yet</div></div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">🔧 Restructures</div>
        </div>
        <div id="restructures-list" class="restructures-list"><div class="empty">No restructures yet</div></div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">📊 Quality Report</div>
        </div>
        <div id="quality-report"></div>
      </div>

      <div class="card workspace-full">
        <div class="card-header">
          <div class="card-title">📝 Loop Logs</div>
        </div>
        <div id="loop-logs-list" class="loop-logs-list"><div class="empty">No logs yet</div></div>
      </div>
    </div>

      <div class="card workspace-full" style="margin-top:24px">
        <div class="card-header">
          <div class="card-title">🔄 Loop History</div>
        </div>
        <div id="loops-content" class="empty">No loops yet</div>
      </div>
    </div>
  </div>

  <div class="footer">
    <div class="model-bar">
      <div class="model-current">
        <span class="model-badge">Model</span>
        <span class="model-name" id="current-model">Not configured</span>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="showModelModal()">Change</button>
    </div>
    <div style="font-size:12px;color:var(--text-muted)">v1.0.0</div>
  </div>
</div>

<div id="modal-root"></div>

<script>
let runtimeState = null
let designState = null
let loopsState = []
let plansState = []
let agentTasksState = []
let agentTasksStats = null
let coverageStats = null
let latestContext = null
let feedbackScores = []
let feedbackSuggestions = []
let currentPhase = "idle"
let currentCards = []
let cardDecisions = {}
let cardNotes = {}
let selectedProvider = null
let selectedModel = null
let allModels = {}
let refreshPromise = null
let sseConnection = null

const $ = id => document.getElementById(id)
const escapeHtml = s => String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")

async function api(path, method="GET", body=null) {
  const opts = { method, headers: {"Content-Type":"application/json"} }
  if (body) opts.body = JSON.stringify(body)
  try { return await (await fetch(path, opts)).json() } catch(e) { return null }
}

function showModal(html) {
  $("modal-root").innerHTML = '<div class="modal-overlay" onclick="if(event.target===this)hideModal()"><div class="modal">'+html+'</div></div>'
}

function hideModal() { $("modal-root").innerHTML = "" }

function updatePhaseUI(phase, desc) {
  currentPhase = phase
  $("phase-dot").className = "phase-dot " + phase
  $("phase-text").textContent = phase.charAt(0).toUpperCase() + phase.slice(1)
  $("phase-desc").textContent = desc
  
  const startBtn = $("start-loop-btn")
  if (phase === "idle" || phase === "complete") {
    startBtn.classList.remove("hidden")
    startBtn.textContent = "Start Loop"
    startBtn.disabled = false
  } else if (phase === "deciding") {
    startBtn.classList.add("hidden")
  } else {
    startBtn.classList.remove("hidden")
    startBtn.textContent = phase.charAt(0).toUpperCase() + phase.slice(1) + "..."
    startBtn.disabled = true
  }
  
  $("decision-section").classList.toggle("hidden", phase !== "deciding")
}

function syncPhaseFromRuntime() {
  if (!runtimeState) return
  currentCards = runtimeState.pendingCards || []
  const status = runtimeState.status || { phase: "idle", desc: "Ready to start" }
  updatePhaseUI(status.phase, status.desc || "Ready to start")
}

async function startLoop() {
  const startBtn = $("start-loop-btn")
  if (startBtn) {
    startBtn.disabled = true
    startBtn.textContent = "Starting..."
  }

  try {
    const result = await api("/api/loop/start", "POST")
    if (!result?.success) {
      alert(result?.error ?? "Dashboard loop start is not available here.")
      refresh()
      return
    }

    updatePhaseUI("analyzing", result?.result?.message ?? "Loop start requested. Waiting for runtime updates...")
    setTimeout(refresh, 250)
  } finally {
    setTimeout(() => refresh(), 800)
  }
}

async function pollLoopStatus() {
  const status = await api("/api/loop/status")
  if (!status) return

  updatePhaseUI(status.phase || "idle", status.desc || "Ready to start")
  refresh()
}

function renderDecisionCards() {
  const container = $("decision-cards")
  container.innerHTML = currentCards.map(card => {
    const decision = cardDecisions[card.id]
    const note = cardNotes[card.id]
    const statusClass = decision === "accepted" ? "accepted" : decision === "rejected" ? "rejected" : ""
    const content = card.content || {}
    const prediction = card.prediction || {}
    const objective = card.objective || content.objective || card.id
    const approach = card.approach || content.approach || "-"
    const benefit = card.benefit || content.benefit || "-"
    const risk = card.risk || content.risk || "-"
    const confidence = card.confidence ?? prediction.confidence ?? 0.5
    
    return '<div class="decision-card '+statusClass+'" id="card-'+card.id+'">'+
      '<div class="card-obj">'+escapeHtml(objective)+'</div>'+
      '<div class="card-detail"><strong>Approach:</strong> '+escapeHtml(approach)+'</div>'+
      '<div class="card-detail"><strong>Benefit:</strong> '+escapeHtml(benefit)+'</div>'+
      '<div class="card-detail"><strong>Risk:</strong> '+escapeHtml(risk)+'</div>'+
      '<div class="card-detail"><strong>Confidence:</strong> '+Math.round(confidence*100)+'%</div>'+
      (decision === "rejected" && note ? '<div class="card-detail"><strong>Reason:</strong> '+escapeHtml(note)+'</div>' : '')+
      '<div class="card-actions">'+
        '<button class="btn btn-success btn-sm" onclick="decideCard(\\''+card.id+'\\',\\'accept\\')">'+(decision==="accepted"?"✓ Accepted":"Accept")+'</button>'+
        '<button class="btn btn-danger btn-sm" onclick="decideCard(\\''+card.id+'\\',\\'reject\\')">'+(decision==="rejected"?"✗ Rejected":"Reject")+'</button>'+
      '</div>'+
    '</div>'
  }).join("")
}

function decideCard(cardId, action) {
  if (action === "reject") {
    const note = prompt("Optional rejection reason", cardNotes[cardId] || "")
    if (note === null) return
    cardNotes[cardId] = note.trim()
    cardDecisions[cardId] = "rejected"
  } else {
    delete cardNotes[cardId]
    cardDecisions[cardId] = "accepted"
  }
  renderDecisionCards()
}

async function submitDecisions() {
  const unresolved = currentCards.filter(card => !cardDecisions[card.id]).map(card => card.id)
  if (unresolved.length > 0) {
    alert("Please decide all pending cards before submitting: " + unresolved.join(", "))
    return
  }

  const decisions = currentCards.map(card => ({
    cardId: card.id,
    status: cardDecisions[card.id],
    note: cardNotes[card.id] || undefined,
  }))
  
  const result = await api("/api/loop/decide", "POST", { decisions })
  if (result?.success) {
    cardDecisions = {}
    cardNotes = {}
    refresh()
  } else {
    alert(result?.error ?? "Failed to save loop decisions.")
  }
}

function renderExecutionPlans() {
  const container = $("execution-plans")
  if (!plansState.length) {
    container.innerHTML = '<div class="empty">No execution plans yet</div>'
    return
  }
  
  container.innerHTML = plansState.map(plan => {
    const statusClass = plan.preflight?.status || "ready"
    const tasks = plan.tasks || []
    const tasksHtml = tasks.map(task => {
      const taskStatus = task.status || "pending"
      return '<div class="task-item"><span class="task-name">'+escapeHtml(task.spec?.title || task.id)+'</span><span class="task-status '+taskStatus+'">'+taskStatus+'</span></div>'
    }).join("")
    
    return '<div class="plan-card '+statusClass+'">'+
      '<div class="plan-header"><span class="plan-title">'+escapeHtml(plan.id)+'</span><span class="plan-status '+statusClass+'">'+statusClass+'</span></div>'+
      '<div class="card-detail">'+escapeHtml(plan.interpretation || "")+'</div>'+
      '<div class="plan-tasks">'+tasksHtml+'</div>'+
      '<div class="plan-actions">'+
        '<button class="btn btn-primary btn-sm" onclick="executePlan(\\''+plan.id+'\\')">Execute</button>'+
        '<button class="btn btn-danger btn-sm" onclick="rollbackPlan(\\''+plan.id+'\\')">Rollback</button>'+
      '</div>'+
    '</div>'
  }).join("")
}

async function executePlan(planId) {
  const result = await api("/api/execute", "POST", { planId })
  if (result?.success) {
    alert("Plan executed successfully")
    refresh()
  } else {
    alert("Failed: " + (result?.error ?? "Unknown"))
  }
}

async function executeAllPlans() {
  for (const plan of plansState) {
    const result = await api("/api/execute", "POST", { planId: plan.id })
    if (!result?.success) {
      alert("Failed to execute "+plan.id+": " + (result?.error ?? "Unknown"))
      break
    }
  }
  refresh()
}

async function autoExecute() {
  const statusEl = $("auto-execute-status")
  const btn = event.target
  
  if (!confirm("Execute all ready plans automatically? This will auto-commit each task and rollback on failure.")) {
    return
  }
  
  btn.disabled = true
  btn.textContent = "Executing..."
  statusEl.innerHTML = '<div style="color:var(--primary)">Starting auto-execution...</div>'
  
  try {
    const result = await api("/api/execute/auto", "POST")
    
    if (result?.success) {
      let html = '<div style="background:var(--surface-2);border-radius:8px;padding:16px;margin-top:8px">'
      html += '<div style="font-weight:600;margin-bottom:8px">Auto-Execution Complete</div>'
      html += '<div>Total Plans: ' + result.totalPlans + '</div>'
      html += '<div style="color:var(--success)">Success: ' + result.successCount + '</div>'
      if (result.failedCount > 0) {
        html += '<div style="color:var(--danger)">Failed: ' + result.failedCount + '</div>'
      }
      
      if (result.results?.length) {
        html += '<div style="margin-top:12px;font-size:12px">'
        for (const r of result.results) {
          const icon = r.success ? '✓' : '✗'
          const color = r.success ? 'var(--success)' : 'var(--danger)'
          html += '<div style="color:'+color+'">'+icon+' '+r.planId
          if (r.commit) html += ' ('+r.commit+')'
          if (r.error) html += ' - '+r.error
          html += '</div>'
        }
        html += '</div>'
      }
      
      if (result.evalDelta !== null) {
        const deltaColor = result.evalDelta >= 0 ? 'var(--success)' : 'var(--danger)'
        html += '<div style="margin-top:8px">Evaluation Δ: <span style="color:'+deltaColor+'">'+(result.evalDelta >= 0 ? '+' : '')+result.evalDelta.toFixed(2)+'</span></div>'
      }
      
      html += '</div>'
      statusEl.innerHTML = html
    } else {
      statusEl.innerHTML = '<div style="color:var(--danger)">Error: ' + (result?.error ?? "Unknown") + '</div>'
    }
  } catch (error) {
    statusEl.innerHTML = '<div style="color:var(--danger)">Error: ' + (error.message || error) + '</div>'
  } finally {
    btn.disabled = false
    btn.textContent = "⚡ One-Click Execute"
    refresh()
  }
}

async function rollbackPlan(planId) {
  if (!confirm("Are you sure you want to rollback plan "+planId+"?")) return
  
  const result = await api("/api/rollback", "POST", { planId })
  if (result?.success) {
    alert("Plan rolled back successfully")
    refresh()
  } else {
    alert("Failed: " + (result?.error ?? "Unknown"))
  }
}

function renderTaskStatus() {
  const container = $("task-status-list")
  const allTasks = plansState.flatMap(plan => 
    (plan.tasks || []).map(task => ({ ...task, planId: plan.id }))
  )
  
  if (!allTasks.length) {
    container.innerHTML = '<div class="empty">No tasks yet</div>'
    return
  }
  
  container.innerHTML = allTasks.map(task => {
    const status = task.status || "pending"
    const startTime = task.started_at ? new Date(task.started_at).toLocaleTimeString() : "-"
    const endTime = task.completed_at ? new Date(task.completed_at).toLocaleTimeString() : "-"
    
    return '<div class="task-status-item">'+
      '<div class="task-status-header"><span class="task-status-title">'+escapeHtml(task.spec?.title || task.id)+'</span><span class="task-status '+status+'">'+status+'</span></div>'+
      '<div class="task-status-body">Plan: '+escapeHtml(task.planId)+'</div>'+
      (task.error ? '<div class="task-status-body" style="color:var(--danger)">Error: '+escapeHtml(task.error)+'</div>' : '')+
      '<div class="task-status-time">Started: '+startTime+' | Completed: '+endTime+'</div>'+
    '</div>'
  }).join("")
}

function renderAgentTasks() {
  const container = $("agent-tasks-list")
  const statsContainer = $("agent-tasks-stats")
  
  // Render stats
  if (agentTasksStats) {
    const stats = agentTasksStats
    statsContainer.innerHTML = 
      '<div class="stat" style="display:inline-block;margin-right:16px"><div class="stat-label">Total Tasks</div><div class="stat-value">'+stats.total+'</div></div>'+
      '<div class="stat" style="display:inline-block;margin-right:16px"><div class="stat-label">Done</div><div class="stat-value success">'+stats.byStatus.done+'</div></div>'+
      '<div class="stat" style="display:inline-block;margin-right:16px"><div class="stat-label">Failed</div><div class="stat-value" style="color:var(--danger)">'+stats.byStatus.failed+'</div></div>'+
      '<div class="stat" style="display:inline-block;margin-right:16px"><div class="stat-label">Avg Duration</div><div class="stat-value">'+stats.avgDurationMs+'ms</div></div>'
  }
  
  // Render tasks list
  if (!agentTasksState.length) {
    container.innerHTML = '<div class="empty">No agent tasks recorded yet</div>'
    return
  }
  
  container.innerHTML = agentTasksState.map(task => {
    const status = task.status || "unknown"
    const statusColor = status === "done" ? "var(--success)" : status === "failed" ? "var(--danger)" : status === "running" ? "var(--primary)" : "var(--text-muted)"
    const duration = task.duration_ms ? task.duration_ms + "ms" : "-"
    const triggeredBy = task.triggered_by || "-"
    const roleId = task.role_id || "unknown"
    
    return '<div style="background:var(--surface-2);border-radius:8px;padding:12px;margin-bottom:8px;border-left:3px solid '+statusColor+'">'+
      '<div style="display:flex;justify-content:space-between;margin-bottom:8px">'+
        '<div><strong>'+escapeHtml(roleId)+'</strong> <span style="color:var(--text-muted);font-size:12px">['+escapeHtml(triggeredBy)+']</span></div>'+
        '<span style="color:'+statusColor+';font-size:12px">'+status.toUpperCase()+'</span>'+
      '</div>'+
      '<div style="font-size:12px;color:var(--text-muted)">Duration: '+duration+' | '+escapeHtml(task.started_at || '-')+'</div>'+
      (task.error ? '<div style="font-size:12px;color:var(--danger);margin-top:4px">Error: '+escapeHtml(task.error)+'</div>' : '')+
      (task.raw_output ? '<details style="margin-top:8px"><summary style="cursor:pointer;font-size:12px;color:var(--text-muted)">View Output</summary><pre style="font-size:11px;background:var(--bg);padding:8px;border-radius:4px;margin-top:4px;overflow-x:auto;max-height:200px">'+escapeHtml(task.raw_output.substring(0, 1000))+'</pre></details>' : '')+
    '</div>'
  }).join("")
}

function renderCoverageStats() {
  const container = $("coverage-stats")
  if (!container) return
  
  if (!coverageStats) {
    container.innerHTML = '<div class="empty">No coverage data available</div>'
    return
  }
  
  const avgCoveragePercent = Math.round(coverageStats.avgCoverage * 100)
  const coverageColor = avgCoveragePercent >= 80 ? "var(--success)" : avgCoveragePercent >= 50 ? "var(--warning)" : "var(--danger)"
  
  let html = '<div style="margin-bottom:16px">'
  html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">'
  html += '<span style="font-size:24px;font-weight:700;color:'+coverageColor+'">'+avgCoveragePercent+'%</span>'
  html += '<span style="color:var(--text-muted)">Average Coverage</span>'
  html += '</div>'
  html += '<div style="font-size:12px;color:var(--text-muted)">'+coverageStats.total+' requirements</div>'
  html += '</div>'
  
  // Low coverage requirements
  if (coverageStats.lowCoverage && coverageStats.lowCoverage.length > 0) {
    html += '<div style="margin-top:12px">'
    html += '<div style="font-size:12px;font-weight:600;margin-bottom:8px;color:var(--warning)">Low Coverage (&lt;50%)</div>'
    for (const req of coverageStats.lowCoverage) {
      const percent = Math.round(req.coverage * 100)
      html += '<div style="background:var(--surface-2);border-radius:6px;padding:8px;margin-bottom:4px">'
      html += '<div style="display:flex;justify-content:space-between;font-size:12px">'
      html += '<span style="color:var(--primary)">'+escapeHtml(req.id)+'</span>'
      html += '<span style="color:var(--warning)">'+percent+'%</span>'
      html += '</div>'
      html += '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">'+escapeHtml(req.text)+'</div>'
      html += '</div>'
    }
    html += '</div>'
  }
  
  container.innerHTML = html
}

async function renderLoopLogs() {
  const container = $("loop-logs-list")
  if (!container) return

  const logs = await api("/api/logs?limit=5")
  if (!logs || logs.length === 0) {
    container.innerHTML = '<div class="empty">No logs yet</div>'
    return
  }

  let html = ''
  for (const log of logs) {
    html += '<div style="background:var(--surface-2);border-radius:8px;padding:12px;margin-bottom:8px">'
    html += '<div style="font-weight:600;margin-bottom:8px">'+escapeHtml(log.firstLine)+'</div>'
    html += '<details><summary style="cursor:pointer;font-size:12px;color:var(--text-muted)">View full log</summary>'
    html += '<pre style="font-size:11px;background:var(--bg);padding:8px;border-radius:4px;margin-top:8px;overflow-x:auto;max-height:300px">'+escapeHtml(log.content)+'</pre>'
    html += '</details></div>'
  }
  container.innerHTML = html
}

function connectSSE() {
  if (sseConnection) sseConnection.close()
  const es = new EventSource("/api/events")
  sseConnection = es

  for (const eventName of ["state","loops","cards","plans","config","loop","execution","optimization","coverage","negatives","reports","feedback"]) {
    es.addEventListener(eventName, () => refresh())
  }
  
  es.onerror = () => {
    es.close()
    if (sseConnection === es) {
      sseConnection = null
    }
    setTimeout(connectSSE, 5000)
  }
}

refresh()
connectSSE()
setInterval(refresh, 5000)
</script>
</body>
</html>`
}
