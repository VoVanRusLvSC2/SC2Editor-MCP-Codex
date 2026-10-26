import type {TriggerWorkspace} from './workspace.js';

/** Keep transaction identity and diagnostics while avoiding an unsolicited
 * second copy of the generated source in every successful MCP response. */
export function compactRuntimeReceipt(value:Awaited<ReturnType<TriggerWorkspace['generateRuntime']>>) {
 const {transaction,...generation}=value;
 return {...generation,transaction:{...transaction,files:transaction.files.map(({preview,...file})=>({...file,previewOmitted:preview!==undefined}))}};
}
