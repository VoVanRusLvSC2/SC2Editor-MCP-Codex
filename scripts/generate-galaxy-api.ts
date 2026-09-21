import {promises as fs} from 'node:fs';
import {createHash} from 'node:crypto';
import {GalaxyDocument} from '../src/modules/script/document.js';
const [file,triggerLibFile,triggerStringsFile]=process.argv.slice(2);if(!file)throw new Error('Usage: generate-galaxy-api.ts /path/to/natives.galaxy [/path/to/NativeLib.TriggerLib /path/to/enUS/TriggerStrings.txt]');
const source=await fs.readFile(file,'utf8'),d=new GalaxyDocument(source);
if(d.diagnostics.some(x=>x.severity==='error'))throw new Error(JSON.stringify(d.diagnostics.slice(0,20)));
type GuiAction={library:'Ntve';functionDefId:string;displayName:string;grammar:string;hint:string;paramDefIds:string[]};
const guiByIdentifier=new Map<string,GuiAction>();
let triggerLibSha256:string|undefined,triggerStringsSha256:string|undefined;
if(triggerLibFile&&triggerStringsFile){
  const [triggerLib,triggerStrings]=await Promise.all([fs.readFile(triggerLibFile,'utf8'),fs.readFile(triggerStringsFile,'utf8')]);
  triggerLibSha256=createHash('sha256').update(triggerLib).digest('hex');triggerStringsSha256=createHash('sha256').update(triggerStrings).digest('hex');
  const localized=new Map(triggerStrings.split(/\r?\n/).map(line=>{const at=line.indexOf('=');return at<0?['','']:[line.slice(0,at),line.slice(at+1)]}));
  for(const match of triggerLib.matchAll(/<Element Type="FunctionDef" Id="([^"]+)">([\s\S]*?)<\/Element>/g)){
    const id=match[1]!,body=match[2]!,identifier=body.match(/<Identifier>([^<]+)<\/Identifier>/)?.[1];if(!identifier)continue;
    const key=`lib_Ntve_${id}`;guiByIdentifier.set(identifier,{library:'Ntve',functionDefId:id,displayName:localized.get(`FunctionDef/Name/${key}`)??identifier,grammar:localized.get(`FunctionDef/Grammar/${key}`)??'',hint:localized.get(`FunctionDef/Hint/${key}`)??'',paramDefIds:[...body.matchAll(/<Parameter Type="ParamDef" Library="Ntve" Id="([^"]+)"\/>/g)].map(x=>x[1]!) });
  }
}
const functions=d.symbols.filter(x=>x.kind==='prototype'&&/^native\b/.test(x.signature)).map(x=>({name:x.name,signature:x.signature,returnType:x.returnType,parameters:x.parameters,...(guiByIdentifier.has(x.name)?{guiAction:guiByIdentifier.get(x.name)}:{})}));
await fs.writeFile('generated/galaxy-native-api.json',JSON.stringify({provenance:{source:'https://github.com/SC2Mapster/SC2GameData/blob/6dd323aae4209a01f110719a00b4e8f7a88389bc/mods/core.sc2mod/base.sc2data/TriggerLibs/natives.galaxy',commit:'6dd323aae4209a01f110719a00b4e8f7a88389bc',sha256:createHash('sha256').update(source).digest('hex'),scope:'Pinned Core native declarations enriched with official GUI FunctionDef names when TriggerLib inputs are supplied; external GameData natives and target-build compatibility not guaranteed',guiEvidence:triggerLibSha256&&triggerStringsSha256?{triggerLibFile,triggerLibSha256,triggerStringsFile,triggerStringsSha256}:null},functions},null,2)+'\n');
console.log(JSON.stringify({functions:functions.length,guiActions:guiByIdentifier.size,diagnostics:d.diagnostics.length}));
