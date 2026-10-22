import {readFileSync,statSync} from 'node:fs';
import {projectPath} from '../../app/paths.js';
import type {FunctionDef} from './authoring.js';

let cached:{revision:string;functions:Array<{name:string;returnType:string;parameters:string[];guiAction?:{library:string;functionDefId:string;paramDefIds:string[]}}> }|undefined;
/** Event GUI signatures omit the compiler-supplied trigger. Only verified native
 * registrations may acquire that explicit argument in a runtime Action carrier. */
export function checkRegistrationSignature(f:FunctionDef){
 if(f.library!=='Ntve'||!f.flags.includes('FlagNative')||!f.flags.includes('FlagEvent')||f.origin==='map'||f.subFunctions?.length)throw Error('GUI_REGISTRATION_NATIVE_EVENT_REQUIRED');
 const file=projectPath('generated/galaxy-native-api.json'),stat=statSync(file),revision=stat.size+':'+stat.mtimeMs;
 if(cached?.revision!==revision)cached={revision,functions:JSON.parse(readFileSync(file,'utf8')).functions};
 const signatures=cached.functions.filter(s=>s.name===f.name);
 if(signatures.length!==1||signatures[0].returnType!=='void'||signatures[0].parameters.length!==f.parameters.length+1||!/^trigger\s+[A-Za-z_]\w*$/.test(signatures[0].parameters[0]))throw Error('GUI_REGISTRATION_NATIVE_SIGNATURE');
 const gui=signatures[0].guiAction;
 if(!gui||gui.library!==f.library||gui.functionDefId!==f.id||gui.paramDefIds.length!==f.parameters.length||gui.paramDefIds.some((id,i)=>id!==f.parameters[i].id))throw Error('GUI_REGISTRATION_NATIVE_GUI_BINDING');
}
