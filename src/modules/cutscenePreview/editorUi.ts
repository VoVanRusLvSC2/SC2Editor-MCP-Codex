import type {PreviewScene, SceneCamera, PreviewLighting} from './types.js';
import type {createObjectInspector} from './objectInspector.js';
import type {createPreviewKernel} from './kernel.js';

/** Serializable UI controller. Every asset entry comes from the loaded scene. */
export function mountEditorUi(scene: PreviewScene, choose: (id: string) => void, action: (id: string) => void, inspector: ReturnType<typeof createObjectInspector>) {
    const tree = document.getElementById('scene-tree')!, assets = document.getElementById('asset-list')!;
    const search = document.getElementById('asset-search') as HTMLInputElement;
    const properties = document.getElementById('property-rows')!;
    let selected = 'director', tab = 'Models';
    const groups = [
        {name: 'Director', items: [{id: 'director', name: 'Director'}]},
        {name: 'Actors', items: scene.actors},
        {name: 'Cameras', items: scene.cameras},
        {name: 'Lights', items: [...(scene.environmentLights ?? []), ...(scene.lights ?? [])]},
        {name: 'Fog', items: scene.fog ?? []},
        {name: 'RTT', items: [...new Set(scene.rtt?.map(r => r.channel) ?? [])].map(channel => ({id: 'rtt:' + channel, name: 'RTT ' + channel}))},
    ];
    const button = (name: string, click: () => void) => {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = name; b.onclick = click; return b;
    };
    const sourceObjects=new Map((scene.sourceObjects??[]).map(n=>[n.id,n]));
    const represented=new Set(groups.flatMap(g=>g.items.map(n=>n.id)));
    function sourceBranch(id:string,seen:Set<string>):Element|undefined {
        const node=sourceObjects.get(id);if(!node||seen.has(id)||!node.tag.startsWith('CCutsceneNode'))return undefined;seen.add(id);
        const selectedId=node.tag==='CCutsceneNodeDirector'?'director':node.tag==='CCutsceneNodeRTTChannel'?'rtt:'+node.attrs.RTTChannel:represented.has(node.id)?node.id:'source:'+node.id;
        const selectButton=button(node.name,()=>choose(selectedId));selectButton.dataset.treeObject=selectedId;selectButton.title=node.tag;
        const children=node.children.filter(child=>sourceObjects.get(child)?.tag.startsWith('CCutsceneNode'));
        if(!children.length)return selectButton;
        const details=document.createElement('details'),summary=document.createElement('summary');summary.append(selectButton);details.append(summary);details.open=node.tag==='CCutsceneNodeDirector';
        for(const child of children){const branch=sourceBranch(child,seen);if(branch)details.append(branch);}
        return details;
    }
    if(sourceObjects.size){const seen=new Set<string>();for(const node of sourceObjects.values())if(!node.parent||sourceObjects.get(node.parent)?.tag==='CutsceneState'){const branch=sourceBranch(node.id,seen);if(branch)tree.append(branch);}}
    else for (const group of groups) {
        if (!group.items.length) continue;
        const details = document.createElement('details'), summary = document.createElement('summary');
        summary.textContent = group.name + ' (' + group.items.length + ')'; details.open = group.name === 'Director' || group.name === 'Actors';
        details.append(summary);
        for (const item of group.items) {
            const b = button(item.name, () => choose(item.id)); b.dataset.treeObject = item.id; details.append(b);
        }
        tree.append(details);
    }
    if(sourceObjects.size){const embedded=scene.cameras.filter(c=>c.rigObject);if(embedded.length){const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Встроенные камеры';details.append(summary);for(const camera of embedded){const b=button(camera.name,()=>choose(camera.id));b.dataset.treeObject=camera.id;details.append(b);}tree.append(details);}}
    const sceneButton = button(scene.file.split(/[\\/]/).at(-1) ?? scene.file, () => action('director'));
    sceneButton.title = scene.file; document.getElementById('scene-list')!.append(sceneButton);
    function assetRows() {
        const query = search.value.trim().toLowerCase(); assets.replaceChildren();
        const rows: Array<{label: string; title: string; id?: string; time?: number}> = tab === 'Models' ? scene.actors.filter(a => a.model).map(a => ({label: a.name, title: a.model!, id: a.id}))
            : tab === 'Sounds' ? (scene.speech ?? []).map(s => ({label: s.speaker ? s.speaker + ' · ' + s.soundLink : s.soundLink, title: s.soundLink, time: s.start}))
            : tab === 'Conversations' ? (scene.drivers ?? []).map(d => ({label: d.conversation + ' · ' + d.line, title: d.conversation, time: d.start}))
            : scene.references.map(r => ({label: r.file.split(/[\\/]/).at(-1) ?? r.file, title: r.file}));
        for (const row of rows.filter(r => (r.label + ' ' + r.title).toLowerCase().includes(query))) {
            const b = button(row.label, () => {
                if (row.id !== undefined) choose(row.id);
                else if (row.time !== undefined) action('seek:' + row.time);
                else {document.getElementById('asset-path')!.textContent = row.title;}
            });
            b.title = row.title; assets.append(b);
        }
        if (!assets.childNodes.length) {const empty = document.createElement('p'); empty.textContent = 'Нет записей'; assets.append(empty);}
    }
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-asset-tab]')) b.onclick = () => {
        tab = b.dataset.assetTab!;
        for (const other of document.querySelectorAll('[data-asset-tab]')) other.setAttribute('aria-selected', String(other === b));
        assetRows();
    };
    search.oninput = assetRows; assetRows();
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-editor-action]')) b.onclick = () => {
        b.closest('details')?.removeAttribute('open'); action(b.dataset.editorAction!);
    };
    function select(id: string) {
        selected = id;
        for (const b of tree.querySelectorAll<HTMLButtonElement>('[data-tree-object]')) {
            b.setAttribute('aria-pressed', String(b.dataset.treeObject === id));
        }
    }
    const propertySearch=document.getElementById('property-search') as HTMLInputElement|null,authoredOnly=document.getElementById('property-authored-only') as HTMLInputElement|null;
    let last:{state:ReturnType<ReturnType<typeof createPreviewKernel>['sample']>;camera:SceneCamera;light:PreviewLighting}|undefined,signature='';
    let cells:Array<{row:HTMLTableRowElement;value:HTMLTableCellElement}>=[];
    function update(state:ReturnType<ReturnType<typeof createPreviewKernel>['sample']>, camera:SceneCamera, light:PreviewLighting) {
        last={state,camera,light};
        const query=(propertySearch?.value??'').toLowerCase(),rows=inspector.rows(scene,state,selected,camera,light).filter(r=>(!authoredOnly?.checked||r.kind!=='runtime')&&(!query||(r.group+' '+r.name+' '+r.value).toLowerCase().includes(query)));
        const key=JSON.stringify([selected,query,!!authoredOnly?.checked,rows.map(r=>[r.group,r.name])]);
        if(signature!==key){signature=key;properties.replaceChildren();cells=[];let group='';
            for(const entry of rows){if(entry.group!==group){group=entry.group;const tr=document.createElement('tr'),th=document.createElement('th');th.setAttribute('colspan','2');th.textContent=group;tr.className='property-group';tr.append(th);properties.append(tr);}
                const tr=document.createElement('tr'),name=document.createElement('td'),value=document.createElement('td');name.textContent=entry.name;tr.append(name,value);properties.append(tr);cells.push({row:tr,value});
            }
        }
        rows.forEach((entry,i)=>{const cell=cells[i];if(cell.value.textContent!==entry.value)cell.value.textContent=entry.value;const state=entry.changed?'changed':entry.kind;if(cell.row.getAttribute('data-property-state')!==state)cell.row.setAttribute('data-property-state',state);const title=entry.authored!==undefined?'В катсцене: '+entry.authored:'';if(cell.value.title!==title)cell.value.title=title;});
        const summary=document.getElementById('property-summary');if(summary)summary.textContent=String(rows.length);
        document.getElementById('current-light')!.textContent=light.preset;
    }
    for(const input of [propertySearch,authoredOnly])if(input)input.oninput=()=>{signature='';if(last)update(last.state,last.camera,last.light);};
    select('director');
    return {select, update};
}

export const editorUiCss = `
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;height:100vh;overflow:hidden;display:flex;flex-direction:column;background:#101923;color:#dfedfa;font:12px "Segoe UI",Arial,sans-serif}
button,select,input{font:inherit}button,select{color:#dfedfa;border:1px solid #42657e;border-radius:2px;background:linear-gradient(#2c4c66,#203b53);padding:4px 7px;margin:0}button{cursor:pointer}button:hover{background:#345977;border-color:#79c7f3}button[aria-pressed=true],button[aria-selected=true]{background:#345977;border-color:#79c7f3}button:disabled,select:disabled{opacity:.55;cursor:default}
header{flex:0 0 auto;border-bottom:1px solid #2e465c;background:#101923}.editor-title{padding:4px 10px;display:flex;gap:12px;align-items:center;background:#142231}.editor-title h1{font-size:12px;font-weight:500;margin:0;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;flex:1}.editor-menus{display:flex;gap:0;border-bottom:1px solid #436074;padding:0 7px}.editor-menus details{position:relative}.editor-menus summary{padding:4px 9px;cursor:pointer;list-style:none}.editor-menus details[open]{background:#23465f}.menu-popover{position:absolute;left:0;top:100%;min-width:160px;z-index:20;background:#172737;box-shadow:2px 3px 8px #0005;border:1px solid #42657e;padding:4px}.menu-popover button{display:block;width:100%;text-align:left;border:0;background:none;padding:6px}.editor-toolbar{display:flex;align-items:center;gap:5px;padding:5px 8px;flex-wrap:wrap}.editor-toolbar label{display:flex;align-items:center;gap:3px;white-space:nowrap}.editor-toolbar select#camera{max-width:350px}.editor-toolbar input[type=checkbox]{width:auto}.editor-toolbar #filters{width:90px}.editor-toolbar #play{color:#b4e7fa;font-weight:bold}
main{display:grid;grid-template-columns:230px minmax(0,1fr) 320px;min-height:180px;flex:1 1 0;overflow:hidden;gap:4px;padding:4px}.asset-browser,.inspector{min-width:0;overflow:auto;background:#172737;border:1px solid #42657e}.asset-tabs{display:flex;gap:0;padding:3px;border-bottom:1px solid #436074}.asset-tabs button{padding:4px 5px;flex:1;font-size:11px}.asset-browser input{margin:4px;width:calc(100% - 8px);padding:4px;border:1px solid #436074}.asset-section{border-top:1px solid #2e465c;padding:5px;background:#203343}.asset-list{max-height:24vh;overflow:auto;background:#142332;min-height:45px}.asset-list button,#scene-list button{display:block;width:100%;border:0;border-radius:0;text-align:left;background:none;padding:4px 7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.asset-list button:hover,#scene-list button:hover{background:#345977}#asset-path{padding:4px;overflow-wrap:anywhere;color:#a9c2d8;font-size:10px}#scene-tree{padding:3px;overflow:auto}#scene-tree summary{padding:3px;cursor:pointer}#scene-tree button{display:block;margin-left:15px;max-width:calc(100% - 15px);border:0;background:none;text-align:left;padding:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#scene-tree button[aria-pressed=true]{background:#345977}
.viewport{position:relative;overflow:hidden;min-width:0;min-height:0;background:#08090b;display:grid;place-items:center;border:1px solid #436074}#render-surface{position:relative;overflow:hidden;max-width:100%;max-height:100%}canvas{display:block;width:100%;height:100%;touch-action:none}#viewport-hud{position:absolute;top:5px;left:7px;right:7px;display:flex;justify-content:space-between;color:white;font:11px monospace;text-shadow:0 1px 3px #000;pointer-events:none;z-index:3}.aspect-guide{position:absolute;border:1px solid #fffd;pointer-events:none;z-index:2;box-shadow:0 0 1px #000}.aspect-guide span{position:absolute;bottom:3px;right:4px;color:white;font:10px monospace;text-shadow:0 1px 2px #000}.aspect-guide[hidden]{display:none}#subtitle{position:absolute;bottom:15px;left:7%;width:86%;max-height:35%;overflow:hidden;text-align:center;white-space:pre-wrap;background:linear-gradient(90deg,#0000,#0009 12%,#0009 88%,#0000);color:#edf3fb;padding:8px 15px;font:clamp(13px,1.15vw,18px)/1.4 "Segoe UI",sans-serif;text-shadow:0 1px 3px #000;pointer-events:none}.subtitle-speaker{color:#b4e7fa;font-weight:600}
.inspector{padding:0}.inspector-title{padding:5px;border-bottom:1px solid #436074;background:#203343}.inspector-controls{padding:5px;display:grid;gap:4px}.inspector-controls select{width:100%}.inspector-controls label{display:flex;align-items:center;gap:4px}table.properties{width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed}.properties th,.properties td{padding:4px;border:1px solid #2b4256;vertical-align:top;text-align:left;overflow-wrap:anywhere}.properties th{background:#203343;font-weight:400}.properties td:first-child{color:#a9c2d8;width:47%}.inspector details{margin:6px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:11px "Segoe UI";margin:5px}#active{max-height:80px;overflow:auto;color:#a9c2d8}
footer{flex:0 0 auto;padding:3px 8px;background:#203343;border-top:1px solid #436074}footer input{width:100%;accent-color:#65d8ff}footer p{margin:2px 0;font-size:11px}footer .note{font-size:10px;color:#e6bc75}#status{padding:4px 8px;font-size:11px;border-top:1px solid #436074;background:#172737;flex:0 0 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.frame-options{display:flex;align-items:center;gap:7px}#loading-widget{display:inline-flex;align-items:center;gap:5px;font-size:11px}#loading-progress{width:95px;height:10px}#loading-overlay{position:absolute;inset:0;display:grid;place-content:center;background:#101923ed;color:white;z-index:9;font-size:16px}#loading-overlay[hidden]{display:none}body.hide-assets main{grid-template-columns:minmax(0,1fr) 255px}body.hide-assets .asset-browser{display:none}body.hide-properties main{grid-template-columns:230px minmax(0,1fr)}body.hide-properties .inspector{display:none}body.hide-assets.hide-properties main{grid-template-columns:minmax(0,1fr)}body.hide-timeline #timeline{display:none}
#timeline{background:#111d29;color:#dfedfa;border-color:#42657e;height:225px;min-height:130px}.timeline-toolbar{background:#203343;padding:4px 8px}.timeline-label{background:#1b2a39;border-color:#436074;color:#dfedfa}.timeline-label button{color:#dfedfa}.timeline-label button:hover{background:#345977}.timeline-lane{background:repeating-linear-gradient(90deg,transparent 0,transparent 99px,#2e465c 100px)}.timeline-row{border-color:#436074}.ruler-row .timeline-lane{background:#203343}.ruler-tick{color:#c9ddea;border-color:#436074}.timeline-clip{background:#245f82;color:#dfedfa;border-color:#4c9bc9;border-radius:0;box-shadow:none}.timeline-clip.active{background:#307caf;border-color:#79c7f3}.camera-clip{background:#615480;border-color:#a393be}.timeline-clip.lifetime{background:#283f52;color:#91a5b8}.timeline-key{color:#e5b568}.actor-row.selected .timeline-label,.timeline-row.selected .timeline-label,.timeline-label.selected{background:#345977}.timeline-label button[aria-pressed=true]{color:#83ddff}.layer-label{color:#a9c2d8}#timeline-cursor{background:#e22626}#timeline-cursor i{border-top-color:#e22626}.timeline-toolbar button{color:#b4e7fa}
.inspector{display:flex;flex-direction:column;overflow:hidden}.inspector-title{flex:0 0 auto;font-weight:600}.inspector-title small{float:right;color:#a9c2d8}.property-filters{display:grid;gap:4px;padding:5px;border-bottom:1px solid #436074}.property-filters input[type=search]{width:100%;padding:4px;color:#dfedfa;background:#101923;border:1px solid #42657e}.property-filters label{font-size:11px}.properties-scroll{overflow:auto;flex:1;min-height:90px}.properties thead{position:sticky;top:0;z-index:1}.properties .property-group th{background:#203343;color:#b4e7fa;overflow-wrap:anywhere}.properties tr[data-property-state=changed] td:last-child{color:#ffdc8b}.properties tr[data-property-state=animated] td:last-child{color:#83ddff}.properties tr[data-property-state=unresolved] td:last-child{color:#e6bc75}.properties tr[data-property-state=runtime] td{color:#a9c2d8}#scene-tree summary>button{display:inline-block;margin-left:0;max-width:calc(100% - 18px)}
.timeline-clip.selected-property{outline:1px solid #ffdc8b;outline-offset:-2px;z-index:4}
@media(max-width:1100px){main{grid-template-columns:180px minmax(0,1fr) 220px}.editor-toolbar select#camera{max-width:260px}}@media(max-width:800px){main{grid-template-columns:minmax(0,1fr) 210px}.asset-browser{display:none}.editor-toolbar select#camera{max-width:220px}.timeline-toolbar small{display:none}.editor-title .frame-options{display:none}}@media(max-width:550px){main{grid-template-columns:minmax(0,1fr)}.inspector{display:none}.editor-toolbar{gap:3px}}
`;
