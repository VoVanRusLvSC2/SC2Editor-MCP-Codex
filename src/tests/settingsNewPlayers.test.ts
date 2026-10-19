import test from 'node:test';
import assert from 'node:assert/strict';
import {createMapInfo} from '../modules/document/codecs/mapInfoFactory.js';
import {PlayersDocument} from '../modules/settings/players.js';
test('New map can register native starts and add a computer while preserving opaque settings',()=>{
 const initial=new PlayersDocument(createMapInfo(128,128,'Agria',8,1));
 const tail=initial.bytes.subarray(initial.tableEnd+4);
 const registered=new PlayersDocument(initial.registerStarts([70,71]));
 const added=new PlayersDocument(registered.createPlayer({op:'player.create',playerId:2,control:'Computer',aiName:'Terr',color:1}));
 const result=new PlayersDocument(added.patch({op:'player.set',playerId:2,patch:{startLocation:71}}));
 assert.equal(result.players.find(p=>p.id===2)?.control,'Computer');
 assert.equal(result.players.find(p=>p.id===2)?.startLocation,71);
 assert.deepEqual(result.startLocationIds,[70,71]);
 assert.deepEqual(result.bytes.subarray(result.tableEnd+12),tail);
 assert.throws(()=>result.createPlayer({op:'player.create',playerId:2,control:'Computer',aiName:'Terr',color:1}),/ALREADY_EXISTS/);
 assert.throws(()=>result.patch({op:'player.set',playerId:2,patch:{startLocation:99}}),/NOT_REGISTERED/);
});
