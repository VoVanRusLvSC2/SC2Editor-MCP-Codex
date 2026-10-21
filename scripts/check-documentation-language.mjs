/* global process */
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function walk(directory){const entries=await fs.readdir(directory,{withFileTypes:true});return (await Promise.all(entries.map(e=>e.isDirectory()?walk(path.join(directory,e.name)):[path.join(directory,e.name)]))).flat();}
export function documentationProse(text){return text
 .replace(/<(pre|code|script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'')
 .replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm,'')
 .replace(/`[^`\n]*`/g,'')
 .replace(/\]\([^\n)]+\)/g,']');}
const optional=[];
for(const directory of ['.agents/skills','resources/authoring-catalog/instructions']){
 const absolute=path.join(root,directory);try{optional.push(...await walk(absolute));}catch(error){if(error.code!=='ENOENT')throw error;}
}
const files=[...(await walk(path.join(root,'docs'))),...(await walk(path.join(root,'windows'))),...optional,...(await fs.readdir(root)).filter(n=>/\.(md|txt)$/i.test(n)).map(n=>path.join(root,n))].filter(f=>/\.(md|html|txt)$/i.test(f));
const violations=[];
for(const file of files){const prose=documentationProse(await fs.readFile(file,'utf8'));for(const [i,line]of prose.split('\n').entries())if(/\p{Script=Cyrillic}/u.test(line))violations.push({file:path.relative(root,file),proseLine:i+1,excerpt:line.trim().slice(0,180)});}
process.stdout.write(JSON.stringify({ok:violations.length===0,files:files.length,scope:'Maintained prose. Localized code examples, source IDs and archived work evidence are exempt.',violations},null,2)+'\n');
if(violations.length)process.exitCode=1;
