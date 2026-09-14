import assert from 'node:assert/strict';
const endpoint=process.env.MCP_URL||'http://127.0.0.1:8000/mcp';
async function rpc(method,params,id){const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id,method,params})});assert.equal(r.status,200);return r.json();}
const list=await rpc('tools/list',{},1);const names=list.result.tools.map(t=>t.name);
for(const name of ['easyeda_design_capabilities','easyeda_open_project','easyeda_open_document','easyeda_route_track','easyeda_create_via','easyeda_search_library_components','easyeda_create_schematic_component','easyeda_create_schematic_wire','easyeda_create_net_label','easyeda_create_net_port','easyeda_import_project','easyeda_export_project','easyeda_call_api'])assert(names.includes(name),name);
assert(!names.includes('easyeda_execute_api'));
const cap=await rpc('tools/call',{name:'easyeda_design_capabilities',arguments:{}},2);assert(!cap.result.isError);const payload=JSON.parse(cap.result.content[0].text);assert.equal(payload.genericApi,true);assert(Object.keys(payload.actions).length>=32);
const rejected=await rpc('tools/call',{name:'easyeda_create_via',arguments:{params:{net:'GND',x:1,y:1,drill:10,diameter:20},confirmWrite:false,expectedProjectUuid:'wrong'}},3);assert.equal(rejected.result.isError,true);assert.match(rejected.result.content[0].text,/confirmWrite/);
console.log(JSON.stringify({toolCount:names.length,actionCount:Object.keys(payload.actions).length,rawExecute:names.includes('easyeda_execute_api'),writeGuardRejected:true},null,2));
