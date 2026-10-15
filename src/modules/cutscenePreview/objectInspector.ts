import type {PreviewScene, SceneCamera, PreviewLighting, Curve, SceneSourceObject} from './types.js';
import type {createPreviewKernel} from './kernel.js';

export interface InspectorRow {name:string;value:string;authored?:string;kind:'authored'|'animated'|'runtime'|'unresolved';changed:boolean;group:string}

/** Pure inspection of preserved XML and the same sampled values used by playback. */
export function createObjectInspector(k:ReturnType<typeof createPreviewKernel>) {
    const indexes = new WeakMap<PreviewScene, Map<string,SceneSourceObject>>();
    const authoredRows = new WeakMap<SceneSourceObject,InspectorRow[]>();
    function sourceIndex(scene:PreviewScene) {
        let index=indexes.get(scene);
        if(!index){index=new Map((scene.sourceObjects??[]).map(n=>[n.id,n]));indexes.set(scene,index);}
        return index;
    }
    const format=(value:unknown):string=>typeof value==='number'?String(Number(value.toFixed(6))):Array.isArray(value)?value.map(v=>typeof v==='number'?Number(v.toFixed(6)):v).join(', '):typeof value==='object'?JSON.stringify(value):String(value??'');
    function rows(scene:PreviewScene,state:ReturnType<typeof k.sample>,selected:string,camera:SceneCamera,light:PreviewLighting):InspectorRow[] {
        const id=selected.startsWith('source:')?selected.slice(7):selected,index=sourceIndex(scene);
        const source=selected==='director'?(scene.sourceObjects??[]).find(n=>n.tag==='CCutsceneNodeDirector'):selected.startsWith('rtt:')?(scene.sourceObjects??[]).find(n=>n.tag==='CCutsceneNodeRTTChannel'&&n.attrs.RTTChannel===selected.slice(4)):index.get(id);
        const parsed=[...scene.actors,...scene.cameras,...(scene.lights??[]),...(scene.fog??[]),...(scene.environmentLights??[]),...(scene.texts??[]),...(scene.paths??[]),...(scene.speech??[])].find(n=>n.id===id||n.sourceObjectId===id);
        const output:InspectorRow[]=[],byName=new Map<string,InspectorRow>();
        const add=(name:string,value:unknown,kind:InspectorRow['kind'],group:string,authored?:string)=>{const row={name,value:format(value),kind,group,authored,changed:false};output.push(row);byName.set(name,row);return row;};
        if(source)for(const [name,value]of Object.entries(source.attrs))add(name,value,'authored','Свойства катсцены',value);
        else if(parsed)for(const [name,value]of Object.entries(parsed))if(value!==undefined&&!['curves','clips','attachments','lookAts','followPaths'].includes(name))add(name,value,'runtime','Значения предпросмотра');
        const curves=(parsed as {curves?:Curve[]}|undefined)?.curves??[];
        for(const curve of curves){
            const value=k.curve(curve,state.time,state.settings,state.activeShot);
            let row=byName.get(curve.property);
            if(value===undefined){if(!row)add(curve.property,'Не вычисляется на этом кадре','unresolved','Анимация');continue;}
            if(!row)row=add(curve.property,value,'animated','Анимация');
            else{row.value=format(value);row.kind='animated';row.changed=row.authored===undefined||!Number.isFinite(Number(row.authored))||Math.abs(Number(row.authored)-value)>1e-7;}
            // Native vectors can serialize as one attribute while curves use scalar aliases.
            const match=curve.property.match(/^(position|rotation|scale|teamColorDiffuse|teamColorEmissive|tintColor|fogColor|ambientColor|(?:key|fill|back)(?:DiffuseColor|SpecularColor|Direction))(X|Y|Z|Red|Green|Blue|R|G|B)$/);
            if(match){const vector=byName.get(match[1]),component=({X:0,Y:1,Z:2,Red:0,Green:1,Blue:2,R:0,G:1,B:2} as Record<string,number>)[match[2]];
                if(vector){const values=vector.value.split(',').map(Number);if(values.length>component&&values.every(Number.isFinite)){values[component]=value;vector.value=format(values);vector.kind='animated';const authored=vector.authored?.split(',').map(Number);vector.changed=!authored||authored.length!==values.length||values.some((v,i)=>Math.abs(v-authored[i])>1e-7);}}
            }
        }
        if(source){
            let nested=authoredRows.get(source);
            if(!nested){
                nested=[];
                // Iterative traversal retains every nested field, including property-track
                // flags and key handles. Independent scene objects have their own inspector.
                const stack=source.children.map(id=>({id,group:source.name})).reverse(),seen=new Set<string>();
                while(stack.length){const item=stack.pop()!,child=index.get(item.id);if(!child||seen.has(child.id)||(/^CCutsceneNode/.test(child.tag)&&!/^CCutsceneNode(?:PropertyValue|AnimLayer)$/.test(child.tag)))continue;seen.add(child.id);
                    const at=child.attrs.time??child.attrs.start,group=item.group+' / '+child.name+(at!==undefined?' @ '+at:'');
                    for(const [name,value]of Object.entries(child.attrs))nested.push({name,value,authored:value,kind:'authored',changed:false,group});
                    for(const id of [...child.children].reverse())stack.push({id,group});
                }
                authoredRows.set(source,nested);
            }
            output.push(...nested);
        }
        const entry=state.actors.find(e=>e.actor.id===id);
        if(entry){add('visibleNow',entry.visible,'runtime','Текущий кадр');add('worldPosition',entry.matrix.slice(12,15),'runtime','Текущий кадр');add('activeAnimations',entry.layers.map(l=>l.name),'runtime','Текущий кадр');}
        if(selected==='director'){add('activeCamera',camera.name,'runtime','Director');add('nativeTicks',Math.round(state.time),'runtime','Director');add('light',light.preset,'runtime','Director');add('exposure',light.parameters?.HDRExposure??1,'runtime','Director');}
        if(selected.startsWith('rtt:'))for(const r of scene.rtt?.filter(r=>'rtt:'+r.channel===selected)??[])for(const [name,value]of Object.entries(r))add(name,value,'runtime','RTT '+r.start+'–'+r.end);
        if(!output.length&&selected!=='all')add('id',id,'unresolved','Объект');
        add('Camera · FOV / near / far',camera.fov.toFixed(3)+'° '+(camera.vertical?'V':'H')+' / '+camera.near.toFixed(4)+' / '+camera.far.toFixed(2),'runtime','Камера просмотра');
        return output;
    }
    return {rows};
}
