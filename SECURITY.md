# Security

- `/mcp` is intended for LazyCat authenticated application-to-application access.
- The official EasyEDA bridge listens only on `127.0.0.1` inside the container.
- Arbitrary `eda.*` JavaScript execution is disabled by default. To deliberately
  enable the expert-only tool, set `EASYEDA_ALLOW_RAW_EXECUTE=true`.
- The default MCP surface exposes read-only inspection, DRC, window selection,
  and explicit document save only.
- Keep the LazyCat application private to trusted users. A connected Gateway can
  modify the active EDA document through any enabled write tool.
- Report vulnerabilities privately to the repository owner before disclosure.
