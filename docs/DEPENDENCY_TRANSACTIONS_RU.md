# Проверка зависимостей — alpha.11

Текстовая операция фиксирует не только записываемые файлы, но и прочитанные через Workspace зависимости. Это относится к preflight Data/AI и к проверкам внутри ui.apply/text.apply. Data dependency catalogs и Browse dependency text/DocumentInfo также используют tracked reads.

Read set содержит точные байты и существование файла; для локального readRaw дополнительно фиксируется эффективный текст с учётом черновика. Изменение dependency draft или его discard блокирует зависимую запись. Снимки сохраняются в группе черновиков до save/discard, а не исчезают после apply.

Перед transform и перед commit проверяются зависимости. После подготовки временных файлов writer проверяет их повторно. Внешнее изменение отклоняет результат; исходные записываемые файлы и подготовленный черновик остаются доступными. Для повторной оценки следует discard и заново построить операцию на актуальных данных.

Data/AI preflight выполняется в той же AsyncLocalStorage read context, что и raw transaction; очереди разных запросов сохраняют независимые контексты. AI не использует cached bindings во время tracked apply. Отсутствующий корневой Triggers фиксируется явно: появление binding-файла после stage блокирует save. Triggers остаётся read-only; это не новый модуль редактирования триггеров.

## Проверки

Семь новых тестов: preflight dependency edit, validation dependency edit, staged dependency save, external root и missing-file existence, async edit/context isolation, Data reference added to existing catalog, AI binding file appearing after stage, dependency draft discard. Полный regression suite: 205 PASS.

## Границы

Это snapshot validation прочитанных файлов, не изоляция всех процессов. Directory enumeration не pin-ится: новый файл в ранее просканированном каталоге не всегда обнаруживается при save. Binary/adapter reads вне Workspace read context также не покрыты автоматически. Между последней проверкой и rename остаётся OS-level race. Нет persistent recovery journal и crash-wide multi-file atomicity.

Следующая инженерная работа: pin-ить каталоги с корректным исключением собственных новых файлов, добавить durable recovery journal, затем собирать подтверждённые native AI/Terrain semantic fixtures. Полные форматы AI/cliffs/ramps/pathing не становятся подтверждёнными вследствие этого инфраструктурного изменения.
