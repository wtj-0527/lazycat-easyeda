import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const HOST = process.env.EASYEDA_MCP_HOST || '127.0.0.1';
const PORT = Number(process.env.EASYEDA_MCP_PORT || 8000);
const BRIDGE = (process.env.EASYEDA_BRIDGE_URL || 'http://127.0.0.1:49620').replace(/\/$/, '');
const ALLOW_RAW = /^(1|true|yes)$/i.test(process.env.EASYEDA_ALLOW_RAW_EXECUTE || 'false');
const TIMEOUT_MS = Number(process.env.EASYEDA_REQUEST_TIMEOUT_MS || 35_000);
const ACTIVATION_UPLOAD_PATH = process.env.EASYEDA_ACTIVATION_UPLOAD_PATH || '/config/Desktop/lceda-pro-activation.txt';
const MAX_ACTIVATION_BYTES = 256 * 1024;

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


function setupPage(message = '') {
  const escaped = String(message).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>嘉立创EDA 初始化助手</title>
<style>
:root{font-family:Inter,"Noto Sans CJK SC",system-ui,sans-serif;color:#172033;background:#f4f7fb}body{margin:0}.wrap{max-width:760px;margin:48px auto;padding:0 20px}.card{background:#fff;border:1px solid #dce3ee;border-radius:16px;padding:28px;box-shadow:0 12px 32px #1a35651a}h1{margin:0 0 10px;font-size:26px}.sub{color:#58677e;line-height:1.7}.steps{margin:24px 0;padding-left:22px;line-height:2}.row{display:flex;gap:12px;flex-wrap:wrap}.button,button{display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:9px;padding:11px 16px;background:#1677ff;color:#fff;text-decoration:none;font-weight:650;cursor:pointer}.secondary{background:#eef4ff;color:#1458b3}.upload{margin-top:24px;padding:20px;border:1px dashed #9fb2ce;border-radius:12px;background:#f9fbfe}input[type=file]{display:block;margin:12px 0;width:100%}.status{margin-top:16px;padding:12px;border-radius:8px;background:#eef8f0;color:#176b2c}.warning{margin-top:16px;padding:12px;border-radius:8px;background:#fff8e8;color:#7c5200}code{background:#edf1f6;border-radius:5px;padding:2px 5px}</style></head>
<body><main class="wrap"><section class="card"><h1>嘉立创EDA 初始化助手</h1>
<p class="sub">远程桌面中的嘉立创EDA是容器内的程序，不能直接唤起你电脑上的浏览器。请在这个外层页面完成官方激活文件申请，再上传到EDA的持久化桌面。</p>
<ol class="steps"><li>在新标签打开嘉立创官方激活页面并登录。</li><li>下载官方激活文件到当前电脑。</li><li>回到此页上传文件，它会保存到EDA桌面。</li><li>回到EDA窗口，点击“导入激活文件”，选择桌面上的 <code>lceda-pro-activation.txt</code>。</li></ol>
<div class="row"><a class="button" href="https://lceda.cn/page/desktop-client-activation" target="_blank" rel="noopener noreferrer">打开官方激活页面</a><a class="button secondary" href="/">返回EDA桌面</a></div>
<div class="warning">激活文件包含账号许可信息，只保存在本应用的 <code>/config</code> 持久化目录，不会进入镜像、LPK或Git仓库。</div>
<form class="upload" method="post" action="/setup/activation" enctype="application/octet-stream"><strong>上传官方激活文件</strong><input id="file" type="file" accept=".txt,text/plain,application/json" required><button type="submit">上传到EDA桌面</button></form>
${escaped ? `<div class="status">${escaped}</div>` : ''}
<script>document.querySelector('form').addEventListener('submit',async event=>{event.preventDefault();const file=document.querySelector('#file').files[0];if(!file)return;const response=await fetch('/setup/activation',{method:'POST',headers:{'content-type':'application/octet-stream','x-file-name':file.name},body:file});const text=await response.text();document.open();document.write(text);document.close()})</script>
</section></main></body></html>`;
}

async function readLimitedBody(req, limit) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) throw new Error('激活文件超过 256 KiB 限制');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function saveActivationUpload(req) {
  const data = await readLimitedBody(req, MAX_ACTIVATION_BYTES);
  if (!data.length) throw new Error('没有收到文件内容');
  const text = data.toString('utf8').replace(/^\uFEFF/, '');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('文件不是有效的 JSON 激活文件'); }
  const required = ['username', 'customer_code', 'email', 'phone', 'company', 'license'];
  if (!required.every(key => Object.hasOwn(parsed, key)) || !parsed.username || !parsed.license) {
    throw new Error('文件缺少嘉立创EDA激活字段');
  }
  await fs.mkdir(path.dirname(ACTIVATION_UPLOAD_PATH), { recursive: true });
  const temporary = `${ACTIVATION_UPLOAD_PATH}.${process.pid}.tmp`;
  await fs.writeFile(temporary, text, { mode: 0o600 });
  await fs.rename(temporary, ACTIVATION_UPLOAD_PATH);
  return `上传成功：请回到EDA，点击“导入激活文件”，选择桌面上的 ${path.basename(ACTIVATION_UPLOAD_PATH)}`;
}

function createMcpServer() {
  const server = new McpServer({ name: 'lazycat-easyeda', version: '0.1.1' });

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
  if (req.method === 'GET' && (path === '/setup' || path === '/setup/')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(setupPage());
    return;
  }
  if (req.method === 'POST' && path === '/setup/activation') {
    try {
      const message = await saveActivationUpload(req);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(setupPage(message));
    } catch (error) {
      res.writeHead(400, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(setupPage(`上传失败：${error.message}`));
    }
    return;
  }
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
