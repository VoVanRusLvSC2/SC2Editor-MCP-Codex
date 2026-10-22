import assert from 'node:assert/strict';
const operators=['value','equals','minimum','lessThan','exists'];
export function validateSuiteAssertion(e){
 if(!e||typeof e!=='object'||Array.isArray(e)||typeof e.path!=='string')throw Error('Suite assertion requires a string path');
 const unknown=Object.keys(e).filter(k=>!['path',...operators].includes(k));if(unknown.length)throw Error('Unknown suite assertion field: '+unknown.join(', '));
 if(!operators.some(k=>Object.hasOwn(e,k)))throw Error('Suite assertion has no operator');
 if(Object.hasOwn(e,'value')&&Object.hasOwn(e,'equals'))throw Error('Use value or equals, not both');
 if('exists' in e&&typeof e.exists!=='boolean')throw Error('Suite exists assertion must be boolean');
 if('minimum' in e&&(typeof e.minimum!=='number'||!Number.isFinite(e.minimum)))throw Error('Suite minimum assertion must be finite');
}
export function assertSuiteResult(result,expectations,resolve=v=>v){
 for(const e of expectations){
  validateSuiteAssertion(e);const value=e.path?e.path.split('.').reduce((a,k)=>a?.[k],result):result;
  if('value' in e)assert.deepEqual(value,resolve(e.value),e.path);
  if('equals' in e)assert.deepEqual(value,resolve(e.equals),e.path);
  if('minimum' in e)assert.ok(typeof value==='number'&&value>=e.minimum,e.path);
  if('lessThan' in e){const bound=resolve(e.lessThan);assert.ok(typeof bound==='number'&&Number.isFinite(bound)&&typeof value==='number'&&value<bound,e.path);}
  if('exists' in e)assert.equal(value!==undefined,e.exists,e.path);
 }
}
