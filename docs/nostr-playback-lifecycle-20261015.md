# Nostr TV playback lifecycle audit and repair

## Recovery anchor

- Objective: repair full detail preparation, current-detail player return, native exact resume and App auto-switch behavior together, while keeping Native History independent and D-SESSION absent.
- Acceptance: a new detail visit prepares afresh; a same-detail player return preserves ready resources and exposes `续播` only for a validated exact Native History record with positive bounded progress; continuation executes the `history_exact` bridge route; true detail exit clears temporary return data.
- Branch/base: `main` / `5c79c342098b32717fce08c906c71545d667412e`, initially clean.
- Suite user attachments and dirty App/WebHome gitlinks are protected. No Suite pointer update or remote push.
- One next action: implement the lifecycle correction under the shared contract, then add focused WebHome regression coverage.

## Confirmed findings before edits

1. `openDetail()` performs new preparation except for its restoration option, and `closeDetail()` cancels current preparation. Keep this entry/exit split.
2. `updateDetailContinueButton()` chooses its label from broadly matching recent Native History, including on a normal new detail visit. Its bound click handler is always `requestDetailPlayback()`, which uses the current prepared resource and does not resume the historical source/progress.
3. On ordinary player return, `rearmDetailPlaybackAfterPlayerReturn()` refreshes History but cancels the handed-off detail run. The Pan-specific return path bypasses that function and clears `playbackReturn` after UI restoration.
4. The existing explicit Native History route in `playNativeHistoryExact()` already sends `intent=history_exact` and a History reference; the App validates the resolved source and IDs. Reuse this route only for an actual current-detail return.
5. `detailHistoryHandoff`, the run's `history`/`historyVerified` fields, and the unused `resolveDetailContinueResource()` chain have no live ordinary-detail caller; verify consumers again before narrowly removing dead remnants.

## Decision and rollback

- No change is rejected because the current label can disagree with the actual action and the return path throws away prepared state.
- No upstream proposal applies: keep the repository's existing Curated/Direct competition and existing App exact History route; do not add a session coordinator or new resource gate.
- The adaptation is limited to a current-detail return marker, validation against the latest exact-playable Native History record, and an executable `history_exact` click path. New detail entry and close remain the preparation/reset boundaries.
- It adds no bridge fields, network work or resource-search work on return. It uses the existing `fmresume`/`fm_pan_playing` signal and snapshot to survive WebView recreation.
- Rollback: revert this WebHome commit independently; keep Native History records and App history routes intact.

## Implemented lifecycle

- A fresh `openDetail()` resets the current return marker and calls `prepareDetailPlaybackForDetail()`. History is not consulted by Curated/Direct resource competition.
- A same-detail native player return restores the detail snapshot and prepared Pan candidate, refreshes Native History once, and rearms the retained prepared run without another resource search.
- `detailReturnedNativeHistoryFor()` accepts only the current same-detail return marker and an authoritative exact-playable Native History record with positive bounded progress. The primary action then calls `playNativeHistoryExact()` through the explicit `history_exact` bridge route; normal detail entry still uses the prepared current resource. A return with no usable resume point has no false `续播` label.
- Pan handoff now records the same return marker. Closing/exiting detail clears it and aborts stale preflight work. Snapshot barrier continuations re-check the captured media context before a native handoff; stale or failed handoffs release only their own marker and preserve the prepared candidate for retry.
- Exact Native History entry continues to use a validated record reference/capability and concrete source, VOD, line, episode, and progress. A/C history records remain separate; ordinary detail preparation does not take over History routing.
- A normal fresh player handoff is distinguished by its existing WebHome bridge route, not by a D-SESSION token. App ordinary launches no longer implicitly replace that resource with Native History.

## Verification results

- `STATIC_PASS`: source trace confirms fresh entry → new preparation; same-detail return → snapshot restore/rearm without search; close → transient return clear; exact History click → validated `history_exact` bridge.
- `UNIT_PASS`: `detail-native-handoff.mjs`, `detail-native-return-state.mjs`, `history-record-contract.mjs`, and `pan-preflight-fresh-admission.mjs` pass. Coverage includes fresh entry and repeated entry, no search on return, exact final native resource/progress, stale context cancellation, handoff error retry, zero-progress behavior, exact History routing, A/C record independence, and deletion.
- `BUILD_PASS`: `node scripts/build.mjs` followed by `node scripts/verify-build.mjs` passes after the final source/build synchronization. Application concat SHA-256 `874908f44eaffc4d4cd2017af3909fe5d6272a6d9240e55d7e95e0a394436f63`; `index.html` SHA-256 `8c4c041725133c4b530b9222600ac47486258c5c9a4f86a7c3892f6d9be1d5b1`.
- Full WebHome `.mjs` suite: 6 passed, 11 did not pass. Ten TV browser tests stopped before assertions because the configured Chrome executable is absent; `sidebar-home-return-focus.mjs` has a stale source-shape assertion (`const` expected, unchanged source uses `let`). These are recorded as `FAIL` with environment/baseline reasons, not as playback regressions.
- Integration: `NEEDS_DEVICE_TEST` because no actual WebHome↔App native runtime was available in this host run. Mobile, Leanback/TCL, exact native resume after an automatic source switch, and expired-share fallback require real-device verification. No `DEVICE_PASS` is claimed.
- Local branch/base at start: `main` / `5c79c342098b32717fce08c906c71545d667412e`, initially clean. The generated `index.html` is included because it is the shipped WebHome application artifact.
- The local WebHome commit contains the listed lifecycle changes, regression tests, generated `index.html`, and this record. No remote push or Suite gitlink update is made in this pass.
