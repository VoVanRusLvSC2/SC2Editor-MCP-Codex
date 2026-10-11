# Что уже работает и чего ещё нет — 2026-10-11

Основные операции поверхности готовы для поддерживаемых native-компонентов существующей карты. CASC теперь читает установленную игру напрямую, а выбранные metadata packages подключаются к Data/Browse. Полной готовности всех возможностей SC2 Editor/engine проект не заявляет.

| Раздел | Уже есть | Что остаётся |
| --- | --- | --- |
| TERRAIN | Generate/landscape, высота, шум/горки, slopes, flatten/smooth, покраска и смешивание, native hide/show по клеткам/области, preview, grouped stage/save/rollback | Нативное создание cliffs/ramps и rebuild nav/collision; произвольные terrain versions/transform; полноценное SC2 material rendering |
| Вода / свет | Поддерживаемые flat WATR v110 rectangles, CWater states, CTerrain/CLight binding и ограниченные fields | Сложные water bodies/waves/shoreline generator; все lighting/ToD/fog/shader semantics |
| CASC | Actual local CASC/MNDX + strict BLTE reads, path search, CKey/EKey/SHA provenance, build-specific cache, mounts, compressed Galaxy summaries | CDN fetch/write; универсальное чтение неподдержанных/недоступных/зашифрованных payloads; проверка других сборок/платформ |
| Data | Catalog XML, selective context, arrays/links, schema-backed changes, native package data из CASC, dependency read guards | Полное engine inheritance/defaults/token/removal/override поведение и обновление всех XSD/evidence для текущей сборки |
| Browse / Placement | Catalog/dependency search, loose assets, Unit/Doodad/ObjectPoint plans, scatter/snap и отказ на hidden ground | Прозрачный VFS всех бинарных CASC assets в каждом старом API; модельные footprints, точная collision/pathing проверка |
| Galaxy / Triggers | Galaxy structural reading/writes, native signature registry, bounded GUI trigger inspection/authoring; CASC читает current NativeLib/natives bytes | Полный compiler/semantic binding, все GUI function shapes, полное преобразование произвольных сценариев |
| UI / Text / Cutscene | Существующие semantic XML operations, styles/localization, scene/camera/track editing | Все renderer/engine-specific semantics, полные GUI replicas и универсальные in-game acceptance checks |
| Map / MPQ | Native import/export/reopen entry checks, templates/blueprints, MapInfo и metadata plans | Чистая карта с нуля без native donor; универсальный resize/rebuild; все варианты MPQ/MapInfo |
| Assets | Реальные CASC paths, metadata и ограниченные декодированные byte ranges M3/DDS/audio/прочих файлов | Полноценный M3/DDS/audio preview и engine asset resolver |

## Подтверждения

- Пользователь проверил две MCP-authored `p.SC2Map` копии и подтвердил скрытие/восстановление грунта. На карте native hide flag — LFCT v102 bit 0x04; остальные bytes/flags сохранены.
- Настоящий SDK workflow проверяет paint/blend/height-noise/hide/show → stage/save. Mix по умолчанию strength 0.5.
- Actual CASC build 5.0.17.98310: index 780010 logical paths, 312145 index-local paths; прочитаны game XML/Galaxy/M3, подтверждены cache hits; Core mount 245 files/9878922 bytes доступен Data.
- Импортированный ZIP API на 3341 функции остаётся reference-only: шесть source SHA отличаются от установленных bytes.
- Development/release build, ESLint, отдельные CASC/Terrain regressions, полный набор и Windows portable проверяются перед публикацией; актуальные итоговые результаты записаны в [PROJECT_STATUS](PROJECT_STATUS.md).

## Новый модуль и следующие приоритеты

Отдельный **CASC** уже добавлен: он владеет installed-game source и кэшем, а Terrain/Data/Browse используют его данные через собственные APIs. [Устройство, команды и запуск](CASC_RU.md).

Следующий отдельный модуль имеет смысл для **Assets preview**: M3/DDS inspection/preview, animation/material metadata, provenance-aware resolving с учётом dependency order. Он не нужен для базового CASC чтения, уже реализованного сейчас.

Дальше по поверхности: native cliffs/ramps и navigation/footprint rebuild потребуют отдельных Editor fixtures и подтверждённых межслойных операций. Базовые кисти рельефа, текстур и hide/show уже доступны Codex.
