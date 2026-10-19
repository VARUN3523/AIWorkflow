/**
 * FlowAI Landing Page Interactive Client Script (public/js/landing.js)
 * Implements Live Interactive Demo Widget and navigation smoothness
 */

(function () {
  'use strict';

  // Demo presets
  const DEMO_PRESETS = {
    invoice: {
      type: 'text/plain • 512 bytes (AP Vendor Invoice)',
      text: `INVOICE #INV-2026-8819
Date: October 9, 2026
Vendor: Apex Cloud Infrastructure Inc.
Recipient: Enterprise Operations
Payment Terms: Net 30
Line Items:
  1. Dedicated High-Memory GPU Compute Node - $8,400.00
  2. Multi-Region Fast VPC Peering Bandwidth - $1,250.00
  3. Enterprise Support SLA 24/7 - $1,800.00
Total Amount: $11,450.00 USD`,
      extraction: {
        step_id: "step_01_extract",
        processor: "doc_extraction",
        status: "success",
        duration_ms: 34,
        fields: {
          invoice_number: "INV-2026-8819",
          vendor: "Apex Cloud Infrastructure Inc.",
          payment_terms: "Net 30",
          total_amount: 11450.00,
          currency: "USD",
          line_item_count: 3
        }
      },
      classification: {
        step_id: "step_02_classify",
        processor: "classification",
        status: "success",
        duration_ms: 38,
        category: "High-Value Enterprise Expense",
        confidence: 0.96,
        reasoning: "Total amount $11,450.00 exceeds $10k threshold; vendor classified as Tier-1 Cloud Infrastructure.",
        tags: ["infrastructure", "cfo_review_required", "high_priority"]
      },
      synthesis: {
        step_id: "step_03_synth",
        processor: "synthesis",
        status: "success",
        duration_ms: 48,
        summary: "Vendor invoice INV-2026-8819 from Apex Cloud Infrastructure ($11,450.00) routed to CFO approval queue.",
        action_items: [
          "Flag for CFO signature authorization (exceeds $10,000 limit)",
          "Schedule Net 30 payment for November 8, 2026",
          "Allocate GL Code #6200 (Cloud Infrastructure & Hardware)"
        ]
      }
    },
    lead: {
      type: 'application/json • 480 bytes (Inbound Demo Request)',
      text: `Inbound Enterprise Demo Request
Contact: David Sterling
Role: VP of Engineering
Company: Global Fintech Solutions (3,200 employees)
Tech Stack: AWS, Postgres, Kafka
Requirements: Multi-tenant document processing with strict data boundary and automated Stripe billing.
Estimated Volume: 15,000 docs/mo
Budget: $50,000 - $100,000 ARR
Timeline: Immediate (Q4 Deployment)`,
      extraction: {
        step_id: "step_01_extract",
        processor: "doc_extraction",
        status: "success",
        duration_ms: 28,
        fields: {
          lead_name: "David Sterling",
          title: "VP of Engineering",
          company: "Global Fintech Solutions",
          employee_count: 3200,
          monthly_volume: 15000,
          estimated_arr_budget: "$50k-$100k"
        }
      },
      classification: {
        step_id: "step_02_classify",
        processor: "classification",
        status: "success",
        duration_ms: 35,
        category: "Enterprise Tier-1 (Urgent)",
        confidence: 0.98,
        reasoning: "VP-level title, >1,000 enterprise employees, and Q4 budget allocation indicate immediate buyer readiness.",
        tags: ["enterprise", "tier_1", "urgent_sdr"]
      },
      synthesis: {
        step_id: "step_03_synth",
        processor: "synthesis",
        status: "success",
        duration_ms: 42,
        summary: "Tier-1 enterprise inbound lead from Global Fintech Solutions (VP Eng, 3.2k employees). High priority deal.",
        action_items: [
          "Dispatch personalized SDR video email with calendly link within 5 minutes",
          "Assign Strategic Enterprise Account Executive (AE) in CRM",
          "Pre-provision sandbox workspace with Pro tier features"
        ]
      }
    },
    ticket: {
      type: 'text/plain • 390 bytes (Customer Support Ticket)',
      text: `Support Escalation #SEC-4091
Customer: HealthMetrics Corp (Pro Plan)
Subject: Production API Webhook 429 Rate Limit Alert
Details: Ingestion burst of 250 lab results encountered 429 Quota Exceeded error. Requesting quota headroom expansion or temporary boost for high-volume lab test run.
Severity: High`,
      extraction: {
        step_id: "step_01_extract",
        processor: "doc_extraction",
        status: "success",
        duration_ms: 22,
        fields: {
          ticket_id: "SEC-4091",
          customer_name: "HealthMetrics Corp",
          active_tier: "Pro Plan",
          error_code: "429 QUOTA_EXCEEDED",
          burst_volume: 250
        }
      },
      classification: {
        step_id: "step_02_classify",
        processor: "classification",
        status: "success",
        duration_ms: 29,
        category: "Urgent Customer Expansion Opportunity",
        confidence: 0.94,
        reasoning: "Pro customer encountering legitimate volume quota boundary; high likelihood of contract upsell.",
        tags: ["billing_support", "upsell_opportunity", "high_severity"]
      },
      synthesis: {
        step_id: "step_03_synth",
        processor: "synthesis",
        status: "success",
        duration_ms: 38,
        summary: "HealthMetrics Corp hit Pro monthly quota. Recommend immediate temporary +1k runs courtesy boost and account review.",
        action_items: [
          "Apply courtesy temporary burst quota in billing portal",
          "Notify Account Manager to propose Enterprise Custom tier",
          "Respond to customer with updated quota headroom confirmation"
        ]
      }
    }
  };

  function initDemoWidget() {
    const inputText = document.getElementById('demo-input-text');
    const docType = document.getElementById('demo-doc-type');
    const statusBadge = document.getElementById('demo-pipeline-status');
    const simulateBtn = document.getElementById('demo-simulate-btn');
    const presetButtons = document.querySelectorAll('[data-preset]');
    const tabButtons = document.querySelectorAll('.demo-tab-btn');
    const panes = document.querySelectorAll('.demo-pane');

    const codeExtraction = document.getElementById('code-extraction');
    const codeClassification = document.getElementById('code-classification');
    const codeSynthesis = document.getElementById('code-synthesis');
    const codeTrace = document.getElementById('code-trace');

    const statEntities = document.getElementById('stat-entities');
    const statCategory = document.getElementById('stat-category');
    const statConfidence = document.getElementById('stat-confidence');

    if (!inputText || !simulateBtn) return;

    let currentPreset = 'invoice';

    function loadPreset(key) {
      currentPreset = key;
      const data = DEMO_PRESETS[key];
      if (!data) return;

      inputText.value = data.text;
      if (docType) docType.textContent = data.type;
      renderOutputs(data);
    }

    function renderOutputs(data) {
      if (codeExtraction) codeExtraction.textContent = JSON.stringify(data.extraction, null, 2);
      if (codeClassification) codeClassification.textContent = JSON.stringify(data.classification, null, 2);
      if (codeSynthesis) codeSynthesis.textContent = JSON.stringify(data.synthesis, null, 2);

      const fullTrace = {
        execution_id: 'sim_' + Math.random().toString(36).slice(2, 10),
        status: 'completed',
        total_duration_ms: data.extraction.duration_ms + data.classification.duration_ms + data.synthesis.duration_ms,
        steps: [data.extraction, data.classification, data.synthesis]
      };
      if (codeTrace) codeTrace.textContent = JSON.stringify(fullTrace, null, 2);

      if (statEntities) {
        const entityCount = Object.keys(data.extraction.fields || {}).length;
        statEntities.textContent = entityCount + ' Extracted';
      }
      if (statCategory) statCategory.textContent = data.classification.category;
      if (statConfidence) statConfidence.textContent = data.classification.confidence;
    }

    // Preset button clicks
    presetButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        presetButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        loadPreset(btn.dataset.preset);
      });
    });

    // Tab buttons
    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        tabButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tabKey = btn.dataset.tab;

        panes.forEach(pane => {
          pane.classList.remove('active');
          if (pane.id === 'pane-' + tabKey) {
            pane.classList.add('active');
          }
        });
      });
    });

    // Run live simulation button
    simulateBtn.addEventListener('click', () => {
      if (statusBadge) {
        statusBadge.textContent = 'Processing Pipeline...';
        statusBadge.className = 'badge badge-warning';
      }
      simulateBtn.disabled = true;

      setTimeout(() => {
        const data = DEMO_PRESETS[currentPreset];
        renderOutputs(data);
        if (statusBadge) {
          statusBadge.textContent = 'Completed (200 OK)';
          statusBadge.className = 'badge badge-success';
        }
        simulateBtn.disabled = false;
      }, 350);
    });

    // Initial load
    loadPreset('invoice');
  }

  // Smooth scroll
  function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', function (e) {
        const targetId = this.getAttribute('href').slice(1);
        if (!targetId) return;
        const targetEl = document.getElementById(targetId);
        if (targetEl) {
          e.preventDefault();
          targetEl.scrollIntoView({ behavior: 'smooth' });
        }
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initDemoWidget();
    initSmoothScroll();
  });
})();
