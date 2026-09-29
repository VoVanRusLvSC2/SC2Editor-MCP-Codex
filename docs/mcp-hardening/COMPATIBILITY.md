# Совместимость и границы

Все 10 модулей и legacy profiles all/ui/cutscene/data/terrain/script/authoring/custom сохранены. Legacy UI custom tools остаются включёнными. Новые minimal (core save/discard/capabilities), focused-data, focused-script, focused-authoring убирают UI tool surface; focused-script включает Trigger через Script module. Не все старые schema registries переведены на lazy load.

Data identity и parent/reference lookup используют точный регистр и catalog domain. Текстовый поиск остаётся case-insensitive. В конфликтующих layers effective value unknown, raw declarations и provenance доступны. Unindexed arrays используют [#N]; неоднозначный путь и синтез отсутствующего ordinal запрещены. Unknown reset/merge не выдумывается. IncludesGraph и DocInfo dependency metadata не являются доказательством engine load order.

Shared references: typed Data fields/parents/tokens, Galaxy известные native catalog carriers, GUI gamelink, Objects version27 Unit/Doodad, выбранные actor-event Terms/Send. Unknown free text, custom runtime logic, неуказанные dependency roots и полный actor interpreter остаются вне гарантированного покрытия. Ответы destructive mutation явно PARTIAL. Нет гарантии global unused. Inherited templates остаются readOnly, чтобы не менять поведение других children; требуется отдельная materialization. force разрешает только известные incoming refs, не unknown scope; allowInvalid не обходит malformed XML, path, stale и transaction guards.

GUI describe/plan/apply/validate использует pinned NativeLib build97563: MapInit, Wait, AISetAPM, DialogDestroyAll, ActorTextureGroupApplyGlobal, PeriodicEvent, UnitCreate. Проверены literal/variable/preset/gamelink. Nested call/block/customScript и неподтверждённые flags unsupported до staging. Создание typed GUI требует существующей named Library; inspect/graft поддерживает implicit. Localized graft и missing cross-library resources отвергаются конкретно; Native external IDs сохраняются. Trigger XML является source of truth; Galaxy regeneration в Editor NOT_EXECUTED.

Планы immutable и привязаны к workspace, source/schema/registry/catalog revisions. Directory read sets замечают новые consumers. Coupled draft groups сохраняются общей транзакцией; unrelated drafts не включаются автоматически. Проверки не являются полным Galaxy compiler или полной runtime валидацией Editor.

XSD v2: 2319 complex + 994 simple types, scoped anonymous members, namespaces, inheritance/restriction, groups, facets и source spans. Неподдержанные imports/includes/redefine/global member refs сообщаются; global refs в проверенном SC2 source отсутствуют. Cache selected shards content-hashed и ограничен. XSD input SHA256 cf5ac8c452a695f9504048481c16422719f8e2a07a898dca0a9802d100390488. NativeLib input SHA256 cbb2302825dce57ff9bb8efd44f9b0ed5cb056eee00265e5b711b0824d872396; другой build нельзя молча принять.

Portable включает Node, runtime JS, все runtime schemas, XSD shards, NativeLib registry и native archive DLLs. Editor/live UI/Windows launcher execution не входят в автоматический smoke. Публикация и установка не выполнялись.


## Дополнение 2026-09-29

Старые профили и default all сохранены; SC2_MCP_MODULES по-прежнему имеет приоритет. Для компактного запуска задайте SC2_MCP_PROFILE=focused-authoring либо focused-data и удалите конфликтующую SC2_MCP_MODULES. Новые trigger.labels/label_of доступны в script-профилях. CinematicMode и GlobalCinematicSetting — отдельные FunctionDef; поддержан только PlayerGroupAll как вложенное playergroup-выражение. Мутация меток и компиляция Editor не заявлены.
