# Galaxy scripts — SC2Editor MCP alpha.16

Добавлен отдельный script.* внутри существующего проекта. Теперь 10 модулей и 158 MCP-команд. GUI Triggers не редактируются. Galaxy event APIs в пользовательских скриптах допустимы.

## Команды

| Команда | Назначение |
|---|---|
| script.inspect | Файлы, hashes, Includes, диагностика, provenance native API, состояние кэша |
| script.symbols | Пагинация functions/prototypes/globals/structs и их сигнатур |
| script.references | Индекс идентификаторов и кандидатов строковых ссылок |
| script.context | Одна функция и нужные сигнатуры с точным лимитом JSON characters |
| script.validate | Структура, строки/комментарии/скобки, Include safety/cycles, native arity |
| script.plan | file.create, function.add, function.body, guarded function.rename, connect |
| script.apply | dryRun diff либо atomic stage с проверкой источников |
| script.connect | План Include + init call в существующей void entry function |
| script.recipe | Init scaffold либо periodic callback вокруг существующей void action |
| script.save | Сохранение всей staged text group с backup и stale guards |
| script.discard | Отмена всей связанной staged text group |

## Обычная работа

1. script.inspect, затем script.symbols с query и limit.
2. script.context с file/name/maxChars, например 8000. Полные файлы не нужны; усечение source/dependency metadata обозначается явно.
3. script.plan с необходимыми операциями.
4. script.apply(planId, dryRun=true) для diff.
5. script.apply(planId, dryRun=false) для staging.
6. script.save(file, backup=true). Сохранится вся группа.

Перед apply проверяются исходные значения, existence и полный обнаруженный набор Galaxy файлов. Перед script.save проверяются staged значения и тот же набор файлов. Новая Include dependency, изменение source либо появление нового Galaxy файла блокируют запись. Shared transaction сохраняет проверки существующих read dependencies и компенсированную запись. Полной crash-atomicity или отсутствия любых межпроцессных гонок не заявляем.

## Пример периодического дохода

В существующем MapScript.galaxy добавить через script.plan/function.add:

```galaxy
void GiveIncome () {
    PlayerModifyPropertyInt(1, c_playerPropMinerals, c_playerPropOperAdd, 10);
}
```

После apply/save:

```json
{"file":"Scripts/Income.galaxy","name":"IncomeInit","kind":"periodic","seconds":2,"action":"GiveIncome"}
```

Это аргументы script.recipe: план создаёт callback, trigger variable и IncomeInit с TriggerCreate/TriggerAddEventTimePeriodic. После apply/save вызвать script.connect:

```json
{"file":"Scripts/Income.galaxy","init":"IncomeInit","entryFile":"MapScript.galaxy","entry":"InitMap"}
```

Затем apply/save плана подключения. Пример подразумевает доступность NativeLib в реальной entry chain. Поведение в игре ещё не проверено. Повторный connect не добавляет второй Include/call; ранний return в entry блокирует автоматическое подключение. Повторный вызов init в runtime не имеет отдельной защиты от повторной регистрации.

## Экономия

Разобранные файлы кэшируются по исходному тексту: 128 entries / 32 MiB source bytes. Изменённые файлы переиндексируются; индекс идентификаторов/строк и список вызовов повторно используются. Планы: до 8 и 128 MiB учитываемого исходного текста. Эти бюджеты не равны полному RSS процесса. JSON контекста ограничен maxChars; pagination и короткие ответы уменьшают передачу кода модели. Общий скан файлов/hash всё ещё выполняется для stale safety; worker pool и disk-backed index не добавлены.

## Проверки и ограничения

251 тест всего проекта прошли; 8 новых проверяют scripts. TypeScript build и ESLint PASS. Portable MCP/HTTP smoke PASS, включая Galaxy recipe/connect/apply/save из другой cwd. 4 реальных MapScript: lexical/structural parse без diagnostics, unchanged source exact.

2200 Core native signatures извлечены из pinned SC2GameData commit 6dd323aae4209a01f110719a00b4e8f7a88389bc; provenance/hash в generated/galaxy-native-api.json. Это индекс деклараций, а не полный актуальный API всех GameData libraries и target builds.

Текущая модель — tokens + structural declarations, не полноценный AST/compiler. Native arity проверяется; expression/assignment types, полный local scope binding, Include activation, dynamic function strings и Data/Points/UI resource links ещё не завершены. Rename блокирует строковые кандидаты и неоднозначные token bindings. valid=true означает отсутствие ошибок в перечисленном scope, semanticCoverage остаётся PARTIAL.

MapScript может быть пересоздан редактором. Connect не меняет непрозрачные native headers и не создаёт map foundation. Windows launcher, Editor persistence, compilation и runtime NOT_EXECUTED в доступной Linux-среде.

Следующий этап: полный Galaxy AST/type resolver, read-only installed/dependency library adapter, explicit resource link graph, дополнительные recipes и native compiler/editor final gate.
