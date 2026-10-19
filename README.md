# B2B AI Workflow Automation SaaS

## 🚀 Product Overview
This product is a robust, production-grade B2B SaaS platform that provides automated, multi-step AI-driven workflows. It enables organizations to build and execute pipelines capable of ingesting documents, extracting structured data, classifying content, and synthesizing summaries or actionable intelligence using AI.

Designed with enterprise requirements in mind, the platform enforces strict multi-tenant isolation, Role-Based Access Control (RBAC), and quota-based metering. It includes a resilient execution engine that features granular step-by-step trace logging for auditing and debugging, and defensive error boundaries that prevent localized step failures from crashing the system.

### Key Capabilities
- **Multi-Tenant Workspaces:** Secure isolation of data, workflows, and executions per tenant.
- **Visual Workflow Builder (API-First):** Define multi-step pipelines where subsequent steps dynamically ingest outputs from previous steps via variable interpolation.
- **Trigger Versatility:** Trigger pipelines manually, via file uploads, or through secure webhooks.
- **Atomic Metering & Billing:** Integrated with Stripe for scalable subscription tiers (Free, Starter, Pro), enforcing strict concurrency and usage quotas.
- **Comprehensive Trace Logging:** Every pipeline execution generates granular, step-level traces including duration, inputs, outputs, and errors.

---

## 🛠 Setup & Initialization

### Prerequisites
- **Node.js**: v26 or higher (runs on Node v26 with native built-in `node:sqlite` and `node:test`).
- **SQLite**: Local database, handled natively by Node's built-in `node:sqlite` module without external binary dependencies.

### Installation
1. Clone the repository and navigate into the project directory:
   ```bash
   git clone <repository_url> ai_workflow_saas
   cd ai_workflow_saas
   ```
2. Install dependencies:
   ```bash
   npm install
   ```

### Environment Variables & Configuration
The application operates locally without external dependencies by default, utilizing mock services for AI and local SQLite storage. For production setups, you can configure:

- `PORT`: HTTP server port (Default: `3000`)
- `DATABASE_PATH`: Path to the SQLite database file (Default: `./data/saas.db`)
- `STRIPE_WEBHOOK_SECRET`: Secret used to verify Stripe webhook signatures (Default: fallback testing string)

*Database Initialization:* The database schema is automatically provisioned when the server starts. `initDb()` and `runMigrations()` will initialize all tables in the SQLite database path specified.

### Running the Application
Start the server:
```bash
npm start
```
The server will bind to port 3000 (or `PORT`). Access the dashboard at `http://localhost:3000`.

---

## 📁 Project Structure & Modules

The application is structured as a modular monolith, dividing functionality into independent domains:

- **`src/auth`**: User registration, login, and secure session management. Enforces authentication boundaries and workspace membership contexts.
- **`src/workspaces`**: Multi-tenant isolation domain. Manages tenant lifecycles, user memberships, and RBAC roles (`owner`, `admin`, `member`, `viewer`).
- **`src/engine`**: The core execution environment (`runner.js`). Safely resolves workflow variables, coordinates step processors, manages state transitions, and persists atomic traces via the `TraceLogger`.
- **`src/steps`**: Contains the implementations of various AI pipeline steps (e.g., `classification.js`, `doc_extraction.js`, `synthesis.js`, and `mock_ai.js`). Mock AI heuristic and regex processors operate asynchronously and yield the event loop (via `setImmediate`) to maintain non-blocking execution during heavy document extraction and classification.
- **`src/triggers`**: Event dispatchers that kick off workflow executions. Supports `manual.js` (on-demand), `file_upload.js` (multipart file uploads powered by `multer` with strict 15MB file size limit and streaming backpressure defense), and `webhook.js` (API-driven).
- **`src/billing`**: Handles quota metering, execution counting, tier limits, and Stripe integration (Checkout, Billing Portal, Webhook Idempotency).
- **`src/workflows`**: Provides CRUD operations for workflow configurations and definitions, enforcing tenant boundaries.
- **`src/ui`**: Server-rendered Web Dashboard, Landing page, and Auth views built seamlessly atop the API routes.
- **`src/db`**: Database configuration (`index.js`), SQLite native driver initialization, and schema layout (`schema.sql`).

---

## 🏗 Architecture & Data Flow

### Data Flow for Workflow Execution
1. **Trigger Event:** An event arrives via HTTP (Webhook, File Upload, or UI Manual Run).
2. **Quota Check (`src/billing`):** The system verifies the workspace's subscription tier and atomically increments the usage meter. If quota is exceeded, an HTTP 429 is returned.
3. **Engine Initialization (`src/engine`):** A new `workflow_executions` record is created, and the initial context (trigger payload) is established.
4. **Step Execution Loop (`src/steps`):**
   - For each configured step, the engine performs variable interpolation (e.g. `{{steps.extract.output.fields}}`).
   - The engine logs the step commencement via `TraceLogger`.
   - The specific step processor runs the business logic (e.g., Document Extraction).
   - Results (success or failure) are recorded atomically to `step_execution_logs`.
   - On failure, subsequent steps are marked as skipped, preventing fatal process crashes.
5. **Completion:** The main execution record is updated with total duration, final status, and an output summary.

---

## 🗄 Database Schema Documentation

The system utilizes SQLite with WAL journaling mode for optimal concurrency. 

| Table Name | Description |
|---|---|
| **`workspaces`** | Tenant accounts. Enforces isolation boundaries for all other data. |
| **`users`** | Application user accounts and credentials. |
| **`workspace_members`** | Maps users to workspaces with RBAC roles (`owner`, `admin`, `member`, `viewer`). |
| **`subscriptions`** | Tracks Stripe subscription statuses and active plan tiers (`free`, `starter`, `pro`). |
| **`usage_meters`** | Tracks monthly workflow executions and AI steps used for quota enforcement. |
| **`workflows`** | Stores AI pipeline configurations (steps, triggers) as serialized JSON arrays. |
| **`workflow_executions`** | High-level status and metadata for a given workflow run. |
| **`step_execution_logs`** | Granular trace logs detailing individual step durations, inputs, and outputs. |
| **`webhook_events`** | Records external webhook payloads to enforce idempotency and prevent double processing. |
| **`sessions`** | Secure authentication session store. |
| **`uploaded_files`** | Metadata and storage paths for files ingested via the file upload trigger. |

---

## 🔌 API Reference

### Authentication
- `POST /api/auth/register` - Register a new user and initialize a default workspace.
- `POST /api/auth/login` - Authenticate and create a session.
- `POST /api/auth/logout` - Invalidate the current session.
- `GET /api/auth/me` - Retrieve current user profile and workspaces.

### Workspaces
- `GET /api/workspaces` - List workspaces the user belongs to.
- `POST /api/workspaces` - Create a new workspace.
- `GET /api/workspaces/:id` - Get details of a specific workspace.
- `PUT /api/workspaces/:id` - Update workspace metadata.
- `DELETE /api/workspaces/:id` - Delete a workspace.
- `GET /api/workspaces/:id/members` - List workspace members.
- `POST /api/workspaces/:id/members` - Invite a new member (requires admin/owner).

### Workflows
- `GET /api/workflows` - List all workflows in the active workspace.
- `POST /api/workflows` - Define a new multi-step workflow.
- `GET /api/workflows/:id` - Retrieve workflow schema.
- `PUT /api/workflows/:id` - Update a workflow definition.
- `DELETE /api/workflows/:id` - Delete a workflow.

### Triggers & Executions
- `POST /api/workflows/triggers/webhook/:token` - Trigger a workflow via public webhook.
- `POST /api/workflows/triggers/manual` - Trigger a workflow manually with payload.
- `POST /api/workflows/triggers/upload/:id` - Trigger a workflow via multipart file upload.
- `POST /api/workflows/:id/run` - Alias to manually run a specific workflow ID.
- `GET /api/executions` - List paginated execution history.
- `GET /api/executions/:id` - Get summary metadata for a specific execution.
- `GET /api/executions/:id/trace` - Get the granular step-by-step trace logs of an execution.

### Dashboard UI & Billing
- `GET /api/dashboard/stats` - Fetch aggregated KPI metrics for the UI.
- `POST /api/billing/checkout` - Initialize Stripe checkout session.
- `POST /api/billing/portal` - Initialize Stripe customer portal.

---

## 🧪 Testing Guide

The project has a comprehensive testing infrastructure validating Core Capabilities, Defensive Boundaries, and End-to-End User Journeys. It leverages the native Node.js test runner (`node:test` and `node:assert`).

### Running Integration Tests
Tests integration across all subsystems, mocking external boundaries to test core logic.
```bash
npm test
```
*(Expect 199 passing tests across 58 suites)*

### Running End-to-End (E2E) Tests
Tests the full HTTP lifecycle, mounting the Express application and asserting responses via `supertest`.
```bash
npm run test:e2e
# or directly:
node --test tests/e2e/*.test.js
```
*(Expect 58 passing tests across 14 suites)*

### Full Test Suite
Together, all 257 tests (199 integration + 58 E2E) pass with zero errors.

### Test Architecture
- **E2E (`tests/e2e`)**: Validates API boundaries, Auth enforcement, Rate limiting, and full cross-feature journeys.
- **Integration (`tests/integration`)**: Validates Service logic, Database interactions, and specific module edge cases without HTTP overhead.
