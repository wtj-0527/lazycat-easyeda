# Changelog

## 0.2.1 — 2026-09-14

- Remove the redundant bundled Gateway artifact; install it directly from the official online extension marketplace.
- Keep the validated Chromium profile, account login, extension and permissions persistent in `/config`.

## 0.2.0 — 2026-09-14

- Replace the proprietary Linux desktop client with Chromium loading the official EasyEDA Pro online editor.
- Remove desktop activation, activation upload, and desktop-client redistribution.
- Preserve the package ID, `/config`, official Bridge, constrained MCP, and Gateway workflow.
- Persist Chromium account/session data and leave existing v0.1.x `/config/LCEDA-Pro` data untouched.
- Lock down the Selkies command surface and session sharing by default.

## 0.1.3 — 2026-09-14

- Retry the official Bridge handshake until an EasyEDA window registers.
- Work around the EasyEDA 3.2.x WebSocket callback-readiness race without changing the Gateway protocol.
