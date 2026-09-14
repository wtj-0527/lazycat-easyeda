import { GENERATED_ACTIONS, SUPPORTED_ACTIONS } from './generated-actions.mjs';
export { SUPPORTED_ACTIONS };
export function actionToCode(action, params = {}) {
  if (action === 'get_netlist') {
    const type = params.type === undefined ? 'JLCEDA' : String(params.type);
    const allowed = new Set(['Allegro', 'Protel2', 'DISA', 'DSNET', 'EasyEDA', 'JLCEDA', 'PADS']);
    if (!allowed.has(type)) throw new Error(`unsupported netlist type: ${type}`);
    const fileName = String(params.fileName || 'easyeda-mcp-netlist').trim();
    if (!fileName) throw new Error('fileName must not be empty');
    return `if(!eda?.sch_ManufactureData?.getNetlistFile)throw new Error('current EDA does not support sch_ManufactureData.getNetlistFile');const file=await eda.sch_ManufactureData.getNetlistFile(${JSON.stringify(fileName)},${JSON.stringify(type)});if(!file)throw new Error('EasyEDA did not return a netlist file');const netlist=await file.text();let parsed;try{parsed=JSON.parse(netlist);}catch{}return {fileName:file.name||${JSON.stringify(fileName)},mimeType:file.type||'text/plain',size:file.size??new Blob([netlist]).size,type:${JSON.stringify(type)},netlist,parsed};`;
  }
  if (action === 'ping') return `return { message: 'pong', timestamp: Date.now() };`;
  if (action === 'select_component') {
    const designator = String(params.designator || '').trim();
    if (!designator) throw new Error('designator is required');
    return `const api=eda;if(!api?.pcb_SelectControl?.selectByDesignator)throw new Error('select not supported');await api.pcb_SelectControl.selectByDesignator(${JSON.stringify(designator)});return {selected:${JSON.stringify(designator)}};`;
  }
  const template = GENERATED_ACTIONS[action];
  if (!template) throw new Error(`unknown design action: ${action}`);
  return `${template.pre}\nconst params=${JSON.stringify(params)};\nreturn await (${template.rootJs})(params);`;
}
