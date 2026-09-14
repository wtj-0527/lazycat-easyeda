# EasyEDA Pro for LazyCat Microserver

An all-in-one LazyCat LPK for running **嘉立创EDA专业版 / EasyEDA Pro** in a
browser desktop and exposing a constrained, standard Streamable HTTP MCP endpoint
to Hermes Studio.

> Independent community packaging. EasyEDA/JLCEDA is a product of Shenzhen JLC
> Technology Group. This project is not an official LazyCat or JLCEDA release.

## Architecture

```text
Browser ── authenticated LazyCat route ──> Selkies desktop ──> EasyEDA Pro Linux
                                                              │
                                                              │ official extension
                                                              ▼
Hermes Studio ── POST /mcp ──> constrained MCP adapter ──> official API bridge
                                                              ▲
                                                              │ localhost WebSocket
                                                     Run API Gateway
```

EasyEDA Pro, the official API bridge, and the MCP adapter run in the same
container so the official Gateway's localhost-only discovery works without a
second computer or a reverse connector.

## First start

1. Open the installed app in a browser. For activation, open `/setup` in the same external browser, e.g. `https://easyeda.example.com/setup`.
2. Accept the vendor EULA and obtain/import the **official free activation file**
   when prompted. Activation is never bypassed by this project.
3. Sign in to EasyEDA if required.
4. Install `Run API Gateway v1.0.5` from the official extension marketplace, or
   import the copy placed on the desktop at
   `/config/Desktop/run-api-gateway_v1.0.5_zh-cn.eext`.
5. In Extension Manager enable **Allow external interaction** for Run API Gateway.
6. Its menu/status should show a connection to the local bridge.
7. Add/scan the exported MCP provider in Hermes Studio and call
   `easyeda_status` followed by `easyeda_list_windows`.

The whole `/config` volume is persistent, including projects, client settings,
login state, activation file, extension settings, and desktop downloads.

## MCP endpoint

The projected, non-user-facing endpoint is:

```text
http://app.community.lazycat.app.easyeda-pro.lzcx/mcp
```

The LPK exports `resources/mcp-providers/default/mcp.yml`, so a compatible
Hermes Studio instance can discover it rather than relying on a human-facing URL.

### Default tools

- `easyeda_status`
- `easyeda_list_windows`
- `easyeda_select_window`
- `easyeda_get_project_info`
- `easyeda_get_current_document`
- `easyeda_list_schematics`
- `easyeda_list_pcb_documents`
- `easyeda_get_schematic_source`
- `easyeda_get_pcb_source`
- `easyeda_get_schematic_components`
- `easyeda_get_pcb_components`
- `easyeda_get_pcb_nets`
- `easyeda_run_schematic_drc`
- `easyeda_run_pcb_drc`
- `easyeda_save_current_document`

Arbitrary JavaScript execution is deliberately absent unless
`EASYEDA_ALLOW_RAW_EXECUTE=true` is set by an administrator.

## Build image

```bash
docker build --pull -t registry.cn-shanghai.aliyuncs.com/wtjking/lazycat-easyeda:3.2.186 .
```

The Dockerfile downloads the official EasyEDA Linux archive and verifies its
pinned SHA-256. It also pins the official API Skill commit and verifies the
Gateway release artifact.

## Test locally

```bash
docker run --rm --name easyeda-test --shm-size=2g \
  -p 3000:3000 -p 8000:8000 \
  -e PUID=1000 -e PGID=1000 \
  -e EASYEDA_MCP_HOST=0.0.0.0 \
  -v easyeda-config:/config \
  registry.cn-shanghai.aliyuncs.com/wtjking/lazycat-easyeda:3.2.186
```

Run the protocol smoke test from inside the container/network namespace:

```bash
docker cp tests/mcp-smoke.mjs easyeda-test:/tmp/mcp-smoke.mjs
docker exec -e MCP_URL=http://127.0.0.1:8000/mcp easyeda-test \
  node /tmp/mcp-smoke.mjs
```

## Build LPK

```bash
lzc-cli project lint .
lzc-cli project release -o dist/community.lazycat.app.easyeda-pro-v0.1.1.lpk
lzc-cli lpk info dist/community.lazycat.app.easyeda-pro-v0.1.1.lpk
lzc-cli lpk lint dist/community.lazycat.app.easyeda-pro-v0.1.1.lpk
```

## Licensing

Integration code is MIT licensed. EasyEDA Pro remains proprietary and is covered
by the included vendor EULA and Linux distribution license. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
