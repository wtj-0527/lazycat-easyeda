import fs from 'node:fs';
const file = process.argv[2];
if (!file) throw new Error('bridge-server path is required');
let source = fs.readFileSync(file, 'utf8');
const clientTypeAnchor = "  const clientType = req.url === '/eda' ? 'eda' : 'agent';";
if (!source.includes(clientTypeAnchor)) throw new Error('pinned bridge source no longer matches client-type patch anchor');
// EasyEDA 3.2.x can strip the requested `/eda` path. Reserve only the explicit
// `/agent` path for agents and treat `/` as an EDA connection.
source = source.replace(clientTypeAnchor, "  const clientType = req.url === '/agent' ? 'agent' : 'eda';");
const original = `  // Send handshake message for client verification\n  ws.send(JSON.stringify({\n    type: 'handshake',\n    service: SERVICE_ID,\n    clientType,\n    timestamp: Date.now(),\n  }));\n\n  if (clientType === 'eda') {\n    let registeredWindowId = null;`;
const replacement = `  // Some EasyEDA 3.2.x WebSocket wrappers report connected before their\n  // message callback is ready. Repeat the idempotent handshake until the EDA\n  // window registers, then stop immediately. Agent clients still receive one.\n  const sendHandshake = () => {\n    if (ws.readyState === 1) {\n      ws.send(JSON.stringify({\n        type: 'handshake',\n        service: SERVICE_ID,\n        clientType,\n        timestamp: Date.now(),\n      }));\n    }\n  };\n  sendHandshake();\n\n  if (clientType === 'eda') {\n    let registeredWindowId = null;\n    const handshakeTimer = setInterval(() => {\n      if (registeredWindowId) clearInterval(handshakeTimer);\n      else sendHandshake();\n    }, 500);`;
if (!source.includes(original)) throw new Error('pinned bridge source no longer matches handshake patch anchor');
source = source.replace(original, replacement);
source = source.replace(
  `          registeredWindowId = msg.windowId;\n          edaClients.set(registeredWindowId, ws);`,
  `          registeredWindowId = msg.windowId;\n          clearInterval(handshakeTimer);\n          edaClients.set(registeredWindowId, ws);`,
);
source = source.replace(
  `    ws.on('close', (code, reason) => {\n      console.log(\`[WS] EDA window disconnected: \${registeredWindowId} (\${code} \${reason})\`);`,
  `    ws.on('close', (code, reason) => {\n      clearInterval(handshakeTimer);\n      console.log(\`[WS] EDA window disconnected: \${registeredWindowId} (\${code} \${reason})\`);`,
);
fs.writeFileSync(file, source);
