# Graph Report - .  (2026-07-12)

## Corpus Check
- Corpus is ~29,925 words - fits in a single context window. You may not need a graph.

## Summary
- 355 nodes · 499 edges · 28 communities (17 shown, 11 thin omitted)
- Extraction: 93% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 31 edges (avg confidence: 0.72)
- Token cost: 130,000 input · 20,000 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Controller Config & Environment|Controller Config & Environment]]
- [[_COMMUNITY_Session Controller Core (CT 105)|Session Controller Core (CT 105)]]
- [[_COMMUNITY_System Architecture Overview|System Architecture Overview]]
- [[_COMMUNITY_Frontend Homepage & Mobile Toolbar|Frontend Homepage & Mobile Toolbar]]
- [[_COMMUNITY_Frontend Dependencies|Frontend Dependencies]]
- [[_COMMUNITY_HealthStatus API Routes|Health/Status API Routes]]
- [[_COMMUNITY_TypeScript Config|TypeScript Config]]
- [[_COMMUNITY_Feedback API & Email Templates|Feedback API & Email Templates]]
- [[_COMMUNITY_Deployment & Infra Bugs|Deployment & Infra Bugs]]
- [[_COMMUNITY_Phase 3 Real Bugs (ttyd, ws_proxy, nesting)|Phase 3 Real Bugs (ttyd, ws_proxy, nesting)]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]

## God Nodes (most connected - your core abstractions)
1. `ProxmoxClient` - 20 edges
2. `Playground Session Controller README` - 18 edges
3. `compilerOptions` - 16 edges
4. `SessionTable` - 13 edges
5. `Playground Phase 3 — Session Controller Implementation Plan` - 13 edges
6. `Playground Phase 4 — Public Web Interface Implementation Plan` - 11 edges
7. `checkAndNotifyIfRecovered()` - 10 edges
8. `Step 4.5: Recovery notification system` - 10 edges
9. `jaysync-lab-playground README` - 8 edges
10. `Step 3.3: Proxmox resource pool, role, and API token` - 8 edges

## Surprising Connections (you probably didn't know these)
- `Gate 3: Sandboxed test run in a real session clone` --semantically_similar_to--> `Step 3.8: Full end-to-end manual test`  [INFERRED] [semantically similar]
  playground-contribution-pipeline-plan.md → playground-phase3-session-controller-plan.md
- `Cron fallback safety net (daily, Hobby-plan tradeoff)` --semantically_similar_to--> `Step 3.6: Background reaper (safety net)`  [INFERRED] [semantically similar]
  playground-phase4-web-interface-plan.md → playground-phase3-session-controller-plan.md
- `Issue #23: analytics/security logging (deprioritized)` --conceptually_related_to--> `Playground Phase 4 — Public Web Interface Implementation Plan`  [AMBIGUOUS]
  CLAUDE.md → playground-phase4-web-interface-plan.md
- `controller/ (FastAPI session controller directory)` --conceptually_related_to--> `Controller (FastAPI, controller/)`  [INFERRED]
  README.md → CLAUDE.md
- `controller/ directory placement decision` --rationale_for--> `Playground Session Controller README`  [INFERRED]
  PHASE3_EXECUTION_BRIEF.md → controller/README.md

## Import Cycles
- 1-file cycle: `controller/app/main.py -> controller/app/main.py`
- 2-file cycle: `controller/app/main.py -> controller/app/ws_proxy.py -> controller/app/main.py`

## Hyperedges (group relationships)
- **Bugs found only via real end-to-end testing against the live host/production, never guessed or found via code review alone** — implementation_log_bug1_wait_for_task_exitstatus, implementation_log_bug2_ttyd_loopback_bound, implementation_log_bug3_ws_proxy_relay_bugs, implementation_log_bug4_nesting_regression_ct183, implementation_log_stale_session_429_bug, implementation_log_send_trigger_gating_bug [INFERRED 0.85]
- **Core components of the clone-per-session disposable sandbox architecture** — implementation_log_vmbr_sandbox_bridge, implementation_log_ct180_creation, implementation_log_step3_4_3_7_controller_core, implementation_log_ttyd_install, implementation_log_ct180_template_conversion [INFERRED 0.80]
- **Proxmox permission grants following the least-privilege, two-place-grant pattern** — implementation_log_sdn_use_permission, implementation_log_datastore_allocatespace_permission, implementation_log_playground_ctrl_api_token, implementation_log_two_place_grant_trap [EXTRACTED 1.00]
- **Recurring irreversible golden-template retemplate cycles (fix on a clone, verify, convert, restore VMID)** — implementation_log_ct180_template_conversion, implementation_log_ct180_to_ct183_retemplate, implementation_log_post_phase3_cleanup_ct180_restore, implementation_log_stale_network_config_ct183 [EXTRACTED 1.00]
- **Four-gate review process for terminal-content contributions** — playground_contribution_pipeline_plan_gate1_automated_checks, playground_contribution_pipeline_plan_gate2_human_review, playground_contribution_pipeline_plan_gate3_sandboxed_test, playground_contribution_pipeline_plan_gate4_retemplate [EXTRACTED 1.00]
- **Push-triggered, Vercel-verified recovery notification flow with backup poll** — playground_phase4_web_interface_plan_step4_5, playground_phase4_web_interface_plan_execstartpost_hook, playground_phase4_web_interface_plan_host_online_endpoint, playground_phase4_web_interface_plan_vercel_cron [EXTRACTED 1.00]
- **Sequential living implementation plans (Phase 3 -> Phase 4)** — playground_phase3_session_controller_plan_doc, playground_phase4_web_interface_plan_doc, readme_playground_plans [INFERRED 0.85]

## Communities (28 total, 11 thin omitted)

### Community 0 - "Controller Config & Environment"
Cohesion: 0.05
Nodes (38): clone_sandbox_ip(), Central configuration for the playground session controller.  Tested against t, Static IP convention for a session clone on vmbr_sandbox — see the     networki, create_session(), delete_session(), lifespan(), FastAPI app for the playground session controller (Phase 3, Steps 3.4-3.5), plu, SessionResponse (+30 more)

### Community 1 - "Session Controller Core (CT 105)"
Cohesion: 0.08
Nodes (40): CT 105 (controller host), Three real bugs found during Step 3.8 testing, app/config.py, Playground Session Controller README, .env.example, app/main.py, app/proxmox_client.py, app/reaper.py (+32 more)

### Community 2 - "System Architecture Overview"
Cohesion: 0.07
Nodes (39): Cloudflare Tunnel, Controller (FastAPI, controller/), CT 180 golden template, CLAUDE.md (playground repo), Frontend (Next.js, web/), Issue #21: welcome-script escape-sequence bug, Issue #23: analytics/security logging (deprioritized), Independent reaper (+31 more)

### Community 3 - "Frontend Homepage & Mobile Toolbar"
Cohesion: 0.11
Nodes (20): MobileCtrlToolbar(), MobileCtrlToolbarProps, MobileDesktopBanner(), FormStatus, OfflineState(), formatGiB(), Phase, PlaygroundTerminal() (+12 more)

### Community 4 - "Frontend Dependencies"
Cohesion: 0.08
Nodes (24): dependencies, next, react, react-dom, @upstash/redis, @xterm/addon-fit, @xterm/xterm, devDependencies (+16 more)

### Community 5 - "Health/Status API Routes"
Cohesion: 0.17
Nodes (15): GET(), POST(), sleep(), checkHealth(), sendEmail(), SendEmailInput, addToQueue(), checkAndNotifyIfRecovered() (+7 more)

### Community 6 - "TypeScript Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+11 more)

### Community 7 - "Feedback API & Email Templates"
Cohesion: 0.21
Nodes (16): getClientIp(), POST(), renderEmailShell(), buildTitle(), checkRateLimit(), createFeedbackIssue(), escapeHtml(), FEEDBACK_TYPES (+8 more)

### Community 8 - "Deployment & Infra Bugs"
Cohesion: 0.13
Nodes (19): clone_template() review findings: full=1 clone + unawaited task race, cloudflared tunnel (playground-controller), Cron fallback interval tradeoff (daily, Vercel Hobby limit), CT 105 never auto-started after real host outage (no onboot=1), ExecStartPost couldn't write log file (unprivileged service user), GET /health endpoint, Phase 4 — Public Web Interface, Send-trigger transition-gating gap (missed notification on short outage) (+11 more)

### Community 9 - "Phase 3 Real Bugs (ttyd, ws_proxy, nesting)"
Cohesion: 0.18
Nodes (18): Bug 1 — _wait_for_task() too strict on WARNINGS exitstatus, Bug 2 — ttyd bound to 127.0.0.1 only, Bug 3 — ws_proxy.py relay bugs (text-frame crash + hung teardown), Bug 4 — nesting=1 regression in new template CT 183, Temporary net1 build-time internet access left/removed (drift), Retemplate CT 180 → CT 183 (ttyd wrapper fix), Datastore.AllocateSpace grant on /storage/local-lvm, nesting=1 required for unprivileged LXC systemd (recurring root cause) (+10 more)

### Community 10 - "Community 10"
Cohesion: 0.15
Nodes (13): CT 180 base container creation, pct template 180 conversion (irreversible), Dangerous tools installed in curated sandbox (bug), Multi-source-IP concurrency test technique broken by Cloudflare Tunnel NAT, Deferred cluster-wide firewall policy (drift decision), Phase 1 — Network Foundation, Phase 2 — Golden Template (VMID 180), PlaygroundTerminal.tsx (xterm.js + ttyd wire protocol) (+5 more)

### Community 11 - "Community 11"
Cohesion: 0.29
Nodes (4): FEEDBACK_TYPES, FeedbackForm(), FormStatus, metadata

### Community 12 - "Community 12"
Cohesion: 0.33
Nodes (7): Issue #17: community contribution pipeline (paused), Bash-only submission scope, Community Contribution Pipeline — Implementation Plan, jaysync-lab-site docs pipeline (rebuild-from-docs.yml), Gate 1: Automated checks (bash -n, shellcheck, denylist), Gate 2: Mandatory human review, Gate 3: Sandboxed test run in a real session clone

### Community 13 - "Community 13"
Cohesion: 0.40
Nodes (3): geistMono, geistSans, metadata

### Community 14 - "Community 14"
Cohesion: 0.40
Nodes (5): Feedback issue bodies never contain submitter email, GITHUB_FEEDBACK_TOKEN scoping, lib/feedback.ts, Rate-limit testing pollutes shared IPs, Upstash Redis (KV)

## Ambiguous Edges - Review These
- `CT 180 golden template` → `Issue #21: welcome-script escape-sequence bug`  [AMBIGUOUS]
  CLAUDE.md · relation: conceptually_related_to
- `Issue #23: analytics/security logging (deprioritized)` → `Playground Phase 4 — Public Web Interface Implementation Plan`  [AMBIGUOUS]
  CLAUDE.md · relation: conceptually_related_to

## Knowledge Gaps
- **93 isolated node(s):** `notify-host-online.sh script`, `eslintConfig`, `nextConfig`, `name`, `version` (+88 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `CT 180 golden template` and `Issue #21: welcome-script escape-sequence bug`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Issue #23: analytics/security logging (deprioritized)` and `Playground Phase 4 — Public Web Interface Implementation Plan`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `Playground Phase 3 — Session Controller Implementation Plan` connect `Session Controller Core (CT 105)` to `System Architecture Overview`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Why does `Playground Session Controller README` connect `Session Controller Core (CT 105)` to `System Architecture Overview`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `ProxmoxClient` (e.g. with `SessionResponse` and `WebSocket`) actually correct?**
  _`ProxmoxClient` has 6 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `Playground Session Controller README` (e.g. with `CT 105 (controller host)` and `controller/ directory placement decision`) actually correct?**
  _`Playground Session Controller README` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 4 inferred relationships involving `SessionTable` (e.g. with `SessionResponse` and `WebSocket`) actually correct?**
  _`SessionTable` has 4 INFERRED edges - model-reasoned connections that need verification._