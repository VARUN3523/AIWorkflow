import { renderLayout } from './layout.js';

/**
 * Render Login Page view
 */
export function renderLoginPage() {
  const body = `
  <section class="auth-section">
    <div class="container auth-container">
      <div class="auth-card">
        <div class="auth-header text-center">
          <div class="brand-logo justify-center">
            <span class="logo-icon">⚡</span>
            <span class="logo-text">Flow<span class="logo-accent">AI</span></span>
          </div>
          <h2 class="auth-title">Welcome Back</h2>
          <p class="auth-subtitle">Sign in to manage workflows, view traces, and monitor usage</p>
        </div>

        <div id="auth-alert" class="alert alert-danger" style="display: none;"></div>

        <form id="login-form" class="auth-form" method="POST" action="/api/auth/login">
          <div class="form-group">
            <label for="login-email" class="form-label">Work Email</label>
            <input type="email" id="login-email" name="email" class="form-control" placeholder="name@company.com" required autocomplete="email">
          </div>

          <div class="form-group">
            <div class="form-label-row">
              <label for="login-password" class="form-label">Password</label>
              <a href="#forgot" class="form-link-subtle">Forgot password?</a>
            </div>
            <input type="password" id="login-password" name="password" class="form-control" placeholder="••••••••" required autocomplete="current-password">
          </div>

          <button type="submit" id="login-submit-btn" class="btn btn-primary btn-block btn-lg">
            <span>Sign In to Console</span>
            <span class="btn-arrow">&rarr;</span>
          </button>
        </form>

        <div class="auth-footer text-center">
          <p>Don't have an account yet? <a href="/register" class="link-primary">Start Free Trial</a></p>
        </div>
      </div>
    </div>
  </section>
  `;

  return renderLayout({
    title: 'Sign In | FlowAI Console',
    description: 'Sign in to access your tenant workspace, workflows, and execution logs.',
    body,
    scripts: ['/js/app.js'],
    activeNav: 'login'
  });
}

/**
 * Render Register Page view
 */
export function renderRegisterPage() {
  const body = `
  <section class="auth-section">
    <div class="container auth-container">
      <div class="auth-card">
        <div class="auth-header text-center">
          <div class="brand-logo justify-center">
            <span class="logo-icon">⚡</span>
            <span class="logo-text">Flow<span class="logo-accent">AI</span></span>
          </div>
          <h2 class="auth-title">Create Your Free Account</h2>
          <p class="auth-subtitle">Includes 50 free workflow runs per month. No credit card required.</p>
        </div>

        <div id="auth-alert" class="alert alert-danger" style="display: none;"></div>

        <form id="register-form" class="auth-form" method="POST" action="/api/auth/register">
          <div class="form-group">
            <label for="reg-fullname" class="form-label">Full Name</label>
            <input type="text" id="reg-fullname" name="fullName" class="form-control" placeholder="Sarah Jenkins" required autocomplete="name">
          </div>

          <div class="form-group">
            <label for="reg-email" class="form-label">Work Email</label>
            <input type="email" id="reg-email" name="email" class="form-control" placeholder="sarah@cloudscale.com" required autocomplete="email">
          </div>

          <div class="form-group">
            <label for="reg-password" class="form-label">Password</label>
            <input type="password" id="reg-password" name="password" class="form-control" placeholder="At least 8 characters" required autocomplete="new-password">
          </div>

          <div class="form-group">
            <label for="reg-workspace" class="form-label">Workspace Name <span class="text-muted">(Optional)</span></label>
            <input type="text" id="reg-workspace" name="workspaceName" class="form-control" placeholder="CloudScale Operations">
          </div>

          <button type="submit" id="register-submit-btn" class="btn btn-primary btn-block btn-lg">
            <span>Create Account &amp; Launch Console</span>
            <span class="btn-arrow">&rarr;</span>
          </button>
        </form>

        <div class="auth-footer text-center">
          <p>Already have an account? <a href="/login" class="link-primary">Sign In</a></p>
        </div>
      </div>
    </div>
  </section>
  `;

  return renderLayout({
    title: 'Create Account | FlowAI Console',
    description: 'Start free with FlowAI B2B AI Workflow Automation.',
    body,
    scripts: ['/js/app.js'],
    activeNav: 'register'
  });
}
