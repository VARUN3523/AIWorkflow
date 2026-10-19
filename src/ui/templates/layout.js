/**
 * Base HTML layout template for FlowAI B2B SaaS
 */
export function renderLayout({
  title = 'FlowAI | B2B AI Workflow Automation Platform',
  description = 'Autonomous enterprise AI workflow automation for document extraction, classification, and agentic pipelines.',
  body = '',
  scripts = [],
  styles = ['/css/style.css'],
  activeNav = 'home',
  user = null,
}) {
  const scriptTags = scripts
    .map((s) => `<script src="${s}" defer></script>`)
    .join('\n    ');

  const styleTags = styles
    .map((s) => `<link rel="stylesheet" href="${s}">`)
    .join('\n    ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220%22%20%22100%22><text y=%22.9em%22 font-size=%2290%22>⚡</text></svg>">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  ${styleTags}
  ${scriptTags}
</head>
<body class="flowai-app">
  <div class="site-wrapper">
    <header class="site-header">
      <div class="container header-container">
        <a href="/" class="brand-logo" aria-label="FlowAI Home">
          <span class="logo-icon">⚡</span>
          <span class="logo-text">Flow<span class="logo-accent">AI</span></span>
          <span class="badge badge-subtle">Enterprise</span>
        </a>

        <nav class="main-nav" aria-label="Main Navigation">
          <ul class="nav-links">
            <li><a href="/#features" class="nav-link ${activeNav === 'features' ? 'active' : ''}">Features</a></li>
            <li><a href="/#pipeline" class="nav-link ${activeNav === 'pipeline' ? 'active' : ''}">Pipeline</a></li>
            <li><a href="/#demo" class="nav-link ${activeNav === 'demo' ? 'active' : ''}">Interactive Demo</a></li>
            <li><a href="/#pricing" class="nav-link ${activeNav === 'pricing' ? 'active' : ''}">Pricing</a></li>
            <li><a href="/#testimonials" class="nav-link ${activeNav === 'testimonials' ? 'active' : ''}">Testimonials</a></li>
          </ul>
        </nav>

        <div class="header-actions">
          ${
            user
              ? `
            <a href="/dashboard" class="btn btn-primary btn-sm">
              <span class="btn-icon">📊</span> Console Dashboard
            </a>
            <button id="header-logout-btn" class="btn btn-ghost btn-sm">Sign Out</button>
          `
              : `
            <a href="/login" class="btn btn-ghost btn-sm">Sign In</a>
            <a href="/register" class="btn btn-primary btn-sm">Start Free Trial</a>
          `
          }
        </div>
      </div>
    </header>

    <main class="main-content">
      ${body}
    </main>

    <footer class="site-footer">
      <div class="container footer-container">
        <div class="footer-top">
          <div class="footer-brand">
            <div class="brand-logo">
              <span class="logo-icon">⚡</span>
              <span class="logo-text">Flow<span class="logo-accent">AI</span></span>
            </div>
            <p class="footer-tagline">
              Autonomous enterprise AI workflow automation. Extract, classify, and synthesize document intelligence at scale.
            </p>
            <div class="compliance-badges">
              <span class="badge badge-outline">SOC-2 Type II Ready</span>
              <span class="badge badge-outline">Multi-Tenant Isolated</span>
              <span class="badge badge-outline">99.99% Uptime SLA</span>
            </div>
          </div>

          <div class="footer-links-grid">
            <div class="footer-col">
              <h4>Platform</h4>
              <ul>
                <li><a href="/#features">Document Extraction</a></li>
                <li><a href="/#pipeline">AI Classification</a></li>
                <li><a href="/#pipeline">Executive Synthesis</a></li>
                <li><a href="/#demo">Interactive Simulator</a></li>
              </ul>
            </div>
            <div class="footer-col">
              <h4>Developers</h4>
              <ul>
                <li><a href="/api/workflows">REST API</a></li>
                <li><a href="/#pipeline">Webhook Triggers</a></li>
                <li><a href="/#pipeline">Multipart File Ingestion</a></li>
                <li><a href="/health">System Status</a></li>
              </ul>
            </div>
            <div class="footer-col">
              <h4>Enterprise</h4>
              <ul>
                <li><a href="/#pricing">Subscription Tiers</a></li>
                <li><a href="/register">Free 50 Runs/Mo</a></li>
                <li><a href="/login">Customer Portal</a></li>
                <li><a href="mailto:support@flowai.enterprise">Support & Security</a></li>
              </ul>
            </div>
          </div>
        </div>

        <div class="footer-bottom">
          <p>&copy; ${new Date().getFullYear()} FlowAI Systems Inc. All rights reserved. Built for high-volume enterprise document operations.</p>
          <div class="footer-legal">
            <a href="#privacy">Privacy Policy</a>
            <a href="#terms">Terms of Service</a>
            <a href="#security">Security Whitepaper</a>
          </div>
        </div>
      </div>
    </footer>
  </div>
</body>
</html>`;
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
