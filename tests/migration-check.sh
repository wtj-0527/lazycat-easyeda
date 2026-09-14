#!/bin/sh
set -eu
root=$(mktemp -d)
mkdir -p "$root/config/.config/openbox" "$root/config/Desktop"
printf '%s\n' '/opt/lceda-pro/lceda-pro --no-sandbox --disable-dev-shm-usage --gtk-version=3' > "$root/config/.config/openbox/autostart"
sed 's|/config|$TEST_ROOT/config|g; s/chown abc:abc/# chown skipped/g; s/install -d -o abc -g abc/install -d/g; s/install -o abc -g abc -m 0644/install -m 0644/g; s|/opt/run-api-gateway_v1.0.5_zh-cn.eext|$TEST_GATEWAY|g' root/custom-cont-init.d/10-easyeda-assets > "$root/run.sh"
TEST_ROOT="$root" TEST_GATEWAY=/dev/null CHROME_CLI=https://pro.lceda.cn/editor bash "$root/run.sh"
grep -Fxq 'wrapped-chromium ${CHROME_CLI}' "$root/config/.config/openbox/autostart"
! grep -q '/opt/lceda-pro' "$root/config/.config/openbox/autostart"
echo 'v0.1.x to online Chromium autostart migration: PASS'
