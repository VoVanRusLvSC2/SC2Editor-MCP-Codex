import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEditorLayerMask} from '../modules/placement/editorVisibility.js';
test('Editor registry layer mask identifies all four hidden layer bits from user settings',()=>{
 const hidden=parseEditorLayerMask('    TerrainLayersVisible    REG_DWORD    0xffffff87\r\n');
 assert.equal(hidden.mask,4294967175);assert.equal(hidden.hex,'0xFFFFFF87');assert.deepEqual(hidden.disabledBits,[3,4,5,6]);
 assert.deepEqual(parseEditorLayerMask('TerrainLayersVisible REG_DWORD 0xffffffff').disabledBits,[]);
 assert.throws(()=>parseEditorLayerMask('Other REG_DWORD 0x0'),/NOT_FOUND/);
 assert.throws(()=>parseEditorLayerMask('TerrainLayersVisible REG_DWORD 0x100000000'),/INVALID/);
});
