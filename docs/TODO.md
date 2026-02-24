Some future enhancements and things that need fixing, organized into parallel execution sessions.

## Backlog of future enhancements

- Add Ollama to the docs
  - Poppler as well
- Tavily option for websearch?
  - Seems like a good fit, but don't want users to worry about another setup step
- Add lines to the pdf pages optionally

- **Office hours + class notes user stories**
  - Write concrete user journeys (student, TA/instructor) for office hours and notes workflows.
  - Identify required features vs nice-to-have add-ons.
  - Acceptance: prioritized stories that can feed implementation tickets.

- **Test Linux/Windows secret store backends**
  - Add integration tests for LinuxLibsecretStore and WindowsCredentialStore
  - Mock platform-specific CLI commands (`secret-tool`, `cmdkey`, PowerShell)
  - Test get/set/delete operations and fallback behavior
  - Requires CI/CD with Linux/Windows runners or local test devices
  - Acceptance: cross-platform secret storage verified on all target platforms

- **QR Code for Canvas URL**
  - Add QR code functionality to streamline iPad joining

- **Session persistence (save/resume conversations)**
  - Persist active conversation metadata, transcript state, and relevant tool context.
  - Provide explicit resume behavior on restart (auto-resume or selection prompt).
  - Handle corrupted state file with recover/ignore option.
  - Acceptance: users can resume prior work without manual reconstruction.

- **Lightweight markdown editor exploration (tiptap candidate)**
  - Evaluate if embedding a markdown editor improves note-taking/workflow inside product.
  - Compare footprint, integration complexity, and keyboard accessibility.
  - Provide recommendation with build-vs-buy tradeoffs.
  - Acceptance: documented decision and next action (adopt/defer/reject).

- **tldraw licensing review for production**
  - Verify licensing terms for intended distribution/commercial use.
  - Document obligations (attribution, restrictions, paid terms if applicable).
  - Acceptance: legal/licensing go/no-go criteria documented.

- **Work out kinks in resource upload**
  - If file is drag and dropped first, it is read as a /command
  - Need to add better default prompting to guide tool use and scaffold processing
  - Verify that the poppler methods are working well

- **Consider using CLI tools instead of MCP**
  - Would the model do just as well with some bash commands instead of file tools?

- **Known Testing Compromises:**
  - ink-testing-library stdin simulation unreliable for interactive flows.
  - tldraw sync error cannot be fully suppressed (library internals).

## GUI

- Tauri app
- Add components like
  - QR Code
  - Canvas and Markdown Previews
  - Resource Drag and Drop

## Telemetry & Feedback Infrastructure

**Current State:**
- Discord webhook URL is hardcoded in `src/app/command-router.ts` (line 10-11)
- Security concern: public webhook can be spammed, requires rotation if abused
- Zero-config UX requirement: users should not need to configure anything
- Currently acceptable for beta/early development phase

**Recommended Implementation: Cloudflare Worker**

A single Cloudflare Worker can handle both feedback forwarding AND analytics/telemetry with significant overlap:

**Phase 1: Immediate Security Improvement (Optional)**
- Add client-side rate limiting to `/feedback` command
- Prevents single user from spamming (doesn't prevent multiple users)
- Example: 60-second cooldown between feedback submissions
- Location: `src/app/command-router.ts` feedback case handler

**Phase 2: Backend Proxy (Before Public Launch)**

Deploy a Cloudflare Worker that handles:
1. **Feedback proxy** - Protects Discord webhook, allows rotation without releases
2. **Analytics collection** - DAU/MAU, install tracking, command usage, errors
3. **Rate limiting** - IP-based via Workers KV
4. **Validation** - Payload structure checking, size limits

**Worker Architecture:**
```
Clark CLI
    ↓ POST /events (single endpoint)
Cloudflare Worker
    ├→ Discord Webhook (for type: "feedback")
    ├→ Workers Analytics Engine (for type: "heartbeat", "install", "command")
    └→ Workers KV (rate limiting state)
```

**Event Types to Support:**
```typescript
// Install tracking (first run)
{ type: "install", version: "1.0.0", platform: "darwin", arch: "arm64" }

// Daily active usage (sent on first command each day)
{ type: "heartbeat", sessionId: "hash", version: "1.0.0" }

// Feedback (current functionality)
{ type: "feedback", message: "...", context: {...} }

// Error/crash reporting
{ type: "error", error: "...", stack: "...", version: "1.0.0" }
```

**Cloudflare Worker Implementation:**
- Use Workers Analytics Engine for DAU/MAU metrics (built-in feature)
- Store Discord webhook URL as environment variable (not in code)
- Use Workers KV for rate limiting state (key: IP address, value: timestamp)
- Rate limit: 1 feedback per minute per IP, 10 events per minute per IP
- GraphQL API available for querying analytics data

**Privacy Considerations:**
- Hash user IDs before sending (no PII)
- Optional: allow users to opt-out via environment variable `CLARK_TELEMETRY=false`
- Document telemetry in README and provide transparency about what's collected

**Cost:**
- Cloudflare Workers free tier: 100,000 requests/day
- Workers Analytics Engine: Free for reasonable usage
- Sufficient until 100k+ daily active users

**Clark-side Changes:**
1. Replace hardcoded Discord webhook URL with Worker endpoint
2. Add telemetry client module (`src/telemetry/client.ts`)
3. Emit events for: install (first run), heartbeat (daily), commands, errors
4. Respect `CLARK_TELEMETRY=false` environment variable
5. Add startup notice on first run: "Anonymous usage data helps improve Clark. Opt-out: CLARK_TELEMETRY=false"

**Migration Path:**
1. Start with Worker (low effort, zero cost, handles both use cases)
2. If outgrown: Worker can proxy to custom backend
3. Analytics Engine data can be exported if needed

**Acceptance Criteria:**
- Discord webhook not exposed in public code
- Can rotate webhook without releasing new version
- DAU/MAU metrics available via dashboard
- Install and command usage tracked
- Rate limiting prevents spam (< 1% of requests blocked under normal usage)
- Zero-config UX maintained (telemetry works out of box)
- Privacy policy documented, opt-out available

**References:**
- Cloudflare Workers: https://workers.cloudflare.com/
- Workers Analytics Engine: https://developers.cloudflare.com/analytics/analytics-engine/
- Workers KV: https://developers.cloudflare.com/kv/
