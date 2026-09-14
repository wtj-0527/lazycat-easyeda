import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { registerDesignTools } from './design-tools.mjs';

const HOST = process.env.EASYEDA_MCP_HOST || '127.0.0.1';
const PORT = Number(process.env.EASYEDA_MCP_PORT || 8000);
const BRIDGE = (process.env.EASYEDA_BRIDGE_URL || 'http://127.0.0.1:49620').replace(/\/$/, '');
const ALLOW_RAW = /^(1|true|yes)$/i.test(process.env.EASYEDA_ALLOW_RAW_EXECUTE || 'false');
const TIMEOUT_MS = Number(process.env.EASYEDA_REQUEST_TIMEOUT_MS || 35_000);
const DATA_ROOTS = ['/config/Desktop', '/config/Downloads'];
const MAX_PROJECT_FILE_BYTES = 100 * 1024 * 1024;
const CONFIRM_PHRASE = 'CONFIRM DESTRUCTIVE EASYEDA OPERATION';
let writeQueue = Promise.resolve();

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
  const startedAt = Date.now();
  const operation = String(code).match(/eda\.([A-Za-z0-9_]+\.[A-Za-z0-9_]+)/)?.[1] || 'structured-action';
  console.log(JSON.stringify({ event: 'eda.execute.start', operation, windowId: windowId || null }));
  try {
  const body = await request('/execute', {
    method: 'POST',
    body: JSON.stringify({ code, ...(windowId ? { windowId } : {}) }),
  });
  console.log(JSON.stringify({ event: 'eda.execute.ok', operation, durationMs: Date.now() - startedAt }));
  return body?.result;
  } catch (error) {
    console.error(JSON.stringify({ event: 'eda.execute.error', operation, durationMs: Date.now() - startedAt, error: error.message }));
    throw error;
  }
}

function text(value, isError = false) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], ...(isError ? { isError: true } : {}) };
}



function resolveDataPath(candidate, forWrite = false) {
  if (typeof candidate !== 'string' || !candidate.trim()) throw new Error('filePath is required');
  const absolute = path.resolve(candidate);
  if (!DATA_ROOTS.some(root => absolute === root || absolute.startsWith(`${root}/`))) throw new Error(`filePath must be under: ${DATA_ROOTS.join(', ')}`);
  if (!forWrite && absolute.includes('..')) throw new Error('invalid filePath');
  return absolute;
}
async function loadProjectFile(filePath) {
  const absolute = resolveDataPath(filePath);
  const stat = await fs.stat(absolute);
  if (!stat.isFile()) throw new Error('filePath is not a regular file');
  if (stat.size > MAX_PROJECT_FILE_BYTES) throw new Error('project file exceeds 100 MiB');
  const data = await fs.readFile(absolute);
  return { fileName: path.basename(absolute), fileBase64: data.toString('base64'), size: data.length, sha256: createHash('sha256').update(data).digest('hex') };
}
async function saveExportFile(result, outputPath) {
  if (!result || result.kind !== 'file' || typeof result.base64 !== 'string') throw new Error('EDA API did not return a file');
  const absolute = resolveDataPath(outputPath || `/config/Desktop/${result.name || 'easyeda-export.epro'}`, true);
  const data = Buffer.from(result.base64, 'base64');
  if (data.length > MAX_PROJECT_FILE_BYTES) throw new Error('export exceeds 100 MiB');
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.${process.pid}.tmp`;
  await fs.writeFile(temporary, data, { mode: 0o600 });
  await fs.rename(temporary, absolute);
  return { filePath: absolute, fileName: path.basename(absolute), size: data.length, mimeType: result.type, sha256: createHash('sha256').update(data).digest('hex') };
}

async function getProjectUuid(windowId) {
  const project = await execute('return await eda.dmt_Project.getCurrentProjectInfo();', windowId);
  return project?.uuid || null;
}

async function runWrite(input, operation) {
  if (input.confirmWrite !== true) throw new Error('confirmWrite must be true');
  if (!input.allowNoProject) {
    if (!input.expectedProjectUuid) throw new Error('expectedProjectUuid is required');
    const actual = await getProjectUuid(input.windowId);
    if (!actual || actual !== input.expectedProjectUuid) throw new Error(`Project mismatch: expected ${input.expectedProjectUuid}, active ${actual || 'none'}`);
  }
  if (input.destructive && input.confirmationPhrase !== CONFIRM_PHRASE) throw new Error(`confirmationPhrase must equal: ${CONFIRM_PHRASE}`);
  const queued = writeQueue.then(operation, operation);
  writeQueue = queued.then(() => undefined, () => undefined);
  return queued;
}

function createMcpServer() {
  const server = new McpServer({ name: 'lazycat-easyeda', version: '0.3.1' });

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

  server.tool('easyeda_save_current_document', 'Save the active schematic or PCB. WRITE operation; project-bound confirmation required.', {
    documentType: z.enum(['schematic', 'pcb']),
    confirmWrite: z.literal(true),
    expectedProjectUuid: z.string().min(1),
    windowId: z.string().optional(),
  }, async input => {
    const code = input.documentType === 'schematic'
      ? 'return await eda.sch_Document.save();'
      : 'return await eda.pcb_Document.save();';
    try { return text(await runWrite(input, () => execute(code, input.windowId))); }
    catch (error) { return text({ error: error.message }, true); }
  });

  registerDesignTools(server, { execute, runWrite, getProjectUuid, text, loadProjectFile, saveExportFile });

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
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
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
  const isMcpPost = req.method === 'POST' && (path === '/mcp' || (path === '/' && contentType.includes('application/json')));
  if (!isMcpPost) {
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
