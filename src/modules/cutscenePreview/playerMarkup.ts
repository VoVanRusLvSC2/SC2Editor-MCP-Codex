import type {PreviewScene} from './types.js';
import {timelineMarkup, timelineCss} from './timeline.js';
import {editorUiCss} from './editorUi.js';

export function playerMarkup(scene: PreviewScene, dataScripts: string, bootstrapScript: string) {
    const esc = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
    return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; media-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width"><title>Cutscenes — ${esc(scene.file)}</title>
<style>${timelineCss}${editorUiCss}</style></head><body data-renderer="v42">
<header>
    <div class="editor-title"><h1>Cutscenes · ${esc(scene.file)}</h1><span id="loading-widget"><progress id="loading-progress" max="100" value="0" aria-label="Загрузка плеера"></progress><span id="loading-label" role="status">0% · Чтение файла</span></span></div>
    <nav class="editor-menus" aria-label="Меню катсцены">
        <details><summary>View</summary><div class="menu-popover"><button data-editor-action="assets">Панель ресурсов</button><button data-editor-action="properties">Панель свойств</button><button data-editor-action="timeline">Таймлайн</button><button data-editor-action="director">Director · D</button><button data-editor-action="reset">Общий план</button></div></details>
        <details><summary>Render</summary><div class="menu-popover"><button data-editor-action="solid">Материалы</button><button data-editor-action="wireframe">Каркас</button><button data-editor-action="skeleton">Скелет</button><button data-editor-action="shot">Сохранить кадр</button></div></details>
        <details><summary>Animation</summary><div class="menu-popover"><button data-editor-action="play">Воспроизведение · Space</button><button data-editor-action="start">В начало · Home</button><button data-editor-action="end">В конец · End</button></div></details>
    </nav>
    <div class="editor-toolbar">
        <button id="play">▶ Воспроизвести</button><select id="camera" aria-label="Камера"></select>
        <select id="mode" aria-label="Режим рендера"><option value="solid">Материалы</option><option value="wireframe">Каркас</option><option value="skeleton">Скелет</option></select>
        <select id="speed" aria-label="Скорость"><option value=".25">0.25×</option><option value=".5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select>
        <label><input id="sound" type="checkbox" checked>Звук</label><label><input id="subtitles" type="checkbox" checked>Субтитры</label><label><input id="effects" type="checkbox" checked>Эффекты</label><label><input id="scene-loop" type="checkbox">Повтор</label>
        <label>Фильтры <input id="filters" placeholder="red, win"></label><label title="Видимость объектов с native флагом Guide"><input id="guides" type="checkbox" checked>Guide</label>
        <button id="reset">Общий план</button><button id="shot">Сохранить кадр</button>
    </div>
    <div class="editor-toolbar">
        <label>Кадр <select id="output-aspect" aria-label="Соотношение сторон кадра"><option value="viewport">По окну</option><option value="1.7777777777777777" selected>16:9</option><option value="1.6">16:10</option></select></label>
        <label><input id="guide-169" type="checkbox" checked>Рамка 16:9</label><label><input id="guide-1610" type="checkbox">Рамка 16:10</label>
        <label>Разрешение <select id="render-scale" aria-label="Масштаб разрешения"><option value="1" selected>100%</option><option value=".75">75%</option><option value=".5">50%</option></select></label>
        <span>Lighting: <output id="current-light">${esc(scene.lighting?.preset ?? 'DefaultLight')}</output></span>
    </div>
</header>
<main>
    <aside class="asset-browser" aria-label="Ресурсы и объекты сцены">
        <div class="asset-tabs" role="tablist" aria-label="Тип ресурса">${['Models', 'Sounds', 'Files', 'Conversations'].map((name, i) => `<button role="tab" data-asset-tab="${name}" aria-selected="${i === 0}">${name}</button>`).join('')}</div>
        <input id="asset-search" type="search" aria-label="Поиск ресурса" placeholder="Найти ресурс…"><div id="asset-list" class="asset-list" role="tabpanel"></div><div id="asset-path"></div>
        <div class="asset-section">Cutscene</div><div id="scene-list"></div><div class="asset-section">Scene Objects</div><div id="scene-tree"></div>
    </aside>
    <section class="viewport" aria-label="Director viewport">
        <div id="render-surface"><canvas id="scene"></canvas><div id="viewport-hud"><span id="viewport-camera">Director</span><time id="viewport-clock">00:00:00.000</time></div><div id="aspect-169" class="aspect-guide"><span>16:9</span></div><div id="aspect-1610" class="aspect-guide" hidden><span>16:10</span></div><div id="subtitle" aria-live="polite" hidden></div></div>
        <div id="loading-overlay" role="status">0% · Чтение файла</div>
    </section>
    <aside class="inspector" aria-label="Свойства объекта">
        <div class="inspector-title">Свойства объекта <small id="property-summary"></small></div><div class="inspector-controls"><select id="actor" aria-label="Объект"></select><select id="clip" aria-label="Анимация"><option value="">Клип по таймлайну</option></select><label><input id="isolate" type="checkbox">Только выбранный</label><button id="view-camera" hidden>Смотреть через камеру</button></div>
        <div class="property-filters"><input id="property-search" type="search" aria-label="Поиск свойства" placeholder="Найти свойство…"><label><input id="property-authored-only" type="checkbox" checked>Заданные в катсцене</label></div><div class="properties-scroll"><table class="properties"><thead><tr><th>Property</th><th>Value</th></tr></thead><tbody id="property-rows"></tbody></table></div>
        <details><summary>Исходные свойства</summary><pre id="object-info"></pre></details><output id="playback-event" aria-live="polite"></output><pre id="active"></pre><details><summary>Диагностика: ${scene.issues.length}</summary><pre>${esc(JSON.stringify(scene.issues, null, 2))}</pre></details>
    </aside>
</main>
<footer><input id="time" type="range" aria-label="Время сцены" min="0" step="1" value="0"><b id="stamp"></b><p>Мышь: вращение · колесо: отдаление от текущей камеры · D: Director</p><small class="note">WebGL2 · материалы из CASC · SC2 Key/Fill/Back · Fog/Light/RTT. HDR/Bloom/DOF/AO приблизительные; тени и совпадение с движком SC2 не подтверждены.</small></footer>
${timelineMarkup(scene)}<output id="status" role="status">Подготовка WebGL2…</output>
${dataScripts}<script>${bootstrapScript}</script></body></html>`;
}
