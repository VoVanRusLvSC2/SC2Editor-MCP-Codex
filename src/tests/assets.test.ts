import test from 'node:test';import assert from 'node:assert/strict';import {inflateSync} from 'node:zlib';import vm from 'node:vm';import {decodeDds,pngThumbnail} from '../modules/assets/dds.js';import {readM3Geometry} from '../modules/assets/m3.js';import {modelPage} from '../modules/assets/viewer.js';import {resolveModuleSelection} from '../app/moduleSelection.js';
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { Workspace } from "../core/workspace.js";
import { AssetWorkspace } from "../modules/assets/workspace.js";
import type { CascWorkspace } from "../modules/casc/workspace.js";
import { compileAuthorScript } from "../app/authoringScript.js";

test("compact multi-asset inspection preserves input order and rejects mixed/final changed builds", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-inspect-many-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let reads = 0,
    mixed = false,
    finalChanged = false;
  const bytes = dds("DXT1");
  const casc = {
    read: async () => ({
      bytes,
      metadata: {
        sha256: createHash("sha256").update(bytes).digest("hex"),
        buildKey: ++reads === 2 && mixed ? "changed" : "stable",
      },
      cacheHit: false,
    }),
    refreshBuild: async () => ({ build: { buildKey: finalChanged ? "changed" : "stable" } }),
  } as unknown as CascWorkspace;
  const assets = new AssetWorkspace(new Workspace(root), casc),
    files = ["second.dds", "first.dds"];
  const result = await assets.inspectMany(files);
  assert.deepEqual(
    result.items.map((item) => item.file),
    files,
  );
  assert.equal(result.count, 2);
  assert.equal(result.nativePlayback, "not_checked");
  assert.deepEqual(
    compileAuthorScript("assets inspect_many files=second.dds,first.dds", "plan")[0].args.files,
    files,
  );
  reads = 0;
  mixed = true;
  await assert.rejects(assets.inspectMany(files), /ASSET_BUILD_CHANGED/);
  reads = 0;
  mixed = false;
  finalChanged = true;
  await assert.rejects(assets.inspectMany(files), /ASSET_BUILD_CHANGED/);
  await assert.rejects(assets.inspectMany([]), /BATCH_LIMIT/);
  await assert.rejects(assets.inspectMany(Array(25).fill("x.dds")), /BATCH_LIMIT/);
});

test("asset preview outputs verify bytes on reuse and models share bounded geometry/isolated metadata preparation", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-preparation-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let bytes = dds("DXT1"),
    build = "one",
    reads = 0;
  const casc = {
    read: async () => {
      reads++;
      return {
        bytes,
        metadata: { sha256: createHash("sha256").update(bytes).digest("hex"), buildKey: build },
        cacheHit: reads > 1,
      };
    },
  } as unknown as CascWorkspace;
  const assets = new AssetWorkspace(new Workspace(root), casc);
  const first = await assets.preview("texture.dds"),
    again = await assets.preview("texture.dds");
  assert.equal(first.artifactHit, false);
  assert.equal(again.artifactHit, true);
  assert.equal(reads, 2);
  await fs.writeFile(first.pngFile!, "tampered");
  assert.equal((await assets.preview("texture.dds")).artifactHit, false);
  await fs.rm(first.htmlFile);
  assert.equal((await assets.preview("texture.dds")).artifactHit, false);
  build = "two";
  assert.notEqual((await assets.preview("texture.dds")).htmlFile, first.htmlFile);
  bytes = m3();
  const key = createHash("sha256").update(bytes).digest("hex");
  assert.equal(assets.measurements.prepareGeometry(bytes, key).cacheHit, false);
  assert.equal(assets.measurements.prepareGeometry(bytes, key).cacheHit, true);
  const metadata = assets.measurements.prepareMetadata(bytes, key);
  metadata.animations.push("poison");
  assert.equal(
    assets.measurements.prepareMetadata(bytes, key).animations.includes("poison"),
    false,
  );
});
test("derived measurement/palette outputs verify equal-length edits and do not adopt unverified files after restart", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "measurement-artifacts-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = new Workspace(root),
    assets = new AssetWorkspace(workspace, {} as CascWorkspace);
  let produced = 0;
  const make = async () => Buffer.from("value" + ++produced);
  const first = await assets.measurements.writeDerived("key", "json", make);
  assert.equal(first.cacheHit, false);
  assert.equal((await assets.measurements.writeDerived("key", "json", make)).cacheHit, true);
  assert.equal(produced, 1);
  await fs.writeFile(first.file, "value0");
  assert.equal((await assets.measurements.writeDerived("key", "json", make)).cacheHit, false);
  assert.equal(produced, 2);
  const fresh = new AssetWorkspace(workspace, {} as CascWorkspace);
  assert.equal((await fresh.measurements.writeDerived("key", "json", make)).cacheHit, false);
  assert.equal(produced, 3);
});
function dds(format:string){const b=Buffer.alloc(144);b.write('DDS ');b.writeUInt32LE(124,4);b.writeUInt32LE(4,12);b.writeUInt32LE(4,16);b.writeUInt32LE(32,76);b.write(format,84);const at=format==='DXT1'?128:136;b.writeUInt16LE(0xf800,at);b.writeUInt16LE(0x07e0,at+2);return b;}
function m3(){const b=Buffer.alloc(600),sections=[['MODL',24,1,23],['U8__',160,96,0],['DIV_',256,1,2],['U16_',308,3,0],['REGN',320,1,3]] as const;const tag=(s:string,at:number)=>b.write(s.split('').reverse().join(''),at);tag('MD34',0);b.writeUInt32LE(512,4);b.writeUInt32LE(sections.length,8);const ref=(at:number,n:number,index:number)=>{b.writeUInt32LE(n,at);b.writeUInt32LE(index,at+4)};ref(12,1,0);b.writeUInt32LE(0x182007d,120);ref(124,96,1);ref(136,1,2);ref(256,3,3);ref(268,1,4);b.writeFloatLE(1,160+32);b.writeFloatLE(1,160+64+4);b.writeUInt16LE(1,310);b.writeUInt16LE(2,312);b.writeUInt32LE(3,332);b.writeUInt32LE(3,340);sections.forEach(([s,off,n,v],i)=>{const at=512+i*16;tag(s,at);b.writeUInt32LE(off,at+4);b.writeUInt32LE(n,at+8);b.writeUInt32LE(v,at+12)});return b;}
test('DDS BC color and both alpha encodings decode known blocks',()=>{const bc1=decodeDds(dds('DXT1'));assert.deepEqual([...bc1.rgba.subarray(0,4)],[255,0,0,255]);const b=dds('DXT1');b.writeUInt16LE(0,128);b.writeUInt16LE(0xffff,130);b.writeUInt32LE(0xffffffff,132);assert.equal(decodeDds(b).rgba[3],0);const bc2=dds('DXT3');bc2.fill(0x88,128,136);assert.equal(decodeDds(bc2).rgba[3],136);const bc3=dds('DXT5');bc3[128]=210;bc3[129]=10;assert.equal(decodeDds(bc3).rgba[3],210);});
test('DDS rejects truncation/unsupported format and PNG contains correct scanlines',()=>{assert.throws(()=>decodeDds(dds('DXT5').subarray(0,143)),/TRUNCATED/);assert.throws(()=>decodeDds(dds('DX10')),/UNSUPPORTED/);const p=pngThumbnail(decodeDds(dds('DXT1')));assert.equal(p.width,4);let at=8;while(p.bytes.toString('ascii',at+4,at+8)!=='IDAT')at+=p.bytes.readUInt32BE(at)+12;const raw=inflateSync(p.bytes.subarray(at+8,at+8+p.bytes.readUInt32BE(at)));assert.deepEqual([...raw.subarray(0,5)],[0,255,0,0,255]);});
test('M3 resolves model/division/region references and rejects corrupt face indices',()=>{const b=m3(),g=readM3Geometry(b);assert.equal(g.vertexCount,3);assert.equal(g.triangleCount,1);assert.deepEqual(g.indices,[0,1,2]);assert.deepEqual(g.bounds,{min:[0,0,0],max:[1,1,0]});b.writeUInt16LE(3,312);assert.throws(()=>readM3Geometry(b),/FACE_VERTEX_INVALID/);const bad=m3();bad.writeUInt32LE(999,8);assert.throws(()=>readM3Geometry(bad),/INDEX_BOUNDS/);});
test('offline viewer script initializes, toggles and rotates using a WebGL contract stub',()=>{const html=modelPage('<unsafe>',readM3Geometry(m3()));assert.ok(html.includes('&lt;unsafe&gt;'));const script=html.match(/<script>([\s\S]*)<\/script>/)![1],draws:number[]=[],button:{onclick?:()=>void}={},canvas:{[key:string]:unknown}={clientWidth:800,clientHeight:600,setPointerCapture:()=>{}};const gl=new Proxy({getShaderParameter:()=>true,getUniformLocation:()=>0,getAttribLocation:()=>0,createShader:()=>({}),createProgram:()=>({}),createBuffer:()=>({}),drawArrays:(_mode:number,_first:number,count:number)=>draws.push(count)},{get:(o,k)=>k in o?o[k as keyof typeof o]:()=>{}});canvas.getContext=()=>gl;vm.runInNewContext(script,{document:{getElementById:(id:string)=>id==='view'?canvas:button},window:{},devicePixelRatio:1,Float32Array,Math,Error});assert.deepEqual(draws,[6]);button.onclick!();assert.deepEqual(draws,[6,3]);(canvas.onpointerdown as (e:unknown)=>void)({clientX:10,clientY:10,pointerId:1});(canvas.onpointermove as (e:unknown)=>void)({clientX:20,clientY:30});assert.equal(draws.length,3);});
test('assets has a separate focused profile without expanding existing CASC profile',()=>{assert.ok(resolveModuleSelection({}).modules.has('assets'));assert.deepEqual([...resolveModuleSelection({SC2_MCP_PROFILE:'assets'}).modules],['ui','casc','assets']);assert.deepEqual([...resolveModuleSelection({SC2_MCP_PROFILE:'casc'}).modules],['ui','casc','data','browse']);});
