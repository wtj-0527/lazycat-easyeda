# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS integration
ARG EASYEDA_API_SKILL_COMMIT=7b70e9e4878bc7affaa9f58ce3715fc3ec7b4dec
RUN apt-get update && apt-get install --no-install-recommends -y git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY content/bridge-compat/patch-bridge.mjs /tmp/patch-bridge.mjs
RUN git clone https://github.com/easyeda/easyeda-api-skill.git /opt/easyeda-api-skill && \
    cd /opt/easyeda-api-skill && git checkout "${EASYEDA_API_SKILL_COMMIT}" && npm ci --omit=dev && \
    node /tmp/patch-bridge.mjs /opt/easyeda-api-skill/scripts/bridge-server.mjs && \
    rm -rf /opt/easyeda-api-skill/.git /tmp/patch-bridge.mjs
COPY content/easyeda-mcp /opt/easyeda-mcp
RUN cd /opt/easyeda-mcp && npm ci --omit=dev && npm cache clean --force

FROM lscr.io/linuxserver/chromium@sha256:54a61718733c82ac041e7c84543283419b06ab0d6439eef5c20b1f6a53b8dcd0
LABEL org.opencontainers.image.source="https://github.com/wtj-0527/lazycat-easyeda" \
      org.opencontainers.image.licenses="MIT"
COPY --from=integration /usr/local/bin/node /usr/local/bin/node
COPY --from=integration /opt/easyeda-api-skill /opt/easyeda-api-skill
COPY --from=integration /opt/easyeda-mcp /opt/easyeda-mcp
COPY root/ /
RUN chmod +x /custom-cont-init.d/10-easyeda-assets \
    /etc/s6-overlay/s6-rc.d/svc-easyeda-bridge/run \
    /etc/s6-overlay/s6-rc.d/svc-easyeda-mcp/run
ENV TITLE="嘉立创EDA在线版" \
    CHROME_CLI="https://pro.lceda.cn/editor" \
    PIXELFLUX_WAYLAND=false
VOLUME /config
EXPOSE 3000 3001 8000
