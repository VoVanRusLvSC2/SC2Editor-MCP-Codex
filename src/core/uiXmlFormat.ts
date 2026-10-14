import {scanXml} from './xmlScanner.js';
/** Formatting only: retain original tag/attribute spelling, comments and PI.
 * Text-bearing XML is left intact because added whitespace could change content. */
export function formatUiXml(source:string):string{
 const parsed=scanXml(source);if(parsed.diagnostics.some(d=>d.severity==='error'))throw new Error('UI_FORMAT_XML_INVALID');
 const tokens:string[]=[];let at=source.charCodeAt(0)===0xfeff?1:0;const bom=at?'\uFEFF':'';
 while(at<source.length){const start=source.indexOf('<',at);if(start<0){if(source.slice(at).trim())return source;break;}if(source.slice(at,start).trim())return source;
 let end:number;if(source.startsWith('<!--',start)){end=source.indexOf('-->',start)+3;}else if(source.startsWith('<![CDATA[',start))return source;else if(source.startsWith('<?',start)){end=source.indexOf('?>',start)+2;}else{let quote='';end=start+1;for(;end<source.length;end++){const c=source[end];if(quote){if(c===quote)quote='';}else if(c==='"'||c==="'")quote=c;else if(c==='>'){end++;break;}}}
 if(end<=start||end>source.length)throw new Error('UI_FORMAT_XML_INVALID');tokens.push(source.slice(start,end));at=end;
 }
 const nl=source.includes('\r\n')?'\r\n':'\n';let depth=0;return bom+tokens.map(token=>{const close=token.startsWith('</');if(close)depth--;const row='    '.repeat(Math.max(0,depth))+token;if(!close&&!/^<[/!?]/.test(token)&&!token.endsWith('/>'))depth++;return row;}).join(nl)+nl;
}
export const isUiXml=(file:string)=>/\.(?:SC2Layout|SC2Style)$/i.test(file);
