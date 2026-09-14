# EasyEDA Pro Online for LazyCat Microserver

An all-in-one LazyCat LPK that opens the official **嘉立创EDA专业版在线编辑器**
in an isolated Chromium browser desktop and exposes a constrained Streamable
HTTP MCP endpoint to Hermes Studio.

> Independent community packaging. EasyEDA/JLCEDA is a product and online
> service of Shenzhen JLC Technology Group. This is not an official LazyCat or
> JLCEDA release.

## Architecture

```text
Browser ── LazyCat authenticated route ──> Selkies Chromium desktop
                                             └─ pro.lceda.cn/editor
                                                  ↕ Run API Gateway
Hermes Studio ── POST /mcp ──> constrained MCP ──> official local Bridge
```

Chromium, the official Bridge, and MCP run in one container, so the online
editor's Run API Gateway can reach `127.0.0.1:49620` without another computer.
No EasyEDA desktop binary or activation flow is included.

## First start

1. Open the app and sign in to EasyEDA inside the LPK Chromium. Cloud projects
   belonging to that account appear directly.
2. In EasyEDA, open **Advanced → Extension Manager** and install **Run API
   Gateway** from the marketplace, or import the verified copy on the persistent
   desktop: `/config/Desktop/run-api-gateway_v1.0.5_zh-cn.eext`.
3. Enable the extension and check **Allow external interaction** and **Show in
   top menu**.
4. Open a schematic or PCB and choose **API Gateway → Reconnect**.
5. In Hermes Studio, test/call the projected `easyeda` MCP provider.

Chromium's profile, cookies, extension data and downloads persist under
`/config`. Upgrading from v0.1.x leaves the old desktop-client data under
`/config/LCEDA-Pro` untouched but the online Chromium login must be established
once because browser cookies cannot be migrated safely.

## MCP

Canonical non-user-facing endpoint:

```text
http://app.community.lazycat.app.easyeda-pro.lzcx/mcp
```

The LPK exports `resources/mcp-providers/default/mcp.yml`. Arbitrary JavaScript
execution remains disabled unless an administrator explicitly sets
`EASYEDA_ALLOW_RAW_EXECUTE=true`.

## Build and test

```bash
docker build --pull -t registry.cn-shanghai.aliyuncs.com/wtjking/lazycat-easyeda:0.2.0 .
node tests/static-check.mjs
npm audit --omit=dev --audit-level=high --prefix content/easyeda-mcp
lzc-cli project release -o dist/community.lazycat.app.easyeda-pro-online-v0.2.0.lpk
```

## Licensing

Integration code is MIT. The EasyEDA online editor is loaded from the vendor at
runtime and is governed by JLCEDA's terms. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
