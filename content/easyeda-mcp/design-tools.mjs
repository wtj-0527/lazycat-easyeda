import { z } from 'zod';
import { actionToCode, SUPPORTED_ACTIONS } from './vendor/action-codegen.mjs';

const WRITE_ACTIONS = new Set([
  'move_silkscreen', 'auto_silkscreen', 'move_component', 'route_track', 'create_via',
  'delete_via', 'delete_tracks', 'relocate_component', 'create_keepout_rect', 'delete_region',
  'create_pour_rect', 'delete_pour', 'create_differential_pair', 'delete_differential_pair',
  'create_equal_length_group', 'delete_equal_length_group', 'create_pcb_component',
]);
const DESTRUCTIVE_ACTIONS = new Set([
  'delete_via', 'delete_tracks', 'relocate_component', 'delete_region', 'delete_pour',
  'delete_differential_pair', 'delete_equal_length_group',
]);
const ACTION_DESCRIPTIONS = {
  get_state: 'Read complete PCB state: components, nets and bounds.',
  get_feature_support: 'Inspect supported EasyEDA API capabilities.',
  screenshot: 'Capture the current EDA rendered area.',
  get_silkscreens: 'Read PCB silkscreen strings and conflicts.',
  move_silkscreen: 'Move or rotate a PCB silkscreen string.',
  auto_silkscreen: 'Automatically improve conflicted PCB silkscreen placement.',
  move_component: 'Move/rotate a PCB component by designator.',
  route_track: 'Create a PCB track from structured path points.',
  create_via: 'Create a PCB via.', delete_via: 'Delete PCB vias by primitive ID.',
  get_tracks: 'Read PCB tracks.', delete_tracks: 'Delete PCB tracks by primitive ID.',
  get_net_primitives: 'Read all PCB primitives on a net.',
  relocate_component: 'Relocate a PCB component after removing attached tracks.',
  create_keepout_rect: 'Create a rectangular PCB keepout.', delete_region: 'Delete a PCB region/keepout.',
  create_pour_rect: 'Create a rectangular copper pour.', delete_pour: 'Delete a copper pour.',
  create_differential_pair: 'Create a PCB differential-pair rule.', delete_differential_pair: 'Delete a differential-pair rule.',
  list_differential_pairs: 'List PCB differential-pair rules.',
  create_equal_length_group: 'Create an equal-length net group.', delete_equal_length_group: 'Delete an equal-length net group.',
  list_equal_length_groups: 'List equal-length net groups.', run_drc: 'Run PCB DRC.',
  get_pads: 'Read PCB pads.', get_board_info: 'Read current board metadata.', open_document: 'Open a document by UUID.',
  get_schematic_state: 'Read schematic components, pins and wires.', get_netlist: 'Read schematic netlist through the supported manufacture-data API.',
  run_sch_drc: 'Run schematic DRC/ERC.', create_pcb_component: 'Place a library component on PCB.',
};
const ACTION_TOOL_NAMES = Object.fromEntries(SUPPORTED_ACTIONS.map(action => [action, `easyeda_${action}`]));
const CONFIRM_PHRASE = 'CONFIRM DESTRUCTIVE EASYEDA OPERATION';

function primitiveIdCode(expression) {
  return `const value=${expression};return value?{primitiveId:value?.getState_PrimitiveId?.()||value?.primitiveId||null,result:value}:value;`;
}
function safeJson(value) { return JSON.stringify(value ?? null).replaceAll('<', '\\u003c'); }
function methodRisk(method) {
  const m = method.toLowerCase();
  if (/delete|remove|clear|overwrite|reset|closeproject|purge|destroy/.test(m)) return 'destructive';
  if (/^(get|list|search|check|extract|convert|calculate|exists|zoom|navigate|read)/.test(m)) return 'read';
  return 'write';
}
function genericApiCode(module, method, args) {
  return `const moduleName=${safeJson(module)},methodName=${safeJson(method)},args=${safeJson(args)};const target=eda[moduleName];if(!target)throw new Error('Unknown EDA API module: '+moduleName);const fn=target[methodName];if(typeof fn!=='function')throw new Error('Unknown EDA API method: '+moduleName+'.'+methodName);const result=await fn.apply(target,args);async function pack(v,depth=0){if(depth>6)return '[max-depth]';if(v==null||typeof v==='string'||typeof v==='number'||typeof v==='boolean')return v;if(v instanceof Blob){if(v.size>104857600)throw new Error('file result exceeds 100 MiB');const bytes=new Uint8Array(await v.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return {kind:'file',name:v.name||'export.bin',type:v.type||'application/octet-stream',size:v.size,base64:btoa(binary)};}if(Array.isArray(v))return await Promise.all(v.map(x=>pack(x,depth+1)));if(typeof v==='object'){const out={};for(const [k,x] of Object.entries(v)){if(typeof x!=='function')out[k]=await pack(x,depth+1);}for(const [name,getter] of [['primitiveId','getState_PrimitiveId'],['designator','getState_Designator'],['x','getState_X'],['y','getState_Y'],['net','getState_Net']]){try{if(out[name]===undefined&&typeof v[getter]==='function')out[name]=await pack(v[getter](),depth+1);}catch{}}return out;}return String(v);}return await pack(result);`;
}
function fileImportCode(input) {
  return `const p=${safeJson(input)};const raw=atob(p.fileBase64);const bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);const file=new File([bytes],p.fileName,{type:p.mimeType||'application/octet-stream'});const extracted=await eda.sys_FileManager.extractProjectInfo(file);const imported=await eda.sys_FileManager.importProjectByProjectFile(file,p.fileType,p.props,p.saveTo,p.librariesImportSetting);if(!imported)throw new Error('EasyEDA import returned undefined; verify fileType, project-file format, saveTo and account permissions');return {imported:{uuid:imported.uuid||null,name:imported.name||null,friendlyName:imported.friendlyName||null,itemType:imported.itemType||null},target:p.saveTo,source:{fileName:file.name,size:file.size,type:p.fileType||null,sha256:p.sha256||null,extracted:extracted||null}};`;
}

export function registerDesignTools(server, { execute, runWrite, getProjectUuid, text, loadProjectFile, saveExportFile }) {
  const windowArg = { windowId: z.string().optional().describe('Optional target EasyEDA window ID') };
  for (const action of SUPPORTED_ACTIONS) {
    const write = WRITE_ACTIONS.has(action);
    const destructive = DESTRUCTIVE_ACTIONS.has(action);
    const schema = {
      params: z.record(z.any()).optional().describe('Structured parameters for this EasyEDA design action.'),
      ...windowArg,
      ...(write ? {
        confirmWrite: z.boolean().describe('Must be true for write operations.'),
        expectedProjectUuid: z.string().min(1).describe('Current project UUID read immediately before this write.'),
      } : {}),
      ...(destructive ? { confirmationPhrase: z.literal(CONFIRM_PHRASE) } : {}),
    };
    server.tool(ACTION_TOOL_NAMES[action], `${ACTION_DESCRIPTIONS[action] || action}${write ? ' WRITE operation; project-bound confirmation required.' : ''}`, schema, async input => {
      try {
        const invoke = () => execute(actionToCode(action, input.params || {}), input.windowId);
        const value = write
          ? await runWrite({ ...input, destructive }, invoke)
          : await invoke();
        return text(value);
      } catch (error) { return text({ error: error.message }, true); }
    });
  }

  const commonWrite = {
    confirmWrite: z.literal(true), expectedProjectUuid: z.string().min(1), windowId: z.string().optional(),
  };
  const destructive = { ...commonWrite, confirmationPhrase: z.literal(CONFIRM_PHRASE) };

  server.tool('easyeda_create_project', 'Create a cloud EasyEDA project.', {
    projectFriendlyName: z.string().min(1), projectName: z.string().optional(), teamUuid: z.string().optional(),
    folderUuid: z.string().optional(), description: z.string().optional(), confirmWrite: z.literal(true), windowId: z.string().optional(),
  }, async input => {
    try { return text(await runWrite({ ...input, allowNoProject: true }, () => execute(`const uuid=await eda.dmt_Project.createProject(${safeJson(input.projectFriendlyName)},${safeJson(input.projectName)},${safeJson(input.teamUuid)},${safeJson(input.folderUuid)},${safeJson(input.description)});if(!uuid)throw new Error('EasyEDA project create returned undefined');return {created:true,projectUuid:uuid};`, input.windowId))); }
    catch (error) { return text({ error: error.message }, true); }
  });

  server.tool('easyeda_open_project', 'Open a cloud EasyEDA project. DESTRUCTIVE navigation: unsaved changes in the current project can be lost.', {
    projectUuid:z.string().min(1), confirmWrite:z.literal(true), expectedProjectUuid:z.string().optional(),
    confirmationPhrase:z.literal(CONFIRM_PHRASE), windowId:z.string().optional(),
  }, async i => { try { const current=await getProjectUuid(i.windowId); if(current&&i.expectedProjectUuid!==current)throw new Error(`Project mismatch: expected ${i.expectedProjectUuid||'none'}, active ${current}`); const ok=await runWrite({...i,allowNoProject:!current,destructive:true},()=>execute(`const ok=await eda.dmt_Project.openProject(${safeJson(i.projectUuid)});if(!ok)throw new Error('EasyEDA failed to open project');return {opened:true,projectUuid:${safeJson(i.projectUuid)}};`,i.windowId)); return text(ok); } catch(error){return text({error:error.message},true);} });

  const simpleTools = [
    ['easyeda_create_schematic','Create a schematic under the current project.',{ boardName:z.string().optional(),...commonWrite },i=>`const uuid=await eda.dmt_Schematic.createSchematic(${safeJson(i.boardName)});if(!uuid)throw new Error('EasyEDA schematic create returned undefined');return {created:true,schematicUuid:uuid};`],
    ['easyeda_create_schematic_page','Create a schematic page.',{ schematicUuid:z.string().min(1),...commonWrite },i=>`const uuid=await eda.dmt_Schematic.createSchematicPage(${safeJson(i.schematicUuid)});if(!uuid)throw new Error('EasyEDA schematic page create returned undefined');return {created:true,pageUuid:uuid};`],
    ['easyeda_create_pcb','Create a PCB under the current project.',{ boardName:z.string().optional(),...commonWrite },i=>`const uuid=await eda.dmt_Pcb.createPcb(${safeJson(i.boardName)});if(!uuid)throw new Error('EasyEDA PCB create returned undefined');return {created:true,pcbUuid:uuid};`],
    ['easyeda_rename_schematic','Rename a schematic.',{ schematicUuid:z.string().min(1),name:z.string().min(1),...commonWrite },i=>`const ok=await eda.dmt_Schematic.modifySchematicName(${safeJson(i.schematicUuid)},${safeJson(i.name)});if(!ok)throw new Error('EasyEDA schematic rename failed');return {renamed:true};`],
    ['easyeda_rename_schematic_page','Rename a schematic page.',{ pageUuid:z.string().min(1),name:z.string().min(1),...commonWrite },i=>`const ok=await eda.dmt_Schematic.modifySchematicPageName(${safeJson(i.pageUuid)},${safeJson(i.name)});if(!ok)throw new Error('EasyEDA schematic page rename failed');return {renamed:true};`],
    ['easyeda_rename_pcb','Rename a PCB.',{ pcbUuid:z.string().min(1),name:z.string().min(1),...commonWrite },i=>`const ok=await eda.dmt_Pcb.modifyPcbName(${safeJson(i.pcbUuid)},${safeJson(i.name)});if(!ok)throw new Error('EasyEDA PCB rename failed');return {renamed:true};`],
    ['easyeda_delete_schematic','Delete a schematic.',{ schematicUuid:z.string().min(1),...destructive },i=>`return await eda.dmt_Schematic.deleteSchematic(${safeJson(i.schematicUuid)});`,true],
    ['easyeda_delete_schematic_page','Delete a schematic page.',{ pageUuid:z.string().min(1),...destructive },i=>`return await eda.dmt_Schematic.deleteSchematicPage(${safeJson(i.pageUuid)});`,true],
    ['easyeda_delete_pcb','Delete a PCB.',{ pcbUuid:z.string().min(1),...destructive },i=>`return await eda.dmt_Pcb.deletePcb(${safeJson(i.pcbUuid)});`,true],
  ];
  for (const [name, description, schema, code, isDestructive] of simpleTools) server.tool(name, `${description} WRITE operation.`, schema, async input => {
    try { return text(await runWrite({ ...input, destructive: isDestructive }, () => execute(code(input), input.windowId))); }
    catch (error) { return text({ error: error.message }, true); }
  });

  server.tool('easyeda_search_library_components', 'Search EasyEDA device or symbol libraries and return valid references for placement.', {
    keyword:z.string().min(1), libraryType:z.enum(['DEVICE','SYMBOL']).default('DEVICE'), libraryUuid:z.string().optional(),
    limit:z.number().int().min(1).max(100).default(20), page:z.number().int().min(1).default(1), ...windowArg,
  }, async i => { try { const module=i.libraryType==='SYMBOL'?'lib_Symbol':'lib_Device'; const code=`const libraryUuid=${safeJson(i.libraryUuid)}||await eda.lib_LibrariesList.getSystemLibraryUuid();if(!libraryUuid)throw new Error('EasyEDA system library UUID is unavailable');const rows=await eda.${module}.search(${safeJson(i.keyword)},libraryUuid,undefined,undefined,${i.limit},${i.page});return (rows||[]).map(x=>({libraryType:${safeJson(i.libraryType)},libraryUuid:x.libraryUuid||libraryUuid,componentUuid:x.uuid||'',name:x.name||'',symbol:x.symbol||((x.symbolUuid||x.symbolName)?{uuid:x.symbolUuid||'',name:x.symbolName||'',libraryUuid:x.libraryUuid||libraryUuid}:null),footprint:x.footprint||((x.footprintUuid||x.footprintName)?{uuid:x.footprintUuid||'',name:x.footprintName||'',libraryUuid:x.libraryUuid||libraryUuid}:null),supplierId:x.supplierId||x.otherProperty?.['Supplier Part']||'',manufacturerId:x.manufacturerId||x.otherProperty?.['Manufacturer Part']||'',description:x.description||''}));`; return text(await execute(code,i.windowId)); } catch(error){return text({error:error.message},true);} });

  server.tool('easyeda_create_schematic_component', 'Place a validated device or symbol library item in the active schematic. Use easyeda_search_library_components first; invalid/mismatched references fail before placement.', {
    libraryUuid:z.string().min(1), componentUuid:z.string().min(1), libraryType:z.enum(['DEVICE','SYMBOL']).default('DEVICE'),
    x:z.number(), y:z.number(), subPartName:z.string().optional(), rotation:z.number().optional(), mirror:z.boolean().optional(),
    addIntoBom:z.boolean().optional(), addIntoPcb:z.boolean().optional(), ...commonWrite,
  }, async i => { try { const module=i.libraryType==='SYMBOL'?'lib_Symbol':'lib_Device'; const enumValue=i.libraryType==='SYMBOL'?'2':'3'; const code=`const item=await eda.${module}.get(${safeJson(i.componentUuid)},${safeJson(i.libraryUuid)});if(!item)throw new Error(${safeJson(`${i.libraryType} library reference not found or inaccessible`)});const result=await eda.sch_PrimitiveComponent.create(item,${i.x},${i.y},${safeJson(i.subPartName)},${i.rotation??0},${!!i.mirror},${i.addIntoBom!==false},${i.addIntoPcb!==false});if(!result)throw new Error('EasyEDA component create returned undefined');const primitiveId=result?.getState_PrimitiveId?.()||result?.primitiveId||null;if(!primitiveId)throw new Error('EasyEDA component create returned no primitive ID');return {created:true,primitiveId,designator:result?.getState_Designator?.()||result?.designator||null,libraryReference:{libraryType:${safeJson(i.libraryType)},enumValue:${safeJson(enumValue)},libraryUuid:${safeJson(i.libraryUuid)},componentUuid:${safeJson(i.componentUuid)}}};`; return text(await runWrite(i,()=>execute(code,i.windowId))); } catch(error){return text({error:error.message},true);} });

  server.tool('easyeda_create_schematic_wire', 'Create a schematic wire. Points are a flat [x1,y1,x2,y2,...] array.', {
    points:z.array(z.number()).min(4), net:z.string().optional(), color:z.string().optional(), lineWidth:z.number().optional(), lineType:z.number().optional(), ...commonWrite,
  }, async i => { try { return text(await runWrite(i,()=>execute(primitiveIdCode(`await eda.sch_PrimitiveWire.create(${safeJson(i.points)},${safeJson(i.net)},${safeJson(i.color)},${safeJson(i.lineWidth)},${safeJson(i.lineType)})`),i.windowId))); } catch(error){return text({error:error.message},true);} });

  server.tool('easyeda_create_net_label', 'Create a schematic net label.', { x:z.number(),y:z.number(),net:z.string().min(1),...commonWrite }, async i => { try{return text(await runWrite(i,()=>execute(primitiveIdCode(`await eda.sch_PrimitiveAttribute.createNetLabel(${i.x},${i.y},${safeJson(i.net)})`),i.windowId)));}catch(error){return text({error:error.message},true);} });
  server.tool('easyeda_create_net_port', 'Create a schematic net port.', { direction:z.enum(['IN','OUT','BI']),net:z.string().min(1),x:z.number(),y:z.number(),rotation:z.number().optional(),mirror:z.boolean().optional(),...commonWrite }, async i => { try{return text(await runWrite(i,()=>execute(primitiveIdCode(`await eda.sch_PrimitiveComponent.createNetPort(${safeJson(i.direction)},${safeJson(i.net)},${i.x},${i.y},${i.rotation??0},${!!i.mirror})`),i.windowId)));}catch(error){return text({error:error.message},true);} });
  server.tool('easyeda_create_net_flag', 'Create a schematic power/ground net flag.', { identification:z.enum(['Power','Ground','AnalogGround','ProtectGround']),net:z.string().min(1),x:z.number(),y:z.number(),rotation:z.number().optional(),mirror:z.boolean().optional(),...commonWrite }, async i => { try{return text(await runWrite(i,()=>execute(primitiveIdCode(`await eda.sch_PrimitiveComponent.createNetFlag(${safeJson(i.identification)},${safeJson(i.net)},${i.x},${i.y},${i.rotation??0},${!!i.mirror})`),i.windowId)));}catch(error){return text({error:error.message},true);} });

  server.tool('easyeda_modify_schematic_component', 'Modify structured properties of a schematic component.', { primitiveId:z.string().min(1),properties:z.record(z.any()),...commonWrite }, async i=>{try{return text(await runWrite(i,()=>execute(`return await eda.sch_PrimitiveComponent.modify(${safeJson(i.primitiveId)},${safeJson(i.properties)});`,i.windowId)));}catch(error){return text({error:error.message},true);}});
  server.tool('easyeda_delete_schematic_primitives', 'Delete schematic components/wires by type and IDs.', { primitiveType:z.enum(['component','wire']),primitiveIds:z.array(z.string()).min(1),...destructive }, async i=>{try{const mod=i.primitiveType==='wire'?'sch_PrimitiveWire':'sch_PrimitiveComponent';return text(await runWrite({...i,destructive:true},()=>execute(`return await eda.${mod}.delete(${safeJson(i.primitiveIds)});`,i.windowId)));}catch(error){return text({error:error.message},true);}});

  server.tool('easyeda_import_project', 'Import a complete EasyEDA/KiCad/Altium/etc project file. Import always has an explicit destination and undefined results are errors; it does not merge primitives into the currently open sheet.', {
    filePath:z.string().optional().describe('Preferred: path under /config/Desktop or /config/Downloads.'),fileName:z.string().optional(),fileBase64:z.string().max(1_500_000).optional().describe('Only for small files; use filePath for normal projects.'),mimeType:z.string().optional(),
    fileType:z.enum(['JLCEDA','JLCEDA Pro','EasyEDA','EasyEDA Pro','Allegro','OrCAD','EAGLE','KiCad','PADS','LTspice','Altium Designer','Protel']),
    props:z.record(z.any()).optional(),
    saveTo:z.union([z.object({operation:z.literal('Existing Project'),existingProjectUuid:z.string().min(1)}),z.object({operation:z.literal('New Project'),newProjectOwnerTeamUuid:z.string().min(1),newProjectOwnerFolderUuid:z.string().optional(),newProjectName:z.string().optional(),newProjectFriendlyName:z.string().optional(),newProjectDescription:z.string().optional(),newProjectCollaborationMode:z.any().optional()})]).optional().describe('Defaults to the confirmed current project. Required for New Project import.'),
    librariesImportSetting:z.record(z.any()).optional(), confirmWrite:z.literal(true),expectedProjectUuid:z.string().optional(),windowId:z.string().optional(),
  }, async i=>{try{let payload=i;if(i.filePath)payload={...i,...await loadProjectFile(i.filePath)};if(!payload.fileName||!payload.fileBase64)throw new Error('filePath or fileName+fileBase64 is required');const saveTo=i.saveTo||(i.expectedProjectUuid?{operation:'Existing Project',existingProjectUuid:i.expectedProjectUuid}:null);if(!saveTo)throw new Error('saveTo is required when importing into a new project');if(saveTo.operation==='Existing Project'&&saveTo.existingProjectUuid!==i.expectedProjectUuid)throw new Error('saveTo.existingProjectUuid must equal expectedProjectUuid');payload={...payload,saveTo};const allowNoProject=saveTo.operation==='New Project'&&!i.expectedProjectUuid;return text(await runWrite({...i,allowNoProject},()=>execute(fileImportCode(payload),i.windowId)));}catch(error){return text({error:error.message},true);}});

  server.tool('easyeda_export_project', 'Export the current or specified project to a persistent file; returns path, size and SHA-256, not base64.', { projectUuid:z.string().optional(),fileName:z.string().optional(),password:z.string().optional(),fileType:z.enum(['epro','epro2']).optional(),outputPath:z.string().optional().describe('Path under /config/Desktop or /config/Downloads.'),windowId:z.string().optional() }, async i=>{try{const call=i.projectUuid?`eda.sys_FileManager.getProjectFileByProjectUuid(${safeJson(i.projectUuid)},${safeJson(i.fileName)},${safeJson(i.password)},${safeJson(i.fileType)})`:`eda.sys_FileManager.getProjectFile(${safeJson(i.fileName)},${safeJson(i.password)},${safeJson(i.fileType)})`;const result=await execute(genericApiCode('sys_FileManager','__export_helper__',[]).replace("const target=eda[moduleName];",`const direct=await ${call};const target={__export_helper__:async()=>direct};`),i.windowId);return text(await saveExportFile(result,i.outputPath));}catch(error){return text({error:error.message},true);}});

  server.tool('easyeda_call_api', 'Call any public EasyEDA eda.* API method using structured module/method/JSON arguments. No JavaScript is accepted. Future-proof full API coverage.', {
    module:z.string().regex(/^(dmt|pcb|sch|lib|sys)_[A-Za-z0-9_]+$/),method:z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/),args:z.array(z.any()).default([]),
    risk:z.enum(['read','write','destructive']).describe('Must match server-classified method risk.'),confirmWrite:z.boolean().optional(),expectedProjectUuid:z.string().optional(),confirmationPhrase:z.string().optional(),windowId:z.string().optional(),
  }, async i=>{try{const risk=methodRisk(i.method);if(i.risk!==risk)throw new Error(`Method classified as ${risk}, not ${i.risk}`);const invoke=()=>execute(genericApiCode(i.module,i.method,i.args),i.windowId);return text(risk==='read'?await invoke():await runWrite({...i,destructive:risk==='destructive'},invoke));}catch(error){return text({error:error.message},true);}});

  server.tool('easyeda_design_capabilities', 'List complete design action coverage and safety confirmation requirements.', {}, async()=>text({actions:Object.fromEntries(SUPPORTED_ACTIONS.map(a=>[ACTION_TOOL_NAMES[a],{action:a,risk:WRITE_ACTIONS.has(a)?(DESTRUCTIVE_ACTIONS.has(a)?'destructive':'write'):'read'}])),genericApi:true,destructiveConfirmationPhrase:CONFIRM_PHRASE}));
}
