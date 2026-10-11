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
| 1. Foundation | Complete | `fac5dba` + `415f29d` | Browser sign-in → execute real Tabby settings test → Passed → actual/expected PNGs → self-hosted trace viewer demonstrated on 2026-10-10 PDT. |
| 2. Real RDP Validation | Complete | `439d9d0` | Clean-commit browser workflows executed Windows 11 and Ubuntu GNOME RDP tests, compared reviewed screenshots, and opened reports/traces on 2026-10-10 PDT. |
| 2a. Distro/native-client expansion | Complete | `277874f` + `43a487f` + `8c4dd7c` | All 18 clean-checkout browser workflows passed: three native clients, five RDP servers each, plus settings. Exact receipts below. |
| 2b. Fedora KDE Plasma / KRDP | Pending | — | Third Linux desktop/RDP stack requested; requires its own session, codec and three-native-client acceptance evidence. |
| 3. Defect Injection | Complete | `8049878` + `e9c106e` | Dashboard healthy → 13-mutation campaign → report/trace → healthy passed on macOS, Windows and Linux native clients; 39/39 manifested defects detected, zero false positives in six controls. Reproduction and alternate crop parameter also passed. |
| 4. AI Visual Intelligence | Complete | `c9b87f9` | Live Pro-backed Codex reviews: 32/39 detected, 0/12 control false positives across three clients; real crash dialog and failed-test review demonstrated. |
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

**Phase 2 decisions (2026-10-10 PDT / 2026-10-11 UTC):**

1. Reuse the existing CDP lifecycle through `createTestContext()` and the runner's credential guard. Add fixed
   `visual-linux` / `visual-windows` catalog entries; no commands or environment values are accepted over HTTP.
   Operator-owned private configuration supplies SSH/WinRM credentials. Missing configuration fails before launch.
2. Create fresh dedicated Linux and Windows guests on a separate available ARM64 libvirt host, following the user's
   instruction to avoid another thread's testbed. Reuse static installer/driver assets only, not its live disk or
   session. Ubuntu provisioning now supports both architectures, dated images, checksum validation and GI/Cairo.
   Windows ARM installation required manual WinPE image application; no claim of a generic ARM Windows provisioner.
3. Use fullscreen native GTK/WinForms fixtures with independent JSON state, fixed typography/colors and input-driven
   sequence tiles. Test actual RDP pixels, screenshot baselines, input, tab return, resize and reconnect. No mock
   framebuffer. H.264 is explicitly disabled; broader Section 5 scenarios remain documented coverage gaps.
4. Preserve bounded resize filmstrips and timestamped region samples, including transient settling. Require sustained
   correct final samples and reject invalid samples after initial correct repaint. Keep raw-canvas and final visible
   captures; add same-session Windows guest screen evidence. The five point samples do not measure whole-frame damage
   area; Wayland fixture state is not a guest pixel oracle. The other thread's H.264 resize observation remains open.
5. Keep zero baseline tolerance/retries and explicit local baseline updates. Store four platform/runtime-specific
   RDP baselines per environment; detailed report metadata records guest versions, scale, fixture state and sampled
   transitions. Add per-environment status/preview and an expandable filmstrip to the existing dashboard.

**Phase 3 decisions (2026-10-11):**

1. Extend the existing real-RDP lifecycle, fixtures, Playwright baselines, result store and authenticated dashboard.
   One campaign is one serialized run; no alternate launcher, queue, service or production plugin hook. Normal
   environment health excludes mutation campaigns. Fixed IDs and enumerated numeric values are the only new HTTP input.
2. Supply all twelve starter categories plus a synthetic error dialog across four explicitly labeled layers:
   owned decoded-canvas `putImageData` hooks, owned frontend transforms/overlays, remote fixture state, and captured-PNG
   text degradation. The last is evaluator sensitivity only. Normal cleanup restores every trial; canvas/frontend and
   remote-control mutations have independent 30-second expiry. The campaign fixture lifetime is bounded to 20 minutes.
3. Verify manifestation from before/after RGBA differences and changed-region bounds, or independent remote sequence
   advancement plus two unchanged later captures for temporal cases. Do not accept the injection flag as manifestation.
   Detection gets pixels, the existing baseline name and the normal frame/state assertion, with no mutation metadata.
   Buffer comparison reuses Playwright's comparator; fixed-viewport capture prevents following a displaced canvas.
   This is observational evidence, not a general classifier proving every changed pixel's cause.
4. Keep nonmanifested, incomplete and not-executed experiments out of detection denominators. Retain individual
   detector results, restoration status, controls, escapes, parameters, timings and commit/dirty flag. Report observation
   latency including transport/capture/assertion costs, not precise rendering latency. Historical reproduction uses the
   current checkout with original values, rather than silently changing source commits.
5. User review exposed a gap in evidence-only initial OS captures: a stale Ubuntu Tabby crash dialog was covered by
   the fullscreen fixture. Preserve that accepted historical run and qualify its meaning. A real negative run now
   fails preparation on known same-account crash-reporter processes. This is not general OS-dialog recognition.
6. Visual review caught lost ICC metadata when encoding the screenshot-only text mutation. `e9c106e` copies the source
   PNG color-profile chunks without changing mutation RGBA bytes; a property test and fresh Linux/macOS captures verify
   the correction. No baseline, tolerance, retry or production plugin bytes changed. AI and scheduling remain pending.

Record significant decisions here.

**Phase 4 decisions (2026-10-11):**

1. Verified the [Decisions guide](https://developers.openai.com/api/docs/guides/decisions): public beta, typed
   predicates/choices/scores and image inputs; it is not an arbitrary JSON/explanation generator. The guide recommends
   [Responses structured output](https://developers.openai.com/api/docs/guides/structured-outputs) for custom findings.
   One structured review supplies categories, severity, uncalibrated confidence, observed regions, facts, hypotheses
   and limitations. No second classifier call, model voting, new SDK or service is required.
2. At the user's request, default to the installed **Codex CLI with ChatGPT sign-in**, using their Pro allowance.
   [Codex authentication](https://learn.chatgpt.com/docs/auth) and [non-interactive execution](https://learn.chatgpt.com/docs/non-interactive-mode)
   document saved subscription authentication and JSON-schema output. This is local operator execution, not credential
   export, a private API, or subscription-authenticated public CI. No auth token is read/copied by the dashboard.
   Direct Responses remains an explicit optional provider with separate API billing; Pro does not supply API credits.
3. Use `gpt-6-luna`, low reasoning, a fixed versioned prompt/schema and one serial review at a time. Codex gets only
   opaque image roles and independently observed fixture sequence; a temporary directory holds only those PNGs and
   the schema. Ignore user config, project instructions and memories; disable shell, apps, plugins, hooks, computer
   use, delegation and the code-mode host. Any tool event or unexpected CLI error excludes the result. Do not load
   campaign truth, filenames, detector messages, source logs, private crash payloads or causal commit claims into AI.
4. Join ground truth only after evaluation. Include the two static campaign controls and two successful native-input
   checkpoints per campaign. Temporal pairs use independently read remote sequence plus captures; sequence advancement
   alone is not a defect. Unknown initial OS desktops are reviewed without assigning truth from the run's Passed status.
   AI remains advisory and never rewrites test status, baselines or historical evidence. Uncertain defect reviews count
   as misses with separate abstention counts; provider failures, incomplete trials and nonmanifestation stay distinct.
5. Cache by image bytes, independent state, model, detector version, schema/prompt and CLI options/version. Keep
   per-run review history, source/evaluator commits, usage and latency. Subscription reviews have a persistent request
   cap; direct API reviews have a persistent dollar reservation ledger. No automatic application retry, scheduling,
   VM change, GitHub publication or Phase 5 investigation pipeline. Runtime artifacts still require separate backup.

For each decision, document:

- Decision made.
- Alternatives considered.
- Rationale.
- Relevant implementation references.
- Implications for subsequent phases.

Prefer concise entries over lengthy architectural essays.

### Outstanding Issues

- User review found an unexpected Ubuntu Tabby crash dialog in accepted run `2026-10-11T10-46-41.888Z-bf325b96` / `initial-desktop`. This image was evidence-only; the later fullscreen fixture hid it. The remote Apport report is dated 09:39:12 UTC (signal 5), before the 10:46 run; its reporter remained open. The historical test result is retained, but does **not** establish initial-desktop health. Phase 3 adds an explicit crash-reporter preflight and unexpected-dialog mutation coverage. Root cause is not established by the screenshot.

- Native macOS, Windows and Linux ARM64 clients now have reviewed baselines. Tabby 1.0.236 / Electron 43.7.0
  is common, but macOS declares xterm ^6.0.0 and the official Linux/Windows builds declare ^5. x86_64 remains
  unqualified. The other thread’s H.264 resize failure is not resolved by the non-H.264 controls here.
- Phase 1 had no real RDP coverage. Phase 2 now provisions dedicated Windows/Ubuntu desktops; see its handoff for
  actual acceptance records and the disclosed Windows installer provenance limitation. Only the listed scenarios
  and non-H.264 path are covered; broader Section 5 coverage remains outstanding.
- Trace DOM replay can miss fonts/icons from Electron's local `file://` resources and shows a placeholder for the
  live canvas bitmap; the captured actual PNG and filmstrip are the pixel evidence. Actions, assertions, timings and DOM snapshots are available in the local viewer.
- Dashboard runs the current working tree (commit + dirty flag), not a frozen checkout. Use a dedicated checkout;
  do not edit it or run competing desktop suites during execution. The single-run guard covers this server only.
- The dashboard exposes three legacy visual entries plus the native-client/distro matrix, not the full CDP catalog. Legacy-suite ingestion,
  VM lifecycle controls, long-term trends and scheduled runs remain later-phase work. Phase 3 adds bounded mutation campaigns;
  Phase 4 adds manual advisory AI reviews and measured detector effectiveness, with the limitations recorded below.
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
- Commits: **`fac5dba`** establishes the foundation; **`415f29d`** stabilizes the settings viewport and improves
  the acceptance script's run selection/failure handling. This subsequent documentation commit records the final
  clean-commit evidence. Later phases remain Pending.
- Actual acceptance: **three consecutive full browser workflows passed on clean commit `415f29d`**, each with
  zero test retries and the same reviewed baseline. Run IDs: `2026-10-11T05-38-37.268Z-269fb6e1`,
  `2026-10-11T05-38-44.436Z-3a264874`, and **`2026-10-11T05-38-51.621Z-76b2e9b7`**. The script signed in, clicked Run,
  verified that the newly created run was selected, waited for its terminal Passed status, loaded actual/expected
  screenshots, opened Playwright's report, followed its trace link, and found the recorded `toHaveScreenshot`
  assertion. Desktop/mobile dashboard captures and the trace viewer were visually inspected during acceptance.
- Evidence: `.qa/runs/2026-10-11T05-38-51.621Z-76b2e9b7/` contains result JSON, host JSON, PNGs, trace and HTML report.
  `.qa/acceptance.json`, `dashboard-acceptance.png`, `dashboard-mobile.png`, `trace-acceptance.png` record the browser
  demonstration. These generated artifacts are intentionally untracked; rerun `scripts/qa/acceptance.mjs` to reproduce.
- Validation: build + plugin/test typecheck passed; existing unit suite **578 passed, 3 skipped, 0 failed** (the skips
  need an explicitly configured Electron test binary); existing real Tabby `smoke-host` suite **ALL PASSED**. All
  three QA tests passed, covering auth/origin/Host checks, catalog enforcement, concurrency, cancellation, protected
  artifacts, path containment, persistent history, recovery classification and a real launcher failure with the
  test correctly marked Not executed. CI now runs these same QA contract tests; no visual CI execution is claimed.
- Validation caught a real checkpoint-stability failure in run `2026-10-11T05-36-53.716Z-703eb4ae` on `fac5dba`:
  help-topic navigation scheduled smooth scrolling and changed the captured scroll position. The dashboard retained
  a Failed result, 19,430 differing pixels, expected/actual/diff images and trace. This was test setup nondeterminism,
  not an established application regression. `415f29d` uses ordinary Settings navigation and requires the heading
  fully in view. The baseline bytes and zero-difference tolerance were not changed; the three clean runs above
  validate the correction. This historical failure remains visible rather than being deleted or relabeled Passed.
- Negative baseline check: temporarily removed the reviewed PNG, executed normal `visual-host`, verified a failing
  result with screenshot/trace evidence and no baseline creation, then restored the identical reviewed bytes.
  Baseline SHA-256: `4bc0b2bad2d4743b0e21e96ef7c31bad14acea16b7495da104c412e15725e202`.
  No defect injection framework or mutation campaign was implemented.
- Next phase: read this entire plan and `docs/visual-qa.md`; provision/identify dedicated Windows and GNOME desktops,
  reuse the existing RDP suites/runner, and expand the fixed catalog and structured results deliberately. Do not
  count the Phase 1 settings baseline as end-to-end RDP validation. AI/mutation/scheduling work remains out of scope.

**Phase 2 — completed 2026-10-10 PDT (2026-10-11 UTC)**

- Added `visual-linux` and `visual-windows`, native fixtures, remote JSON state checks, four reviewed baselines per
  guest and bounded resize filmstrips. Guest-side Windows screen captures independently validate visible corner
  markers and retain a transition reference. Dashboard selection, environment status/previews, failure evidence,
  private configuration and browser acceptance reuse the Phase 1 service and existing Tabby/CDP runner.
- Provisioned fresh isolated Windows 11 Pro ARM64 and Ubuntu 24.04 GNOME guests on another available libvirt host.
  The other thread's guest and live disk were not altered. Setup media containing fresh credentials was detached
  and removed; signed driver validation and setup completion receipts are retained privately. Operations, image
  provenance (including the inherited `.UNVERIFIED` Windows ISO discrepancy), scope and restart steps are in
  [visual-qa.md](visual-qa.md); private host/credential/tunnel receipts are in ignored `.qa/private/`.
- Validation: build/typecheck passed, unit suite **578 passed / 3 skipped / 0 failed**, existing `smoke-host`
  and `smoke-rdp` **ALL PASSED**, four QA tests passed including missing-environment Not executed/Infrastructure
  failure and secret-free configuration reporting. Linux browser acceptance passed in runs
  `2026-10-11T06-06-48.238Z-c71d47be` and `2026-10-11T06-11-36.480Z-8a7d3255` (development working tree).
  Windows baseline lifecycle passed in **197 seconds**, with no retries.
- Final acceptance on **clean implementation commit `439d9d0`**, baseline updates disabled and zero retries:
  **Windows** `2026-10-11T06-24-23.606Z-fce937db` (204.0 s, 56 attachments), **Ubuntu**
  `2026-10-11T06-28-30.439Z-dc8135b6` (15.4 s, 48 attachments), and **local settings**
  `2026-10-11T06-29-13.243Z-342c0196`. Every workflow signed in through the browser, selected the environment,
  clicked Run, verified the new run passed, loaded its PNGs, opened the report and found recorded screenshot
  assertions in the self-hosted trace viewer; mobile layout passed too. Dashboard screenshots, baseline images,
  the Windows guest oracle and trace viewer were visually inspected. This subsequent documentation commit records
  completion; no implementation changed after these clean-commit tests.
- Final environment receipts: Ubuntu **24.04.5**, GNOME Shell **46.0-0ubuntu6~24.04.15**, GNOME Remote Desktop
  **46.3-0ubuntu1.2**, DejaVu **2.37-8**; Windows **Professional, 26H2, build 26300, UBR 9457**.
  The common client is macOS arm64 / Tabby **1.0.236** / Electron **43.7.0**, remote/device scale 1, H.264 off.
- Evidence: `.qa/runs/<IDs above>/` contains reports, expected/actual PNGs, raw-canvas images, guest images for Windows,
  resize timelines, environment/fixture/RDP logs and trace ZIPs. `.qa/visual-{windows,linux,host}-acceptance.json`,
  matching dashboard/mobile/trace PNGs and `.qa/windows-dashboard-viewport.png` retain the browser demonstration.
  Runtime artifacts are intentionally untracked. The dashboard remains at <http://127.0.0.1:4317>; token `.qa/token`,
  configuration `.qa/private/environments.json`, operational VM/tunnel receipt `.qa/private/phase2-infrastructure.md`.
- Cleanup verified after acceptance: **zero** Windows fixture tasks/directories and **zero** Linux fixture directories.
  Scanned all **222** files from the three clean runs, including ZIP members, for the new guest passwords: no matches.
  The isolated guests and dashboard remain available for future tests; no other thread's guest was stopped or changed.
- Temporal results: Linux retained one unsettled observation then consistent markers/geometry, first correct sample
  at **550 ms**, twelve observations over **5.5 s**. Windows retained twelve correct observations over **39 s**;
  first observed correct frame at **2.43 s**, typical collection cost **2.4 s**, and **11.9 s** for the observation
  including a guest screen capture. These are observation times, not exact repaint latency. Windows cannot establish
  high-frequency transition correctness with this WinRM sampling cadence; that instrumentation limit is explicit.
- Setup failures were preserved: missing GI/Cairo prevented Ubuntu fixture startup; Windows' first-login Start menu
  obscured the fixture, independently confirmed by guest screen capture. Installed the required Cairo bridge and
  explicitly dismiss the first-login menu/activate the fixture. Baselines were reviewed only after those fixes;
  no tolerances were increased. Initial transport helper accidentally returned a DOM form instead of a Boolean;
  corrected it before Windows acceptance. These are setup/harness failures, not established client regressions.
- Reviewed baseline content: native text/gradient/color grid, four edge markers, frame counter and input tile at
  800×600 and 900×650. Tab return matches initial pixels; reconnect matches resized pixels in both environments.
  894 generated files (including ZIP members) were scanned for the new guest passwords: no matches.
- Remaining coverage: H.264 (including the other thread's observed resize failure), multiple simultaneous sessions,
  non-default DPI, clipboard, window movement, rapid animation and prolonged idle. Ubuntu has no independent
  Wayland guest screenshot oracle. Region samples do not quantify affected screen area or prove a root cause.
  Windows WinRM checks take materially longer than Linux SSH checks; actual timestamps/capture overhead are retained.
  Runtime artifacts remain ignored and need separate backup. Phase 3 should reuse these real checkpoints without
  feeding mutation metadata into detectors. No mutation, AI or scheduling functionality was implemented.

After completing each phase, record:

- What was implemented.
- Relevant commits.
- Tests executed.
- Acceptance evidence.
- Important design decisions.
- Known limitations.
- What the next phase needs to know.

The document must serve as a durable handoff between independent Codex sessions.

### Phase 2 extension — distro and native-client coverage (2026-10-11)

**Scope:** user-requested expansion of Phase 2, not Phase 3. Status: **Complete**, with all 18 browser workflows accepted on 2026-10-11.

- Added fixed matrix cells for macOS, Windows and Linux **native Tabby clients**, each with settings UI plus
  Ubuntu 24.04/GNOME 46, Fedora 44/GNOME 50, Debian 13.7/GNOME 48, Rocky 9/Xfce/xrdp and Windows 11 remote desktops.
- New isolated ARM64 Fedora and Debian VMs use vendor-checksummed cloud images. The existing isolated Ubuntu
  and Windows QA VMs remain separate from the other thread's work. Clients report Tabby 1.0.236
  ARM64/Electron 43.7.0. Linux/Windows use checksum-verified official binaries and declare xterm ^5; the existing
  macOS installation declares ^6.0.0. Identical version labels do not establish identical host builds. This expansion
  does not establish x86_64 client coverage.
- Every run checks the real client OS and installed plugin content, then the actual remote release/GNOME/GRD
  versions. Baseline keys use those observed identities, including Windows build. Driver OS is labeled separately.
- Operator-only per-cell configuration and private CDP tunnels reuse the existing runner's `--port` support.
  A missing cell cannot inherit another cell's credentials/destination. Fixed HTTP IDs remain the only execution input.
- Added distro-aware package/image provisioning and a small native-client launcher/bundle command. No extra
  service, job queue or parallel test framework. Native client sessions are operator-managed and explicitly stopped.
- The initial fifteen-cell GNOME/Windows matrix passed browser acceptance on clean implementation commits.
  The user subsequently added Rocky/Xfce/xrdp; all eighteen cells then passed fresh browser acceptance with the
  final shared RDP test implementation and 63 reviewed baselines (three settings plus fifteen RDP cells × four checkpoints).
- Provisioning findings retained in `.qa/`: Fedora's shim was rejected by the installed ARM Secure Boot firmware;
  its disposable VM explicitly uses non-Secure-Boot AAVMF. Windows portable ARM64 required Microsoft's signed
  Visual C++ ARM64 runtime. First-login GNOME welcome dialogs and overview obscured correct framebuffer content;
  dedicated test-account provisioning suppresses tours/banners, and Escape dismisses the overview over actual RDP.
  Debian's first attempt stopped before reboot on unsupported `grdctl --version`; package-version reporting fixes it. Serial-console diagnosis identified a 90-second systemd wait for missing `/dev/tpmrm0`, delaying SSH.
  Linux fixtures now omit the unnecessary virtual TPM. The provisioner also freezes cloud-init before ejecting
  its seed, retains MAC-based DHCP/networkd configuration, and starts the user D-Bus socket before setting GNOME preferences.
- An offline clone of the isolated Windows QA guest supplies a separate Windows server for Windows→Windows.
  macOS is tested as a native Tabby client, not claimed as a native RDP server. H.264 remains disabled/unqualified as in Phase 2.
- The older Windows guest developed an activation watermark; it was retained in failure/preparation evidence,
  not masked or bypassed. All final Windows desktop cells use the separate server clone. These disposable guests
  are unactivated; future OS overlays can cause legitimate baseline mismatches and require environment review.
- Operational instructions and lifecycle limitations: `docs/visual-qa.md`, “Native client and desktop matrix”.
- Rocky reuses the existing xrdp provisioner and GTK fixture, with its own checksummed cloud image, EPEL/CRB
  packages, dedicated Xfce/Xorg account and loopback listener; SELinux remains enforcing. Session/transport versions
  are checked and included in baseline names. This is actual xrdp coverage, distinct from GRD.
- Shared-harness validation caught retained-state/setup failures: failed SSH tabs were not previously tracked for
  cleanup; an implicit desktop choice reused Windows behind an Ubuntu gateway; tab animation and focus/sign-in layout
  could change the requested viewport. The fixes track failed tabs, select the own Linux desktop explicitly, wait for
  initial geometry and scope the fixed viewport to the owned QA pane. Actual dimensions are asserted. No screenshot
  tolerance, masks or retries were added. Separate failures and corrective commits remain in the evidence history.

**Final acceptance and handoff:**

- All **18** workflows signed in, selected the client/desktop, executed the test, verified Passed and image loading,
  opened the report and local trace viewer, and checked mobile layout. The first eleven receipts use clean commit
  `43a487f`; Windows→Windows and all six Linux-client receipts use clean `8c4dd7c`. The only difference between these
  commits is bounded mobile dashboard screenshot capture in the browser acceptance helper. RDP assertions, plugin
  bytes and all baselines are identical. Every lifecycle has zero retries; baseline writes were disabled.
- Windows→Windows run `2026-10-11T10-52-06.695Z-37d16a89` passed RDP checks, but its browser demonstration failed at
  Chrome's full-page mobile capture. That passing RDP record and the separate acceptance error remain retained.
  `8c4dd7c` captures mobile overview/evidence separately; the complete workflow was then rerun successfully below.
  This was not relabeled as an RDP failure and no pixel tolerance changed.
- Validation: plugin/test typechecking passed; **580 unit tests passed, 3 skipped, 0 failed**; **7 QA contract tests
  passed**; shell syntax and diff checks passed. A real failed SSH connection was separately verified to remove its
  owned tab and preserve existing tabs. All twelve Rocky baselines were reviewed: tab-return bytes equal initial
  bytes, and reconnect bytes equal resized bytes. The existing 51 baseline files were not changed.
- Executed server identities: Ubuntu **24.04.5 / GNOME 46.0 / GRD 46.3**; Fedora **44 / GNOME 50.5 / GRD 50.2**;
  Debian **13.7 / GNOME 48.7 / GRD 48.1**; Rocky **9.8 / Xfce 4.18.3 / xrdp 0.10.6.1 / xorgxrdp 0.10.5**;
  Windows **11 Pro 26H2 / 26300.9457**. All native clients were ARM64. The installed plugin content digest matched
  across every run: `af02b30405df3a651792b131a36192ee51fdce196275489a66cd253cbf8a505b`.
- The eighteen receipts retain **774 attachments**. Evidence: `.qa/runs/<IDs below>/`,
  `.qa/visual-<client>-<target>-acceptance.json`, matching dashboard/mobile/trace PNGs,
  `.qa/matrix-validation.json` and `.qa/matrix-18-acceptance.log`. Final desktop/mobile views and actual images were
  visually inspected. Earlier failures remain available. Runtime evidence is ignored and must be backed up separately.
- Cleanup verified: zero fixture directories on all four Linux guests; zero Windows fixture tasks/directories;
  zero owned SSH panes or temporary sizing styles on native Windows/Linux clients; no remaining test Xfce session.
  Scanned **4,042 artifact files and 13,532 ZIP members** for the actual test/admin passwords and private-key content
  (including UTF-16/base64 forms): zero matches. Dedicated guests, native clients, SSH forwards and the dashboard
  remain available; no other thread's guest was modified. Private lifecycle details are in `.qa/private/`.
- Remaining scope: x86_64 clients, H.264, independent Linux guest pixels and the broader Phase 2 scenarios already
  listed above. Windows unactivated-guest overlays and installer provenance remain disclosed limitations. Fedora
  KDE/KRDP is **planned only** below. No Phase 3 mutation, AI, scheduler or new VM-control API was implemented.

**Accepted runs** (durations are whole test-run times, not repaint latency):

| Target | Clean run ID | Seconds |
|---|---|---:|
| visual-macos-host | `2026-10-11T10-46-34.712Z-f782a9ee` | 3.6 |
| visual-macos-ubuntu2404 | `2026-10-11T10-46-41.888Z-bf325b96` | 14.3 |
| visual-macos-fedora44 | `2026-10-11T10-47-01.101Z-9a529004` | 14.7 |
| visual-macos-debian13 | `2026-10-11T10-47-20.300Z-3463f2d6` | 14.1 |
| visual-macos-rocky9 | `2026-10-11T10-47-39.628Z-c2054e76` | 17 |
| visual-macos-windows11 | `2026-10-11T10-48-00.819Z-3499bc91` | 144.8 |
| visual-windows-host | `2026-10-11T10-50-30.312Z-23fd5ea4` | 3.8 |
| visual-windows-ubuntu2404 | `2026-10-11T10-50-37.879Z-d234af39` | 17.6 |
| visual-windows-fedora44 | `2026-10-11T10-50-58.999Z-c7b39800` | 18.6 |
| visual-windows-debian13 | `2026-10-11T10-51-22.325Z-366f5001` | 17.5 |
| visual-windows-rocky9 | `2026-10-11T10-51-43.531Z-e64c6b38` | 19.5 |
| visual-windows-windows11 | `2026-10-11T10-56-33.730Z-64078b2d` | 159.3 |
| visual-linux-host | `2026-10-11T10-59-17.099Z-f9186af6` | 3.6 |
| visual-linux-ubuntu2404 | `2026-10-11T10-59-24.119Z-c02ff358` | 17.1 |
| visual-linux-fedora44 | `2026-10-11T10-59-45.286Z-406aba02` | 17.9 |
| visual-linux-debian13 | `2026-10-11T11-00-08.544Z-87f9aea1` | 17.1 |
| visual-linux-rocky9 | `2026-10-11T11-00-29.713Z-63e3b123` | 18.7 |
| visual-linux-windows11 | `2026-10-11T11-00-52.867Z-19dc2789` | 152.9 |

### Planned third Linux stack — Fedora KDE Plasma / KRDP

Requested 2026-10-11 as the third **desktop/RDP stack**, alongside GNOME/GRD and Xfce/xrdp. This is a separate
Fedora KDE guest, not the Fedora GNOME 50 guest with a different label. Status: **Pending; not executed or qualified**.

| Stack | Environments | Native Tabby clients |
|---|---|---|
| GNOME / GNOME Remote Desktop | Ubuntu 24.04 (GNOME 46), Fedora 44 (GNOME 50), Debian 13.7 (GNOME 48) | macOS, Windows, Linux |
| Xfce / Xorg / xrdp | Rocky Linux 9 | macOS, Windows, Linux |
| KDE Plasma / Wayland / KRDP | Separate Fedora KDE Plasma guest | macOS, Windows, Linux; planned |

Before execution, pin and record Fedora, Plasma, KWin, KRDP, PipeWire and encoder versions; provision a dedicated
session with documented start/restart, login, credential storage and certificate lifecycle. Verify the installed
release's unattended/headless behavior rather than assuming parity with GRD or xrdp. Upstream documents an existing
logged-in session or SDDM autologin and an RDP Graphics Pipeline/H.264 path, which needs separate codec qualification.
Sources: [KRDP session, codec and CLI documentation](https://github.com/KDE/krdp/blob/master/README.md),
[Fedora KRDP packages](https://packages.fedoraproject.org/pkgs/krdp/krdp-server/).

Acceptance requires real native Tabby runs on all three client OSes: initial frame, keyboard/mouse input, tab return,
resize with temporal evidence, reconnect and cleanup, with verified guest identity and negotiated codec. Preserve
raw and visible frames, guest evidence where available, reports and traces. Measure the codec's rendering stability
before selecting comparison tolerances; do not copy the current non-H.264 baselines or relax them to admit KRDP.
Report unsupported operations and infrastructure failures explicitly. This planned coverage does not resolve the
other thread's H.264 resize failure. No KDE VM or passing KRDP cell is claimed by this plan entry.

### Phase 3 — completed 2026-10-11

**Implementation:** `scripts/qa/mutations.{json,mjs}`, campaign execution in `server.mjs`, Test the Tests UI,
`test/visual/mutations.ts` / `png.ts`, existing RDP test/fixtures, and `scripts/qa/mutation-acceptance.mjs`.
Commits **`8049878`** and **`e9c106e`** implement the phase; this final handoff commit records acceptance and strengthens
missing-environment campaign contract assertions. Operational details are in [visual-qa.md](visual-qa.md#test-the-tests-phase-3).

**Executed acceptance:** all three browser workflows signed in, selected a native-client/remote-desktop cell,
ran a healthy lifecycle, selected all 13 default mutations, observed a completed campaign, opened actual/expected
images and the local report/trace viewer, checked mobile layout, and ran a healthy lifecycle again. Each campaign
independently witnessed all 13 defects, restored each one, and passed both internal healthy controls. Zero retries;
no baseline writes or tolerance changes. The initial OS desktop and deterministic fixture are separate evidence.

| Native client / server | Step | Clean run ID | Commit |
|---|---|---|---|
| macOS / Ubuntu GNOME 46 | Healthy before | `2026-10-11T11-30-23.179Z-7e766176` | `8049878` |
| macOS / Ubuntu GNOME 46 | 13-mutation campaign | `2026-10-11T11-30-39.612Z-0faf2fe8` | `8049878` |
| macOS / Ubuntu GNOME 46 | Healthy after | `2026-10-11T11-31-14.082Z-307405fc` | `8049878` |
| Windows / Windows 11 | Healthy before | `2026-10-11T11-31-37.038Z-fbd8ec0d` | `8049878` |
| Windows / Windows 11 | 13-mutation campaign | `2026-10-11T11-34-19.751Z-45ecb868` | `8049878` |
| Windows / Windows 11 | Healthy after | `2026-10-11T11-42-09.877Z-51089dd8` | `8049878` |
| Linux / Rocky Xfce/xrdp | Healthy before | `2026-10-11T11-45-55.031Z-107273e6` | `e9c106e` |
| Linux / Rocky Xfce/xrdp | 13-mutation campaign | `2026-10-11T11-46-15.498Z-63277147` | `e9c106e` |
| Linux / Rocky Xfce/xrdp | Healthy after | `2026-10-11T11-47-08.544Z-080b5635` | `e9c106e` |

- The three campaigns detected **39/39** manifested mutations, with **0/6** healthy controls falsely flagged.
  Screenshot comparison detected **33/39**; frame-state samples detected **12/39** (overlap on color/blank). Freeze and
  stale-frame cases escaped single-frame baseline comparison but were detected by remote-state/pixel disagreement.
  At their tested values, crop/offset/scale/missing-control/overlay/alignment/text/geometry/dialog escaped the five
  point samples and were detected by screenshots. This measures this finite catalog, not arbitrary visual defects.
- Whole campaign durations: macOS **31.9 s**, Windows **468.7 s**, Linux **49.4 s**. Mean detection observation latency:
  **0.85 s**, **6.57 s**, **1.02 s**, respectively. Windows' serial WinRM work accounts for much of the difference;
  these are not exact repaint times or algorithm-only latency.
- Clicked **Reproduce campaign** for the original macOS campaign on clean `e9c106e`: run
  **`2026-10-11T11-47-45.076Z-02f16623`**, **13/13** detected, all restored, both controls healthy, ordinary RDP checks
  passed. Original parameters were reproduced exactly; the new source commit is explicit. The Linux campaign and this
  macOS reproduction retain ICC profiles and were checked for unchanged RGBA outside the text-mutation band.
- Selected **40** in the crop parameter dropdown and executed from the dashboard on `e9c106e`: run
  **`2026-10-11T11-50-09.836Z-cd255271`** detected/restored the stronger crop with healthy controls. Other alternative
  severity values are supported by the fixed catalog but were not acceptance-qualified. Original defaults remain recorded.
- Windows' full 13-mutation workflow is on `8049878`; it was not repeated after the PNG metadata/UI/evidence-accounting
  refinement in `e9c106e`. The refinement changes no mutation pixel bytes, baselines, production plugin or detector
  tolerances. The corrected encoder has property coverage plus actual Linux/macOS qualification; earlier artifacts
  retain their original bytes and provenance rather than being rewritten.
- The user-provided historical initial desktop contains a visible, partly offscreen crash dialog. Ubuntu's saved
  report predates the run (09:39:12, signal 5; Tabby restarted at 09:40:40). Actual negative run
  **`2026-10-11T11-19-50.552Z-ea2fab57`** failed the new preflight before fixture startup. Crash evidence was archived
  privately, the stale reporter closed, and later healthy OS captures reviewed. No crash report was sent and no root
  cause or crash during the historical test is claimed. Arbitrary initial OS dialogs still need further coverage.
- Earlier development crop/campaign runs remain in history. One development browser check looked for a synchronous
  `toMatchSnapshot` call in a context-only trace; that API call is not recorded there. The test itself passed. The
  final browser helper verifies recorded locator screenshot checks, while buffer comparison findings are retained in
  the HTML report and mutation JSON. Dashboard screenshot anchors were corrected after lazy images shifted the page.

**Evidence and validation:**

- `.qa/runs/<IDs above>/` retains PNGs, independent manifestation diffs, before/restored controls, temporal captures,
  detector messages, remote state, report, trace and environment metadata. The three main campaigns have **490**
  attachments; the final macOS reproduction adds **161**. Empty diagnostic logs are valid; all PNGs/traces are nonempty.
- `.qa/visual-<target>-mutation-acceptance.json`, matching `*-mutations*.png`, `*-mutation-evidence.png`,
  `*-mutation-trace.png`, `.qa/phase3-*-review-*.png`, `.qa/phase3-reproduction.json`, `.qa/phase3-parameter.json` and
  `.qa/phase3-validation.json` retain browser and independent verification receipts. Runtime artifacts are ignored;
  back them up separately. The dashboard remains at <http://127.0.0.1:4317> with its existing private configuration.
- Final checks: **581 unit tests passed, 3 skipped, 0 failed**; **9 QA contract tests passed**; plugin/test typecheck,
  syntax and diff checks passed. Contract coverage includes authenticated/origin-protected campaigns, fixed values,
  concurrency/cancellation, missing-environment experiments explicitly Not executed, and exclusion/false-positive metrics.
- Cleanup: zero fixture directories on all four Linux QA guests; no leftover test Xfce session; zero Windows fixture
  tasks/directories; zero owned panes, mutation hooks/overlays or sizing styles on native Windows/Linux clients.
  All test/browser processes completed. Dedicated native clients, tunnels and dashboard remain intentionally available.
- Scanned **6,317 artifact files and 19,812 ZIP members** for actual guest/admin passwords and private-key content,
  including UTF-16/base64 forms: **zero matches**. Final dashboard state: **active null**, **73** retained runs.
  Aggregate development-plus-acceptance history has 67/67 detections and 0/14 control false positives; this includes
  repeated experiments, not 67 distinct defect categories. The comparable three-client acceptance subset is 39/39 above.

**Handoff / remaining scope:**

- Phase 3 mutation acceptance covers three ARM64 cells: native macOS→Ubuntu/GNOME, Windows→Windows, and Linux→Rocky/xrdp.
  Other Phase 2 cells remain configured and retain their Phase 2 evidence; they were not all rerun as mutation campaigns.
  H.264, x86_64, KDE/KRDP, independent Linux guest pixels and broader Phase 2 scenarios remain unqualified as previously
  documented. No other thread's VM or live session was changed.
- A known-process crash preflight is not a visual classifier. Synthetic dialog detection is limited to the measured
  fixture viewport. Generic initial OS-dialog understanding remains a gap. PNG profile preservation avoids adding an
  unintended presentation change, but this does not establish comprehensive color-management correctness.
- Spatial manifestation observes changed pixels/bounds; temporal manifestation observes a controlled remote state
  advance and unchanged presentation. Neither independently attributes a production failure's cause. Missing baseline,
  disconnected transport, incomplete execution and nonmanifested injection must remain distinct from a detection.
- Keep controls and mutation metadata separate from future AI evaluator inputs. Phase 4 should use these retained
  healthy/mutated images and temporal pairs to measure sensitivity/false positives before making AI judgments blocking.
  No Decisions/Responses integration, automated investigation, scheduler, PR automation or KDE provisioning was added.
- Forced termination relies on the 30-second mutation expiry and bounded fixture lifetime; a hard kill can still leave
  a temporary directory/session requiring operator cleanup. Normal accepted runs verified full cleanup. Historical
  metrics include development/repeated campaigns; use commit and run IDs for comparable subsets. The 100-run capacity
  and separate runtime-evidence backup requirement remain in force.

### Phase 4 — completed 2026-10-11

**Implementation commit: `c9b87f9`.** `scripts/qa/ai{,-codex,-evidence}.mjs`, authenticated serialized review/cancellation in the
existing server, findings/regions/history in the dashboard, and `scripts/qa/ai-acceptance.mjs`. The Codex provider
uses the user's Pro-backed ChatGPT sign-in; optional Responses uses separately billed API credentials. Operations,
limits, isolation, cache/recovery and reproduction are documented in [visual-qa.md](visual-qa.md#ai-visual-review-phase-4).

**Actual acceptance:** browser sign-in → select retained real-RDP campaign → request AI review → inspect completed
findings and images → desktop/mobile layout → repeat review → verify local cache reuse with no additional provider
requests. Three ARM64 native clients, 13 manifested mutations plus two static and two native-input controls each.
No RDP VM/session was restarted or modified, and original tests, baseline tolerances and statuses remain unchanged.
Model **`gpt-6-luna`**, low reasoning; detector **`visual-review-1-codex`**, CLI **`0.162.1`**.

| Native client / server | Source run | First accepted AI review | Detected | Healthy false positives | Escapes |
|---|---|---|---:|---:|---|
| macOS / Ubuntu GNOME 46 | `2026-10-11T11-47-45.076Z-02f16623` | `7295fad8-059e-4822-98a2-e91e143e1007` | 12/13 | 0/4 | crop |
| Windows / Windows 11 | `2026-10-11T11-34-19.751Z-45ecb868` | `9c73a1ed-ed4a-4e90-9f35-2d725fabcb12` | 10/13 | 0/4 | crop, offset, missing |
| Linux / Rocky Xfce/xrdp | `2026-10-11T11-46-15.498Z-63277147` | `a36733f9-ed69-432e-aa85-6dfd4420dd0e` | 10/13 | 0/4 | crop, missing, alignment |

- **32/39 detected (82.05%), 7/39 missed (17.95%), 0/12 control false positives**, zero abstentions, no incomplete or
  nonmanifested cases in this subset. These 51 labeled observations represent **45 unique AI inputs**, because static
  controls repeat and freeze/stale can yield identical image/state evidence. Each first campaign review reused two
  within-campaign cache entries; its uncached mean request latency was **4.47 / 4.43 / 4.57 seconds**, respectively.
  Reproduction used cache for all 51 observations. No detector/prompt tuning or answer substitution was used to hide misses.
- Per-category detection: crop **0/3**, offset **2/3**, missing UI **1/3**, alignment **2/3**; remaining nine catalog
  categories **3/3** each. Layer totals: framebuffer **12/15**, frontend **16/18**, remote environment **1/3**,
  screenshot/evaluator **3/3**. The last measures screenshot sensitivity, not live RDP rendering. Deterministic Phase 3
  detectors caught all seven AI escapes, so the two approaches remain complementary rather than interchangeable.
- The historical user-linked initial desktop in `2026-10-11T10-46-41.888Z-bf325b96` was classified **overlay / high /
  0.99 confidence**, with a region over the real crash dialog. Its original Passed status is preserved. The failed
  preflight run `2026-10-11T11-19-50.552Z-ea2fab57` received completed initial-desktop and full-window anomaly reviews
  while remaining Infrastructure failure. Later clean Ubuntu desktop `2026-10-11T11-31-14.082Z-307405fc` was **healthy**.
  Those three OS classifications were separately checked against human-reviewed screenshots; the two positive views
  are the same stale incident, not independent production regressions. The two ordinary passed runs also contributed
  twelve healthy fixture/input observations, all correctly unflagged; these are outside the primary 39/12 benchmark.
- Supplementary accepted review IDs: historical dialog **`fe22f02d-979a-419b-b051-9e610a6dfd98`**, failed preflight
  **`b2ca68cb-1e1d-47b0-97ba-f87a3cb2a918`**, clean desktop **`515e5e78-dd7d-4817-b5c9-183592c7e961`**.
  All three browser workflows also verified repeat-cache behavior, unchanged source status and mobile layout.

**Validation and retained evidence:**

- **21 QA tests passed**, including subscription subprocess cancellation, credential-environment isolation, fail-closed
  tool-event handling, schema/refusal validation, cache identity, API spending reservations, ground-truth separation,
  evidence containment, HTTP authorization, persistence/recovery and effectiveness denominators. Synthetic contract
  replies run only in isolated temporary test data; they are not model-quality evidence. Typechecking passed;
  **581 unit tests passed, 3 skipped, 0 failed**. No dependency or production plugin change.
- `.qa/phase4-mutation-ai-acceptance.json`, `phase4-os-ai-acceptance.json`, `phase4-validation.json`, corresponding
  `ai-<run-id>{,-mobile}.png`, and `phase4-{dialog,initial-desktop}-findings{,-mobile}.png` retain browser/independent
  receipts and visually inspected real region overlays. Every evaluated image's SHA-256 matches retained source
  evidence. `.qa/runs/<id>/ai-reviews/` preserves original and repeated reviews; latest summaries point to cached repeats.
- Initial missing-key browser checks and `phase4-ui-contract*` are explicitly labeled negative/contract-only evidence.
  A direct API credential was unavailable; the user requested Pro authentication, which was then validated through
  supported Codex CLI sign-in. No direct paid API request was made. The direct Responses transport remains
  **contract-tested, not live account-qualified**.
- Development validation caught unsupported installed-CLI config keys, benign isolation notices emitted as error
  items, a long environment-selector mobile overflow and a 2200×1700 HiDPI failure screenshot rejected by the original
  per-edge limit. Fixed using verified CLI options, a narrow isolation-notice allowlist, constrained flex sizing, and
  the same four-megapixel budget with a 4096-pixel edge cap. The interrupted/failed review record remains retained;
  a subsequent full browser workflow completed. No screenshot was resized or baseline relaxed to make review succeed.
- Local subscription ledger at acceptance: **55 attempts**, **52 cached evaluations**, **605,034 reported tokens**.
  Three early development attempts failed configuration/output validation; a separate CLI diagnostic is outside
  this ledger. These are local accounting figures, not remaining Pro allowance or a complete billing statement.
  No dollar estimate is assigned to subscription usage. The request cap remains 100; all repeated acceptance reviews
  use the local cache. The dashboard stays on <http://127.0.0.1:4317>; 73 source test runs remain retained.
- All six browser review/cache workflows were repeated on clean **`c9b87f9`** after implementation commit; source
  status, findings, image loading and mobile checks passed with **zero additional provider requests**. These clean
  reviews explicitly reuse the earlier model evaluations rather than claiming fresh inference. Receipt:
  `.qa/phase4-clean-cache-acceptance.json`. Final dashboard totals are 67 reviewed observations, 32/39 defects detected
  and 0/24 labeled-control false positives; the primary comparable subset remains 39/12 above.
- Secret scan of **6,350 artifact files and 19,812 ZIP members** found no actual test passwords/private-key material.
  Runtime reviews/cache/receipts are ignored and need separate backup. No test run or AI request remains active at handoff.

**Limitations and next-phase handoff:**

- AI misses subtle crop/offset/alignment and some missing controls. High self-reported confidence does not imply
  correctness; some temporal state disagreements were labeled text/geometry instead of render-state. Binary detection
  effectiveness is measured; classification accuracy and region precision are not calibrated. Freeze/stale evidence
  establishes state/presentation disagreement, not a causal diagnosis or the ability to distinguish those mechanisms.
- This is a finite catalog/default-strength dataset, not a held-out generalization benchmark. Windows uses retained
  pre-ICC-refinement Phase 3 text evidence; do not treat its AI result as isolated color-management/text qualification.
  Other matrix cells, H.264, x86_64, KDE/KRDP and broader visual scenarios remain unqualified as previously documented.
- Initial OS review detected this crash dialog; it does not prove general shell/dialog coverage or establish crash
  timing/root cause. Failed-test analysis is screenshot-grounded and manual-triggered. Logs/traces are linked locally;
  automatic multi-artifact investigation, scheduling, CI/PR automation and retention work remain **Phase 5**.
- Codex model access, sign-in and shared subscription allowance are operator dependencies. Use a private trusted local
  service account/session; do not export personal authentication to public CI. A model alias can evolve; bump detector
  version/invalidate cache deliberately when requalifying behavior. Preserve misses, independent controls and source
  truth separation, and use disjoint evidence when tuning before considering blocking AI judgments.

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
