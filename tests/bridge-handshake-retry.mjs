import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
const bridge = process.env.BRIDGE_SCRIPT || '/opt/easyeda-api-skill/scripts/bridge-server.mjs';
const child = spawn(process.execPath, [bridge], { stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
child.stdout.on('data', chunk => output += chunk);
child.stderr.on('data', chunk => output += chunk);
async function waitForHealth() {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch('http://127.0.0.1:49620/health'); if (r.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`bridge did not start: ${output}`);
}
try {
  await waitForHealth();
  const ws = new WebSocket(`ws://127.0.0.1:49620${process.env.STRIPPED_WS_PATH === '1' ? '/' : '/eda'}`);
  let handshakes = 0;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no repeated handshake; count=${handshakes}`)), 3000);
    ws.on('message', data => {
      const message = JSON.parse(data.toString());
      if (message.type !== 'handshake') return;
      handshakes++;
      if (handshakes === 2) {
        ws.send(JSON.stringify({ type: 'register', windowId: 'delayed-listener-test' }));
        clearTimeout(timer); resolve();
      }
    });
  });
  await new Promise(resolve => setTimeout(resolve, 150));
  const health = await (await fetch('http://127.0.0.1:49620/health')).json();
  assert.equal(health.edaConnected, true);
  assert.equal(health.activeWindowId, 'delayed-listener-test');
  console.log(JSON.stringify({ handshakes, health }, null, 2));
  ws.close();
} finally {
  child.kill('SIGTERM');
}
