import test from 'node:test';
import assert from 'node:assert/strict';
import {MovementClock} from '../modules/testing/movementClock.js';
const body=(gameTime:number)=>({session:'owned',runtimeEpoch:'epoch',mapLoadSerial:1,gameTime});

test('movement clocks retain same-response identity and compare simulation progress with actual request timing',()=>{
 const c=new MovementClock();c.observe(body(10),'initial',0,5);const order=c.observe(body(10.0625),'order',10,20);
 c.observe(body(10.25),'sample',30,100);const last=c.observe(body(12.0625),'sample',110,1020),summary=c.summary();
 assert.deepEqual(order.native,body(10.0625));assert.equal(last.roundTripMs,910);assert.equal(summary.quality,'verified');assert.equal(summary.wallElapsedMs,1000);assert.equal(summary.gameElapsedSeconds,2);assert.equal(summary.gameSecondsPerWallSecond,2);assert.equal(summary.observations,4);
});

test('a stalled simulation is recorded as zero progress without inventing a load or game-speed diagnosis',()=>{
 const c=new MovementClock();c.observe(body(5),'initial',0,1);c.observe(body(5),'order',2,3);c.observe(body(5),'sample',4,1003);
 assert.equal(c.summary().quality,'verified');assert.equal(c.summary().gameElapsedSeconds,0);assert.equal(c.summary().gameSecondsPerWallSecond,0);assert.equal(c.invalid,false);
});

test('absent or partial clocks never produce a simulation-rate ratio',()=>{
 const c=new MovementClock();c.observe({},'initial',0,1);c.observe({},'order',2,3);c.observe({},'sample',4,5);
 assert.equal(c.summary().quality,'unavailable');assert.equal(c.summary().gameSecondsPerWallSecond,undefined);
 const partial=new MovementClock();partial.observe(body(0),'initial',0,1);partial.observe(body(1),'order',2,3);partial.observe({},'sample',4,5);
 assert.equal(partial.summary().quality,'partial');assert.equal(partial.summary().gameElapsedSeconds,undefined);
});

test('session replacement, time regression and invalid timestamps invalidate clock correlation',()=>{
 for(const changed of [{...body(2),session:'other'},{...body(2),runtimeEpoch:'other'},{...body(2),mapLoadSerial:2},body(.5),{...body(2),gameTime:-1},{...body(2),gameTime:'2'},{session:'owned'}]){
  const c=new MovementClock();c.observe(body(0),'initial',0,1);c.observe(body(1),'order',2,3);c.observe(changed,'sample',4,5);assert.equal(c.invalid,true);assert.equal(c.summary().quality,'invalid');assert.equal(c.summary().gameSecondsPerWallSecond,undefined);
 }
 const c=new MovementClock();c.observe(body(0),'initial',0,10);c.observe(body(1),'order',9,11);assert.ok(c.summary().issues.includes('wall_clock_regressed'));
});

test('clock records are bounded scalar copies independent of later input changes',()=>{
 const c=new MovementClock(),input={...body(1),secret:'not a clock',nested:{source:'private'}};
 const captured=c.observe(input,'order',0,1);input.session='changed';input.gameTime=100;
 assert.deepEqual(captured.native,body(1));assert.ok(!JSON.stringify(captured).includes('private'));assert.ok(!JSON.stringify(captured).includes('secret'));
});
