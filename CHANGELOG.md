# Changelog

## [1.0.1] - 2026-10-10

### Fixed
- **Engine Trace Logging Signature (`src/engine/logger.js`, `src/engine/runner.js`)**:
  - Removed dangerous and confusing polymorphic argument parsing in `TraceLogger.recordStepSuccess` and `TraceLogger.recordStepFailure`. They now strictly accept positional arguments `(logId, data/error, durationMs, db)`.
  - Fixed assertion mismatch bugs in the test suite that surfaced due to incorrectly bound parameters (where `db` was implicitly matched to `durationMs`).
  - Fixed `runner.js` to correctly pass positional arguments to trace logger functions.
- **Trace Logger Vulnerability (`src/engine/logger.js`)**:
  - Removed a massive testing hack in `startStepLog` that was silently inserting dummy workflow definitions and workflow executions in the database if the specified execution ID was missing. This was a critical robustness and security risk in production.
- **File Upload Denial of Service (DoS) Vulnerability (`src/triggers/file_upload.js`)**:
  - Replaced an abusive `req.resume()` call during payload-too-large conditions (which safely avoided `ECONNRESET` but downloaded infinite payload sizes into memory/bandwidth) with `req.destroy()`. The server now correctly aborts malicious file uploads exceeding the 15MB limit without exhausting bandwidth.
  - **UPDATE (Self-Correction):** Using `req.destroy()` caused abrupt TCP teardowns resulting in client-side `ECONNRESET` instead of HTTP 413 responses. Replaced `req.destroy()` with `req.res.setHeader('Connection', 'close')` and `req.resume()`. This gracefully flushes the stream to prevent client blockages while properly emitting a 413 Payload Too Large error and instructing the OS to close the connection.
- **Engine Trace Logging & Workflow Execution Fix (`src/engine/runner.js`)**:
  - The previous fix moved the dummy workflow insertion hack from `logger.js` into `executeWorkflow`. This was removed entirely from production code. `executeWorkflow` no longer inserts ad-hoc workflows, preserving foreign key integrity in production.
- **Test Suite Enhancements (`tests/integration/m2_adversarial.test.js`)**:
  - Updated tests for `TraceLogger` to explicitly initialize necessary mock dependencies (dummy workflows and executions) since the testing hacks were removed from the production trace logger logic.
  - **UPDATE:** Reverted adversarial upload tests (ATTACK-2.5 and REMED-3.1) from swallowing `ECONNRESET` errors, properly asserting for HTTP 413. Added correct dummy workflow insertion for `ATTACK-1.7` to fix FOREIGN KEY constraint failures previously masked by the `runner.js` hack.

## [1.0.2] - 2026-10-10

### Documentation
- **Massive README rewrite**:
  - Added comprehensive Product Overview and architecture data flow description.
  - Documented setup instructions, prerequisites, and environment variable requirements.
  - Explained every module and its responsibilities across the `src` structure.
  - Updated the API Reference to include all domain endpoints.
  - Provided full database schema documentation covering tables and relationships.
  - Added a Testing Guide explaining E2E and Integration test runners.
  
### Chore
- **Code Quality Review**:
  - Removed dead code and unused imports across the codebase.
  - `src/billing/routes.js`: Removed unused `getTier` import.
  - `src/billing/stripe.js`: Removed unused `TIERS` import and unused `getSubscription` call in `createBillingPortalSession`.
  - `src/engine/runner.js`: Removed confusing and unused export of `PLAN_LIMITS` and `checkAndIncrementQuota` that belonged in the billing service.
  - Verified resource lifecycle management, finding no unclosed DB connections, and confirmed proper non-security error handling boundaries.

## [1.0.3] - 2026-10-11

### Performance & Optimization
- **File Upload Streaming Optimization (`src/triggers/file_upload.js`)**:
  - Installed `multer` and replaced the custom 130-line `parseMultipartFormData` buffer slicing implementation with a performant `multer` memory storage parser.
  - Enforces the 15MB file size ceiling (`MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024`) via busboy streaming backpressure without CPU or memory exhaustion, with a 10-file boundary (`files: 10`) to guard against multi-file heap flooding.
  - Preserves full compatibility with upload routes, JSON fallback payloads, MIME type checks, and structured 413 `PAYLOAD_TOO_LARGE` error contracts.
  - Hardened edge case handling: protected against undefined `req.headers`, case-insensitive `Content-Type` headers, mapped non-size `MulterError` codes to HTTP 400, and added safe filename fallbacks for `path.basename()`.
- **Asynchronous Non-Blocking Mock AI Engine (`src/steps/mock_ai.js`)**:
  - Refactored `mockExtractEntities`, `mockClassifyContent`, and `mockSynthesizeOutput` into asynchronous processors yielding the Node event loop via `setImmediate`.
  - Prevents event loop starvation during regex evaluations on large document strings.
  - Added type guards in category classification and synthesis context inspection to prevent runtime crashes on non-string inputs.
  - Updated `DocExtractionStep`, `ClassificationStep`, and `SynthesisStep` processors to await the non-blocking engine calls.

### Scripts & Documentation
- **Package Scripts (`package.json`)**:
  - Added `"test:e2e": "node --test tests/e2e/*.test.js"` script for dedicated end-to-end test execution.
  - Added `multer` dependency.
- **Documentation (`README.md`)**:
  - Updated Node.js runtime requirement to Node v26+ with native built-in `node:sqlite`.
  - Documented `multer` streaming architecture and 15MB file limit enforcement.
  - Updated Testing Guide with explicit `test:e2e` command and full 257-test coverage details.
