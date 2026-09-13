# syntax=docker/dockerfile:1
FROM ghcr.io/linuxserver/baseimage-selkies:ubunturesolute
ARG EASYEDA_VERSION=3.2.186
ARG EASYEDA_SHA256=4314e046e34d5eb02ca1ea44c5faf5cfc74d35e9a83a5e978287f27ed0bbb80a
ARG EASYEDA_API_SKILL_COMMIT=7b70e9e4878bc7affaa9f58ce3715fc3ec7b4dec
ARG RUN_API_GATEWAY_URL=https://github.com/easyeda/eext-run-api-gateway/releases/download/v1.0.5/run-api-gateway_v1.0.5_zh-cn.eext
ARG RUN_API_GATEWAY_SHA256=2a97471b76cd274eb1151559949d47ad8940a57b3044c4291eeb22e0935e196a
LABEL org.opencontainers.image.source="https://github.com/wtj-0527/lazycat-easyeda" \
      org.opencontainers.image.licenses="LicenseRef-LCEDA-Distribution-License AND MIT"
ENV TITLE="嘉立创EDA专业版" NO_GAMEPAD=true PIXELFLUX_WAYLAND=false
RUN apt-get update && apt-get install --no-install-recommends -y \
    curl unzip git nodejs libgtk-3-0 libnss3 libasound2t64 libsecret-1-0 \
    fonts-noto-cjk fonts-wqy-microhei xdg-utils && \
    curl -fL "https://image.lceda.cn/files/lceda-pro-linux-x64-${EASYEDA_VERSION}.zip" -o /tmp/easyeda.zip && \
    echo "${EASYEDA_SHA256}  /tmp/easyeda.zip" | sha256sum -c - && \
    unzip -q /tmp/easyeda.zip -d /tmp/easyeda && \
    mv /tmp/easyeda/lceda-pro /opt/lceda-pro && chmod 0755 /opt/lceda-pro/lceda-pro /opt/lceda-pro/chrome_crashpad_handler && \
    git clone https://github.com/easyeda/easyeda-api-skill.git /opt/easyeda-api-skill && \
    cd /opt/easyeda-api-skill && git checkout "${EASYEDA_API_SKILL_COMMIT}" && npm ci --omit=dev && \
    curl -fL "${RUN_API_GATEWAY_URL}" -o /opt/run-api-gateway_v1.0.5_zh-cn.eext && \
    echo "${RUN_API_GATEWAY_SHA256}  /opt/run-api-gateway_v1.0.5_zh-cn.eext" | sha256sum -c - && \
    rm -rf /opt/easyeda-api-skill/.git /tmp/easyeda.zip /tmp/easyeda /var/lib/apt/lists/*
COPY content/easyeda-mcp /opt/easyeda-mcp
RUN cd /opt/easyeda-mcp && npm ci --omit=dev && npm cache clean --force
COPY root/ /
RUN chmod +x /etc/s6-overlay/s6-rc.d/svc-easyeda-bridge/run /etc/s6-overlay/s6-rc.d/svc-easyeda-mcp/run && cp /opt/lceda-pro/icon/icon_256x256.png /usr/share/selkies/www/icon.png && \
    cp /opt/lceda-pro/LCEDA-Distribution-License.txt /usr/share/doc/LCEDA-Distribution-License.txt
VOLUME /config
EXPOSE 3001 8000
