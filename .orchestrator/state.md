# Boards hub implementation preparation

Project: VisualGrilling. Source: docs/vgril/specs/grill-boards-hub.md (2026-11-17).
Source SHA256: 53c93b3d215ac16bad568ddac615fb5031cedf11bd1aa620f30cfa812ac04fc5.
Base: 61b462f36d6db0499a830b72fe83d7679e4c0978. Initial working tree clean.
Iteration 1, phase 2 (review pass 5 fixes). Limits: 5 iterations; mandatory review-until-clean takes precedence over review round cap.
User approved archival of completed ContextBudget; previous state saved as context-budget-completed.md. This is the canonical boards-hub state. Independent preparation record remains as history.

## Requirements
| ID | Requirement/source | Acceptance | Status | Evidence |
|---|---|---|---|---|
| R1 | Spec requirement 1: stable registry identity | Same board across ports; concurrent atomic registration; copies detected; retain missing entries; rebind checks ID | REVIEW | Implementation and checks below; final independent verification pending |
| R2 | Requirement 2: open existing board | Reopening tab preserves server/session and one handler | REVIEW | Implementation and checks below; final independent verification pending |
| R3 | Requirement 3: Play | Resume available session; otherwise owned background session; concurrent requests share success/error | REVIEW | Implementation and checks below; final independent verification pending |
| R4 | Requirement 4: Stop ownership | Stop server/processing, preserve terminal session, stop owned process, isolate neighbours; no finish | REVIEW | Implementation and checks below; final independent verification pending |
| R5 | Requirement 5: durable stop fence | Accepted results exactly once; unfinished replay; old epoch rejected through restart/race | REVIEW | Implementation and checks below; final independent verification pending |
| R6 | Requirement 6: independent state | Completion/server/agent/time separate; no connected claim on queue submission | REVIEW | Implementation and checks below; final independent verification pending |
| R7 | Requirement 7: counts | Current q ok closed, open/weak/gap/verify open; exclude obsolete/other kinds | REVIEW | Implementation and checks below; final independent verification pending |
| R8 | Requirement 8: background interaction | Chat link, login and approval visible and actionable | REVIEW | Implementation and checks below; final independent verification pending |
| R9 | Requirement 9: demand launch/recovery | Native host launch after reboot; stale cached list/retry/help; no false empty success | REVIEW | Implementation and checks below; final independent verification pending |
| R10 | Requirement 10: command admission | Installation secret and exact origin; installer bootstrap/rebind; negative tests | REVIEW | Implementation and checks below; final independent verification pending |
| R11 | Requirement 11: navigation | Search/project groups; active means unfinished regardless of running status | REVIEW | Implementation and checks below; final independent verification pending |
| R12 | Installation steps 8-9 | Unified Windows path, production distribution caveat explicit, version/install/docs synchronized | REVIEW | Implementation and checks below; final independent verification pending |
| R13 | Verification section | Disposable simulator, worker/monitor/maps, restart/security, actual Chrome/Codex acceptance distinguished | REVIEW | Implementation and checks below; final independent verification pending |

## Work units and dependencies
- W0 read-only Codex and Chrome installation investigations in parallel; no model tasks or user profile mutations.
- W1 registry and runtime lifecycle contracts precede service/frontend integration.
- W2 Codex adapter, local service and native installer; disjoint ownership required.
- W3 extension and chat UI using impeccable; service contract required.
- W4 integration/docs/checks; fresh independent read-only reviewer per pass, distinct fixer, commits for nonclean passes; final independent whole-spec verification.

## Decisions and open dependencies
- Existing root-level binding cannot safely control independent boards; require per-board binding and durable epoch.
- Stop boundary must precede response and process exit, with post-await mutation checks; never refresh old apply credentials from disk.
- Codex 0.169.0 supplies app-server RPC and shared daemon proxy; inspect exact schemas before implementation.
- Chrome unmanaged Windows forbids silent local extension installation. Native messaging can be installed per user. Production requires Store listing and browser confirmation; local developer path must be labelled honestly.
- Existing state archival approved and completed. No pending user decisions.

## Wave 1 assignments
- registry_runtime: skills/grill/grill.mjs, connection.mjs, usage.mjs, hub/registry.mjs, dev/check-hub-runtime.mjs. R1/R4/R5/R6/R7 implementation, epoch+board binding contract.
- codex_adapter: skills/grill/hub/codex.mjs, dev/check-hub-codex.mjs. R3/R8 adapter and fake transport tests, safe actual protocol initialization only.
- native_installer: hub/native.mjs, install.ps1, NativeHost.cs, README.md, dev/check-hub-native.mjs. R9/R10/R12 transport/installer staging. No HKCU/user Chrome modifications during tests.
- W0 read-only findings complete: Codex0.169.0 supports owned app-server and shared proxy; Store publication remains external production dependency. No paid tasks started.
- Service and extension wait for interfaces and a free slot. All implementations require fresh independent review; no requirement DONE yet.

## Integration contract (wave 1)
- Registry: registerBoard({dir,base,name,project,cli}), listBoards(), getBoard(id), rebindBoard(id,dir), updateObservation(id,observation). Per-board identity file and per-ID records under GRILL_HUB_HOME or LOCALAPPDATA/VisualGrilling/Hub.
- Native installation: install/installation.json {installationId,secret,epoch,extensionId,nodePath,servicePath,dataDir}; never record actual secret here. Native host com.visualgrilling.hub. Stable developer extension ID mlbhjcnadefifjiiaodeamaammblmpfp; public key in hub/extension-key.json.
- Native envelope: {v:1,id,method,params,installationId,secret,epoch}; bind bootstraps only after real argv origin validation. Result {id,ok:true,result} or {id,ok:false,error:{code,message}}.
- Service launch: fixed Node and skills/grill/hub/service.mjs --config installation.json; endpoint dataDir/endpoint.json {port,pid,installationId,epoch}; protected GET /api/health and POST /api/command {method,params}, x-grill:1, Authorization Bearer installation secret, x-grill-epoch, exact extension Origin and loopback Host. Singleton across native clients.
- Methods: list/open/play/stop/rebind/chat/sendChat/login/approval. Board params use boardId, rebind uses dir. Chat lives in extension chat.html and communicates through native transport, avoiding unauthenticated web chat routes.
- Adapter createCodexAdapter exposes probeBinding/resume/startOwned/stop/readChat/sendChat/resolveRequest/login/getState/close. States do not imply actual attached map consumer. Persist callbacks and ownership, never infer absence from unknown transport error.

## Wave 1 evidence and wave 2
- codex_adapter complete, focused fake protocol checks PASS; real dedicated initialize/account PASS with no model turns. Shared proxy initialize timed out; not accepted as working resume. hub_service assigned integration and investigation/fix of proxy framing. R3/R8 remain REVIEW/PARTIAL pending real transport and final review.
- registry_runtime reports check-hub-runtime PASS (identity, counters, missing/rebind, six concurrent registrations, Stop epoch/replay/accepted receipt/restart/403); regression checks running. Runtime workflow/contract synchronization added to its ownership. No independent review yet.
- native_installer reports framing/origin/secret/rotation + actual twice-run PowerShell staging + compiled launcher PASS, without HKCU or profile writes. Actual service/extension integrated staging must be rerun later.
- hub_service owns service.mjs/check-hub-service.mjs and permitted adapter fixes; native transport contract above is fixed. Service/extension chat UI uses native authenticated methods only.
- registry_runtime complete: focused runtime and maps PASS. monitor fixture still writes root binding after migration (consumer update assigned); workers waits for full tracked mirror synchronization. Entire .claude/skills/grill is a tracked directory, not a junction, so release stamping alone is insufficient.
- extension_ui owns hub/extension and extension checks, PRODUCT.md/.impeccable surface context; impeccable applied, actual rendered narrow/wide capture required.
- consumer_docs owns developer docs/root guides and affected old binding test fixtures; run regressions in disposable GRILL_HUB_HOME. Runtime and skill instructions frozen pending fresh review.
- consumer_docs complete: connection/monitor/session-transfer/usage/worker-cost PASS in disposable registries; updated guides and fixtures. No baseline failures in these checks.
- Root independent execution: check-actions-simulator PASS (actual --no-open --delay 200, gap/ok/verify/discuss/more/finish/report/403), check-actions PASS, check-followups PASS, git diff --check PASS.
- review_core_1 fresh read-only core/native review underway (scoped review pass 1). Service/adapter/extension still evolving and excluded; full fresh integrated review required afterward.
- Shared proxy framing attempts NDJSON, LE/BE length and Content-Length produced no initialization response. Service author investigating safe existing-session queue fallback with explicit unconfirmed status, no duplicate background on ambiguous transport. Owned app-server uses explicit standalone blocking wait, never shared-daemon monitor wake.

## Core review pass 1 — changes requested
Fresh review_core_1 independently passed hub-runtime/native/connection/transfer/usage/maps/monitor, found:
- F1 P1 empty registry.lock after crash between marker unlink and rmdir blocks all Windows writes indefinitely (10s executable repro).
- F2 P2 epoch gate rejects existing browser transfer admission without epoch on managed boards.
- F3 P1 Stop leaves pending sessionTransfer; Play fresh epoch cannot drain events and old transfer cannot claim.
Distinct fix_core_1 assigned all three and regressions. Source runtime/registry and relevant transfer docs/tests owned exclusively by fixer until done. No clean review claim. Full integration review still pending.

## Service evidence
Service and adapter focused checks PASS including security, singleton, rotation, concurrent Play success/error, actual disposable board lifecycle, missing/stale observations. Safe actual current-thread read succeeded through dedicated read-only adapter; existing-session fallback uses supported queue --resume with unconfirmed starting state and no background creation after ambiguous delivery. No real model prompts in these tests.
live_acceptance assigned one bounded real owned background Play/Stop test on disposable project/map only, with no approval-policy changes or existing-user-task messages. Evidence will distinguish permissions/login blockers from successful queue handling.

## Review 1 fixes and release preparation
- Distinct fixer resolved F1/F2/F3 with empty-lock concurrency and managed transfer requested/creating/attached Stop/restart regressions; runtime/transfer/monitor/connection PASS.
- Root confirmed additional service streamed-body credential-rotation race; fixer revalidates admission after body read. Five credential/identity split-body rotation regressions PASS.
- Required worker check exposed instruction budget11188 >11000; wording compacted without removing rules, final10992 bytes, worker/mirror checks PASS.
- Full tracked source mirror synchronized. npm run release executed ONCE:1.0.22; source/mirror UI/version and extension manifest stamped together. npm run link:codex verifies existing test-project junction.
- Native compiled launcher/staging and extension real-native-dispatch credential tests PASS on integrated release. Root preview/knowledge/context/actions/followups/simulator checks PASS.
- Real owned Codex acceptance PASS: attached, live wait, one answer graded ok, protected chat read, Stop terminated owned process/server, accepted result/receipt preserved exactly once, restart old epoch409. Evidence hub-live-acceptance.json. No login/approval arose; those flows have deterministic UI/protocol checks. Temporary fixture cleanup was rejected by automatic approval policy; directory retained, all processes stopped.
- review_integrated_2 has read full spec/docs and viewed captures, no visual blocker; code pass will begin on review1 commit. Extension/native/Store install and actual reboot not yet accepted; terminal fallback has safe identity probe but no real continuation message acceptance.

## Full integration review pass 2 — changes requested
Reviewed frozen a74c87f. Independent runtime/codex/service/native/extension/browser/workers/monitor/maps/transfer/connection/simulator PASS; all39 mirrored source files and1.0.22 release manifests agree. Fresh visual review found no additional blocker.
- F1 P1 previous owned background thread resumes as external on second Play; second Stop preserves it incorrectly. fix_service_2 owns service+adapter/tests/mirrors: trusted persisted ownership, same-thread owned resume and repeated/service-restart coverage.
- F2 P1 sequential native port serializes simultaneous Play into two launches on failure. fix_native_2 owns native/tests/readme: bounded concurrent dispatch/coalescing and actual framed-process regression.
- F3 P1 same-session stale epoch can call /api/stop and stop replacement lifecycle. fix_runtime_2 owns runtime/registry/tests/mirrors and contract: epoch gate on worker stop, separate Hub user control unchanged.
- F4 P2 correct-ID folder rename rejected by old basename check. fix_runtime_2: validate new supported name and update routing atomically.
- F5 P2 live ordinary terminal waiter loses provider/thread identity in Hub list. fix_service_2: validated map binding fallback without assuming connectivity; also avoid unavailable queue-transport chat links.
Three disjoint fixers active. Version stays1.0.22. Root will commit review2 fixes after relevant checks then request another fresh integrated review. Production Store publication, actual clean-machine Chrome install and reboot acceptance remain external unverified dependencies, not claimed complete.

Review2 fix evidence: fix_runtime_2 completed stale/current epoch Stop and same-ID renamed routing with custom-project/legacy/copy/invalid-name regressions; runtime/maps/monitor/transfer PASS, owned mirrors synced. fix_native_2 completed native16-envelope bound, pending Play shared success/error, serialized control order, output backpressure and EOF/malformed-input drain; actual native child/HTTP coalescing + compiled staging checks PASS. Service ownership/provider fixer finishing focused checks before actual repeated owned lifecycle test and review2 commit.

Review2 complete: fix_service_2 preserves trusted same-thread ownership across Stop/Play/service restart, validates per-map provider identity separately from connectivity, and advertises chat only with live RPC; codex/service checks PASS. Windows read/rename timing made initial fixture polling transiently fail; settling admission before polling produced two passing final runs, no product error hidden. consumer_docs synchronized architecture/development/contract;30 local links and whitespace PASS.
Real repeated acceptance PASS after recreating controller: same saved thread, new owned standalone process (no queue), attach+live wait in24seconds, Stop terminates owned process/server, original answer exactly once and receipts/queue unchanged. Evidence hub-live-resume.json; no additional answer, login or approval. Retained disposable directory was not deleted again.
Preparing review2 fix commit, then fresh integrated review pass3. Version remains1.0.22; no second release bump.

## Full integration review pass 3 — changes requested
Frozen4b40c91 independently reviewed; all six Hub suites plus workers/monitor/maps/connection/transfer/usage/worker-cost and actual disposable simulator PASS. No new visual blocker. Found:
- F1 P2 service Play->Stop->Play from independent clients reuses the pre-Stop pending Play; final server stays stopped despite third caller's running result. Requires clearing coalescing at control admission while keeping serialized execution.
- F2 P2 stale working activity rendered definitely disconnected; known failed owned transport could be overridden by lingering waiter and rendered connected. Requires explicit uncertainty, known-failure priority and fresh relevant activity evidence.
- F3 P3 architecture names wrong lifecycle epoch file (state.json instead of hub-lifecycle.json).
Distinct fix_service_3 owns service/adapter/UI status consumers/tests, architecture/contract and own mirrors. No release bump. New clean independent pass required afterward; all requirement completion remains pending final verifier.

Review3 fixes complete: Stop/rebind invalidate pending Play sharing at admission, with cross-HTTP-client ordering regression; connection tri-state matches current attachment/thread/epoch, uses live RPC for ongoing board work and prioritizes known owned failure; UI displays unconfirmed distinctly. Architecture names hub-lifecycle.json. Root integration inspection additionally found stale predecessor binding hiding new pending login/approval and pre-thread login metadata blocking restart; both corrected with current-epoch pending attachment precedence and narrowly validated pre-thread recovery. Ambiguous string IDs still fail closed. Codex/service/extension/browser/native/runtime checks PASS; wide/narrow status captures inspected; owned service mirror synced. Preparing third fix commit, then fresh review pass4. Version unchanged1.0.22.

## Full integration review pass 4 — changes requested
Frozen0394c4e full scope independently reviewed. Six Hub suites, workers/monitor/maps/transfer/connection/usage/worker-cost, simulator PASS; installed links, mirrors,1.0.22 manifests and visual captures consistent. Two concrete recovery defects:
- F1 P1 map-only crash then Play restarts server paused/new epoch but reuses existing old-epoch adapter forever without claim/resume.
- F2 P1 moving live map then rebind accepts new routing while same-ID server still uses old DIR; new discussion fails500 ENOENT and is not saved.
Fresh fix_recovery_4 owns service/runtime/registry/adapter as needed and tests/docs/mirrors. Required fixes include exact lifecycle reconciliation and safe verified-path stop/restart (no PID-only kill or overwriting moved state). Root requested coverage of whole default-project move as part relocation, preserving wrong-project thread guards. Current phase2/pass4 fixes; no version bump. Real acceptance of earlier ordinary/repeated owned lifecycle remains recorded, crash/move acceptance pending new checks.

Terminal acceptance attempted through hidden PTY but host rejected both launches before process creation with CreateProcessW Access denied (os error5); alternative shell selection was ignored. No TUI/model task/thread/config/daemon change. Evidence hub-terminal-acceptance.json. Treat real terminal-preservation/resume acceptance as externally blocked, not proven by fixtures. Existing real owned acceptance remains valid.

## Checks
Targeted new registry/lifecycle/adapter/native/extension checks; node dev/check-actions-simulator.mjs; worker/monitor/maps/connection/session-transfer/actions checks and affected consumers. Actual reboot, clean Windows install and model session tests cannot be replaced by fixtures.

Review4 fixes complete: reconcile exact live epoch after map crash; retire scoped transport and resume same thread; validate canonical route as well as board ID before rebind; stop moved server without writing stale memory; preserve relocated journal. Verified whole-project relocation updates owned thread cwd, uses bundled runtime, and gives unavailable queue-only old-cwd sessions one durable owned replacement while preserving terminal. Creation marker and known replacement ID prevent duplicate startup across helper restart. Service/codex/workers final checks PASS; runtime/maps/monitor/transfer/simulator earlier PASS. Mirrors synchronized; version remains1.0.22. Real map-only crash acceptance and fresh full review5 pending.

Real map-only crash acceptance PASS on1ac3d0f: killed only captured disposable server child while owned Codex survived; Play rotated epoch, ended old owned process, resumed same thread in new owned process and restored actual wait within28seconds. Final Stop ended both, original answer exactly once, receipts/queue unchanged, unfinished. Evidence hub-crash-acceptance.json. No new answer or cleanup retry.

## Full integration review pass 5 — changes requested
Frozen1ac3d0f independently reviewed full task. Six Hub suites + workers/monitor/maps/connection/transfer/usage/worker-cost/simulator PASS; mirrors/version/install links/visuals consistent. F1 P2 Stop races sendChat turn/start: terminal turn accepted before response lacks ownedTurnId, stop skips interruption and returns success; serialize admission/settlement and report ambiguity. F2 P2 extension ignores stopped:false/error and always reports success. Distinct fix_stop_5 assigned adapter/service/UI regressions/docs/mirrors. No version bump. Real owned crash acceptance remains PASS; terminal PTY/Chrome install/reboot external limits unchanged.

Review5 fixes complete: adapter awaits admitted starts, prevents new starts while stopping, preserves failed stop result and ignores late callbacks; service serializes chat/login/approval with lifecycle and returns independent fenced flag. UI shows failed agent shutdown honestly. Deferred started/completed/unrelated-turn/closed-transport/interrupt-failure/exit-timeout/repeated-stop/cross-client/UI regressions PASS. Hub codex/service/extension/browser/runtime checks PASS, docs/mirrors synced. Preparing fix commit and fresh full review6; version remains1.0.22.
