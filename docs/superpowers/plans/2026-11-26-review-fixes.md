# Live Plugin Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the five confirmed review defects and release compatible updates.

**Architecture:** Keep independent adapters and the current host API. Exercise real plugin entry points through VM contexts and fake HTTP/clock boundaries.

**Tech Stack:** JavaScript, Node built-in test/assert/vm, Ruby packaging.

**Spec:** `docs/superpowers/specs/2026-11-26-review-fixes-design.md`

## Global Constraints

- Binance favorite flow budget stays 16 seconds; request cap stays 8 seconds.
- OKX history retry interval is 10 seconds; use the original requested sequence until acknowledged.
- Do not alter Twitch IDs, code or package versions.
- Preserve unrelated user changes and current public source URLs.

## Review Focus

- Slow successful profile lookup followed by a second HTTP request must recompute remaining time.
- A failure or empty earlier page must not discard a later successful fetched page.
- A failed or ended first OKX candidate must not mask a live second candidate.
- New chat pushes while history is pending must not suppress timeout retry; acknowledgment must stop retry.
- Offline YouTube metadata omissions and subsequent network errors must preserve known identity and artwork.

### Task 1: Binance deadline

**Files:** `plugins/binance/index.js`, `tests/review-regressions.test.mjs`
**Interfaces:** `_bn_latestLiveByUser(userId, excludeId, timeout, deadline?)`; optional deadline affects only favorites.
- [ ] Add a fake-clock test with responses taking 7.9s, 7s, 7.9s; require elapsed <= 16s.
- [ ] Run the test, observe failure; recalculate timeout before profile and detail requests.
- [ ] Verify the regression and full suite; commit.

### Task 2: Binance partial batches

**Files:** same as task 1. Independent of its function signature change.
- [ ] Add tests where page 1 fails and page 2 is live, and where two empty pages precede a live page in the same batch.
- [ ] Observe failures; verify all successful pages before applying stop conditions.
- [ ] Verify regressions and full suite; commit.

### Task 3: OKX current session

**Files:** `plugins/okx/index.js`, regression tests.
**Interfaces:** replace the private first-match lookup with all matching candidates; preserve public responses.
- [ ] Add playback and chat tests with ended/failed old candidate plus a live newer candidate.
- [ ] Observe failures; verify each candidate independently and continue on ended/failed candidates.
- [ ] Verify regressions and full suite; commit.

### Task 4: OKX history timeout

**Files:** same as task 3.
**Interfaces:** session fields retain pending sequence and request timestamp; tick returns retry writes.
- [ ] Add a dropped-response fake-clock test, including new pushes and later acknowledgment.
- [ ] Observe failure; retry the same sequence after 10s, stopping retries on acknowledgment.
- [ ] Verify regression and full suite; commit.

### Task 5: YouTube metadata

**Files:** `plugins/youtube-tw/index.js`, regression tests.
**Interfaces:** `_yt_room(id, player, fallback?)` merges only missing metadata; state remains fresh.
- [ ] Add offline-without-details then HTTP 503 tests and a cold-cache supplied channel-ID test.
- [ ] Observe failures; retain cached metadata/supplied identity while updating state.
- [ ] Verify regressions and full suite; commit.

### Task 6: Review and release

**Files:** affected manifests, README, generated three packages and sources/checksums.
- [ ] Run fresh whole-branch review; fix important findings with regression proof.
- [ ] Bump Binance/OKX/YouTube only, build and validate, compare packaged source bytes.
- [ ] Verify upstream head, publish with lease, fetch public sources and verify downloaded package digests.
