import assert from 'node:assert/strict';
const endpoint = process.env.MCP_URL || 'http://127.0.0.1:8000/mcp';
async function rpc(method, params, id) {
  const r = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }) });
  const text = await r.text();
  assert.equal(r.status, 200, text);
  return JSON.parse(text);
}
const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } }, 1);
assert.equal(init.result.serverInfo.name, 'lazycat-easyeda');
const listed = await rpc('tools/list', {}, 2);
const names = listed.result.tools.map(t => t.name);
for (const name of ['easyeda_status', 'easyeda_get_project_info', 'easyeda_run_pcb_drc', 'easyeda_save_current_document']) assert(names.includes(name), name);
assert(!names.includes('easyeda_execute_api'));
const status = await rpc('tools/call', { name: 'easyeda_status', arguments: {} }, 3);
assert.equal(status.result.isError, undefined);
const statusPayload = JSON.parse(status.result.content[0].text);
assert.equal(statusPayload.service, 'easyeda-bridge');
assert.equal(typeof statusPayload.edaConnected, 'boolean');
console.log(JSON.stringify({ server: init.result.serverInfo, toolCount: names.length, status: statusPayload, tools: names }, null, 2));
