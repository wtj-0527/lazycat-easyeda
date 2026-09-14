# Changelog

## 0.1.3 — 2026-09-14

- Retry the official Bridge handshake until an EasyEDA window registers.
- Work around the EasyEDA 3.2.x WebSocket callback-readiness race without changing the Gateway protocol.

## 0.1.2 — 2026-09-14

- Fix LazyCat upstream prefix stripping for `/setup`, activation upload, and `/mcp`.
- Test both direct service paths and stripped-prefix application routes.

## 0.1.1 — 2026-09-14

- Add an outer-browser setup page at `/setup`.
- Open the official activation application page in the user browser.
- Validate and upload the official activation file to the persistent EDA desktop.
- Keep activation data out of the image, LPK, logs, and source repository.

## 0.1.0 — 2026-09-14

- Package EasyEDA Pro 3.2.186 in a Selkies browser desktop.
- Run the official EasyEDA API Skill bridge locally in the same container.
- Export a LazyCat MCP Provider at `/mcp` with 15 constrained tools.
- Bundle the verified official Run API Gateway v1.0.5 artifact on the persistent desktop.
- Disable arbitrary API execution by default and pin the runtime image by digest.
