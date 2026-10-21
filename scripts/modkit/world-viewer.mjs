// Interactive view uses ModKit's existing world renderer, camera and picking implementation.
import {createWorldWebGlRenderer,DEFAULT_WORLD_WEBGL_CAMERA,panWorldWebGlCamera,zoomWorldWebGlCamera} from '@modkit/scene/world';

export function mount(input,summary) {
  const {document,ResizeObserver}=globalThis;
  const canvas=document.querySelector('canvas'),status=document.querySelector('#status'),picked=document.querySelector('#picked');
  const renderer=createWorldWebGlRenderer(canvas);
  if(!renderer){status.textContent="WebGL2 is unavailable. PNG remains available.";return;}
  const initialCamera=input.camera??{...DEFAULT_WORLD_WEBGL_CAMERA};
  let camera={...initialCamera},selectedObjectId;
  const originalItems=input.items;
  function draw(){
    const ratio=Math.min(globalThis.devicePixelRatio||1,1.5),r=canvas.getBoundingClientRect();
    canvas.width=Math.max(1,Math.round(r.width*ratio));canvas.height=Math.max(1,Math.round(r.height*ratio));
    const stats=renderer.draw({...input,camera,selectedObjectId});
    status.textContent=`ModKit WebGL · ${summary.models.converted}/${summary.models.total} models ${summary.terrainTextures} soil-texture${summary.complete?'':" • partial scene"}`;
    return stats;
  }
  let drag;
  canvas.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,button:e.button};canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{
    if(!drag)return;
    const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
    if(drag.button===2||e.shiftKey)camera={...camera,azimuth:camera.azimuth-dx*.008,elevation:Math.max(.05,Math.min(1.55,camera.elevation+dy*.008))};
    else camera=panWorldWebGlCamera(input,camera,{x:dx,y:dy,viewportHeight:canvas.clientHeight});
    drag.x=e.clientX;drag.y=e.clientY;draw();
  });
  canvas.addEventListener('pointerup',e=>{
    if(drag&&Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)<4){
      const r=canvas.getBoundingClientRect();
      const hit=renderer.pick({...input,camera},{x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height,width:canvas.width,height:canvas.height});
      selectedObjectId=hit?.objectId;
      picked.textContent=hit?`${hit.kind}${hit.objectId===undefined?'':` #${hit.objectId}`} · ${hit.position.map(n=>n.toFixed(2)).join(', ')}`:"No choice.";draw();
    }drag=undefined;
  });
  canvas.addEventListener('pointercancel',()=>{drag=undefined;});
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  canvas.addEventListener('wheel',e=>{e.preventDefault();camera=zoomWorldWebGlCamera(camera,e.deltaY);draw();},{passive:false});
  document.querySelector('#reset').onclick=()=>{camera={...initialCamera};draw();};
  document.querySelector('#top').onclick=()=>{camera={...camera,elevation:Math.PI/2-.001};draw();};
  for(const box of document.querySelectorAll('[data-facet]'))box.onchange=()=>{
    const hidden=new Set([...document.querySelectorAll('[data-facet]')].filter(b=>!b.checked).map(b=>b.dataset.facet));
    input={...input,items:originalItems.filter(item=>!hidden.has(item.facet))};draw();
  };
  new ResizeObserver(draw).observe(canvas);
  globalThis.addEventListener('pagehide',()=>renderer.dispose(),{once:true});draw();
}
