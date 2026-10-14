import {scanXml} from '../../core/xmlScanner.js';
export const manualCoverage={
  "schemaVersion": 1,
  "manual": {
    "url": "http://us.media.blizzard.com/starcraft2/downloads/tutorial/SCII-CutsceneEditorInstructions.pdf",
    "sha256": "0c2e97c690e1e4e144b939ee681b52dd967b03ed52a10466295dd13a1f163c28",
    "pages": 35,
    "bytes": 1342360
  },
  "features": [
    {
      "id": "workspace",
      "pages": [
        1,
        3,
        6,
        27
      ],
      "title": "XML, файлы и безопасное сохранение",
      "status": "supported",
      "scope": "MCP создаёт, читает, изменяет, сохраняет и экспортирует XML; staged save и guards.",
      "proof": "src/tests/cutsceneWorkspace.test.ts"
    },
    {
      "id": "library",
      "pages": [
        2
      ],
      "title": "Библиотека данных и CASC",
      "status": "partial",
      "scope": "CASC metadata-only rig query; CModel inheritance and token PI Prefix/Race/id resolved; globally merge RequiredM3A for shared assets. Nested Sound/Conversation catalogs, defaults/tokens, FACE1731/1740 + localized FXE, direct CASC scenes supported; auxiliary bindings and native mix flags partial.",
      "proof": "src/tests/cutsceneConstraints.test.ts; CONSTRAINTS_ANIMATED_GPU_VERIFICATION.json; RUNTIME_GPU_VERIFICATION.json"
    },
    {
      "id": "panes",
      "pages": [
        1,
        2
      ],
      "title": "Окна, выбор сцены и несколько viewport",
      "status": "partial",
      "scope": "Одна сцена/один viewport в HTML; несколько ракурсов доступны последовательно. Мультиокна отсутствуют.",
      "proof": ""
    },
    {
      "id": "free-camera",
      "pages": [
        2,
        3
      ],
      "title": "Все схемы управления камерой",
      "status": "partial",
      "scope": "Orbit/zoom есть; truck, pan, mouse-look, roll, FOV и пользовательские профили горячих клавиш не совпадают с редактором.",
      "proof": ""
    },
    {
      "id": "previewer",
      "pages": [
        3
      ],
      "title": "Временная сцена Previewer",
      "status": "partial",
      "scope": "Отдельные HTML-артефакты; нет нативной несохраняемой сцены Previewer.",
      "proof": ""
    },
    {
      "id": "selection",
      "pages": [
        3,
        4,
        5
      ],
      "title": "Дерево, multi-select и совместимый copy/paste",
      "status": "partial",
      "scope": "В MCP есть clone и селекторы; в HTML один actor/solo. Проверка совместимых GUI-вставок и multi-select отсутствует.",
      "proof": ""
    },
    {
      "id": "timeline-view",
      "pages": [
        4
      ],
      "title": "Таймлайн: scrub/zoom/pan/range",
      "status": "supported",
      "scope": "Навигация и дорожки Actor/Animation/Director/Fog/Light/RTT/Fade/Bookmark/End.",
      "proof": "src/tests/cutsceneManual.test.ts"
    },
    {
      "id": "timeline-edit",
      "pages": [
        4,
        5
      ],
      "title": "Перемещение, resize и nudge элементов",
      "status": "missing",
      "scope": "MCP меняет атрибуты; HTML read-only. Arrow перемещает курсор, а не элемент.",
      "proof": ""
    },
    {
      "id": "timeline-conflicts",
      "pages": [
        5
      ],
      "title": "Запрет overlap, event collapse и paste overwrite",
      "status": "missing",
      "scope": "Нативный алгоритм конфликтов блоков не реализован.",
      "proof": ""
    },
    {
      "id": "ghost",
      "pages": [
        5
      ],
      "title": "Ghost Mode, временный режим, snap",
      "status": "missing",
      "scope": "Нет cut/overwrite при ghost drag; Alt-snap курсора не заменяет snap элементов.",
      "proof": ""
    },
    {
      "id": "locked-end",
      "pages": [
        5,
        6
      ],
      "title": "Locked to End и границы сцены",
      "status": "partial",
      "scope": "Окна lockedToEnd продлеваются к вычисленному duration; ограничения resize/nudge и поиск блокирующего конца не реализованы.",
      "proof": "src/tests/cutscenePreview.test.ts"
    },
    {
      "id": "galaxy",
      "pages": [
        6
      ],
      "title": "Запуск в игре и события каждому игроку",
      "status": "partial",
      "scope": "Генерация Create/LastCreated/Play по natives registry; preview не исполняет Galaxy и не рассылает события игрокам.",
      "proof": "src/modules/cutscene/runtime.ts"
    },
    {
      "id": "manipulators",
      "pages": [
        6,
        7
      ],
      "title": "Gizmo, Q/W/E/R, grid, eye/target",
      "status": "missing",
      "scope": "Transform через MCP есть; редактируемые viewport-манипуляторы отсутствуют.",
      "proof": ""
    },
    {
      "id": "transform",
      "pages": [
        6,
        7,
        29
      ],
      "title": "Position/Rotation/Scale",
      "status": "partial",
      "scope": "Z-up/XYZ Euler/factor scale; нативная конвенция ещё не сверена с движком.",
      "proof": "src/tests/cutscenePreview.test.ts"
    },
    {
      "id": "lifetime",
      "pages": [
        7
      ],
      "title": "Время существования actor",
      "status": "supported",
      "scope": "Отрисовка внутри окна жизни, disabled ancestor не исполняется.",
      "proof": "src/tests/cutscenePreview.test.ts"
    },
    {
      "id": "folders",
      "pages": [
        7,
        8
      ],
      "title": "Папки, Disabled и Visible",
      "status": "partial",
      "scope": "Наследуются enabled/visible; скрытый actor отключает загрузку ассета, разные semantics не полностью разделены.",
      "proof": ""
    },
    {
      "id": "guide-lock",
      "pages": [
        8
      ],
      "title": "Guide и Locked",
      "status": "partial",
      "scope": "XML сохраняется, Guide показывается и диагностируется; game-mode и редакторская блокировка команд отсутствуют.",
      "proof": ""
    },
    {
      "id": "animation",
      "pages": [
        8,
        9,
        30
      ],
      "title": "Animation layers, clip speed/offset/loop",
      "status": "partial",
      "scope": "Скелетные слои, priority, weighted fades, offset и speed есть; PlayOnce/RightAligned/автоматический movespeed не исполнены полностью.",
      "proof": "src/tests/cutscenePreview.test.ts"
    },
    {
      "id": "bone-blend",
      "pages": [
        8,
        9
      ],
      "title": "Partial animations и точное смешивание",
      "status": "partial",
      "scope": "Weighted local TRS/quaternion; нет bone masks, native additive/IK/partial inheritance.",
      "proof": "src/tests/cutscenePreview.test.ts"
    },
    {
      "id": "m3a",
      "pages": [
        9
      ],
      "title": "Добавление M3A всем экземплярам модели",
      "status": "partial",
      "scope": "RequiredAnims/OptionalAnims CModel подгружаются; отдельные M3A nodes и material/light tracks не завершены.",
      "proof": "src/tests/cutscenePreview.test.ts"
    },
    {
      "id": "camera-ui",
      "pages": [
        9,
        10
      ],
      "title": "Создание, live-edit и camera editor",
      "status": "partial",
      "scope": "MCP camera.create/pose/shot есть; V фокусирует список, D включает Director. Live-edit/Alt-V/DOF editor отсутствуют.",
      "proof": ""
    },
    {
      "id": "camera-pose",
      "pages": [
        10,
        32,
        33
      ],
      "title": "Game и Target: анимация положения и оптики",
      "status": "supported",
      "scope": "Yaw/Pitch/Distance и position для Game, eye/target для Target; FOV/roll/near/far.",
      "proof": "src/tests/cutsceneManual.test.ts"
    },
    {
      "id": "camera-dof",
      "pages": [
        10,
        32
      ],
      "title": "Depth of Field и shadow clip",
      "status": "missing",
      "scope": "Оптика DOF не рендерится, shadow clip не применяется.",
      "proof": ""
    },
    {
      "id": "aspect-guides",
      "pages": [
        10,
        11
      ],
      "title": "Director Window и aspect guides",
      "status": "partial",
      "scope": "Размер кадра в MCP; нет отдельного Director Window и наложения aspect guides.",
      "proof": ""
    },
    {
      "id": "director-cuts",
      "pages": [
        11,
        33
      ],
      "title": "Active Camera: объекты и embedded M3 CAM_",
      "status": "partial",
      "scope": "Ракурсы переключаются, animated CAM_ и pose проверены; native optical convention ещё без сравнения SC2.",
      "proof": "src/tests/cutscenePreview.test.ts"
    },
    {
      "id": "active-light",
      "pages": [
        12,
        17,
        18,
        33
      ],
      "title": "Active Light и Environment Light 80+ properties",
      "status": "partial",
      "scope": "Director EnvironmentLight/LightData presets and index, animated Key/Fill/Back/ambient and blending. GPU floating scene target, approximate exposure/bloom/DOF/AO/colorization; shadows, distortion and exact tone/optics unvalidated.",
      "proof": "src/tests/cutsceneConstraints.test.ts; CONSTRAINTS_ANIMATED_GPU_VERIFICATION.json; RUNTIME_GPU_VERIFICATION.json"
    },
    {
      "id": "fade",
      "pages": [
        12,
        33
      ],
      "title": "Director Fade",
      "status": "supported",
      "scope": "Amount/unfadedAmount, fadeIn/out, color, hold и priority; GPU и software имеют общий расчёт.",
      "proof": "src/tests/cutsceneManual.test.ts"
    },
    {
      "id": "end",
      "pages": [
        12
      ],
      "title": "End Scene / subscene",
      "status": "supported",
      "scope": "Переход через ближайший End marker завершает цикл, overshoot сохраняется; несколько markers.",
      "proof": "src/tests/cutsceneManual.test.ts"
    },
    {
      "id": "bookmark",
      "pages": [
        13,
        34
      ],
      "title": "Закладки: jump/pause и навигация",
      "status": "supported",
      "scope": "Локальный transport выполняет jump/pause; Shift+PageUp/Down. Это не Galaxy trigger dispatch.",
      "proof": "src/tests/cutsceneManual.test.ts"
    },
    {
      "id": "master-sound",
      "pages": [
        13
      ],
      "title": "Синхронизация Master Sound",
      "status": "missing",
      "scope": "Нет звукового master-clock.",
      "proof": ""
    },
    {
      "id": "property-sheet",
      "pages": [
        13,
        14
      ],
      "title": "Все property sheets и анимация почти всех полей",
      "status": "partial",
      "scope": "MCP registry + property.animate. Preview поддерживает ограниченный список scalar properties; остальные диагностируются.",
      "proof": ""
    },
    {
      "id": "autokey",
      "pages": [
        14
      ],
      "title": "Auto Key",
      "status": "missing",
      "scope": "Нет автоматического создания/слияния keys при viewport edit.",
      "proof": ""
    },
    {
      "id": "curve-editor",
      "pages": [
        14,
        15
      ],
      "title": "Curve Editor, duplicate, fitting, in/out tangents",
      "status": "missing",
      "scope": "Нет редактируемого curve viewport.",
      "proof": ""
    },
    {
      "id": "curves",
      "pages": [
        14,
        15,
        32,
        34
      ],
      "title": "Smooth/Linear/Slow/Step/Custom/Auto кривые",
      "status": "partial",
      "scope": "Linear и Step исполняются; отсутствие curve type даёт Linear. Numeric IDs не восстановлены, Custom/Auto/другие tangents не эмулируются.",
      "proof": "src/tests/cutsceneManual.test.ts"
    },
    {
      "id": "local-light",
      "pages": [
        15,
        16,
        17,
        34
      ],
      "title": "Omni/Spot: цвет, дальность, конус и specular",
      "status": "partial",
      "scope": "До 8 local/model lights, animated scalar refs; target/eye convention, AO, shadow and quality gates не полностью реализованы.",
      "proof": "src/tests/cutscenePreview.test.ts"
    },
    {
      "id": "light-shadow",
      "pages": [
        16,
        17,
        34
      ],
      "title": "AO и spot shadows",
      "status": "missing",
      "scope": "Нет SSAO/native shadow maps.",
      "proof": ""
    },
    {
      "id": "sound",
      "pages": [
        18,
        19,
        32
      ],
      "title": "Звуки, вариации, pitch, volume, 3D",
      "status": "partial",
      "scope": "Embedded CASC SoundData assets; deterministic variation, locale, pause/seek/speed, volume/pitch and WebAudio 2D/3D. IMA/DVI ADPCM WAVE preview transcodes to PCM16. Native mixer/envelopes/flags and MasterSound still incomplete.",
      "proof": ""
    },
    {
      "id": "text",
      "pages": [
        19,
        35
      ],
      "title": "World text, dynamic tags, color/image markup",
      "status": "partial",
      "scope": "GPU/PNG world billboard text, depth, lifetime, attachments, color/opacity, stepped text and (time)/(frame). Arial approximates native font; rich inline image/style shaping incomplete.",
      "proof": "src/tests/cutsceneConstraints.test.ts; CONSTRAINTS_ANIMATED_GPU_VERIFICATION.json; RUNTIME_GPU_VERIFICATION.json"
    },
    {
      "id": "conversation",
      "pages": [
        19,
        20,
        31,
        35
      ],
      "title": "Conversation, facial FXA, subtitles, driver/import",
      "status": "partial",
      "scope": "ConversationLink/Line catalogs resolve localized VO/FXE/subtitles and Character names. FACE1731/1740 multi-group compiled graphs and Hermite bone deltas; MasterSound clock and linked localized durations. Driver emits crossed line records including loops. Branch/import actions, M3 auxiliary bindings, full mixer semantics remain partial.",
      "proof": ""
    },
    {
      "id": "attachment",
      "pages": [
        20,
        21,
        31
      ],
      "title": "Attachment points, timed offsets, scale/visibility",
      "status": "partial",
      "scope": "Timed Actor/Light/Camera/Text attachments: native M3 sites, offsets, scale/visibility, chains/cycles; documented raw-file rules. Generic native object families and engine parity require further work.",
      "proof": "src/tests/cutsceneConstraints.test.ts; CONSTRAINTS_ANIMATED_GPU_VERIFICATION.json; RUNTIME_GPU_VERIFICATION.json"
    },
    {
      "id": "look-at",
      "pages": [
        21,
        22,
        30
      ],
      "title": "Head/Eye Look At и blend styles",
      "status": "partial",
      "scope": "Actual M3 Head/Chest/EyeLeft/EyeRight groups and GameUI styles, weights, angle limits, start/stop, IgnoreEyes, and skinning on top of M3A. Rate/quat_up/main group semantics and engine comparison remain unverified.",
      "proof": "src/tests/cutsceneConstraints.test.ts; CONSTRAINTS_ANIMATED_GPU_VERIFICATION.json; RUNTIME_GPU_VERIFICATION.json"
    },
    {
      "id": "path",
      "pages": [
        22,
        23,
        31,
        34
      ],
      "title": "Path markers, tangents и Follow Path",
      "status": "partial",
      "scope": "Native markers, polyline arc length, animation/object movement speed integration, AlwaysPointUp and offsets. Native tangent variants/terrain snapping remain incomplete; end position holds in preview.",
      "proof": "src/tests/cutsceneConstraints.test.ts; CONSTRAINTS_ANIMATED_GPU_VERIFICATION.json; RUNTIME_GPU_VERIFICATION.json"
    },
    {
      "id": "terrain",
      "pages": [
        23,
        27,
        29
      ],
      "title": "Map import, terrain snapping и Fog of War",
      "status": "missing",
      "scope": "Terrain/placed map objects не импортируются; BlendToTerrain и FOW не исполняются.",
      "proof": ""
    },
    {
      "id": "active-shot",
      "pages": [
        23
      ],
      "title": "Active For Shot",
      "status": "supported",
      "scope": "Director shot visibility independent of observer camera; preserves hidden-but-alive hosts and InheritVisibility=false.",
      "proof": "src/tests/cutsceneConstraints.test.ts; CONSTRAINTS_ANIMATED_GPU_VERIFICATION.json; RUNTIME_GPU_VERIFICATION.json"
    },
    {
      "id": "filters",
      "pages": [
        23,
        28
      ],
      "title": "Filters per player, Filter Test",
      "status": "supported",
      "scope": "Inherited OR clauses and ancestor AND, multi-filter preview, bookmark add/remove filters; local preview, not per-player Galaxy simulation.",
      "proof": "src/tests/cutsceneConstraints.test.ts; CONSTRAINTS_ANIMATED_GPU_VERIFICATION.json; RUNTIME_GPU_VERIFICATION.json"
    },
    {
      "id": "fog",
      "pages": [
        24,
        35
      ],
      "title": "Анимируемый Fog",
      "status": "partial",
      "scope": "Density default 0, color/startHeight/falloff, lifetime; формула approximate, engine image parity не доказана.",
      "proof": "src/tests/cutscenePreview.test.ts"
    },
    {
      "id": "rtt",
      "pages": [
        24,
        35
      ],
      "title": "7 RTT channels / M3 cameras / campaign mode",
      "status": "partial",
      "scope": "Bounded 512px RGBA8 ping-pong, embedded CAM_, time windows; HDR/order/story-mode semantics не совпадают полностью.",
      "proof": "src/tests/cutscenePreview.test.ts"
    },
    {
      "id": "links",
      "pages": [
        24,
        25,
        28
      ],
      "title": "Start/end links и локализованное retiming",
      "status": "partial",
      "scope": "Native start/end GUID graph and attach points 1/2 resolve before sampling; localized Ogg duration changes retime dependent nodes and Bezier handles. Cycles rejected; LockedToEnd and other point kinds require further validation.",
      "proof": ""
    },
    {
      "id": "in-out",
      "pages": [
        25
      ],
      "title": "I/O, Alt+I/O и loop selection",
      "status": "supported",
      "scope": "Границы, переход к ним и bounded loop реализованы.",
      "proof": "src/tests/cutsceneManual.test.ts"
    },
    {
      "id": "split",
      "pages": [
        26
      ],
      "title": "Split selected/all с сохранением offsets",
      "status": "missing",
      "scope": "Нативный split/NLE алгоритм отсутствует; lifetime split запрещён руководством.",
      "proof": ""
    },
    {
      "id": "nle",
      "pages": [
        26
      ],
      "title": "Insert/Remove Time",
      "status": "missing",
      "scope": "Нет splice/push/compress по selection.",
      "proof": ""
    },
    {
      "id": "import-copy",
      "pages": [
        26,
        27
      ],
      "title": "Import/overwrite объектов из другой сцены",
      "status": "partial",
      "scope": "Можно clone в документе; импорт с provenance remap из другого документа не реализован полностью.",
      "proof": ""
    },
    {
      "id": "references",
      "pages": [
        27,
        28
      ],
      "title": "Live references на внешнюю сцену",
      "status": "partial",
      "scope": "Readonly resolver expands local/package references, isolates imported GUIDs and preserves local overrides. Depth/cycle/build/source guards; cross-subtree native reference behavior remains partial.",
      "proof": ""
    },
    {
      "id": "appearance",
      "pages": [
        29,
        30
      ],
      "title": "Opacity/Tint/Height Offset и Team Color",
      "status": "partial",
      "scope": "Geometry scalar opacity/tint/height offset + diffuse team color; effects inheritance/emissive team-color parity не завершены.",
      "proof": "src/tests/cutsceneManual.test.ts"
    },
    {
      "id": "actor-system",
      "pages": [
        29,
        30
      ],
      "title": "Alias, Finder Tag, physics, FXA, variation и walk",
      "status": "missing",
      "scope": "Нет actor messaging/game lookup/physics/facial/automatic walk.",
      "proof": ""
    },
    {
      "id": "materials",
      "pages": [
        29,
        30
      ],
      "title": "Все M3 материалы, postprocess и effects",
      "status": "partial",
      "scope": "WebGL2 материалы/particles/ribbons/кубы есть. HDR, depth blend, distortion, volume и точные material flags остаются неполными.",
      "proof": "src/tests/cutscenePreview.test.ts"
    }
  ],
  "allSupported": false,
  "engineValidated": false,
  "proofPolicy": "supported означает реализованный ограниченный контракт preview/MCP, а не полное совпадение SC2. partial/missing не могут быть признаны полным покрытием.",
  "appendix": [
    {
      "page": 28,
      "group": "Commandable",
      "property": "ID",
      "preview": "supported",
      "note": "Preview contract; engine comparison pending.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 28,
      "group": "Commandable",
      "property": "Parent ID",
      "preview": "supported",
      "note": "Preview contract; engine comparison pending.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 28,
      "group": "Commandable",
      "property": "Reference File",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 28,
      "group": "Commandable",
      "property": "Reference GUID",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 28,
      "group": "Node",
      "property": "Enabled",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 28,
      "group": "Node",
      "property": "Filter",
      "preview": "supported",
      "note": "Inherited filters and local preview state implemented; per-player runtime not simulated.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 28,
      "group": "Node",
      "property": "Guide",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 28,
      "group": "Node",
      "property": "Locked",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 28,
      "group": "Node",
      "property": "Name",
      "preview": "supported",
      "note": "Preview contract; engine comparison pending.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 28,
      "group": "Node",
      "property": "Visible",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 28,
      "group": "Element",
      "property": "Duration",
      "preview": "supported",
      "note": "Preview contract; engine comparison pending.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 28,
      "group": "Element",
      "property": "End Link Distance",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 28,
      "group": "Element",
      "property": "End Link to Point",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 28,
      "group": "Element",
      "property": "End Linked to GUID",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 28,
      "group": "Element",
      "property": "Start Link Distance",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 28,
      "group": "Element",
      "property": "Start Link to Point",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 28,
      "group": "Element",
      "property": "Start Linked to GUID",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 29,
      "group": "Element",
      "property": "Start Time",
      "preview": "supported",
      "note": "Preview contract; engine comparison pending.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 29,
      "group": "Object",
      "property": "Blend to Terrain",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 29,
      "group": "Object",
      "property": "Finder Tag",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 29,
      "group": "Object",
      "property": "Fog Visibility",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 29,
      "group": "Object",
      "property": "Height Offset",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 29,
      "group": "Object",
      "property": "Movesped",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 29,
      "group": "Object",
      "property": "Position",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 29,
      "group": "Object",
      "property": "Rotation",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 29,
      "group": "Object",
      "property": "Scale",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 29,
      "group": "Actor Node",
      "property": "Actor Alias",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 29,
      "group": "Actor Node",
      "property": "Editor Model",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 29,
      "group": "Actor Node",
      "property": "Enable Physics",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 29,
      "group": "Actor Node",
      "property": "FXA Override",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 29,
      "group": "Actor Node",
      "property": "Model Link",
      "preview": "supported",
      "note": "Preview contract; engine comparison pending.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 29,
      "group": "Actor Node",
      "property": "Model Path",
      "preview": "supported",
      "note": "Preview contract; engine comparison pending.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 29,
      "group": "Actor Node",
      "property": "Opacity",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 29,
      "group": "Actor Node",
      "property": "Shadow Box",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 29,
      "group": "Actor Node",
      "property": "Speaker Tag",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 29,
      "group": "Actor Node",
      "property": "Texture Quality",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 29,
      "group": "Actor Node",
      "property": "Tint Color",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 29,
      "group": "Actor Node",
      "property": "Unit Link",
      "preview": "not-applicable",
      "note": "Само руководство помечает это поле Unsupported.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 29,
      "group": "Actor Node",
      "property": "Use Anim Movespeed",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 30,
      "group": "Actor Node",
      "property": "Variation",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 30,
      "group": "Actor Node",
      "property": "Walk",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 30,
      "group": "Actor Node",
      "property": "Team Color",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 30,
      "group": "Animation Element",
      "property": "Animation",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 30,
      "group": "Animation Element",
      "property": "Animation ID",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 30,
      "group": "Animation Element",
      "property": "Blend In Time",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 30,
      "group": "Animation Element",
      "property": "Blend Out Time",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 30,
      "group": "Animation Element",
      "property": "Looping",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 30,
      "group": "Animation Element",
      "property": "Movespeed",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 30,
      "group": "Animation Element",
      "property": "Original Duration",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 30,
      "group": "Animation Element",
      "property": "Original Movement Speed",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 30,
      "group": "Animation Element",
      "property": "Play Forever",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 30,
      "group": "Animation Element",
      "property": "Play Once",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 30,
      "group": "Animation Element",
      "property": "Priority",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 30,
      "group": "Animation Element",
      "property": "Right-Aligned",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 30,
      "group": "Animation Element",
      "property": "Start Offset",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 30,
      "group": "Animation Element",
      "property": "Time Scale",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 30,
      "group": "Look At Element",
      "property": "Attachment",
      "preview": "partial",
      "note": "Native offline evaluator added; full engine semantics remain unverified.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 30,
      "group": "Look At Element",
      "property": "Ignore Eyes",
      "preview": "partial",
      "note": "Native offline evaluator added; full engine semantics remain unverified.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 30,
      "group": "Look At Element",
      "property": "Target GUID",
      "preview": "partial",
      "note": "Native offline evaluator added; full engine semantics remain unverified.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 30,
      "group": "Look At Element",
      "property": "Type",
      "preview": "partial",
      "note": "Native offline evaluator added; full engine semantics remain unverified.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 31,
      "group": "Conversation Element",
      "property": "Conversation Line",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 31,
      "group": "Conversation Element",
      "property": "Conversation Link",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 31,
      "group": "Conversation Element",
      "property": "Duration Offset",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 31,
      "group": "Conversation Element",
      "property": "Facial Anim",
      "preview": "partial",
      "note": "Native serialized field read by audio/FXA preview; engine semantics are not fully certified.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 31,
      "group": "Conversation Element",
      "property": "Facial Group",
      "preview": "partial",
      "note": "Native serialized field read by audio/FXA preview; engine semantics are not fully certified.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 31,
      "group": "Conversation Element",
      "property": "Sound Link",
      "preview": "partial",
      "note": "Native serialized field read by audio/FXA preview; engine semantics are not fully certified.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 31,
      "group": "Conversation Element",
      "property": "Start Offset",
      "preview": "partial",
      "note": "Native serialized field read by audio/FXA preview; engine semantics are not fully certified.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 31,
      "group": "Conversation Element",
      "property": "Variation",
      "preview": "partial",
      "note": "Native serialized field read by audio/FXA preview; engine semantics are not fully certified.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 31,
      "group": "Conversation Element",
      "property": "Volume",
      "preview": "partial",
      "note": "Native serialized field read by audio/FXA preview; engine semantics are not fully certified.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 31,
      "group": "Follow Path Element",
      "property": "Always Point Up",
      "preview": "partial",
      "note": "Native offline evaluator added; full engine semantics remain unverified.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 31,
      "group": "Follow Path Element",
      "property": "Path GUID",
      "preview": "partial",
      "note": "Native offline evaluator added; full engine semantics remain unverified.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 31,
      "group": "Follow Path Element",
      "property": "Path Rotation Offset",
      "preview": "partial",
      "note": "Native offline evaluator added; full engine semantics remain unverified.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 31,
      "group": "Attachment Element",
      "property": "Attachment GUID",
      "preview": "partial",
      "note": "Native offline evaluator added; full engine semantics remain unverified.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 31,
      "group": "Attachment Element",
      "property": "Attach Point",
      "preview": "partial",
      "note": "Native offline evaluator added; full engine semantics remain unverified.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 31,
      "group": "Attachment Element",
      "property": "Inherit Scale",
      "preview": "partial",
      "note": "Native offline evaluator added; full engine semantics remain unverified.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 31,
      "group": "Attachment Element",
      "property": "Inherit Visibility",
      "preview": "partial",
      "note": "Native offline evaluator added; full engine semantics remain unverified.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 31,
      "group": "Attachment Element",
      "property": "Offset",
      "preview": "partial",
      "note": "Native offline evaluator added; full engine semantics remain unverified.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 31,
      "group": "Attachment Element",
      "property": "Rotation",
      "preview": "partial",
      "note": "Native offline evaluator added; full engine semantics remain unverified.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 32,
      "group": "Property Value Node",
      "property": "Property",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 32,
      "group": "Property Value Element",
      "property": "Value",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 32,
      "group": "Property Value Element",
      "property": "In Tangent Data",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 32,
      "group": "Property Value Element",
      "property": "In Tangent Type",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 32,
      "group": "Property Value Element",
      "property": "Out Tangent Data",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 32,
      "group": "Property Value Element",
      "property": "Out Tangent Type",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 32,
      "group": "Sound Node",
      "property": "Actor Alias",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 32,
      "group": "Sound Node",
      "property": "Model",
      "preview": "partial",
      "note": "Native serialized field read by audio/FXA preview; engine semantics are not fully certified.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 32,
      "group": "Sound Node",
      "property": "Pitch",
      "preview": "partial",
      "note": "Native serialized field read by audio/FXA preview; engine semantics are not fully certified.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 32,
      "group": "Sound Node",
      "property": "Sound Link",
      "preview": "partial",
      "note": "Native serialized field read by audio/FXA preview; engine semantics are not fully certified.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 32,
      "group": "Sound Node",
      "property": "Start Offset",
      "preview": "partial",
      "note": "Native serialized field read by audio/FXA preview; engine semantics are not fully certified.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 32,
      "group": "Sound Node",
      "property": "Variation",
      "preview": "partial",
      "note": "Native serialized field read by audio/FXA preview; engine semantics are not fully certified.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 32,
      "group": "Sound Node",
      "property": "Volume",
      "preview": "partial",
      "note": "Native serialized field read by audio/FXA preview; engine semantics are not fully certified.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 32,
      "group": "Camera",
      "property": "Depth of Field",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 32,
      "group": "Camera",
      "property": "Distance",
      "preview": "supported",
      "note": "Preview contract; engine comparison pending.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 32,
      "group": "Camera",
      "property": "Eye Position",
      "preview": "supported",
      "note": "Preview contract; engine comparison pending.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 32,
      "group": "Camera",
      "property": "Falloff End",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 32,
      "group": "Camera",
      "property": "Falloff Start",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 32,
      "group": "Camera",
      "property": "Far Clip",
      "preview": "supported",
      "note": "Preview contract; engine comparison pending.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 32,
      "group": "Camera",
      "property": "Field of Field",
      "preview": "supported",
      "note": "Preview contract; engine comparison pending.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 32,
      "group": "Camera",
      "property": "Focal Depth",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 32,
      "group": "Camera",
      "property": "Height Offset",
      "preview": "supported",
      "note": "Preview contract; engine comparison pending.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 32,
      "group": "Camera",
      "property": "Near Clip",
      "preview": "supported",
      "note": "Preview contract; engine comparison pending.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 32,
      "group": "Camera",
      "property": "Pitch",
      "preview": "supported",
      "note": "Preview contract; engine comparison pending.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 32,
      "group": "Camera",
      "property": "Roll",
      "preview": "supported",
      "note": "Preview contract; engine comparison pending.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 32,
      "group": "Camera",
      "property": "Shadow Clip",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 32,
      "group": "Camera",
      "property": "Target Position",
      "preview": "supported",
      "note": "Preview contract; engine comparison pending.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 33,
      "group": "Camera",
      "property": "Vertical FOV",
      "preview": "supported",
      "note": "Preview contract; engine comparison pending.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 33,
      "group": "Camera",
      "property": "Yaw",
      "preview": "supported",
      "note": "Preview contract; engine comparison pending.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 33,
      "group": "Active Camera Element",
      "property": "Camera Index",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 33,
      "group": "Active Camera Element",
      "property": "Object ID",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 33,
      "group": "Active Light Node",
      "property": "Maximum Light Level",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 33,
      "group": "Active Light Node",
      "property": "Minimum Light Level",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 33,
      "group": "Active Light Element",
      "property": "Blend Time",
      "preview": "partial",
      "note": "Native offline evaluator added; full engine semantics remain unverified.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 33,
      "group": "Active Light Element",
      "property": "Light GUID",
      "preview": "partial",
      "note": "Native offline evaluator added; full engine semantics remain unverified.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 33,
      "group": "Active Light Element",
      "property": "Light ID",
      "preview": "partial",
      "note": "Native offline evaluator added; full engine semantics remain unverified.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 33,
      "group": "Active Light Element",
      "property": "Light Index",
      "preview": "partial",
      "note": "Native offline evaluator added; full engine semantics remain unverified.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 33,
      "group": "Fade Element",
      "property": "Amount - Faded",
      "preview": "supported",
      "note": "Preview contract; engine comparison pending.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 33,
      "group": "Fade Element",
      "property": "Amount – Unfaded",
      "preview": "supported",
      "note": "Preview contract; engine comparison pending.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 33,
      "group": "Fade Element",
      "property": "Color",
      "preview": "supported",
      "note": "Preview contract; engine comparison pending.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 33,
      "group": "Fade Element",
      "property": "Fade In",
      "preview": "supported",
      "note": "Preview contract; engine comparison pending.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 34,
      "group": "Bookmark Element",
      "property": "Bookmark Name",
      "preview": "supported",
      "note": "Preview contract; engine comparison pending.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 34,
      "group": "Bookmark Element",
      "property": "Jump to Bookmark When Hit",
      "preview": "supported",
      "note": "Preview contract; engine comparison pending.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 34,
      "group": "Bookmark Element",
      "property": "Pause When Hit",
      "preview": "supported",
      "note": "Preview contract; engine comparison pending.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 34,
      "group": "Path Marker Node",
      "property": "In Tangent Type",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 34,
      "group": "Path Marker Node",
      "property": "Out Tangent Type",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 34,
      "group": "Light",
      "property": "Ambient Occlusion",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 34,
      "group": "Light",
      "property": "Attenuation Far",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 34,
      "group": "Light",
      "property": "Attenuation Near",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 34,
      "group": "Light",
      "property": "Color",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 34,
      "group": "Light",
      "property": "Color Multiplier",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 34,
      "group": "Light",
      "property": "Eye Position",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 34,
      "group": "Light",
      "property": "Falloff",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 34,
      "group": "Light",
      "property": "Hotspot",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 34,
      "group": "Light",
      "property": "Light Opaque Objects",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 34,
      "group": "Light",
      "property": "Light Transparent Obects",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 34,
      "group": "Light",
      "property": "Minimum Light Level",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 34,
      "group": "Light",
      "property": "Shadow Casting",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 34,
      "group": "Light",
      "property": "Specular",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 34,
      "group": "Light",
      "property": "Specular Color",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 34,
      "group": "Light",
      "property": "Target Position",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 35,
      "group": "Fog",
      "property": "Color",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 35,
      "group": "Fog",
      "property": "Density",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 35,
      "group": "Fog",
      "property": "Falloff",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 35,
      "group": "Fog",
      "property": "Start Height",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 35,
      "group": "Text",
      "property": "Color",
      "preview": "partial",
      "note": "Native offline evaluator added; full engine semantics remain unverified.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 35,
      "group": "Text",
      "property": "Text",
      "preview": "partial",
      "note": "Native offline evaluator added; full engine semantics remain unverified.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 35,
      "group": "RTT Node",
      "property": "RTT Channel",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 35,
      "group": "RTT Element",
      "property": "Aspect Ratio",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 35,
      "group": "RTT Element",
      "property": "Camera Index",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 35,
      "group": "RTT Element",
      "property": "Object GUID",
      "preview": "partial",
      "note": "Есть ограниченный evaluator; нужна проверка полного поведения.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 35,
      "group": "Conversation Driver Node",
      "property": "Conversation Link",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 35,
      "group": "Conversation Driver Element",
      "property": "Alternate Line ID",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 35,
      "group": "Conversation Driver Element",
      "property": "End Buffer Time",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    },
    {
      "page": 35,
      "group": "Conversation Driver Element",
      "property": "Line ID",
      "preview": "missing",
      "note": "Поле XML можно сохранять, но оно не выполняется нашим preview.",
      "authoring": "lossless XML preservation; per-field typed semantics not certified"
    }
  ]
} as const;
export function cutsceneCoverage(source?:string,file?:string,detail:'summary'|'features'='summary'){const counts={supported:0,partial:0,missing:0};for(const f of manualCoverage.features)counts[f.status]++;const appendixCounts={supported:0,partial:0,missing:0,'not-applicable':0};for(const p of manualCoverage.appendix)appendixCounts[p.preview]++;const scan=source===undefined?undefined:scanXml(source);return {manual:manualCoverage.manual,allSupported:false,engineValidated:false,scope:'preview contracts; not editor replacement or SC2 pixel parity',counts,appendixCounts,featureCount:manualCoverage.features.length,appendixPropertyCount:manualCoverage.appendix.length,missing:manualCoverage.features.filter(f=>f.status==='missing').map(f=>f.id),partial:manualCoverage.features.filter(f=>f.status==='partial').map(f=>f.id),scene:scan?{file,xmlValid:!scan.diagnostics.some(d=>d.severity==='error'),nativeTypes:[...new Set(scan.nodes.map(n=>n.tag))],linkedElements:scan.nodes.filter(n=>n.attrs.startLinkGuid||n.attrs.endLinkGuid).length,externalReferences:scan.nodes.filter(n=>n.attrs.referenceFile).length}:undefined,...detail==='features'?{features:manualCoverage.features,appendix:manualCoverage.appendix}: {}};}
