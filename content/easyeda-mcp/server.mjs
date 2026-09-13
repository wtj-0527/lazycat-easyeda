import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const HOST = process.env.EASYEDA_MCP_HOST || '127.0.0.1';
const PORT = Number(process.env.EASYEDA_MCP_PORT || 8000);
const BRIDGE = (process.env.EASYEDA_BRIDGE_URL || 'http://127.0.0.1:49620').replace(/\/$/, '');
const ALLOW_RAW = /^(1|true|yes)$/i.test(process.env.EASYEDA_ALLOW_RAW_EXECUTE || 'false');
const TIMEOUT_MS = Number(process.env.EASYEDA_REQUEST_TIMEOUT_MS || 35_000);

const templates = Object.freeze({
  easyeda_get_project_info: 'return await eda.dmt_Project.getCurrentProjectInfo();',
  easyeda_get_current_document: 'return await eda.dmt_SelectControl.getCurrentDocumentInfo();',
  easyeda_list_schematics: 'return await eda.dmt_Schematic.getAllSchematicsInfo();',
  easyeda_list_pcb_documents: 'return await eda.dmt_Pcb.getAllPcbsInfo();',
  easyeda_get_schematic_source: 'return await eda.sch_Document.getDocumentSource();',
  easyeda_get_pcb_source: 'return await eda.pcb_Document.getDocumentSource();',
  easyeda_get_schematic_components: 'return await eda.sch_PrimitiveComponent.getAll();',
  easyeda_get_pcb_components: 'return await eda.pcb_PrimitiveComponent.getAll();',
  easyeda_get_pcb_nets: 'return await eda.pcb_Net.getAllNets();',
  easyeda_run_schematic_drc: 'return await eda.sch_Drc.check(true, false, false);',
  easyeda_run_pcb_drc: 'return await eda.pcb_Drc.check(true, false, false);',
});

async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${BRIDGE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    });
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    if (!response.ok) throw new Error(body?.error || `Bridge returned HTTP ${response.status}`);
    return body;
  } finally { clearTimeout(timer); }
}

async function execute(code, windowId) {
  const body = await request('/execute', {
    method: 'POST',
    body: JSON.stringify({ code, ...(windowId ? { windowId } : {}) }),
  });
  return body?.result;
}

function text(value, isError = false) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], ...(isError ? { isError: true } : {}) };
}

function createMcpServer() {
  const server = new McpServer({ name: 'lazycat-easyeda', version: '0.1.0' });

  server.tool('easyeda_status', 'Check the official EasyEDA bridge and connected EasyEDA Pro windows.', {}, async () => {
    try { return text(await request('/health')); } catch (error) { return text({ connected: false, error: error.message }, true); }
  });

  server.tool('easyeda_list_windows', 'List EasyEDA Pro windows connected through the official Run API Gateway.', {}, async () => {
    try { return text(await request('/eda-windows')); } catch (error) { return text({ error: error.message }, true); }
  });

  server.tool('easyeda_select_window', 'Select the active EasyEDA Pro window when more than one is connected.', {
    windowId: z.string().min(1).describe('Window ID returned by easyeda_list_windows'),
  }, async ({ windowId }) => {
    try { return text(await request('/eda-windows/select', { method: 'POST', body: JSON.stringify({ windowId }) })); }
    catch (error) { return text({ error: error.message }, true); }
  });

  for (const [name, code] of Object.entries(templates)) {
    const descriptions = {
      easyeda_get_project_info: 'Read metadata for the current EasyEDA Pro project.',
      easyeda_get_current_document: 'Read metadata for the currently active EasyEDA document.',
      easyeda_list_schematics: 'List schematic documents in the current EasyEDA project.',
      easyeda_list_pcb_documents: 'List PCB documents in the current EasyEDA project.',
      easyeda_get_schematic_source: 'Read the source of the active schematic document.',
      easyeda_get_pcb_source: 'Read the source of the active PCB document.',
      easyeda_get_schematic_components: 'List components in the active schematic.',
      easyeda_get_pcb_components: 'List components in the active PCB.',
      easyeda_get_pcb_nets: 'List nets in the active PCB.',
      easyeda_run_schematic_drc: 'Run the official schematic design-rule check.',
      easyeda_run_pcb_drc: 'Run the official PCB design-rule check.',
    };
    server.tool(name, descriptions[name], { windowId: z.string().optional().describe('Optional target EasyEDA window ID') }, async ({ windowId }) => {
      try { return text(await execute(code, windowId)); } catch (error) { return text({ error: error.message }, true); }
    });
  }

  server.tool('easyeda_save_current_document', 'Save the active schematic or PCB. This is a write operation.', {
    documentType: z.enum(['schematic', 'pcb']),
    windowId: z.string().optional(),
  }, async ({ documentType, windowId }) => {
    const code = documentType === 'schematic'
      ? 'return await eda.sch_Document.save();'
      : 'return await eda.pcb_Document.save();';
    try { return text(await execute(code, windowId)); } catch (error) { return text({ error: error.message }, true); }
  });

  if (ALLOW_RAW) {
    server.tool('easyeda_execute_api', 'ADMIN: execute arbitrary JavaScript against the official eda API. Disabled by default.', {
      code: z.string().min(1).max(100_000), windowId: z.string().optional(),
    }, async ({ code, windowId }) => {
      try { return text(await execute(code, windowId)); } catch (error) { return text({ error: error.message }, true); }
    });
  }
  return server;
}

const httpServer = http.createServer(async (req, res) => {
  const path = new URL(req.url || '/', 'http://localhost').pathname;
  if (req.method === 'GET' && path === '/healthz') {
    try {
      const bridge = await request('/health');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ service: 'lazycat-easyeda-mcp', status: 'ok', bridge }));
    } catch (error) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ service: 'lazycat-easyeda-mcp', status: 'degraded', error: error.message }));
    }
    return;
  }
  if (path !== '/mcp' || req.method !== 'POST') {
    res.writeHead(405, { allow: 'POST', 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Use POST /mcp' }));
    return;
  }
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 2_000_000) { res.writeHead(413).end(); return; }
  }
  let body;
  try { body = JSON.parse(raw); } catch { res.writeHead(400).end('Invalid JSON'); return; }
  const mcp = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await mcp.connect(transport);
    res.on('close', () => {
      transport.close().catch(() => {});
      mcp.close().catch(() => {});
    });
    await transport.handleRequest(req, res, body);
  } catch (error) {
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: error.message }, id: body?.id ?? null }));
    }
  }
});
httpServer.listen(PORT, HOST, () => console.log(`EasyEDA MCP listening on http://${HOST}:${PORT}/mcp`));
