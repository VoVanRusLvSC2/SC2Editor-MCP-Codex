import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeReportPage} from '../integrations/native/details.js';
test('native report details page arrays, escaped keys and long values with explicit coverage',()=>{
 const report={native:{'camera/list':[{name:'A'},{name:'B'},{name:'C'}],code:'x'.repeat(5000)}};
 const page=nativeReportPage(report,'/native/camera~1list',1,1);assert.equal(page.kind,'array');assert.equal((page as any).items[0].value.name,'B');assert.equal((page as any).nextOffset,2);
 const code=nativeReportPage(report,'/native/code',0,1);assert.equal((code as any).truncated,true);assert.ok(JSON.stringify(code).length<1000);
 assert.throws(()=>nativeReportPage(report,'/native/__proto__',0,1),/PATH_MISSING/);
 assert.throws(()=>nativeReportPage(report,'native',0,1),/POINTER_INVALID/);
});
