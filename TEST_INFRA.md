# End-to-End Test Suite Infrastructure (TEST_INFRA.md)

**Platform**: B2B AI Workflow Automation SaaS  
**Architect**: E2E Test Suite Architect (`test_writer_e2e_1`)  
**Standard**: Requirement-Driven Opaque-Box E2E Testing  
**Integrity Mode**: Development / Zero-Facade Guarantee  

---

## 1. Overview & Test Architecture

This document defines the comprehensive end-to-end (E2E) verification architecture for the B2B AI Workflow Automation SaaS platform. The verification suite is constructed directly from the authoritative product requirements in `ORIGINAL_REQUEST.md` (R1 through R5) and architectural contracts in `spec_miner_survey_1/handoff.md` and `explorer_arch_1/handoff.md`.

### Core Verification Principles
1. **Opaque-Box Requirement Fidelity**: Tests interact strictly via external interfaces (HTTP REST APIs, Webhook receivers, Multipart file uploads, and Dashboard views). They make zero assumptions about internal function names or private variables.
2. **Deterministic & Isolated Execution**: Tests run in-process using Node.js 26's native `DatabaseSync` (`:memory:` SQLite) and `supertest`, completing in seconds without external network dependencies or port collision conflicts on Windows.
3. **Zero-Facade / Real Logic Verification**: Tests assert real database side-effects, real scrypt password hashing, real HMAC-SHA256 signatures, real atomic quota meter increments, and real multi-step execution log persistence.
4. **Progressive Testability**: The suite features built-in milestone introspection. As workers complete implementation milestones (M1 Foundation/Auth, M2 Workflow Builder, M3 Engine/AI, M4 Billing/Stripe, M5 UI), the test runner seamlessly transitions gated tests from milestone-pending to active assertion execution with zero unhandled errors.

---

## 2. 4-Tier Testing Methodology

The test suite is structured into four distinct verification tiers, providing defense-in-depth across the entire system surface:

```
+---------------------------------------------------------------------------------+
|                                 TIER 4: SCENARIOS                               |
|   Real-world production journeys: AP Invoices, Lead Routing, SaaS Upgrade       |
+---------------------------------------------------------------------------------+
                                         ^
|                                 TIER 3: COMBINATIONS                            |
|   Cross-feature flows: Auth -> Workflow -> AI Pipeline -> Quota -> Audit Logs  |
+---------------------------------------------------------------------------------+
                                         ^
|                                 TIER 2: BOUNDARIES                              |
|   Edge cases, IDOR, empty docs, quota limits, HMAC tampering, cycle rejection   |
+---------------------------------------------------------------------------------+
                                         ^
|                                 TIER 1: COVERAGE                                |
|   >=5 test cases per feature area for R1, R2, R3, R4, R5 (Happy paths & APIs)   |
+---------------------------------------------------------------------------------+
```

### 2.1 Tier 1: Feature Coverage (>= 5 cases per feature area)
Verifies nominal functionality across all five core requirement areas:
- **Area 1: User Authentication & Workspaces (R2)**
  1. `T1-AUTH-01`: User registration creates account, default workspace, and issues secure session token.
  2. `T1-AUTH-02`: User login with valid credentials returns authentication token and workspace info.
  3. `T1-AUTH-03`: User logout terminates session; invalidated token cannot access `/api/auth/me`.
  4. `T1-AUTH-04`: Current user profile endpoint (`GET /api/auth/me`) returns active membership details.
  5. `T1-AUTH-05`: Workspace CRUD permits creating, updating, and listing workspaces for authenticated users.
- **Area 2: Workflow Builder & Management (R1)**
  1. `T1-WF-01`: Create workflow definition with webhook trigger and multi-step pipeline.
  2. `T1-WF-02`: Retrieve existing workflow by ID with complete trigger and step schema.
  3. `T1-WF-03`: Update workflow name, description, and step configurations.
  4. `T1-WF-04`: List all workflows belonging to caller workspace.
  5. `T1-WF-05`: Delete workflow and confirm removal from workspace catalog.
- **Area 3: Automated Execution Engine & AI Steps (R1)**
  1. `T1-ENG-01`: Manual run trigger executes workflow end-to-end and returns execution record.
  2. `T1-ENG-02`: Document Extraction step extracts structured key-value fields and text metadata.
  3. `T1-ENG-03`: Classification step categorizes input content with confidence and reasoning.
  4. `T1-ENG-04`: Synthesis step generates structured summary and action items from prior steps.
  5. `T1-ENG-05`: Execution trace logger records atomic step-level snapshots (inputs, outputs, durations).
- **Area 4: Subscription Billing & Metering (R3)**
  1. `T1-BILL-01`: Usage status endpoint (`GET /api/billing/usage`) returns current runs and plan ceiling.
  2. `T1-BILL-02`: Stripe Checkout session creation endpoint returns valid redirect URL for Starter/Pro tiers.
  3. `T1-BILL-03`: Stripe Customer Billing Portal session creation generates portal management URL.
  4. `T1-BILL-04`: Stripe webhook receiver processes `checkout.session.completed` and upgrades plan.
  5. `T1-BILL-05`: Atomic run meter increments counter upon each workflow execution.
- **Area 5: Web Application & UI Views (R4)**
  1. `T1-UI-01`: Marketing landing page (`GET /`) loads responsive HTML with hero, CTAs, and pricing tiers.
  2. `T1-UI-02`: Customer dashboard page (`GET /dashboard.html` or `/dashboard`) renders navigation and KPI containers.
  3. `T1-UI-03`: Dashboard metrics API returns summary stats (total workflows, total executions, success rate).
  4. `T1-UI-04`: Workflow execution history view renders filtered execution lists.
  5. `T1-UI-05`: Step-level trace inspector view renders JSON input/output accordions and duration badges.

### 2.2 Tier 2: Boundary & Corner Cases (>= 5 cases per feature area)
Stress-tests validation, security borders, resource limits, and error boundaries:
- **Area 1: Auth & Multi-Tenancy Boundaries (R2)**
  1. `T2-AUTH-01`: Registration rejects duplicate email addresses with case-insensitive matching (`User@Test.com` vs `user@test.com`).
  2. `T2-AUTH-02`: Authentication rejects expired, forged, or malformed bearer tokens with 401 Unauthorized.
  3. `T2-AUTH-03`: Cross-tenant IDOR attack: Tenant B attempting `GET /api/workflows/:tenantA_wf_id` receives 404/403.
  4. `T2-AUTH-04`: Cross-tenant execution attack: Tenant B attempting `POST /api/workflows/:tenantA_wf_id/run` is strictly blocked.
  5. `T2-AUTH-05`: Passwords with extreme lengths (> 1024 chars) or complex UTF-8 multibyte characters are handled safely without crash.
- **Area 2: Workflow & Trigger Boundaries (R1)**
  1. `T2-WF-01`: Webhook trigger with malformed/corrupted JSON body returns 400 without crashing engine.
  2. `T2-WF-02`: Webhook trigger with invalid or nonexistent token returns 404/401 and creates zero execution records.
  3. `T2-WF-03`: Workflow definition with zero processing steps is rejected by validation with 400 Bad Request.
  4. `T2-WF-04`: Workflow definition referencing nonexistent step variable (e.g. `{{steps.missing_step.output}}`) fails gracefully.
  5. `T2-WF-05`: Massive input payload (> 500KB text) is processed within memory limits without heap exhaustion.
- **Area 3: Execution Engine & Step Error Boundaries (R1)**
  1. `T2-ENG-01`: Completely empty input document produces graceful warning state without pipeline failure.
  2. `T2-ENG-02`: Step failure in step 2 of 3: step 1 output preserved, step 2 logged as failed, step 3 marked skipped, execution status marked failed.
  3. `T2-ENG-03`: Simulated AI step timeout or provider rejection fails gracefully with structured error message.
  4. `T2-ENG-04`: Unsupported or unknown step type in execution pipeline is caught and logged cleanly.
  5. `T2-ENG-05`: Non-string or null template interpolations are handled safely without TypeError unhandled rejections.
- **Area 4: Billing & Quota Enforcement Boundaries (R3)**
  1. `T2-BILL-01`: Exact quota limit boundary: execution at run 50/50 on Free tier succeeds.
  2. `T2-BILL-02`: Quota + 1 hard block: execution at run 51/50 is strictly blocked with HTTP 429 / 402 error.
  3. `T2-BILL-03`: Stripe webhook with invalid HMAC signature header is rejected with 400 Bad Request.
  4. `T2-BILL-04`: Duplicate Stripe webhook delivery with identical event ID is processed idempotently without double-upgrading.
  5. `T2-BILL-05`: Checkout request for invalid or unsupported tier identifier returns 400 Bad Request.
- **Area 5: Web UI & Dashboard Boundaries (R4)**
  1. `T2-UI-01`: Dashboard view for brand-new tenant with zero workflows renders clean empty state without UI errors.
  2. `T2-UI-02`: Execution trace inspector for nonexistent execution ID returns 404 cleanly.
  3. `T2-UI-03`: Execution history view with invalid filter parameters falls back gracefully to default pagination.
  4. `T2-UI-04`: Workflow name containing HTML/script tags is sanitized to prevent cross-site scripting (XSS).
  5. `T2-UI-05`: Extreme workflow name lengths (255+ characters) are handled cleanly without layout distortion.

### 2.3 Tier 3: Cross-Feature Combinations
Tests complex interactions spanning multiple subsystems:
1. `T3-COMBO-01`: **Full Tenant Lifecycle**: Register -> Auto-provision Workspace -> Create 3-Step Workflow -> Trigger Execution -> Meter Incremented -> Step Trace Verified.
2. `T3-COMBO-02`: **Quota Block & Stripe Self-Serve Recovery**: Run workflows until Free quota exhausted -> Verify run is blocked (429) -> Dispatch signed Stripe `checkout.session.completed` webhook -> Verify subscription becomes Starter -> Verify subsequent execution immediately succeeds.
3. `T3-COMBO-03`: **Webhook Trigger to Multi-Step AI Pipeline**: External public webhook payload received -> Dispatches execution -> Document Extraction -> Classification -> Synthesis -> Execution trace retrieved via authenticated API with full input/output snapshots.
4. `T3-COMBO-04`: **Multi-Tenant Concurrent Isolation**: Tenant A and Tenant B concurrently create workflows and trigger runs; verify Tenant B can neither read nor trigger Tenant A's workflows, and usage meters remain completely segregated.
5. `T3-COMBO-05`: **File Upload Trigger & Live Status Inspection**: Multipart file uploaded to trigger endpoint -> Execution queued and processed -> Client polls execution status until completion -> Persisted log trace verified.

### 2.4 Tier 4: Real-World Application Scenarios
Models production end-user domain workflows:
1. `T4-SCEN-01`: **Automated Accounts Payable (AP) Invoice Processing Pipeline**:
   - Ingests realistic multi-line enterprise vendor invoice (ACME Corp, Invoice #INV-2026-9921, Total $14,250.00).
   - Step 1 (Extraction): Extracts invoice number, vendor, total amount, line items, and payment terms.
   - Step 2 (Classification): Classifies invoice into `High-Value Enterprise Expense` based on amount > $10,000.
   - Step 3 (Synthesis): Synthesizes CFO approval brief with risk assessment, cost center GL coding, and payment due date alert.
2. `T4-SCEN-02`: **Inbound B2B SaaS Lead Qualification & Routing Pipeline**:
   - Ingests inbound enterprise demo request webhook (VP of Engineering, 2,500 employees, Q4 timeline).
   - Step 1 (Extraction): Extracts company size, decision-maker title, timeline, and tech stack requirements.
   - Step 2 (Classification): Classifies lead priority as `Enterprise Tier-1 (Urgent)` with 0.95 confidence.
   - Step 3 (Synthesis): Synthesizes personalized SDR executive response, calendly link prompt, and CRM battle card.
3. `T4-SCEN-03`: **Multi-Tenant Subscription Growth & Scale Journey**:
   - Organization registers on Free tier (50 runs limit).
   - Runs 50 document processing workflows; verifies 50th succeeds.
   - 51st run is gated with descriptive upgrade prompt.
   - Tenant upgrades to Pro plan via Stripe checkout; signed webhook arrives.
   - Workflow runs proceed unthrottled with 10,000 run ceiling; audit logs accurately reflect upgraded tier.

---

## 3. Test Directory & File Layout

```
ai_workflow_saas/
├── TEST_INFRA.md                          # (This document) Test architecture & strategy
├── TEST_READY.md                          # Test readiness summary & acceptance checklist
├── tests/
│   ├── fixtures/
│   │   ├── invoices.js                    # Sample invoice documents & expected schemas
│   │   ├── leads.js                       # Sample inbound lead payloads & schemas
│   │   ├── workflows.js                   # Pre-configured 3-step & boundary workflow definitions
│   │   ├── stripe.js                      # Realistic Stripe webhook payloads & signature helpers
│   │   └── auth_tenants.js                # Multi-tenant users, workspaces, credentials
│   └── e2e/
│       ├── harness.js                     # Test bootstrap, DB setup/teardown, Supertest wrapper, feature probe
│       ├── tier1_feature_coverage.test.js # Tier 1 test suite (>= 25 tests)
│       ├── tier2_boundary_corner.test.js  # Tier 2 test suite (>= 25 tests)
│       ├── tier3_cross_feature.test.js    # Tier 3 cross-feature suite (5 complex flows)
│       ├── tier4_real_world_scenarios.test.js # Tier 4 realistic domain scenarios (3 full journeys)
│       └── run_all.js                     # Master test runner with formatted scorecard
```

---

## 4. Execution Commands

### Run Master Test Runner (All Tiers)
```powershell
node tests/e2e/run_all.js
```

### Run Specific Test Tiers
```powershell
# Run Tier 1 Feature Coverage only
node tests/e2e/run_all.js --tier=1

# Run Tier 2 Boundaries only
node tests/e2e/run_all.js --tier=2

# Run Tier 3 Combinations only
node tests/e2e/run_all.js --tier=3

# Run Tier 4 Scenarios only
node tests/e2e/run_all.js --tier=4
```

### Run Via Native Node.js Test Runner
```powershell
node --test tests/e2e/*.test.js
```

---

## 5. Acceptance Criteria Traceability Matrix

| Acceptance Criterion (ORIGINAL_REQUEST.md) | Requirement | Primary Test IDs | Success Criteria |
|--------------------------------------------|-------------|------------------|------------------|
| Multi-step workflow runs end-to-end; output states & logs persisted | R1 | `T1-ENG-01`, `T1-ENG-05`, `T3-COMBO-01`, `T4-SCEN-01` | All steps transition `running` -> `success`; `step_execution_logs` records input/output snapshots and duration; execution marked `completed`. |
| Invalid workflow definitions or step failures fail gracefully | R1 | `T2-WF-01`, `T2-WF-03`, `T2-ENG-02`, `T2-ENG-04` | Structured error returned in JSON response; execution marked `failed`; service process never crashes. |
| User registration, login, logout & session management pass assertions | R2 | `T1-AUTH-01`, `T1-AUTH-02`, `T1-AUTH-03`, `T1-AUTH-04` | Register returns 201 + token; login returns 200 + token; logout revokes session; subsequent `/me` returns 401. |
| Cross-tenant access tests verify Tenant A resources strictly inaccessible to Tenant B | R2 | `T2-AUTH-03`, `T2-AUTH-04`, `T3-COMBO-04` | Tenant B queries for Tenant A workflows or executions strictly return 404 or 403. Zero data leakage. |
| Creation of checkout sessions & billing webhook handling | R3 | `T1-BILL-02`, `T1-BILL-04`, `T2-BILL-04`, `T3-COMBO-02` | Checkout generates session URL; valid signed webhook upgrades plan from Free to Starter/Pro. |
| Usage metering increments & blocks runs at plan limit | R3 | `T1-BILL-05`, `T2-BILL-01`, `T2-BILL-02`, `T4-SCEN-03` | Each execution increments usage counter; run 50 succeeds; run 51 returns 429 Quota Exceeded. |
| Web dashboard loads, displays workflows, and permits triggering execution | R4 | `T1-UI-01`, `T1-UI-02`, `T1-UI-03`, `T2-UI-01` | Marketing and dashboard HTML load 200 OK; workflows list and KPI metrics render correctly. |
| All test suites pass cleanly with zero unhandled exceptions | R5 | All suites via `tests/e2e/run_all.js` | 100% test pass rate, 0 uncaught exceptions, 0 unhandled promise rejections. |
