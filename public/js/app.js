/**
 * FlowAI Console Client Application (public/js/app.js)
 * Implements Features F-UI-02 through F-UI-09:
 * - Metrics Overview & KPI cards
 * - Workflow Management & Builder Modal
 * - Interactive Run Modal & Trigger UI
 * - Execution History & Real-Time Polling
 * - Step-Level Trace Inspector
 * - Account & Billing Management UI
 * - Authentication & Session handling
 */

(function () {
  'use strict';

  // State Management
  const state = {
    token: null,
    user: null,
    workspaceId: null,
    workflows: [],
    executions: [],
    pollTimer: null,
    currentRunWorkflowId: null
  };

  // Helper: Get Auth Token
  function getToken() {
    if (state.token) return state.token;
    const local = localStorage.getItem('flowai_token');
    if (local) return local;

    // Cookie fallback
    const match = document.cookie.match(new RegExp('(^| )session_token=([^;]+)'));
    if (match) return match[2];

    return null;
  }

  function setToken(token) {
    state.token = token;
    localStorage.setItem('flowai_token', token);
    document.cookie = `session_token=${token}; path=/; max-age=604800; SameSite=Lax`;
  }

  function clearToken() {
    state.token = null;
    localStorage.removeItem('flowai_token');
    document.cookie = 'session_token=; path=/; max-age=0; SameSite=Lax';
  }

  // API Client with Auth headers
  async function apiRequest(endpoint, options = {}) {
    const token = getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(state.workspaceId ? { 'x-workspace-id': state.workspaceId } : {}),
      ...(options.headers || {})
    };

    const res = await fetch(endpoint, {
      ...options,
      headers
    });

    const contentType = res.headers.get('content-type') || '';
    let data;
    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      data = await res.text();
    }

    if (!res.ok) {
      const err = new Error(data.message || (typeof data === 'string' ? data : 'API Request Failed'));
      err.status = res.status;
      err.data = data;
      throw err;
    }

    return data;
  }

  // Toast / Alert notifications
  function showAlert(containerId, message, type = 'danger') {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.textContent = message;
    el.className = `alert alert-${type}`;
    el.style.display = 'block';

    setTimeout(() => {
      el.style.display = 'none';
    }, 6000);
  }

  // =========================================================================
  // 1. AUTHENTICATION CONTROLLER (Login / Register / Logout)
  // =========================================================================
  function initAuth() {
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        const btn = document.getElementById('login-submit-btn');

        btn.disabled = true;
        try {
          const res = await apiRequest('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
          });

          setToken(res.token);
          if (res.activeWorkspaceId) state.workspaceId = res.activeWorkspaceId;
          window.location.href = '/dashboard';
        } catch (err) {
          showAlert('auth-alert', err.message || 'Login failed', 'danger');
        } finally {
          btn.disabled = false;
        }
      });
    }

    const registerForm = document.getElementById('register-form');
    if (registerForm) {
      registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fullName = document.getElementById('reg-fullname').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const password = document.getElementById('reg-password').value;
        const workspaceName = document.getElementById('reg-workspace').value.trim();
        const btn = document.getElementById('register-submit-btn');

        btn.disabled = true;
        try {
          const res = await apiRequest('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify({ fullName, email, password, workspaceName })
          });

          setToken(res.token);
          if (res.workspace?.id) state.workspaceId = res.workspace.id;
          window.location.href = '/dashboard';
        } catch (err) {
          showAlert('auth-alert', err.message || 'Registration failed', 'danger');
        } finally {
          btn.disabled = false;
        }
      });
    }

    // Logout handlers
    const logoutBtn = document.getElementById('logout-btn');
    const headerLogoutBtn = document.getElementById('header-logout-btn');
    const doLogout = async () => {
      try {
        await apiRequest('/api/auth/logout', { method: 'POST' });
      } catch {
        // Ignore logout errors
      }
      clearToken();
      window.location.href = '/login';
    };

    if (logoutBtn) logoutBtn.addEventListener('click', doLogout);
    if (headerLogoutBtn) headerLogoutBtn.addEventListener('click', doLogout);
  }

  // =========================================================================
  // 2. DASHBOARD APP CONTROLLER
  // =========================================================================
  async function initDashboard() {
    const dashboardApp = document.getElementById('dashboard-app');
    if (!dashboardApp) return;

    state.token = getToken();
    if (!state.token) {
      // Auto-fallback: check if session cookie exists or prompt login
      try {
        const me = await apiRequest('/api/auth/me');
        if (me && me.user) {
          state.user = me.user;
          state.workspaceId = me.active_workspace?.id || me.user.defaultWorkspaceId;
        }
      } catch {
        window.location.href = '/login';
        return;
      }
    }

    // Setup navigation tabs
    const tabButtons = document.querySelectorAll('.dash-tab');
    const tabPanes = document.querySelectorAll('.dash-tab-pane');
    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        tabButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tabTarget = btn.dataset.tab;
        tabPanes.forEach(pane => {
          pane.classList.remove('active');
          if (pane.id === tabTarget) pane.classList.add('active');
        });
      });
    });

    // Refresh button
    const refreshBtn = document.getElementById('refresh-dashboard-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        loadDashboardData();
      });
    }

    // Modal triggers & builders
    initWorkflowBuilder();
    initRunModal();
    initTraceModal();
    initBillingControls();

    // Initial load
    await loadDashboardData();
  }

  async function loadDashboardData() {
    try {
      await Promise.all([
        fetchDashboardStats(),
        fetchWorkflows(),
        fetchExecutions()
      ]);
    } catch (err) {
      console.error('Error loading dashboard data:', err);
    }
  }

  // =========================================================================
  // F-UI-02: KPI METRICS OVERVIEW
  // =========================================================================
  async function fetchDashboardStats() {
    try {
      const stats = await apiRequest('/api/dashboard/stats');

      // Total Workflows
      const kpiWf = document.getElementById('kpi-val-workflows');
      if (kpiWf) kpiWf.textContent = stats.total_workflows ?? stats.workflows ?? 0;

      // Executions
      const kpiExec = document.getElementById('kpi-val-executions');
      if (kpiExec) kpiExec.textContent = stats.total_executions ?? 0;

      // Success Rate
      const kpiRate = document.getElementById('kpi-val-success-rate');
      if (kpiRate) kpiRate.textContent = `${stats.success_rate ?? 100}%`;

      // Quota Text & Fill
      const quotaText = document.getElementById('kpi-quota-text');
      if (quotaText) quotaText.textContent = `${stats.runs_used ?? 0} / ${stats.runs_limit ?? 50} runs`;

      const quotaFill = document.getElementById('kpi-quota-fill');
      if (quotaFill) {
        const pct = Math.min(100, Math.max(0, stats.quota_percentage ?? 0));
        quotaFill.style.width = `${pct}%`;
        if (pct >= 90) {
          quotaFill.style.backgroundColor = 'var(--danger)';
        } else if (pct >= 70) {
          quotaFill.style.backgroundColor = 'var(--warning)';
        } else {
          quotaFill.style.backgroundColor = 'var(--primary)';
        }
      }

      // Plan Name
      const planName = (stats.plan_id || 'free').toUpperCase();
      const planBadge = document.getElementById('workspace-plan-badge');
      if (planBadge) planBadge.textContent = planName;

      const kpiPlanName = document.getElementById('kpi-plan-name');
      if (kpiPlanName) kpiPlanName.innerHTML = `Plan: <strong>${planName}</strong>`;

      // Billing tab summary card
      const billingPlanName = document.getElementById('billing-plan-name');
      if (billingPlanName) billingPlanName.textContent = `${planName} TIER`;

      const billingQuotaText = document.getElementById('billing-quota-text');
      if (billingQuotaText) billingQuotaText.textContent = `${stats.runs_used ?? 0} / ${stats.runs_limit ?? 50} runs used`;

      const billingQuotaFill = document.getElementById('billing-quota-fill');
      if (billingQuotaFill) billingQuotaFill.style.width = `${stats.quota_percentage ?? 0}%`;

    } catch (err) {
      console.warn('Failed to fetch dashboard stats:', err);
    }
  }

  // =========================================================================
  // F-UI-03: WORKFLOW MANAGEMENT TABLE & ACTIONS
  // =========================================================================
  async function fetchWorkflows() {
    const loadingEl = document.getElementById('workflows-loading');
    const emptyEl = document.getElementById('workflows-empty-state');
    const tableContainer = document.getElementById('workflows-table-container');
    const tbody = document.getElementById('workflows-tbody');

    if (loadingEl) loadingEl.style.display = 'block';

    try {
      const res = await apiRequest('/api/workflows');
      state.workflows = res.workflows || [];

      if (loadingEl) loadingEl.style.display = 'none';

      if (!state.workflows || state.workflows.length === 0) {
        if (emptyEl) emptyEl.style.display = 'block';
        if (tableContainer) tableContainer.style.display = 'none';
        return;
      }

      if (emptyEl) emptyEl.style.display = 'none';
      if (tableContainer) tableContainer.style.display = 'block';
      if (!tbody) return;

      tbody.innerHTML = '';
      state.workflows.forEach(wf => {
        const tr = document.createElement('tr');
        const triggerBadge = getTriggerBadgeHtml(wf.trigger_type);
        const statusBadge = wf.status === 'active'
          ? '<span class="badge badge-success">Active</span>'
          : '<span class="badge badge-subtle">Paused</span>';

        const stepCount = Array.isArray(wf.steps) ? wf.steps.length : 0;
        const stepsPreview = (wf.steps || []).map(s => s.type).join(' &rarr; ') || '0 steps';

        tr.innerHTML = `
          <td>
            <strong>${escapeHtml(wf.name)}</strong>
            ${wf.description ? `<br><small class="text-muted">${escapeHtml(wf.description)}</small>` : ''}
          </td>
          <td>${triggerBadge}</td>
          <td>
            <span class="badge badge-outline">${stepCount} steps</span>
            <small class="text-muted text-xs block">${escapeHtml(stepsPreview)}</small>
          </td>
          <td>${statusBadge}</td>
          <td><small class="text-muted">${formatDate(wf.created_at)}</small></td>
          <td class="text-right">
            <button type="button" class="btn btn-primary btn-xs btn-run-workflow" data-id="${wf.id}" data-name="${escapeHtml(wf.name)}">
              ⚡ Run
            </button>
            <button type="button" class="btn btn-outline btn-xs btn-delete-workflow" data-id="${wf.id}" data-name="${escapeHtml(wf.name)}">
              🗑️
            </button>
          </td>
        `;

        tbody.appendChild(tr);
      });

      // Hook up Run & Delete buttons
      tbody.querySelectorAll('.btn-run-workflow').forEach(btn => {
        btn.addEventListener('click', () => {
          openRunModal(btn.dataset.id, btn.dataset.name);
        });
      });

      tbody.querySelectorAll('.btn-delete-workflow').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id;
          const name = btn.dataset.name;
          if (confirm(`Are you sure you want to delete workflow "${name}"?`)) {
            try {
              await apiRequest(`/api/workflows/${id}`, { method: 'DELETE' });
              showAlert('dash-alert', `Workflow "${name}" deleted successfully.`, 'success');
              fetchWorkflows();
              fetchDashboardStats();
            } catch (err) {
              showAlert('dash-alert', err.message || 'Failed to delete workflow', 'danger');
            }
          }
        });
      });

    } catch (err) {
      if (loadingEl) loadingEl.style.display = 'none';
      console.error('Failed to fetch workflows:', err);
    }
  }

  // =========================================================================
  // F-UI-04: WORKFLOW BUILDER MODAL
  // =========================================================================
  function initWorkflowBuilder() {
    const modal = document.getElementById('workflow-builder-modal');
    const openBtns = [
      document.getElementById('open-create-workflow-btn'),
      document.getElementById('btn-create-workflow-action'),
      document.getElementById('empty-state-create-btn')
    ].filter(Boolean);

    const closeBtn = document.getElementById('close-builder-modal');
    const cancelBtn = document.getElementById('cancel-builder-modal');
    const form = document.getElementById('workflow-builder-form');
    const loadSampleBtn = document.getElementById('btn-load-sample-steps');
    const addStepBtn = document.getElementById('btn-add-step');
    const stepsContainer = document.getElementById('steps-list-container');

    let currentSteps = [];

    const defaultThreeSteps = [
      {
        id: 's1_extract',
        name: 'Extract Document Entities',
        type: 'doc_extraction',
        order: 1,
        config: { fields: ['invoice_number', 'vendor_name', 'total_amount', 'payment_terms'] }
      },
      {
        id: 's2_classify',
        name: 'Classify Urgency & Priority',
        type: 'classification',
        order: 2,
        config: {
          input: '{{steps.s1_extract.output.fields.total_amount}}',
          categories: ['Low Expense (<$500)', 'Standard Expense ($500-$5k)', 'High-Value Enterprise Expense (>$5k)']
        }
      },
      {
        id: 's3_synth',
        name: 'Synthesize Executive Action Brief',
        type: 'synthesis',
        order: 3,
        config: {
          prompt: 'Generate CFO executive approval briefing and ERP routing action items',
          format: 'markdown'
        }
      }
    ];

    function renderStepsList() {
      if (!stepsContainer) return;
      stepsContainer.innerHTML = '';

      if (currentSteps.length === 0) {
        stepsContainer.innerHTML = '<p class="text-muted text-xs">No steps added. Click "+ Add Custom Step" or "Load Standard 3-Step AI Pipeline".</p>';
        return;
      }

      currentSteps.forEach((step, idx) => {
        const card = document.createElement('div');
        card.className = 'step-item-card';
        card.innerHTML = `
          <div class="step-item-header">
            <div>
              <strong>Step ${idx + 1}: ${escapeHtml(step.name)}</strong>
              <span class="step-type-badge">&bull; ${step.type}</span>
            </div>
            <button type="button" class="btn btn-ghost btn-xs btn-remove-step" data-index="${idx}">&times;</button>
          </div>
          <div class="step-item-config text-xs text-muted">
            <code>${JSON.stringify(step.config || {})}</code>
          </div>
        `;
        stepsContainer.appendChild(card);
      });

      stepsContainer.querySelectorAll('.btn-remove-step').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.index, 10);
          currentSteps.splice(idx, 1);
          renderStepsList();
        });
      });
    }

    function openModal() {
      currentSteps = [...defaultThreeSteps];
      renderStepsList();
      if (modal) modal.style.display = 'flex';
    }

    function closeModal() {
      if (modal) modal.style.display = 'none';
      if (form) form.reset();
    }

    openBtns.forEach(btn => btn.addEventListener('click', openModal));
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    if (loadSampleBtn) {
      loadSampleBtn.addEventListener('click', () => {
        currentSteps = [...defaultThreeSteps];
        renderStepsList();
      });
    }

    if (addStepBtn) {
      addStepBtn.addEventListener('click', () => {
        const type = prompt('Choose step processor type: doc_extraction, classification, synthesis', 'doc_extraction');
        if (!type) return;
        const name = prompt('Enter step title:', `${type} step`);
        currentSteps.push({
          id: `step_${currentSteps.length + 1}`,
          name: name || `${type} processor`,
          type: type.trim(),
          order: currentSteps.length + 1,
          config: {}
        });
        renderStepsList();
      });
    }

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('wf-name-input').value.trim();
        const description = document.getElementById('wf-desc-input').value.trim();
        const trigger_type = document.getElementById('wf-trigger-type').value;

        if (currentSteps.length === 0) {
          showAlert('builder-alert', 'Workflow must have at least one processing step', 'danger');
          return;
        }

        const payload = {
          name,
          description,
          trigger_type,
          trigger_config: {},
          steps: currentSteps,
          status: 'active'
        };

        const submitBtn = document.getElementById('save-workflow-submit-btn');
        submitBtn.disabled = true;

        try {
          await apiRequest('/api/workflows', {
            method: 'POST',
            body: JSON.stringify(payload)
          });

          closeModal();
          showAlert('dash-alert', `Workflow "${name}" created successfully!`, 'success');
          fetchWorkflows();
          fetchDashboardStats();
        } catch (err) {
          showAlert('builder-alert', err.message || 'Failed to save workflow', 'danger');
        } finally {
          submitBtn.disabled = false;
        }
      });
    }
  }

  // =========================================================================
  // F-UI-05: INTERACTIVE RUN MODAL & TRIGGER UI
  // =========================================================================
  function initRunModal() {
    const modal = document.getElementById('run-modal');
    const closeBtn = document.getElementById('close-run-modal');
    const cancelBtn = document.getElementById('cancel-run-modal');
    const form = document.getElementById('run-workflow-form');
    const payloadInput = document.getElementById('run-payload-input');
    const nameDisplay = document.getElementById('run-workflow-name-display');
    const progressEl = document.getElementById('run-progress-state');
    const submitBtn = document.getElementById('trigger-run-btn');

    const sampleInvoice = `INVOICE #INV-2026-9041
Vendor: ACME Global Technologies Inc.
Total: $14,250.00
Payment Terms: Net 30
Line Items: Enterprise Cloud Suite 1 Year License`;

    const sampleLead = `Inbound Lead: Elena Rostova
Company: Fintech Solutions
Employees: 2,500
Budget: $85,000 ARR
Urgency: Q4 Deployment`;

    document.querySelectorAll('.btn-sample-run').forEach(btn => {
      btn.addEventListener('click', () => {
        if (payloadInput) {
          payloadInput.value = btn.dataset.sample === 'invoice' ? sampleInvoice : sampleLead;
        }
      });
    });

    function closeModal() {
      if (modal) modal.style.display = 'none';
      if (progressEl) progressEl.style.display = 'none';
      if (submitBtn) submitBtn.disabled = false;
    }

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const workflowId = state.currentRunWorkflowId;
        const text = payloadInput.value.trim();

        if (!workflowId) return;

        submitBtn.disabled = true;
        if (progressEl) progressEl.style.display = 'flex';

        // Check if text is JSON or raw string
        let payload = text;
        try {
          payload = JSON.parse(text);
        } catch {
          payload = { text };
        }

        try {
          const res = await apiRequest(`/api/workflows/${workflowId}/run`, {
            method: 'POST',
            body: JSON.stringify({ payload })
          });

          closeModal();
          showAlert('dash-alert', `Execution triggered! Run ID: ${res.execution_id}`, 'success');

          // Refresh executions & stats
          await fetchExecutions();
          await fetchDashboardStats();

          // Immediately open trace modal
          if (res.execution_id) {
            openTraceModal(res.execution_id);
          }
        } catch (err) {
          if (progressEl) progressEl.style.display = 'none';
          submitBtn.disabled = false;
          showAlert('run-alert', err.message || 'Execution failed to run', 'danger');
        }
      });
    }
  }

  function openRunModal(workflowId, workflowName) {
    state.currentRunWorkflowId = workflowId;
    const modal = document.getElementById('run-modal');
    const nameDisplay = document.getElementById('run-workflow-name-display');
    const payloadInput = document.getElementById('run-payload-input');

    if (nameDisplay) nameDisplay.textContent = workflowName || workflowId;
    if (payloadInput && !payloadInput.value) {
      payloadInput.value = `INVOICE #INV-2026-9041\nVendor: ACME Global Technologies Inc.\nTotal: $14,250.00\nPayment Terms: Net 30`;
    }

    if (modal) modal.style.display = 'flex';
  }

  // =========================================================================
  // F-UI-06: EXECUTION HISTORY & REAL-TIME POLLING (F-UI-08)
  // =========================================================================
  async function fetchExecutions() {
    const loadingEl = document.getElementById('executions-loading');
    const emptyEl = document.getElementById('executions-empty-state');
    const tableContainer = document.getElementById('executions-table-container');
    const tbody = document.getElementById('executions-tbody');
    const filterSelect = document.getElementById('execution-status-filter');

    const statusFilter = filterSelect ? filterSelect.value : '';
    const query = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';

    try {
      const res = await apiRequest(`/api/executions${query}`);
      state.executions = res.executions || [];

      if (loadingEl) loadingEl.style.display = 'none';

      if (!state.executions || state.executions.length === 0) {
        if (emptyEl) emptyEl.style.display = 'block';
        if (tableContainer) tableContainer.style.display = 'none';
        return;
      }

      if (emptyEl) emptyEl.style.display = 'none';
      if (tableContainer) tableContainer.style.display = 'block';
      if (!tbody) return;

      tbody.innerHTML = '';
      let hasRunning = false;

      state.executions.forEach(exec => {
        if (exec.status === 'running' || exec.status === 'pending') {
          hasRunning = true;
        }

        const tr = document.createElement('tr');
        const statusBadge = getExecutionStatusBadge(exec.status);
        const triggerBadge = getTriggerBadgeHtml(exec.trigger_type);
        const durationText = exec.duration_ms !== null && exec.duration_ms !== undefined
          ? `${exec.duration_ms} ms`
          : '-';

        tr.innerHTML = `
          <td>
            <code class="code-font text-xs">${escapeHtml(exec.id)}</code>
          </td>
          <td>${escapeHtml(exec.workflow_id)}</td>
          <td>${triggerBadge}</td>
          <td>${statusBadge}</td>
          <td><span class="code-font text-xs">${durationText}</span></td>
          <td><small class="text-muted">${formatDate(exec.started_at)}</small></td>
          <td class="text-right">
            <button type="button" class="btn btn-outline btn-xs btn-inspect-trace" data-id="${exec.id}">
              🔍 Trace
            </button>
          </td>
        `;

        tbody.appendChild(tr);
      });

      // Hook up trace buttons
      tbody.querySelectorAll('.btn-inspect-trace').forEach(btn => {
        btn.addEventListener('click', () => {
          openTraceModal(btn.dataset.id);
        });
      });

      // F-UI-08: Setup or clear real-time polling interval
      if (hasRunning) {
        if (!state.pollTimer) {
          state.pollTimer = setInterval(() => {
            fetchExecutions();
            fetchDashboardStats();
          }, 3000);
        }
      } else {
        if (state.pollTimer) {
          clearInterval(state.pollTimer);
          state.pollTimer = null;
        }
      }

    } catch (err) {
      if (loadingEl) loadingEl.style.display = 'none';
      console.error('Failed to fetch executions:', err);
    }
  }

  // =========================================================================
  // F-UI-07: STEP-LEVEL TRACE INSPECTOR MODAL
  // =========================================================================
  function initTraceModal() {
    const modal = document.getElementById('trace-modal');
    const closeBtns = [
      document.getElementById('close-trace-modal'),
      document.getElementById('close-trace-btn')
    ].filter(Boolean);

    closeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        if (modal) modal.style.display = 'none';
      });
    });
  }

  async function openTraceModal(executionId) {
    const modal = document.getElementById('trace-modal');
    if (!modal) return;

    modal.style.display = 'flex';

    const execIdDisplay = document.getElementById('trace-execution-id');
    const statusBadge = document.getElementById('trace-status-badge');
    const durationDisplay = document.getElementById('trace-duration-display');
    const startedDisplay = document.getElementById('trace-started-display');
    const triggerDisplay = document.getElementById('trace-trigger-display');
    const errorBanner = document.getElementById('trace-error-banner');
    const errorMessage = document.getElementById('trace-error-message');
    const stepsContainer = document.getElementById('trace-steps-container');

    if (execIdDisplay) execIdDisplay.textContent = executionId;
    if (stepsContainer) stepsContainer.innerHTML = '<div class="spinner spinner-sm"></div> Loading trace logs...';
    if (errorBanner) errorBanner.style.display = 'none';

    try {
      const trace = await apiRequest(`/api/executions/${executionId}/trace`);
      const exec = trace.execution || {};
      const steps = trace.steps || [];

      if (statusBadge) {
        statusBadge.textContent = exec.status ? exec.status.toUpperCase() : 'UNKNOWN';
        statusBadge.className = `badge badge-${exec.status === 'completed' ? 'success' : exec.status === 'failed' ? 'danger' : 'warning'}`;
      }

      if (durationDisplay) durationDisplay.textContent = `${exec.duration_ms ?? 0} ms`;
      if (startedDisplay) startedDisplay.textContent = formatDate(exec.started_at);
      if (triggerDisplay) triggerDisplay.textContent = exec.trigger_type || 'manual';

      if (exec.status === 'failed' && exec.error_message) {
        if (errorBanner) errorBanner.style.display = 'block';
        if (errorMessage) errorMessage.textContent = exec.error_message;
      }

      // Render step accordions
      if (!stepsContainer) return;
      stepsContainer.innerHTML = '';

      if (steps.length === 0) {
        stepsContainer.innerHTML = '<p class="text-muted text-xs">No step logs recorded for this execution.</p>';
        return;
      }

      steps.forEach((step, idx) => {
        const accordion = document.createElement('div');
        accordion.className = `step-accordion ${idx === 0 ? 'open' : ''}`;

        const statusClass = step.status === 'success' ? 'badge-success' : step.status === 'failed' ? 'badge-danger' : 'badge-subtle';

        accordion.innerHTML = `
          <div class="step-accordion-header">
            <div>
              <strong>Step ${step.step_order || idx + 1}: ${escapeHtml(step.step_name)}</strong>
              <span class="badge badge-subtle code-font">${escapeHtml(step.step_type)}</span>
            </div>
            <div class="flex-gap">
              <span class="badge ${statusClass}">${step.status}</span>
              <span class="code-font text-xs text-muted">${step.duration_ms ?? 0} ms</span>
              <span class="accordion-toggle-icon">▼</span>
            </div>
          </div>
          <div class="step-accordion-body">
            <div class="step-io-grid">
              <div>
                <label class="form-label text-xs">Input Snapshot</label>
                <pre class="json-block"><code>${escapeHtml(JSON.stringify(step.input_data || {}, null, 2))}</code></pre>
              </div>
              <div>
                <label class="form-label text-xs">Output Snapshot</label>
                <pre class="json-block"><code>${escapeHtml(JSON.stringify(step.output_data || {}, null, 2))}</code></pre>
              </div>
            </div>
            ${step.error_details ? `
              <div class="alert alert-danger mt-3">
                <strong>Step Error:</strong>
                <pre class="code-font text-xs">${escapeHtml(JSON.stringify(step.error_details, null, 2))}</pre>
              </div>
            ` : ''}
          </div>
        `;

        const header = accordion.querySelector('.step-accordion-header');
        header.addEventListener('click', () => {
          accordion.classList.toggle('open');
        });

        stepsContainer.appendChild(accordion);
      });

    } catch (err) {
      if (stepsContainer) stepsContainer.innerHTML = `<p class="text-danger">Failed to load execution trace: ${escapeHtml(err.message)}</p>`;
    }
  }

  // =========================================================================
  // F-UI-09: ACCOUNT & BILLING CONTROLLER
  // =========================================================================
  function initBillingControls() {
    // Upgrade checkout buttons
    document.querySelectorAll('.btn-upgrade-checkout').forEach(btn => {
      btn.addEventListener('click', async () => {
        const planId = btn.dataset.plan;
        btn.disabled = true;
        try {
          const res = await apiRequest('/api/billing/checkout', {
            method: 'POST',
            body: JSON.stringify({
              planId,
              successUrl: window.location.origin + '/dashboard?checkout=success',
              cancelUrl: window.location.origin + '/dashboard?checkout=cancel'
            })
          });

          if (res.checkout_url) {
            window.location.href = res.checkout_url;
          } else {
            showAlert('dash-alert', 'Checkout session created.', 'success');
          }
        } catch (err) {
          showAlert('dash-alert', err.message || 'Failed to initialize checkout', 'danger');
        } finally {
          btn.disabled = false;
        }
      });
    });

    // Stripe Portal launcher
    const portalBtn = document.getElementById('btn-stripe-portal');
    if (portalBtn) {
      portalBtn.addEventListener('click', async () => {
        portalBtn.disabled = true;
        try {
          const res = await apiRequest('/api/billing/portal', {
            method: 'POST',
            body: JSON.stringify({
              returnUrl: window.location.origin + '/dashboard'
            })
          });

          if (res.portal_url) {
            window.location.href = res.portal_url;
          }
        } catch (err) {
          showAlert('dash-alert', err.message || 'Billing portal requires active paid subscription', 'warning');
        } finally {
          portalBtn.disabled = false;
        }
      });
    }
  }

  // Formatting utilities
  function getTriggerBadgeHtml(triggerType) {
    switch (triggerType) {
      case 'webhook': return '<span class="badge badge-primary">Webhook</span>';
      case 'file_upload': return '<span class="badge badge-warning">File Upload</span>';
      case 'manual':
      default: return '<span class="badge badge-subtle">Manual</span>';
    }
  }

  function getExecutionStatusBadge(status) {
    switch (status) {
      case 'completed': return '<span class="badge badge-success">Completed</span>';
      case 'failed': return '<span class="badge badge-danger">Failed</span>';
      case 'running': return '<span class="badge badge-warning">Running</span>';
      case 'pending': return '<span class="badge badge-subtle">Pending</span>';
      default: return `<span class="badge badge-subtle">${escapeHtml(status)}</span>`;
    }
  }

  function formatDate(isoStr) {
    if (!isoStr) return '-';
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return isoStr;
    }
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

  // Initialize on DOM load
  document.addEventListener('DOMContentLoaded', () => {
    initAuth();
    initDashboard();
  });
})();
