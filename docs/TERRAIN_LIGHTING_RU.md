# Terrain: освещение и ландшафт — alpha.14

Добавлены 3 MCP-команды, всего Terrain 30, проект 144 инструмента в 9 модулях.

- `terrain.lighting.inspect`: активный tileset, локальная связь CTerrain/Lighting, CLight и его состояния. Данные зависимости показываются отдельно: localBinding не является полным результатом наследования.
- `terrain.lighting.plan`: назначение пресета и настройки освещения одним планом.
- `terrain.landscape.plan`: генерация рельефа/текстур и необязательное освещение в одном плане на существующей карте. Без area автоматически выбирает физические границы карты; защищённые cliffs/ramps/holes остаются защищёнными.
- `terrain.assets` с `kind:"lighting"`: поиск доступных CLight через Browse и объявленные зависимости.

## Пример

```json
{"operations":[
  {"op":"lighting.preset","id":"CodexNight","parent":"Agria","ambientColor":[0.12,0.18,0.3],"exposure":1.2,"whitePoint":1.85,"directional":[{"index":"Key","color":[0.65,0.75,1],"direction":[0.4,-0.5,-0.7],"intensity":0.45}]},
  {"op":"lighting.assign","id":"CodexNight"}
]}
```

Родитель Agria должен быть разрешён в вашей карте/зависимостях. Имена пресетов не выдумываются. Новый id с parent изолирует изменения; редактирование существующего id затрагивает все его ссылки. `stateIndex` по умолчанию 0; поддержаны явный индекс и нативное отсутствие индекса для нулевого состояния. AmbientColor и DirectionalLight сохраняют представление атрибутом или дочерним value.

Сначала `terrain.apply(planId, dryRun:false, stage:true)`, затем `terrain.save(transactionId, dryRun:false)`. LightData.xml, TerrainData.xml, GameData Includes и ComponentList сохраняются одной группой. Исходные файлы и зависимости защищены от устаревших планов, включая изменения после staging. Общий проверочный код зависимости пока называется STALE_WATER_DEPENDENCIES, используется также освещением.

XML DSL:

```xml
<TerrainRecipe version="1">
  <LightingPreset id="CodexNight" parent="Agria" ambientColor="0.12,0.18,0.3" exposure="1.2" whitePoint="1.85"/>
  <Lighting id="CodexNight"/>
</TerrainRecipe>
```

Directional настройки доступны через JSON; XML пока поддерживает фон/HDR. В GUI можно назначить существующий пресет или указать его для Generate style. Остальные настройки доступны через MCP.

## Подтверждение и границы

Нативная карта City of Tempest: heightMap tileSet=Citytile, CTerrain Citytile содержит Lighting=Agria, LightData.xml содержит Agria/AgriaNight/ArcadeCityLight. Фикстуры двух каталогов включены в src/tests/fixtures/lighting-native; исходная карта сохранена без модификаций.

Проверен Core LightData.xml SC2Mapster/SC2GameData, commit 6dd323aae4209a01f110719a00b4e8f7a88389bc, путь mods/core.sc2mod/base.sc2data/GameData/LightData.xml. Подтверждены ToDInfoArray, AmbientColor, Param HDRExposure/HDRWhitePoint, DirectionalLight Key/Fill/Back и Color/Direction/ColorMultiplier.

Не изменяем tileSet в t3Terrain.xml ради освещения: только соответствующую связь CTerrain/Lighting, остальные поля/неизвестные элементы сохраняются. Чистая карта с нуля ещё не поддержана: нужен извлечённый комплект карты или проверенный blueprint. Существующие команды generate, mountain, valley, plateau, crater, road, coast, transition, river/lake, create_location позволяют строить ландшафт в нём. River/lake без water-операции формируют только рельеф.

**Terrain ещё не покрывает весь редактор:** структурное создание cliffs/ramps/pathing, сложные body/wave воды, настройка полного цикла дня и ночи, полный fog/sky/postprocess и движковый предпросмотр остаются неподдержанными. Нативные неизвестные данные сохраняются. GUI-триггеры исключены; Galaxy scripts остаются следующим этапом. Проверка запуска в SC2Editor и игре не выполнена.
