import test from 'node:test';
import assert from 'node:assert/strict';
import {DataDocument} from '../modules/data/document.js';

test('Data indexed selector cannot silently append beside unindexed actor events',()=>{
  const document=new DataDocument('<Catalog><CActorModel id="Pod"><On Terms="Effect.Old.Start" Send="Create"/><On Terms="ActorCreation" Send="Destroy"/></CActorModel></Catalog>','Base.SC2Data/GameData/ActorData.xml');
  assert.throws(()=>document.setField({id:'Pod',ctype:'CActorModel'},'On[0]','Terms','Effect.New.Start'),/DATA_FIELD_INDEX_UNMATCHED/);
  document.setField({id:'Pod',ctype:'CActorModel'},'On[#0]','Terms','Effect.New.Start');
  assert.match(document.source,/On Terms="Effect.New.Start" Send="Create"/);
  assert.doesNotMatch(document.source,/Effect.Old.Start/);
});
