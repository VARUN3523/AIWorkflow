import { renderLayout } from './layout.js';

/**
 * Marketing Landing Page template (Feature F-UI-01)
 * High-converting modern B2B SaaS landing page with Hero, Value Prop,
 * Interactive Demo Widget, Pipeline Visualizer, Pricing Comparison Table, and Testimonials.
 */
export function renderLandingPage() {
  const body = `
  <!-- HERO SECTION -->
  <section class="hero-section" id="hero">
    <div class="container hero-container">
      <div class="hero-content">
        <div class="hero-pill-badge">
          <span class="pulse-dot"></span>
          <span>B2B AI Workflow Automation Engine</span>
        </div>
        <h1 class="hero-title">
          Automate High-Value Document &amp; Lead Workflows with
          <span class="gradient-text">Autonomous AI Pipelines</span>
        </h1>
        <p class="hero-subtitle">
          Turn complex enterprise invoices, inbound B2B sales leads, and unstructured customer documents into validated, structured data, high-accuracy classifications, and executive briefings in milliseconds.
        </p>

        <div class="hero-cta-group">
          <a href="/register" class="btn btn-primary btn-lg">
            <span>Start Free Trial (50 Runs/Mo)</span>
            <span class="btn-arrow">&rarr;</span>
          </a>
          <a href="#demo" class="btn btn-secondary btn-lg">
            <span class="btn-icon">⚡</span>
            <span>Test Live Demo Widget</span>
          </a>
        </div>

        <div class="hero-trust-bar">
          <div class="trust-item">
            <span class="trust-icon">🛡️</span>
            <span>Tenant-Isolated Workspaces</span>
          </div>
          <div class="trust-item">
            <span class="trust-icon">⚡</span>
            <span>Sub-50ms Pipeline Dispatch</span>
          </div>
          <div class="trust-item">
            <span class="trust-icon">💳</span>
            <span>Integrated Stripe Metering</span>
          </div>
        </div>
      </div>

      <div class="hero-visual">
        <div class="pipeline-card-preview">
          <div class="preview-header">
            <div class="preview-dots">
              <span class="dot red"></span>
              <span class="dot yellow"></span>
              <span class="dot green"></span>
            </div>
            <span class="preview-title">active_pipeline: enterprise_invoice_v2.json</span>
            <span class="badge badge-success">Live Status: 200 OK</span>
          </div>
          <div class="preview-body">
            <div class="pipeline-mini-step completed">
              <div class="step-num">01</div>
              <div class="step-meta">
                <strong>Trigger Ingestion</strong>
                <span>Webhook &bull; POST /api/workflows/triggers/...</span>
              </div>
              <span class="step-status">12ms</span>
            </div>
            <div class="pipeline-connector"></div>
            <div class="pipeline-mini-step completed">
              <div class="step-num">02</div>
              <div class="step-meta">
                <strong>Document Extraction</strong>
                <span>doc_extraction &bull; 5 key-value entities</span>
              </div>
              <span class="step-status">45ms</span>
            </div>
            <div class="pipeline-connector"></div>
            <div class="pipeline-mini-step completed">
              <div class="step-num">03</div>
              <div class="step-meta">
                <strong>AI Classification</strong>
                <span>classification &bull; High-Value Enterprise Expense</span>
              </div>
              <span class="step-status">38ms</span>
            </div>
            <div class="pipeline-connector"></div>
            <div class="pipeline-mini-step completed">
              <div class="step-num">04</div>
              <div class="step-meta">
                <strong>Executive Synthesis</strong>
                <span>synthesis &bull; CFO Brief &amp; ERP Action Items</span>
              </div>
              <span class="step-status">52ms</span>
            </div>
          </div>
          <div class="preview-footer">
            <span class="preview-stat">Total Pipeline Duration: <strong>147 ms</strong></span>
            <span class="preview-stat">Output Integrity: <strong>100% Persisted</strong></span>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- VALUE PROPOSITION SECTION -->
  <section class="value-prop-section" id="features">
    <div class="container">
      <div class="section-header text-center">
        <span class="section-tag">Enterprise Capabilities</span>
        <h2 class="section-title">Built for Mission-Critical Document Automation</h2>
        <p class="section-subtitle">
          Eliminate manual triage and fragile custom scripts with our hardened, multi-tenant AI workflow infrastructure.
        </p>
      </div>

      <div class="features-grid">
        <div class="feature-card">
          <div class="feature-icon-wrapper">
            <span class="feature-icon">📄</span>
          </div>
          <h3 class="feature-title">High-Accuracy Document Extraction</h3>
          <p class="feature-desc">
            Extract invoice numbers, vendor names, currency amounts, line items, and addresses from PDFs, spreadsheets, and text with zero regex fragility.
          </p>
          <ul class="feature-bullets">
            <li>Structured schema enforcement</li>
            <li>Defensive fallback on empty content</li>
            <li>Normalized numerical &amp; currency values</li>
          </ul>
        </div>

        <div class="feature-card">
          <div class="feature-icon-wrapper">
            <span class="feature-icon">🎯</span>
          </div>
          <h3 class="feature-title">Multi-Class AI Classification</h3>
          <p class="feature-desc">
            Categorize inbound leads, invoices, and support requests into business domains with deterministic confidence scoring and explicit reasoning chains.
          </p>
          <ul class="feature-bullets">
            <li>Confidence thresholds &amp; reasoning traces</li>
            <li>Custom priority classes (Urgent / Standard / Low)</li>
            <li>Automatic tagging for CRM &amp; ERP routing</li>
          </ul>
        </div>

        <div class="feature-card">
          <div class="feature-icon-wrapper">
            <span class="feature-icon">📝</span>
          </div>
          <h3 class="feature-title">Executive Action Synthesis</h3>
          <p class="feature-desc">
            Generate executive briefings, approval recommendations, and next-best actions from upstream extraction and classification context.
          </p>
          <ul class="feature-bullets">
            <li>Custom markdown and JSON formats</li>
            <li>Context-aware variable interpolation</li>
            <li>Actionable bullet points for Slack / Email</li>
          </ul>
        </div>

        <div class="feature-card">
          <div class="feature-icon-wrapper">
            <span class="feature-icon">🔒</span>
          </div>
          <h3 class="feature-title">Strict Multi-Tenant Isolation</h3>
          <p class="feature-desc">
            Enterprise security by construction. Every workflow, execution trace, and usage meter is strictly isolated to its workspace with RBAC controls.
          </p>
          <ul class="feature-bullets">
            <li>Tenant-scoped database queries</li>
            <li>IDOR-proof route guards (404/403)</li>
            <li>Role-based permissions (Owner, Admin, Member)</li>
          </ul>
        </div>

        <div class="feature-card">
          <div class="feature-icon-wrapper">
            <span class="feature-icon">🛡️</span>
          </div>
          <h3 class="feature-title">Zero-Crash Error Boundaries</h3>
          <p class="feature-desc">
            Graceful step-level error handling traps provider rejections and malformed inputs, marking failures without taking down the server.
          </p>
          <ul class="feature-bullets">
            <li>Step-level input/output snapshots</li>
            <li>Atomic failure state persistence</li>
            <li>Preserves prior step achievements</li>
          </ul>
        </div>

        <div class="feature-card">
          <div class="feature-icon-wrapper">
            <span class="feature-icon">💳</span>
          </div>
          <h3 class="feature-title">Usage Metering &amp; Stripe Billing</h3>
          <p class="feature-desc">
            Self-serve tiers with atomic quota enforcement. Pre-flight quota gatekeepers prevent overage, backed by Stripe checkout and portal sessions.
          </p>
          <ul class="feature-bullets">
            <li>Atomic monthly execution meters</li>
            <li>Signed Stripe webhook processing</li>
            <li>Seamless 1-click self-serve upgrades</li>
          </ul>
        </div>
      </div>
    </div>
  </section>

  <!-- PIPELINE ARCHITECTURE VISUALIZATION -->
  <section class="pipeline-section" id="pipeline">
    <div class="container">
      <div class="section-header text-center">
        <span class="section-tag">End-to-End Orchestration</span>
        <h2 class="section-title">The FlowAI Processing Pipeline</h2>
        <p class="section-subtitle">
          How incoming payloads transform from raw unstructured inputs into audit-logged executive outcomes.
        </p>
      </div>

      <div class="pipeline-visual-diagram">
        <div class="diagram-step">
          <div class="diagram-step-badge">Phase 01</div>
          <div class="diagram-step-card">
            <span class="diagram-icon">📥</span>
            <h4>Trigger Ingestion</h4>
            <p>Webhook, multipart file upload, or manual dashboard run with quota pre-flight check.</p>
            <div class="diagram-chips">
              <span class="chip">POST /triggers/...</span>
              <span class="chip">Rate Limit Guard</span>
            </div>
          </div>
        </div>

        <div class="diagram-arrow">&rarr;</div>

        <div class="diagram-step">
          <div class="diagram-step-badge">Phase 02</div>
          <div class="diagram-step-card">
            <span class="diagram-icon">🔍</span>
            <h4>Doc Extraction</h4>
            <p>Parses entity fields, dates, vendor names, numbers, and cleans raw document text.</p>
            <div class="diagram-chips">
              <span class="chip">doc_extraction</span>
              <span class="chip">Entity Schema</span>
            </div>
          </div>
        </div>

        <div class="diagram-arrow">&rarr;</div>

        <div class="diagram-step">
          <div class="diagram-step-badge">Phase 03</div>
          <div class="diagram-step-card">
            <span class="diagram-icon">📊</span>
            <h4>AI Classification</h4>
            <p>Scores urgency, budget tier, and category tags with confidence reasoning.</p>
            <div class="diagram-chips">
              <span class="chip">classification</span>
              <span class="chip">Confidence Metric</span>
            </div>
          </div>
        </div>

        <div class="diagram-arrow">&rarr;</div>

        <div class="diagram-step">
          <div class="diagram-step-badge">Phase 04</div>
          <div class="diagram-step-card">
            <span class="diagram-icon">🚀</span>
            <h4>Action Synthesis</h4>
            <p>Generates structured summary brief, action items, and audit-logged step trace.</p>
            <div class="diagram-chips">
              <span class="chip">synthesis</span>
              <span class="chip">Immutable Trace</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- LIVE INTERACTIVE DEMO WIDGET -->
  <section class="demo-section" id="demo">
    <div class="container">
      <div class="section-header text-center">
        <span class="section-tag">Live Interactive Simulator</span>
        <h2 class="section-title">Test the AI Workflow Engine in Real Time</h2>
        <p class="section-subtitle">
          Select a sample enterprise document below, trigger the pipeline, and inspect the real-time extraction, classification, and synthesis outputs.
        </p>
      </div>

      <div class="demo-widget-wrapper" id="demo-widget">
        <div class="demo-toolbar">
          <div class="demo-presets">
            <label class="demo-label">Select Sample Document:</label>
            <div class="btn-group" role="group">
              <button type="button" class="btn btn-sm btn-outline active" data-preset="invoice">AP Vendor Invoice</button>
              <button type="button" class="btn btn-sm btn-outline" data-preset="lead">Enterprise Sales Lead</button>
              <button type="button" class="btn btn-sm btn-outline" data-preset="ticket">Escalated Support Ticket</button>
            </div>
          </div>
          <div class="demo-action">
            <button type="button" id="demo-simulate-btn" class="btn btn-primary btn-sm">
              <span class="btn-icon">⚡</span> Run Live Pipeline Simulation
            </button>
          </div>
        </div>

        <div class="demo-columns">
          <!-- Left: Input Document Preview -->
          <div class="demo-col">
            <div class="demo-card">
              <div class="demo-card-header">
                <span class="demo-card-title">Input Document Payload</span>
                <span class="badge badge-subtle" id="demo-doc-type">text/plain &bull; 842 bytes</span>
              </div>
              <div class="demo-card-body">
                <textarea id="demo-input-text" class="demo-textarea" rows="12" spellcheck="false"></textarea>
              </div>
            </div>
          </div>

          <!-- Right: Interactive Pipeline Output -->
          <div class="demo-col">
            <div class="demo-card">
              <div class="demo-card-header">
                <span class="demo-card-title">Real-Time Step Trace &amp; Output</span>
                <span class="badge badge-success" id="demo-pipeline-status">Ready</span>
              </div>
              <div class="demo-card-body">
                <div class="demo-tabs">
                  <button type="button" class="demo-tab-btn active" data-tab="extraction">1. Extraction</button>
                  <button type="button" class="demo-tab-btn" data-tab="classification">2. Classification</button>
                  <button type="button" class="demo-tab-btn" data-tab="synthesis">3. Synthesis</button>
                  <button type="button" class="demo-tab-btn" data-tab="trace">Full Trace JSON</button>
                </div>

                <div class="demo-tab-content">
                  <div class="demo-pane active" id="pane-extraction">
                    <div class="pane-summary">
                      <div class="stat-badge">Entities: <strong id="stat-entities">5 Extracted</strong></div>
                      <div class="stat-badge">Latency: <strong>34 ms</strong></div>
                    </div>
                    <pre class="code-preview"><code id="code-extraction"></code></pre>
                  </div>

                  <div class="demo-pane" id="pane-classification">
                    <div class="pane-summary">
                      <div class="stat-badge">Category: <strong id="stat-category">High-Value Enterprise Expense</strong></div>
                      <div class="stat-badge">Confidence: <strong id="stat-confidence">0.96</strong></div>
                    </div>
                    <pre class="code-preview"><code id="code-classification"></code></pre>
                  </div>

                  <div class="demo-pane" id="pane-synthesis">
                    <div class="pane-summary">
                      <div class="stat-badge">Action Status: <strong>Approved for CFO Queue</strong></div>
                      <div class="stat-badge">Latency: <strong>48 ms</strong></div>
                    </div>
                    <pre class="code-preview"><code id="code-synthesis"></code></pre>
                  </div>

                  <div class="demo-pane" id="pane-trace">
                    <pre class="code-preview"><code id="code-trace"></code></pre>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- PRICING COMPARISON TABLE -->
  <section class="pricing-section" id="pricing">
    <div class="container">
      <div class="section-header text-center">
        <span class="section-tag">Transparent SaaS Pricing</span>
        <h2 class="section-title">Scale Without Surprise Invoices</h2>
        <p class="section-subtitle">
          Start on our generous free tier with zero credit card required. Upgrade as your automated pipeline volume expands.
        </p>
      </div>

      <div class="pricing-grid">
        <!-- FREE TIER -->
        <div class="pricing-card">
          <div class="pricing-header">
            <h3 class="tier-name">Free / Trial</h3>
            <p class="tier-desc">Ideal for developers prototyping document extraction workflows.</p>
            <div class="tier-price">
              <span class="price-currency">$</span>
              <span class="price-amount">0</span>
              <span class="price-period">/ month</span>
            </div>
          </div>
          <div class="pricing-features">
            <div class="quota-highlight">
              <strong>50 workflow runs</strong> / month included
            </div>
            <ul>
              <li>Up to 3 active workflows</li>
              <li>Manual run trigger</li>
              <li>Document Extraction step</li>
              <li>Basic AI Classification</li>
              <li>Step-level trace inspection</li>
              <li>Community forum support</li>
            </ul>
          </div>
          <div class="pricing-action">
            <a href="/register" class="btn btn-outline btn-block">Get Started Free</a>
          </div>
        </div>

        <!-- STARTER TIER (POPULAR) -->
        <div class="pricing-card featured">
          <div class="popular-ribbon">Most Popular</div>
          <div class="pricing-header">
            <h3 class="tier-name">Starter</h3>
            <p class="tier-desc">For growing teams automating invoice, lead, and ticket pipelines.</p>
            <div class="tier-price">
              <span class="price-currency">$</span>
              <span class="price-amount">29</span>
              <span class="price-period">/ month</span>
            </div>
          </div>
          <div class="pricing-features">
            <div class="quota-highlight">
              <strong>1,000 workflow runs</strong> / month included
            </div>
            <ul>
              <li>Up to 25 active workflows</li>
              <li>Public Webhook triggers</li>
              <li>Multipart file upload triggers</li>
              <li>Document Extraction &amp; Classification</li>
              <li>Executive Action Synthesis</li>
              <li>Automated usage alerts</li>
              <li>Standard email support</li>
            </ul>
          </div>
          <div class="pricing-action">
            <a href="/register?plan=starter" class="btn btn-primary btn-block">Upgrade to Starter</a>
          </div>
        </div>

        <!-- PRO TIER -->
        <div class="pricing-card">
          <div class="pricing-header">
            <h3 class="tier-name">Pro Enterprise</h3>
            <p class="tier-desc">High-throughput automation for mid-market and enterprise operations.</p>
            <div class="tier-price">
              <span class="price-currency">$</span>
              <span class="price-amount">99</span>
              <span class="price-period">/ month</span>
            </div>
          </div>
          <div class="pricing-features">
            <div class="quota-highlight">
              <strong>10,000 workflow runs</strong> / month included
            </div>
            <ul>
              <li>Unlimited active workflows</li>
              <li>All triggers &amp; pipeline steps</li>
              <li>Priority AI execution queue</li>
              <li>Multi-member workspace RBAC</li>
              <li>Custom extraction schema validation</li>
              <li>Stripe Customer Billing Portal</li>
              <li>Dedicated priority support &amp; SLA</li>
            </ul>
          </div>
          <div class="pricing-action">
            <a href="/register?plan=pro" class="btn btn-outline btn-block">Upgrade to Pro</a>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- CUSTOMER TESTIMONIALS -->
  <section class="testimonials-section" id="testimonials">
    <div class="container">
      <div class="section-header text-center">
        <span class="section-tag">Customer Trust</span>
        <h2 class="section-title">Trusted by Modern Operations Teams</h2>
        <p class="section-subtitle">
          See how leading organizations accelerate document processing and lead routing with FlowAI.
        </p>
      </div>

      <div class="testimonials-grid">
        <div class="testimonial-card">
          <div class="rating-stars">★★★★★</div>
          <p class="testimonial-quote">
            &ldquo;FlowAI reduced our AP invoice processing latency from 4 hours to 12 seconds. The step-level trace logs give our finance auditors 100% confidence.&rdquo;
          </p>
          <div class="testimonial-author">
            <div class="author-avatar">SJ</div>
            <div class="author-info">
              <strong>Sarah Jenkins</strong>
              <span>VP of Finance Operations, CloudScale Tech</span>
            </div>
          </div>
        </div>

        <div class="testimonial-card">
          <div class="rating-stars">★★★★★</div>
          <p class="testimonial-quote">
            &ldquo;Our SDR team qualifies inbound enterprise demo requests instantly. Inbound conversion jumped 38% because leads are categorized and routed in real time.&rdquo;
          </p>
          <div class="testimonial-author">
            <div class="author-avatar">MV</div>
            <div class="author-info">
              <strong>Marcus Vance</strong>
              <span>Head of Growth, DataPulse Analytics</span>
            </div>
          </div>
        </div>

        <div class="testimonial-card">
          <div class="rating-stars">★★★★★</div>
          <p class="testimonial-quote">
            &ldquo;The defensive failure boundaries and multi-tenant isolation made our security compliance review effortless. It simply doesn't crash.&rdquo;
          </p>
          <div class="testimonial-author">
            <div class="author-avatar">ER</div>
            <div class="author-info">
              <strong>Elena Rostova</strong>
              <span>Chief Technology Officer, FintechGlobal</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- FINAL CTA BANNER -->
  <section class="cta-banner-section">
    <div class="container">
      <div class="cta-banner-card">
        <div class="cta-banner-content">
          <h2>Ready to Automate Your Document Pipelines?</h2>
          <p>Get started with 50 free workflow executions every month. Set up your first autonomous AI pipeline in less than 3 minutes.</p>
          <div class="cta-actions">
            <a href="/register" class="btn btn-primary btn-lg">
              <span>Create Free Account</span>
              <span class="btn-arrow">&rarr;</span>
            </a>
            <a href="/login" class="btn btn-ghost btn-lg">Sign In to Dashboard</a>
          </div>
        </div>
      </div>
    </div>
  </section>
  `;

  return renderLayout({
    title: 'FlowAI | Autonomous B2B AI Workflow Automation SaaS',
    description: 'Automate enterprise document extraction, classification, and agentic workflows with autonomous AI pipelines.',
    body,
    scripts: ['/js/landing.js'],
    activeNav: 'home'
  });
}
