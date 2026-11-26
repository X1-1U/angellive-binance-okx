# Live plugin review fixes

Approved scope: the five reproduced findings from review of 041f287; user requested implementation.

## Goals and constraints

- Binance favorites must finish within the existing 16-second flow budget, recomputing time before each HTTP request.
- Successful directory pages remain usable when a sibling page fails or is empty.
- OKX playback and chat must test all same-author candidates rather than stop at an ended session.
- An unanswered OKX history request retries after 10 seconds, retaining the requested sequence; acknowledged history stops the timeout retry.
- YouTube offline refresh applies the fresh state while retaining known title, author, channel ID and images when absent from the response.
- Keep the host API, plugin IDs, stream formats and Twitch behavior unchanged. No credentials, authentication bypass or network changes.

## Approaches

Use targeted changes in the existing adapters with boundary-level regression tests. A shared multi-platform framework or host changes are unnecessary for these five local defects and would enlarge risk.

## Verification and release

Run the new regression tests against the reviewed code before changing production code. Verify all existing suites, package metadata/checksums and packaged JavaScript. Independently review the completed branch. Bump only Binance, OKX and YouTube, and publish to the existing repository/source with a checked branch lease. Device behavior is not claimed verified.
