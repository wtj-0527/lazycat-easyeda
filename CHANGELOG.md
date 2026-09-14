# Changelog

## 0.3.0 — 2026-09-14

- Upgrade from inspection MCP to full design MCP with 70 tools.
- Add 32 structured PCB/schematic actions plus document/project CRUD, validated library search/placement, import/export, and generic public API dispatch.
- Use the supported manufacture-data API for netlists instead of the removed `sch_Netlist.getNetlist()` API.
- Require explicit import destinations and reject undefined import/create results instead of reporting false success.
- Require project UUID binding and explicit confirmation for writes; destructive actions require a fixed confirmation phrase.
- Serialize writes and keep arbitrary JavaScript execution disabled by default.
- Restrict project files to persistent Desktop/Downloads paths, cap at 100 MiB, and return export SHA-256 metadata.

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
