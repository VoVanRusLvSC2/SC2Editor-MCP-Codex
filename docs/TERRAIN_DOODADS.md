# Terrain и Doodads — alpha.9

Обработка существующих terrain bundles и массовых placement-планов ускорена; архитектура сервера сохранена. Добавлены две команды декораций и один сокращённый XML workflow.

## Декорации по поверхности

`placement.scatterDoodads` создаёт **план**, не пишет файлы. Выбирает dependency-ready Doodads через Browse, задаёт weighted смесь типов, seed, scale/rotation range и вычисляет Z по одному terrain snapshot. По умолчанию исключает воду, дыры, защищённые native границы/ramps и близость к существующим центрам Unit/Doodad.

```json
{
  "area": { "type": "rectangle", "minX": 4, "minY": 4, "maxX": 28, "maxY": 28 },
  "objects": [{ "id": "AgriaTree", "weight": 3 }, { "id": "CharDuneRock", "weight": 1 }],
  "count": 60, "seed": 42,
  "minimumDistance": 1.5, "maxSlope": 0.4,
  "avoidExisting": true, "avoidWater": true,
  "scaleRange": { "min": 0.85, "max": 1.15 }
}
```

Пример требует соответствующих доступных каталогов: ID взяты из fixture, они не гарантированно доступны на произвольной карте. Сначала используй Browse и terrain.inspect. При недоступном ID запрос отклоняется.

Дополнительные поля:

| Поле | Смысл |
| --- | --- |
| `terrainDirectory` | Каталог terrain внутри текущего workspace |
| `minHeight`, `maxHeight` | Допустимая sampled высота поверхности |
| `minSlope`, `maxSlope` | Допустимый slope; максимум по умолчанию 0.5 |
| `textures:[{id,minWeight}]` | Любая из заданных текстур должна иметь локальный nibble weight ≥ minWeight (1–15) |
| `heightOffset` | Смещение Z относительно поверхности |
| `avoidProtected` | Исключение дыр/native границ/консервативной области ramps; дыры запрещены всегда |
| `avoidExisting` | Учитывать прежние центры Unit/Doodad при minimumDistance |
| `exclusionZones` | Circle/rectangle зоны исключения |
| `rotationRange` | Min/max native числового Rotation; стандартный диапазон 0..2π |
| `maxAttempts` | Бюджет кандидатов, максимум 1 250 000; обычно count×250 |

Каждый выбор объекта содержит ровно один id/key/query, необязательный weight. Count ограничен 5000, типов — 32. Вес определяет вероятность выбора, не точную квоту. Seed воспроизводит точки и параметры. Если бюджет не позволяет разместить весь count, запрос завершается ошибкой без частичного плана/записи. Summary считает только кандидаты, прошедшие spatial/exclusion проверки и проверенные на Terrain.

Если вода не декодирована или компонент отсутствует, стандартный avoidWater отклоняет запрос. Его можно явно выключить, осознанно принимая неизвестное покрытие воды. Texture-фильтр требует доступных masks. Slope и water-границы — диагностика; model footprints, навигация и игровые коллизии не подтверждены.

Результат MCP содержит первые 10 operations, totalOperations и truncated. Полный план сохраняется в сервере и применяется по ID. Preview показывает первые 50 operations и ограниченный текстовый diff; усечение ответа не меняет сохранённый план.

Дальше: `placement.preview` с plan.id → `placement.apply` с planId. Default apply — dry-run. Для непосредственной записи всей Objects/ComponentList transaction:

```json
{ "planId": "<returned plan.id>", "dryRun": false, "stage": false, "backup": true }
```

Это placement-план: применяй его через placement.apply. Standalone ground-based планы отклоняются, если основаны на незаписанном Terrain draft. Сначала save/discard Terrain и создай новый placement-план; для общего commit используй `placement.createLocation` с terrain.

## Привязка существующих объектов

`placement.snapToTerrain` готовит изменения выбранных Unit/Doodad по native ID:

```json
{ "objectIds": [100, 101], "terrainDirectory": "", "maxSlope": 0.5, "avoidWater": true, "heightOffset": 0 }
```

Сохраняет IDs, XY, Rotation, Scale и неизвестные XML-участки. Для Doodads включает наблюдаемый native флаг HeightAbsolute=1, чтобы Z задавался как абсолютная высота. Невалидные/неplaceable IDs, дыры, excessive slope и запрещённая вода отклоняют весь запрос. Применение — через placement.apply, с прежними dry-run/backup/stage правилами. Новые ground-snapped Doodads и combined location также получают HeightAbsolute=1. Его Editor/runtime семантика требует native round-trip, не заявлена как доказанная.

## GUI и XML

Вкладка Terrain содержит секцию Doodads on selected area: реальные IDs через запятую, Count, Minimum distance, Maximum slope. Она использует выбранную область и seed, планирует декорации, показывает review и позволяет Apply Doodads + backup. Terrain stage нужно сначала сохранить или отменить.

`terrain.recipe.plan` принимает `{xml:"<TerrainRecipe ...>...</TerrainRecipe>"}` и компилирует XML в Terrain-план одним вызовом. Preview/apply остаются отдельными. `terrain.recipe.parse` сохранён для отдельных XML diagnostics.

## Измерения и проверки

| Локальная операция | Alpha.8 | Alpha.9 |
| --- | ---: | ---: |
| Построение XML 1000 последовательных объектов | 943 мс | 7.5 мс |
| Scatter 5000 центров, distance=1, область 200×200 | 367 мс | 17.7 мс |
| Локальные noise+paint, radius=6, native 137×137 vertices | 161 мс | 41.2 мс |

Один замер каждого сценария в текущем окружении, без imports/чтения fixture. Это не время полного MCP-запроса или записи на диск. Отношения зависят от задачи, JIT, нагрузки и машины. Все три выходных SHA-256 совпали с alpha.8. [Полный отчёт](../generated/terrain-doodads-performance.json); повтор: `npm run benchmark:terrain -- generated/terrain-doodads-performance-baseline-alpha8.json`.

Оптимизация использует один XML append/reparse на последовательный add-run, пространственные buckets с точной distance-проверкой, ограниченную область brush/sync traversal, lookup maps палитры и кэш native protection в рамках операции. Общий grouped byte writer не заменялся.

186 тестов PASS: legacy модули, byte-exact результаты, allocation/mixed ordering, filters/water, existing-object preservation, stale terrain и dry-run, API/настоящий stdio MCP. [Текущий отчёт](../generated/terrain-doodads-test-report.json). Визуальный GUI, запуск Windows launcher, SC2Editor open/save и игровой runtime не выполнены. Native structural cliffs/ramps/pathing, arbitrary water levels и MPQ write-back остаются заблокированы.
