# Вода Terrain — alpha.13

Поддержан плоский профиль `t3Water`: WATR v110, нулевой bodyCount, точная длина 32 + 56 × count. Каждая запись содержит UTF8 имя CWater до 39 байт и четыре координаты. Нативные образцы City и GitHub thethingrevivalremade содержат соответственно 6 и 18 прямоугольников на сетке 8 клеток. Сложные body/wave sections сохраняются без редактирования. Поддержка этого ограниченного профиля опирается на реальные файлы и описание SC2Mapster; она не является подтверждением работы редактора/движка.

`terrain.water.inspect` показывает записи, профиль и локальные CWater states. Доступные материалы ищутся через `terrain.assets` с `kind: "water"`; новый материал наследуется от разрешённого родителя. Используйте существующий материал карты или извлечённые и объявленные зависимости.

`terrain.water.plan` принимает пакет water.* операций. Затем `terrain.apply` с `dryRun:false, stage:true` создаёт черновик, `terrain.save` с `dryRun:false` сохраняет группу. По умолчанию команды не пишут на диск.

```json
{
  "operations": [
    {"op":"water.material","id":"CodexLake","parent":"Default","height":6,"color":[0.1,0.3,0.5,0.4],"uvRate":[0,-0.001,0,0],"refractionDistortion":0.02},
    {"op":"water.create","template":"CodexLake","area":{"type":"rectangle","minX":8,"minY":8,"maxX":24,"maxY":24}}
  ]
}
```

`Default` в примере должен быть разрешён в текущей карте/зависимостях. Альтернатива: создать воду с `sourceIndex` существующей записи. Укажите ровно одно из template/sourceIndex. `water.update` принимает index, area и необязательную замену template; `water.remove` — index. Координаты должны лежать внутри карты и кратны 8; пересекающиеся прямоугольники отклоняются.

Материал поддерживает stateIndex (по умолчанию 0), height, RGBA color, uvRate, reflectionDistortion, refractionDistortion, framesPerSec и isLava. Изменение существующего материала влияет на все записи с этим именем. Для отдельного озера создайте новый id с parent. Непрозрачные fields, комментарии, остальные states и форма native attribute/child XML сохраняются. Подключение WaterData.xml в GameData.xml и gada-компонента входит в ту же группу. Новый parent обязан быть доступен; изменение parent существующего материала не поддерживается.

```xml
<TerrainRecipe version="1">
  <Area id="lake" shape="rectangle" min="8,8" max="24,24"/>
  <WaterMaterial id="CodexLake" parent="Default" height="6"
                 color="0.1,0.3,0.5,0.4" uvRate="0,-0.001,0,0"/>
  <Water area="lake" template="CodexLake"/>
</TerrainRecipe>
```

XML передаётся в `terrain.recipe.plan`. Также доступны UpdateWater и RemoveWater. Terrain lake/river могут добавить воду через sourceWaterIndex только для прямоугольной области на сетке 8 клеток; произвольный русловой полигон в нативный water body не преобразуется.

Диагностический water preview показывает прямоугольные extent. Scatter исключает их консервативно целиком: уровень воды, реальные береговые границы, shader clipping и passability не доказаны. Карты с непрочитанной водой не выдаются за сухие. Перед сохранением вновь проверяются исходные байты, каталог и при наличии Browse точные байты/список прочих индексируемых файлов; собственные изменённые компоненты проверяются группой отдельно.

Источники: SC2Mapster/SC2GameData commit 6dd323aae4209a01f110719a00b4e8f7a88389bc (Core/Liberty WaterData.xml); willuwontu/thethingrevivalremade.SC2Map commit 206d6644f56a2818969b4e4dc323d117a8e84484; пользовательская City map. SHA-256 и gzip-образцы — src/tests/fixtures/water-native/. Сводка дополнительного корпуса Nova — generated/. GUI-триггеры исключены; Galaxy-скрипты остаются следующим этапом после Terrain.

В GUI Terrain доступны Add water, Move/change water, Remove water и Water material settings. Поля материала показываются для water-действий, существующие локальные ID предлагаются после Inspect map. Кнопка Align area inward выравнивает выбранную область внутрь по 8 клеток. Дальше используется обычный Create plan → Stage → Save/Discard. Визуальная проверка GUI не выполнена.

Проверки alpha.13: 228 PASS, 0 fail/skip, build/lint PASS; MCP/HTTP smoke PASS на Linux Node. 14 таблиц содержат 199 наблюдаемых записей, из них все 175 записей девяти Nova-карт прошли byte-exact no-op update. Редактор/игра/Windows execution и визуальная GUI-проверка не выполнены.
