# Tabby-RDP: Automated Visual QA, Central Dashboard & Defect Injection

**Repository:** `meanaverage/tabby-rdp`

**Objective:** Build a comprehensive, self-hosted, automated visual QA system for Tabby-RDP that minimizes manual application testing and provides measurable evidence that the test suite can detect real visual defects.

## 1. Mission

We already have substantial automated test coverage, but we lack confidence that these tests catch visual problems.

Build an automated QA platform that answers three questions:

1. **Does Tabby-RDP function correctly?**
2. **Does Tabby-RDP render correctly across supported environments?**
3. **Can our test suite demonstrably detect visual defects when they occur?**

The system must be accessible through a centralized web dashboard. I should not need to manually open Tabby-RDP, connect to virtual machines, inspect screenshots individually, or execute test scripts to understand the application's health.

The dashboard must also allow me to inject known defects, execute tests against those defects, and determine whether the testing system successfully detected them.

**This is an implementation assignment, not a request for a proposal.**

Inspect the repository and existing infrastructure, establish an implementation plan, and execute it. Make reasonable engineering decisions autonomously.

Prioritize working end-to-end capabilities over architectural complexity.

## 2. Inspect the Existing Repository First

Before implementing anything:

- Inventory existing unit, integration, E2E, browser, and visual tests.
- Identify existing Playwright infrastructure, fixtures, reporters, and screenshot capabilities.
- Determine how Tabby-RDP is built, launched, and tested.
- Identify existing Windows/Linux test environments and available VMs.
- Inspect GitHub Actions workflows and current testing costs.
- Identify any reusable screenshot, artifact-storage, orchestration, or reporting capabilities.
- Determine which parts of the actual RDP rendering pipeline existing tests exercise.
- Identify tests that validate implementation details but do not establish visible correctness.

Do not duplicate functioning infrastructure.

Prefer subtraction and consolidation over creating another parallel testing framework.

Produce a short initial inventory, then proceed with implementation.

## 3. Technology Stack

Evaluate and use the following technologies where appropriate.

| Component | Preferred technology |
|---|---|
| Browser automation | Playwright |
| Screenshot regression | Playwright `toHaveScreenshot()` |
| Test traces and video | Playwright |
| Test reporting | Allure Report / Allure TestOps |
| Dedicated visual comparisons | Argos, if justified |
| AI visual evaluation | OpenAI Decisions API |
| Detailed AI investigations | OpenAI Responses API |
| Native desktop automation | Jev, if needed |
| Scheduling | GitHub Actions or existing infrastructure |
| Source control integration | GitHub API |
| Test execution | Existing self-hosted infrastructure |
| Dashboard | Existing reporting platform or minimal custom frontend |

These are candidates, not mandatory dependencies.

**Avoid installing three products that solve essentially the same problem.**

Evaluate Allure, Argos, and Playwright's native reporting before choosing. Prefer self-hosted solutions with minimal recurring costs and maintenance.

Verify the actual capabilities, availability, API contracts, and pricing of the Decisions API before integrating it. Do not assume it supports arbitrary image classification or specific output formats without checking.

If a simpler vision-capable Responses API integration is more appropriate, use that instead.

Likewise, verify Jev's capabilities before introducing it.

## 4. Centralized QA Dashboard

Build a browser-accessible dashboard that becomes the single place to monitor and operate Tabby-RDP's testing infrastructure.

### Overview

Display:

- Overall test health.
- Latest successful and failed runs.
- Current test execution activity.
- Windows and Linux environment status.
- Visual regression counts.
- AI-detected anomalies.
- Defect injection detection rates.
- Historical trends.
- Test execution duration.
- Commit and PR associations.

Distinguish clearly between:

- Passed tests.
- Failed tests.
- Skipped tests.
- Infrastructure failures.
- Tests that never actually executed.

A broken test environment must never be reported as a successful application test.

### Visual Gallery

Create a visual overview showing the latest screenshot for every important test scenario.

I should be able to see the rendered application across Windows, Ubuntu, different resolutions, and important UI states without opening individual reports.

Support:

- Expected versus actual screenshots.
- Overlay and difference visualization.
- Side-by-side comparisons.
- Historical screenshots.
- Commit-level comparisons.
- AI-identified problem regions.
- Links to associated traces and recordings.

Prioritize fast visual inspection.

### Execution Controls

From the dashboard, I must be able to:

- Execute the full test suite.
- Execute a selected test.
- Execute tests against a selected environment.
- Trigger visual regression tests.
- Trigger AI visual reviews.
- Launch a defect injection campaign.
- Reproduce a previous failure.
- View currently running tests.
- Cancel an execution.

These controls must actually execute the underlying tests, not simply provide links to GitHub Actions.

Use authenticated, authorized execution endpoints. Do not expose arbitrary command execution through the dashboard.

## 5. Real RDP Visual Testing

Create deterministic test environments capable of validating the actual rendered RDP experience.

Target:

- Windows 11.
- Ubuntu GNOME.

Use existing VMs where available.

Each environment should have controlled:

- Display resolution.
- Scaling.
- Theme.
- Fonts.
- Wallpaper.
- Animations.
- Test application state.

Create a small deterministic visual fixture application displaying text, gradients, geometric shapes, color references, and controls.

The fixture should expose a machine-readable description of its expected state.

Test scenarios should include:

1. Initial RDP connection.
2. Full desktop rendering.
3. Window resizing.
4. Tab switching.
5. Multiple concurrent sessions.
6. Resolution changes.
7. Non-default display scaling.
8. Reconnection.
9. Clipboard operations.
10. Keyboard and mouse interactions.
11. Remote window movement.
12. Scrolling and rapidly changing content.
13. Session disconnection and recovery.
14. Rendering after prolonged idle periods.
15. Linux versus Windows rendering differences.

Capture screenshots and artifacts at meaningful checkpoints.

**Important:** Verify the real RDP rendering path wherever feasible. A mocked UI that renders successfully does not establish that the actual RDP client works.

Use deterministic tests and real RDP tests as complementary coverage.

## 6. Visual Regression Testing

Integrate Playwright screenshot assertions into the existing test architecture.

Establish stable screenshot baselines.

Account for nondeterministic factors such as animations, cursors, timestamps, font rendering, and asynchronous framebuffer updates.

Pin relevant environmental dependencies.

Support configurable tolerances where justified, but do not use excessive tolerances to hide rendering defects.

Categorize visual changes into:

- Expected changes.
- Regressions.
- Nondeterministic rendering.
- Infrastructure problems.

Baseline updates must be explicit and auditable.

An unexpected screenshot must not automatically become the new baseline.

## 7. AI Visual Review

Add an AI visual evaluation layer that examines screenshots for problems traditional assertions may not recognize.

Investigate the OpenAI Decisions API and Responses API.

The AI evaluator should recognize potential:

- Clipping.
- Incorrect scaling.
- Misalignment.
- Unexpected overlays.
- Missing interface elements.
- Blank rendering regions.
- Image corruption.
- Layout instability.
- Unreadable text.
- Incorrect window geometry.
- Rendering artifacts.

Support reference-image comparisons where appropriate.

Return structured findings with:

- Defect category.
- Confidence or calibrated score.
- Severity.
- Affected screenshot.
- Relevant region, when identifiable.
- Human-readable explanation.
- Detector version.

AI judgments should initially be advisory.

Only make AI findings blocking after establishing measurable performance against known healthy screenshots and injected defects.

Do not assume that a single screenshot can prove temporal problems such as frozen rendering.

Use controlled state changes and multiple captures for those cases.

Cache evaluation results where possible and control API spending.

## 8. Defect Injection: Test the Tests

**This is a primary requirement, not an optional extension.**

Implement a visual mutation-testing system that deliberately introduces known defects and measures whether our testing infrastructure catches them.

The central dashboard must provide a dedicated **Test the Tests** section.

### Defect Catalog

Start with these mutations:

| Defect | Example |
|---|---|
| Framebuffer cropping | Remove 20 pixels from an edge |
| Framebuffer offset | Shift rendered desktop by 10 pixels |
| Incorrect scaling | Render at 125% instead of 100% |
| Frozen framebuffer | Stop displaying new frames |
| Missing UI component | Hide a toolbar or tab |
| Unexpected overlay | Place an opaque element over the desktop |
| Color corruption | Swap color channels |
| Blank framebuffer | Render a black or empty desktop |
| Alignment error | Introduce a 2-pixel displacement |
| Text degradation | Render text incorrectly |
| Stale content | Display an earlier frame |
| Incorrect geometry | Distort the displayed aspect ratio |

Use deterministic, reversible, isolated mutations.

### Injection Layers

Support multiple injection layers:

**1. RDP framebuffer**

Modify actual framebuffer data or rendering behavior within an isolated test environment.

This tests whether the visual QA system detects defects in the actual rendering pipeline.

**2. Tabby-RDP frontend**

Inject CSS, layout, scaling, or compositing defects.

This validates UI-level visual detection.

**3. Remote test environment**

Alter the displayed test fixture or remote desktop state.

This tests whether the system detects incorrect real-world rendering.

**4. Screenshot/evaluator layer**

Modify captured screenshots before evaluation.

This validates the sensitivity of screenshot comparison and AI detection, but must not be represented as end-to-end RDP coverage.

### Dashboard Controls

I must be able to:

1. Select a mutation.
2. Select an environment.
3. Select its parameters.
4. Execute the experiment.
5. Watch the test run.
6. Inspect screenshots and evidence.
7. See which detectors caught the mutation.
8. Reproduce the experiment.

Also support selecting multiple mutations and running an automated campaign.

Every experiment must record:

- Target commit.
- Environment.
- Mutation.
- Injection layer.
- Mutation parameters.
- Random seed, if applicable.
- Expected failure.
- Actual detector results.
- Screenshots.
- Traces.
- Execution timestamps.
- Final classification.

An injected defect that does not actually manifest must not count as a successful detection or an escaped defect. Verify manifestation independently before evaluating detection.

Prevent the injected defect's metadata or expected result from leaking into the detector being evaluated.

### Mutation Effectiveness

Measure:

**Mutation Detection Rate = Detected, successfully manifested mutations / All successfully manifested mutations**

Also measure:

- False-positive rate on healthy controls.
- False-negative rate.
- Detection latency.
- Detection by defect category.
- Detection by injection layer.
- Detection by individual testing technology.
- Escaped mutations.
- Historical changes in detection effectiveness.

Run healthy control cases alongside injected defects.

Avoid trivial implementations where the test passes simply because it knows a mutation was enabled.

**The detection must come from observing the defect, not from knowing that injection occurred.**

## 9. Automated Investigation

When a regression occurs, automatically collect:

- Screenshots.
- Screenshot differences.
- Playwright trace.
- Video, when available.
- Browser/application logs.
- RDP connection logs.
- Environment metadata.
- Git commit and PR details.

Use AI to produce a concise diagnosis based on the available evidence.

The investigation should distinguish observed facts from hypotheses.

Where possible, identify the earliest affected commit using historical evidence or automated regression bisection.

Do not claim a specific commit caused the defect simply because it was the first commit tested unsuccessfully.

Make the investigation available through the dashboard.

Optionally create GitHub issues with supporting evidence, with deduplication to avoid issue spam.

## 10. CI and Scheduling

Integrate with existing GitHub Actions workflows.

Proposed execution strategy:

| Trigger | Tests |
|---|---|
| Every PR | Existing tests + deterministic visual smoke tests |
| Merge to main | Broader visual regression suite |
| Nightly | Real Windows/Linux RDP tests |
| Nightly | AI visual evaluations |
| Nightly | Representative mutation campaign |
| Weekly | Expanded defect mutation campaign |
| Manual dashboard action | Any supported test or campaign |

Adjust this schedule based on measured execution time, infrastructure availability, and cost.

Prefer existing DGX/self-hosted infrastructure when appropriate, but do not run workloads on expensive hosted macOS runners unnecessarily.

Tests must remain reproducible locally and in CI.

## 11. Reporting and Historical Evidence

Persist test results and visual evidence centrally.

Support:

- Historical test runs.
- Per-commit test results.
- Baseline versions.
- Screenshot comparisons.
- Mutation campaigns.
- Detection effectiveness over time.
- AI evaluations.
- Environment availability.
- Test duration.
- Flaky-test identification.

Retention policies should prevent unbounded storage growth.

Keep failures and representative historical evidence longer than routine successful runs.

The system should make it easy to distinguish genuine application regressions from environmental instability.

## 12. Operational Requirements

The system must be maintainable by a single developer.

Priorities:

1. Reliability.
2. Low maintenance.
3. Reuse of existing infrastructure.
4. Reproducibility.
5. Clear failure evidence.
6. Minimal dependencies.
7. Low recurring cost.
8. Easy deployment.

Avoid unnecessary services, queues, databases, agents, or orchestration frameworks.

Use existing capabilities where practical.

The dashboard and testing system should survive restarts and recover cleanly from interrupted executions.

Credentials and API keys must be managed securely.

Defect injection must never affect production users or uncontrolled environments.

## 13. Implementation Order

Build in vertical slices, each producing working functionality.

### Phase 1 — Establish the Foundation

- Inspect existing tests and infrastructure.
- Select the reporting/dashboard architecture.
- Integrate Playwright screenshots and traces.
- Publish a centralized dashboard.
- Show actual test results and screenshots.
- Enable dashboard-triggered test execution.

**Acceptance:** I can open the dashboard, execute a test, and inspect its resulting screenshot and trace.

### Phase 2 — Real RDP Validation

- Configure deterministic Windows/Linux environments.
- Execute actual RDP sessions.
- Capture screenshots.
- Implement core visual assertions.
- Integrate results into the dashboard.

**Acceptance:** The dashboard shows real remote desktop rendering captured through Tabby-RDP.

### Phase 3 — Defect Injection

- Implement the mutation framework.
- Create the initial defect catalog.
- Expose mutation execution through the dashboard.
- Track detection results.
- Generate mutation effectiveness metrics.

**Acceptance:** I can intentionally break the rendered desktop from the dashboard and see whether the existing tests catch the defect.

### Phase 4 — AI Visual Intelligence

- Integrate the verified AI evaluation API.
- Classify visual anomalies.
- Analyze failed tests.
- Evaluate AI performance against injected defects.
- Show findings and confidence in the dashboard.

**Acceptance:** AI detection effectiveness is measured against known defects and healthy controls.

### Phase 5 — Full Automation

- Configure recurring campaigns.
- Implement historical reporting.
- Integrate GitHub PR/commit information.
- Add automated investigations.
- Establish retention and operational safeguards.

**Acceptance:** The system runs unattended and provides a reliable picture of Tabby-RDP's functional and visual health.

## 14. Engineering Guardrails

- Do not rewrite existing working tests unnecessarily.
- Do not create parallel test infrastructures without justification.
- Do not add dependencies merely because they are popular.
- Avoid excessive abstraction.
- Prefer readable, maintainable code.
- Keep operational complexity proportional to actual needs.
- Do not use mocks as substitutes for real RDP coverage.
- Do not allow injected defect metadata to contaminate detector results.
- Do not silently update screenshot baselines.
- Do not hide flaky tests by increasing retries indefinitely.
- Do not treat AI confidence scores as inherently calibrated probabilities.
- Do not claim visual coverage that has not been exercised.
- Do not report infrastructure failures as application successes.
- Do not invent successful test results.

Where a requested component is unavailable or unsuitable, implement the simplest practical alternative and document the tradeoff.

## 15. Final Deliverables

Deliver:

1. A functioning, browser-accessible QA dashboard.
2. Automated Playwright visual regression coverage.
3. Centralized screenshots, traces, and test history.
4. Real Windows/Linux RDP testing wherever infrastructure permits.
5. A functioning dashboard-controlled defect injection system.
6. Quantitative mutation detection metrics.
7. AI-assisted visual evaluation.
8. Automated CI and scheduled testing.
9. Deployment and operational documentation.
10. A concise report showing what works, what was actually tested, and what remains.

### Required Final Demonstration

Demonstrate the complete workflow:

1. Start with a healthy Tabby-RDP build.
2. Execute a visual test from the dashboard.
3. Confirm the test passes.
4. Inject a framebuffer cropping defect from the dashboard.
5. Execute the same test.
6. Confirm the mutation visibly manifested.
7. Show the detector identifying the regression.
8. Display the expected/actual screenshots and relevant trace.
9. Record the mutation as detected.
10. Restore the healthy state and confirm the test passes again.

**Do not declare completion based only on passing unit tests or successful compilation. The full workflow must actually execute.**

If infrastructure prevents completing a particular phase, report the specific blocker and retain the working functionality already delivered.

## 16. Implementation Progress

Maintain this section throughout development.

Update it after each completed phase.

| Phase | Status | Commit | Acceptance |
|---|---|---|---|
| 1. Foundation | Complete | Phase 1 implementation commit (recorded in handoff below) | Browser sign-in → execute real Tabby settings test → Passed → actual/expected PNGs → self-hosted trace viewer demonstrated on 2026-10-10 PDT. |
| 2. Real RDP Validation | Pending | — | — |
| 3. Defect Injection | Pending | — | — |
| 4. AI Visual Intelligence | Pending | — | — |
| 5. Full Automation | Pending | — | — |

Valid statuses:

- Pending
- In Progress
- Complete
- Blocked

A phase may only be marked **Complete** when its acceptance criteria have been demonstrated through actual execution.

### Initial Repository Inventory (Phase 1, 2026-10-10)

- **Existing tests:** 49 TypeScript unit files plus Python/shell coverage under `test/unit/`; 34 CDP suite modules
  under `test/suites/`. `test/run.ts` builds an isolated Tabby profile, links or packs the real plugin, runs suites,
  and cleans up. `npm run build` compiles TypeScript; IronRDP WASM/web assets are already vendored.
- **Rendering coverage:** smoke-RDP, direct, resize, focus, graphics, Windows and other suites reach real RDP
  sessions. Canvas size/color checks and changing-color graphics tests exercise decoded/rendered frames. Many
  other checks inspect service state, config, DOM, protocol messages or mocked transports, which cannot establish
  visible correctness. These remain useful complementary tests.
- **Artifacts:** `TRD_TEST_DUMP` captures optional canvas checkpoint PNGs; `screenshots` writes documentation images.
  Neither compares reviewed screenshot baselines. No Playwright config, traces, report store or dashboard existed.
- **Infrastructure:** repository provisioning covers Ubuntu GNOME (Multipass/libvirt), xrdp, Windows 11/libvirt and
  Windows Server/Hyper-V/Gateway. This session has an installed macOS Tabby but no configured `TRD_TEST_*` environment,
  Multipass or virsh command, or configured DGX runner. Existing VMs were not contacted or modified.
- **CI/cost:** existing CI uses Ubuntu hosted jobs for build/package, Node/Electron tests, Python tests, patched
  IronRDP web tests and name checks; heavier IronRDP rebuilds are conditional. No E2E/visual schedule or self-hosted
  runner is declared. No macOS CI runner or recurring service/API charge was added; account billing was not available.

### Architectural Decisions

**Phase 1 decisions (2026-10-10):**

1. Reuse `test/run.ts` and its disposable profile/credential guard. Register one `visual-host` entry that invokes
   pinned Playwright 1.64.0 over CDP. No mock application or replacement RDP harness. The checkpoint is actual local
   settings UI only. Phase 2 should reuse the same launch/artifact path for real remote sessions.
2. Use Playwright native screenshot assertions, HTML report and local trace viewer plus a small Node/static dashboard.
   Evaluated [Playwright reporting/screenshots](https://playwright.dev/docs/test-snapshots),
   [Allure report/history](https://allurereport.org/docs/features-overview/), and
   [Argos's Playwright integration](https://argos-ci.com/integrations/playwright). Native reporting already supplies
   screenshot comparisons and traces; Allure adds report generation/history integration while execution controls
   still need a service, and Argos introduces uploads/another service. No Allure, Argos, database, queue, AI API or
   native automation dependency is justified for this slice. No pricing/API assumptions about Decisions or Jev were
   made; those integrations were not attempted.
3. Store per-run atomic JSON, bounded logs, HTML reports, independent screenshot copies and trace ZIPs on local disk.
   A fixed catalog exposes only `visual-host`; a token/session protects reads and execution. Loopback binding plus
   SSH tunneling provides access to a central host without a public command endpoint. Publish here means a live
   browser-accessible service on the current test machine; remote deployment remains operator-specific.
4. Require an executed test, passing assertions and real screenshot/trace files for Passed. Keep infrastructure
   failure, Failed, Skipped, Not executed and Cancelled separate. Serialize runs; preserve unfinished records as
   infrastructure failures after restart. Cap storage at 100 runs pending Phase 5 retention.
5. Commit reviewed host-specific baselines; missing baselines fail. Only `npm run qa:baseline` enables writes and
   dashboard execution forcibly disables updates. Use 1100×800 at device scale 1, animation/caret stabilization,
   zero differing pixels under Playwright's default perceptual comparator, and no retries. Full-element screenshots
   in Electron included unpainted offscreen areas, so the tested checkpoint is explicitly the visible viewport.

Record significant decisions here.

For each decision, document:

- Decision made.
- Alternatives considered.
- Rationale.
- Relevant implementation references.
- Implications for subsequent phases.

Prefer concise entries over lengthy architectural essays.

### Outstanding Issues

- Only macOS arm64 / installed Tabby 1.0.236 / Electron 43.7.0 has a reviewed baseline and executed visual coverage.
  Its reported xterm declaration is ^6.0.0. Other hosts fail until a baseline is explicitly reviewed there.
- Remote Windows/Linux availability is **not verified**. No real RDP session was executed in Phase 1. Phase 2 must
  configure deterministic dedicated desktops and validate the actual framebuffer path.
- Trace DOM replay can miss fonts/icons from Electron's local `file://` resources; the captured actual PNG and
  filmstrip are the pixel evidence. Actions, assertions, timings and DOM snapshots are available in the local viewer.
- Dashboard runs the current working tree (commit + dirty flag), not a frozen checkout. Use a dedicated checkout;
  do not edit it or run competing desktop suites during execution. The single-run guard covers this server only.
- The dashboard exposes one selected visual test, not the full existing CDP catalog. Ingestion of legacy suite
  outcomes, remote environment controls, long-term trends, scheduled runs, AI and mutations remain later-phase work.
- Runtime evidence is in ignored `.qa/`; back it up separately. Capacity is bounded; automatic retention and remote
  service-manager deployment are documented/deferred. The existing development-only Angular audit advisory predates
  this change; runtime dependency audit reported zero vulnerabilities. No dependency upgrade outside this phase.

Track:

- Known defects.
- Infrastructure blockers.
- Incomplete functionality.
- Deferred improvements.
- Dependencies for subsequent phases.

Do not represent incomplete work as complete.

### Phase Handoff Notes

**Phase 1 — completed 2026-10-10 PDT (2026-10-11 UTC)**

- Implementation: `scripts/qa/{server,store}.mjs`, static UI in `scripts/qa/public/`, Playwright config/spec/reporter
  and reviewed PNG in `test/visual/`, `visual-host` integration in `test/run.ts`, package commands, API/lifecycle
  tests and one validation step in existing CI. Operations: [visual-qa.md](visual-qa.md).
- Commit: the Phase 1 implementation commit is recorded after final commit validation; find it with
  `git log --oneline --grep='establish Phase 1 visual QA foundation'`. All source changes and this initial acceptance
  record are in that commit. Later phases remain Pending.
- Actual acceptance: browser-driven run **`2026-10-11T05-31-46.756Z-f79f9c74`**, about 3.7 seconds end to end, passed
  the real Tabby settings screenshot comparison. The browser script signed in, clicked Run, loaded actual/expected
  screenshots, opened Playwright's report, followed its trace link, and found the recorded `toHaveScreenshot`
  assertion. Desktop/mobile dashboard captures and the trace viewer were visually inspected. The run records base
  commit `ead5160` plus uncommitted Phase 1 changes; no clean-commit coverage is implied by that run.
- Evidence: `.qa/runs/2026-10-11T05-31-46.756Z-f79f9c74/` contains result JSON, host JSON, PNGs, trace and HTML report.
  `.qa/acceptance.json`, `dashboard-acceptance.png`, `dashboard-mobile.png`, `trace-acceptance.png` record the browser
  demonstration. These generated artifacts are intentionally untracked; rerun `scripts/qa/acceptance.mjs` to reproduce.
- Validation: build + plugin/test typecheck passed; existing unit suite **578 passed, 3 skipped, 0 failed** (the skips
  need an explicitly configured Electron test binary); existing real Tabby `smoke-host` suite **ALL PASSED**. All
  three QA tests passed, covering auth/origin/Host checks, catalog enforcement, concurrency, cancellation, protected
  artifacts, path containment, persistent history, recovery classification and a real launcher failure with the
  test correctly marked Not executed. CI now runs these same QA contract tests; no visual CI execution is claimed.
- Negative baseline check: temporarily removed the reviewed PNG, executed normal `visual-host`, verified a failing
  result with screenshot/trace evidence and no baseline creation, then restored the identical reviewed bytes.
  No defect injection framework or mutation campaign was implemented.
- Next phase: read this entire plan and `docs/visual-qa.md`; provision/identify dedicated Windows and GNOME desktops,
  reuse the existing RDP suites/runner, and expand the fixed catalog and structured results deliberately. Do not
  count the Phase 1 settings baseline as end-to-end RDP validation. AI/mutation/scheduling work remains out of scope.

After completing each phase, record:

- What was implemented.
- Relevant commits.
- Tests executed.
- Acceptance evidence.
- Important design decisions.
- Known limitations.
- What the next phase needs to know.

The document must serve as a durable handoff between independent Codex sessions.

## 17. Execution Instructions for Codex / Astra High

This plan is intended to be executed incrementally.

**Read the entire document before starting implementation.**

Understand the overall architecture, requirements, and dependencies between phases.

However, implement only the phase explicitly assigned in the current session.

### Phase Execution Rules

1. Read this entire plan.
2. Inspect the repository and current implementation state.
3. Review progress and handoff notes from previous phases.
4. Identify the assigned phase and its acceptance criteria.
5. Implement that phase completely.
6. Run relevant tests and validate actual behavior.
7. Update the implementation progress table.
8. Document architectural decisions and deviations.
9. Record outstanding issues and handoff notes.
10. Commit the implementation.
11. Report results and stop.

Do not prematurely implement subsequent phases.

Make architectural decisions that accommodate later phases without building speculative infrastructure.

Do not claim acceptance based solely on code review, mocked behavior, or successful compilation.

Each phase should be completed in a separate Codex session to minimize context degradation.

The Markdown plan is the authoritative record of project progress and design decisions.

Do not rely on conversational memory between sessions.

### Final Direction

Build this as a permanent part of Tabby-RDP's engineering infrastructure.

I want to stop manually opening Tabby-RDP just to determine whether something looks broken.

The centralized dashboard should tell me what's healthy, what's broken, what changed, and—most importantly—**whether our tests are capable of recognizing defects in the first place.**

Optimize for measurable confidence, not test count.

**Inspect, implement, execute, validate, and deliver.**
