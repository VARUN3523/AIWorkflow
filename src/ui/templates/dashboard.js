import { renderLayout } from './layout.js';

/**
 * Render Interactive Customer Dashboard (Features F-UI-02 through F-UI-09)
 */
export function renderDashboardPage({ user = null, workspace = null, stats = null } = {}) {
  const body = `
  <div class="dashboard-layout" id="dashboard-app">
    <!-- DASHBOARD TOP BAR -->
    <header class="dashboard-header">
      <div class="container dash-header-container">
        <div class="dash-header-left">
          <div class="workspace-badge" id="current-workspace-display">
            <span class="ws-icon">🏢</span>
            <div class="ws-info">
              <span class="ws-label">Workspace</span>
              <strong class="ws-name" id="workspace-name-text">${workspace ? escapeHtml(workspace.name) : 'Personal Workspace'}</strong>
            </div>
            <span class="badge badge-primary" id="workspace-plan-badge">${workspace?.plan_id ? escapeHtml(workspace.plan_id.toUpperCase()) : 'FREE'}</span>
          </div>
        </div>

        <div class="dash-header-right">
          <button type="button" id="refresh-dashboard-btn" class="btn btn-outline btn-sm" title="Refresh data">
            <span class="btn-icon">🔄</span> Refresh
          </button>
          <button type="button" id="open-create-workflow-btn" class="btn btn-primary btn-sm">
            <span class="btn-icon">➕</span> New Workflow
          </button>
          <div class="user-profile-menu">
            <span class="user-avatar-circle" id="user-initials">U</span>
            <span class="user-email-text" id="user-email-display">${user ? escapeHtml(user.email) : 'User'}</span>
            <button type="button" id="logout-btn" class="btn btn-ghost btn-xs">Sign Out</button>
          </div>
        </div>
      </div>
    </header>

    <!-- DASHBOARD NAVIGATION TABS -->
    <nav class="dashboard-nav-tabs">
      <div class="container tabs-container">
        <button type="button" class="dash-tab active" data-tab="tab-overview">
          <span class="tab-icon">📊</span> Overview &amp; Workflows
        </button>
        <button type="button" class="dash-tab" data-tab="tab-executions">
          <span class="tab-icon">⚡</span> Execution History
        </button>
        <button type="button" class="dash-tab" data-tab="tab-billing">
          <span class="tab-icon">💳</span> Account &amp; Billing
        </button>
      </div>
    </nav>

    <div class="container dashboard-main-content">
      <!-- ALERT CONTAINER -->
      <div id="dash-alert" class="alert" style="display: none;"></div>

      <!-- =================================================================== -->
      <!-- TAB 1: OVERVIEW & WORKFLOWS -->
      <!-- =================================================================== -->
      <section class="dash-tab-pane active" id="tab-overview">
        <!-- F-UI-02: METRICS OVERVIEW / KPI SUMMARY CARDS -->
        <div class="metrics-grid">
          <div class="kpi-card" id="kpi-total-workflows">
            <div class="kpi-icon-wrap bg-blue-soft">
              <span class="kpi-icon">📁</span>
            </div>
            <div class="kpi-meta">
              <span class="kpi-label">Total Workflows</span>
              <strong class="kpi-value" id="kpi-val-workflows">${stats?.total_workflows ?? 0}</strong>
              <span class="kpi-subtext" id="kpi-active-subtext">Active automation pipelines</span>
            </div>
          </div>

          <div class="kpi-card" id="kpi-total-executions">
            <div class="kpi-icon-wrap bg-purple-soft">
              <span class="kpi-icon">⚡</span>
            </div>
            <div class="kpi-meta">
              <span class="kpi-label">Monthly Executions</span>
              <strong class="kpi-value" id="kpi-val-executions">${stats?.total_executions ?? 0}</strong>
              <span class="kpi-subtext">Processed this billing cycle</span>
            </div>
          </div>

          <div class="kpi-card" id="kpi-success-rate">
            <div class="kpi-icon-wrap bg-green-soft">
              <span class="kpi-icon">📈</span>
            </div>
            <div class="kpi-meta">
              <span class="kpi-label">Pipeline Success Rate</span>
              <strong class="kpi-value" id="kpi-val-success-rate">${stats?.success_rate ?? 100}%</strong>
              <span class="kpi-subtext text-success" id="kpi-success-subtext">Zero unhandled exceptions</span>
            </div>
          </div>

          <div class="kpi-card" id="kpi-quota">
            <div class="kpi-icon-wrap bg-amber-soft">
              <span class="kpi-icon">⏳</span>
            </div>
            <div class="kpi-meta w-full">
              <div class="flex-between">
                <span class="kpi-label">Monthly Quota</span>
                <span class="kpi-quota-numbers" id="kpi-quota-text">${stats?.runs_used ?? 0} / ${stats?.runs_limit ?? 50} runs</span>
              </div>
              <div class="progress-bar-wrapper">
                <div class="progress-bar" id="kpi-quota-bar">
                  <div class="progress-fill" id="kpi-quota-fill" style="width: ${stats?.quota_percentage ?? 0}%;"></div>
                </div>
              </div>
              <div class="flex-between">
                <span class="kpi-subtext" id="kpi-plan-name">Plan: <strong>${stats?.plan_id ? stats.plan_id.toUpperCase() : 'FREE'}</strong></span>
                <a href="#tab-billing" class="switch-to-billing-link">Upgrade &rarr;</a>
              </div>
            </div>
          </div>
        </div>

        <!-- F-UI-03: WORKFLOW MANAGEMENT -->
        <div class="card content-card" id="workflows-section">
          <div class="card-header flex-between">
            <div>
              <h3 class="card-title">Configured Workflows</h3>
              <p class="card-subtitle">Manage, trigger, and inspect multi-step AI document processing pipelines</p>
            </div>
            <div class="card-actions">
              <button type="button" id="btn-create-workflow-action" class="btn btn-primary btn-sm">
                <span class="btn-icon">➕</span> Create Workflow
              </button>
            </div>
          </div>

          <div class="card-body">
            <!-- Loading state -->
            <div id="workflows-loading" class="loading-spinner-state" style="display: none;">
              <div class="spinner"></div>
              <p>Loading workflows...</p>
            </div>

            <!-- Empty state -->
            <div id="workflows-empty-state" class="empty-state">
              <div class="empty-state-icon">🤖</div>
              <h4>No workflows configured yet</h4>
              <p>Create your first AI automation workflow to start extracting, classifying, and synthesizing documents.</p>
              <button type="button" class="btn btn-primary btn-sm" id="empty-state-create-btn">
                <span>Build First Workflow</span>
              </button>
            </div>

            <!-- Workflows Table Container -->
            <div class="table-responsive" id="workflows-table-container" style="display: none;">
              <table class="data-table" id="workflows-table">
                <thead>
                  <tr>
                    <th>Workflow Name</th>
                    <th>Trigger</th>
                    <th>Steps Pipeline</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th class="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody id="workflows-tbody">
                  <!-- Rendered dynamically by app.js -->
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <!-- =================================================================== -->
      <!-- TAB 2: EXECUTION HISTORY (F-UI-06) -->
      <!-- =================================================================== -->
      <section class="dash-tab-pane" id="tab-executions">
        <div class="card content-card" id="executions-section">
          <div class="card-header flex-between">
            <div>
              <h3 class="card-title">Execution History &amp; Run Timeline</h3>
              <p class="card-subtitle">Real-time status tracking and step-level input/output inspection</p>
            </div>
            <div class="card-actions flex-gap">
              <select id="execution-status-filter" class="form-select form-select-sm">
                <option value="">All Statuses</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
                <option value="running">Running</option>
              </select>
              <button type="button" id="btn-refresh-executions" class="btn btn-outline btn-sm">
                <span class="btn-icon">🔄</span> Refresh
              </button>
            </div>
          </div>

          <div class="card-body">
            <!-- Loading state -->
            <div id="executions-loading" class="loading-spinner-state" style="display: none;">
              <div class="spinner"></div>
              <p>Loading execution history...</p>
            </div>

            <!-- Empty state -->
            <div id="executions-empty-state" class="empty-state">
              <div class="empty-state-icon">⚡</div>
              <h4>No executions recorded</h4>
              <p>Trigger a workflow from the Overview tab or via the API to inspect real-time execution runs here.</p>
            </div>

            <!-- Executions Table -->
            <div class="table-responsive" id="executions-table-container" style="display: none;">
              <table class="data-table" id="executions-table">
                <thead>
                  <tr>
                    <th>Execution ID</th>
                    <th>Workflow</th>
                    <th>Trigger</th>
                    <th>Status</th>
                    <th>Duration</th>
                    <th>Started</th>
                    <th class="text-right">Trace</th>
                  </tr>
                </thead>
                <tbody id="executions-tbody">
                  <!-- Rendered dynamically by app.js -->
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <!-- =================================================================== -->
      <!-- TAB 3: ACCOUNT & BILLING MANAGEMENT (F-UI-09) -->
      <!-- =================================================================== -->
      <section class="dash-tab-pane" id="tab-billing">
        <div class="billing-grid">
          <!-- Active Subscription Card -->
          <div class="card content-card" id="billing-summary-card">
            <div class="card-header">
              <h3 class="card-title">Subscription &amp; Usage Metering</h3>
              <p class="card-subtitle">Current tier limits and atomic run quota consumption</p>
            </div>
            <div class="card-body">
              <div class="current-plan-highlight">
                <div class="plan-badge-row">
                  <span class="plan-pill" id="billing-plan-name">FREE TIER</span>
                  <span class="badge badge-success" id="billing-plan-status">Active</span>
                </div>
                <div class="quota-progress-block">
                  <div class="flex-between">
                    <span class="quota-label">Monthly Runs Quota:</span>
                    <strong id="billing-quota-text">0 / 50 runs used</strong>
                  </div>
                  <div class="progress-bar-wrapper">
                    <div class="progress-bar">
                      <div class="progress-fill" id="billing-quota-fill" style="width: 0%;"></div>
                    </div>
                  </div>
                  <span class="text-muted text-xs" id="billing-resets-text">Quota resets at the start of each calendar month.</span>
                </div>
              </div>

              <div class="billing-portal-actions">
                <button type="button" id="btn-stripe-portal" class="btn btn-outline btn-block">
                  <span class="btn-icon">⚙️</span> Manage Payment &amp; Invoices in Stripe Customer Portal
                </button>
              </div>
            </div>
          </div>

          <!-- Tier Upgrade Options -->
          <div class="card content-card" id="billing-upgrade-card">
            <div class="card-header">
              <h3 class="card-title">Upgrade Plan</h3>
              <p class="card-subtitle">Scale your automation volume with 1-click Stripe Checkout</p>
            </div>
            <div class="card-body">
              <div class="upgrade-tiers-list">
                <!-- Starter Option -->
                <div class="upgrade-tier-item">
                  <div class="tier-item-info">
                    <h4>Starter Tier</h4>
                    <p>1,000 runs/mo &bull; Webhooks &amp; File Ingestion &bull; Email Support</p>
                  </div>
                  <div class="tier-item-action">
                    <span class="tier-item-price">$29/mo</span>
                    <button type="button" class="btn btn-primary btn-sm btn-upgrade-checkout" data-plan="starter">
                      Upgrade to Starter
                    </button>
                  </div>
                </div>

                <!-- Pro Option -->
                <div class="upgrade-tier-item">
                  <div class="tier-item-info">
                    <h4>Pro Enterprise Tier</h4>
                    <p>10,000 runs/mo &bull; Unlimited Workflows &bull; Priority Queue</p>
                  </div>
                  <div class="tier-item-action">
                    <span class="tier-item-price">$99/mo</span>
                    <button type="button" class="btn btn-outline btn-sm btn-upgrade-checkout" data-plan="pro">
                      Upgrade to Pro
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- =================================================================== -->
    <!-- F-UI-04: WORKFLOW BUILDER MODAL -->
    <!-- =================================================================== -->
    <div class="modal-backdrop" id="workflow-builder-modal" style="display: none;">
      <div class="modal-dialog modal-lg">
        <div class="modal-header">
          <h3 class="modal-title" id="builder-modal-title">Create AI Workflow</h3>
          <button type="button" class="modal-close-btn" id="close-builder-modal">&times;</button>
        </div>

        <form id="workflow-builder-form">
          <div class="modal-body">
            <div id="builder-alert" class="alert alert-danger" style="display: none;"></div>

            <div class="form-group">
              <label for="wf-name-input" class="form-label">Workflow Name <span class="text-danger">*</span></label>
              <input type="text" id="wf-name-input" class="form-control" placeholder="e.g. Inbound Invoice &amp; AP Approval" required>
            </div>

            <div class="form-group">
              <label for="wf-desc-input" class="form-label">Description</label>
              <input type="text" id="wf-desc-input" class="form-control" placeholder="Brief summary of pipeline purpose">
            </div>

            <div class="form-group">
              <label for="wf-trigger-type" class="form-label">Trigger Type</label>
              <select id="wf-trigger-type" class="form-select">
                <option value="manual">Manual Trigger (Dashboard / API On-Demand)</option>
                <option value="webhook">Webhook Trigger (External HTTP POST)</option>
                <option value="file_upload">File Upload Trigger (Multipart Documents)</option>
              </select>
            </div>

            <!-- Steps Builder Container -->
            <div class="steps-builder-section">
              <div class="flex-between mb-2">
                <label class="form-label mb-0">Processing Pipeline Steps <span class="text-danger">*</span></label>
                <div class="step-builder-actions">
                  <button type="button" id="btn-load-sample-steps" class="btn btn-ghost btn-xs">
                    ⚡ Load Standard 3-Step AI Pipeline
                  </button>
                  <button type="button" id="btn-add-step" class="btn btn-outline btn-xs">
                    ➕ Add Custom Step
                  </button>
                </div>
              </div>

              <div id="steps-list-container" class="steps-list">
                <!-- Dynamically populated step cards -->
              </div>
            </div>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-outline" id="cancel-builder-modal">Cancel</button>
            <button type="submit" id="save-workflow-submit-btn" class="btn btn-primary">
              <span>Save &amp; Activate Workflow</span>
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- =================================================================== -->
    <!-- F-UI-05: INTERACTIVE RUN MODAL & TRIGGER UI -->
    <!-- =================================================================== -->
    <div class="modal-backdrop" id="run-modal" style="display: none;">
      <div class="modal-dialog">
        <div class="modal-header">
          <h3 class="modal-title">Trigger Workflow Execution</h3>
          <button type="button" class="modal-close-btn" id="close-run-modal">&times;</button>
        </div>

        <form id="run-workflow-form">
          <input type="hidden" id="run-workflow-id">
          <div class="modal-body">
            <div id="run-alert" class="alert" style="display: none;"></div>

            <div class="run-target-info">
              <span class="text-muted">Target Workflow:</span>
              <strong id="run-workflow-name-display">Loading...</strong>
            </div>

            <div class="form-group mt-3">
              <div class="flex-between mb-1">
                <label for="run-payload-input" class="form-label mb-0">Input Payload / Document Content</label>
                <div class="sample-preset-btns">
                  <button type="button" class="btn btn-ghost btn-xs btn-sample-run" data-sample="invoice">Sample Invoice</button>
                  <button type="button" class="btn btn-ghost btn-xs btn-sample-run" data-sample="lead">Sample Lead</button>
                </div>
              </div>
              <textarea id="run-payload-input" class="form-control code-font" rows="8" placeholder="Enter document text or JSON payload..." required></textarea>
            </div>

            <div id="run-progress-state" class="run-progress-indicator" style="display: none;">
              <div class="spinner spinner-sm"></div>
              <span id="run-progress-text">Dispatching execution engine...</span>
            </div>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-outline" id="cancel-run-modal">Cancel</button>
            <button type="submit" id="trigger-run-btn" class="btn btn-primary">
              <span class="btn-icon">⚡</span> Execute Pipeline Now
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- =================================================================== -->
    <!-- F-UI-07: STEP-LEVEL TRACE INSPECTOR MODAL -->
    <!-- =================================================================== -->
    <div class="modal-backdrop" id="trace-modal" style="display: none;">
      <div class="modal-dialog modal-xl">
        <div class="modal-header">
          <div class="trace-modal-title-wrap">
            <h3 class="modal-title">Step-Level Execution Trace</h3>
            <span class="badge badge-subtle code-font" id="trace-execution-id">exec_...</span>
          </div>
          <button type="button" class="modal-close-btn" id="close-trace-modal">&times;</button>
        </div>

        <div class="modal-body">
          <div class="trace-overview-bar">
            <div class="trace-stat">
              <span class="trace-stat-label">Status</span>
              <span class="badge" id="trace-status-badge">Completed</span>
            </div>
            <div class="trace-stat">
              <span class="trace-stat-label">Total Duration</span>
              <strong id="trace-duration-display">0 ms</strong>
            </div>
            <div class="trace-stat">
              <span class="trace-stat-label">Started At</span>
              <span id="trace-started-display">-</span>
            </div>
            <div class="trace-stat">
              <span class="trace-stat-label">Trigger</span>
              <span class="badge badge-outline" id="trace-trigger-display">manual</span>
            </div>
          </div>

          <div id="trace-error-banner" class="alert alert-danger mt-3" style="display: none;">
            <strong>Execution Error:</strong>
            <span id="trace-error-message"></span>
          </div>

          <div class="trace-steps-section mt-4">
            <h4 class="section-subheading">Step Logs &amp; Input/Output Snapshots</h4>
            <div id="trace-steps-container" class="trace-accordions-list">
              <!-- Dynamically rendered step accordions -->
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn btn-outline" id="close-trace-btn">Close Inspector</button>
        </div>
      </div>
    </div>
  </div>
  `;

  return renderLayout({
    title: 'Console Dashboard | FlowAI Workflow Platform',
    description: 'Manage, trigger, and inspect multi-step AI workflow automation pipelines.',
    body,
    scripts: ['/js/app.js'],
    activeNav: 'dashboard'
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
