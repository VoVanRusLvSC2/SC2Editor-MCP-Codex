# Ручная приёмка SC2 Editor

Статус Editor/load/save/runtime: NOT_RUN. Пакет — изолированная сборка native component fixtures, не полный исходный сценарий и не подтверждённая golden-карта.
components содержит исходники; упакованный components/.sc2mcp-output/TypedGui.SC2Map находится в изолированном workspace после verified archive export (см. static-report.json).

1. Закройте или сохраните свою текущую сессию самостоятельно. Откройте копию указанного архива в отдельном Editor.
2. Запишите версию Editor/SC2 и фактически доступные зависимости из DocumentInfo. Недоступная зависимость — отдельное внешнее условие, не скрывайте его как PASS.
3. В Trigger Editor найдите ManualAcceptance / HardeningInit: Map Initialization, Wait 0.5 Game Time, Destroy All Dialogs. Проверьте порядок действий, типы, NativeLib binding и TriggerStrings.
4. В Data Editor проверьте HardeningDamage.Amount=1 и HardeningSet.EffectArray -> HardeningDamage.
5. Сохраните под новым именем, закройте и откройте вновь. Сравните события/действия/строки/ссылки. Сохраните regenerated MapScript.galaxy, compiler errors и журнал загрузки.
6. Запустите Test Document только на копии. Зафиксируйте реальный load/run и ошибки; наличие статически корректного XML не подтверждает исполнение события.
7. Для positive gamelink UnitCreate используйте trigger.plan на копии с реально объявленной и доступной Unit и существующей point Variable. Отдельно проверьте literal/variable/preset/gamelink; вложенный call/block/customScript в этой версии должен быть отвергнут до staging.
8. Заполните RESULTS.json. До этого ни Editor, ни runtime не считаются проверенными.

Источники fixtures: src/tests/fixtures/terrain-native/nydus и map-native/nydus. Исходные карты, пользовательская сессия и настройки соединений не изменялись.
