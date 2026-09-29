# Ручная приёмка кинематических вызовов

Статус Editor/compile/runtime: NOT_RUN. Это изолированная карта из checked-in native fixtures; сохраните пользовательскую сессию отдельно и открывайте копию.

Откройте components/.sc2mcp-output/CinematicAcceptance.SC2Map. В Trigger Editor проверьте категорию MCP Acceptance и триггер CinematicAcceptance: Map Initialization, CinematicMode On (PlayerGroupAll, duration 0), Wait 0.5, CinematicMode Off, GlobalCinematicSetting On, GlobalCinematicSetting Off. Это две разные FunctionDef, проверьте их параметры и локализованные имена.

Сохраните карту под новым именем, откройте повторно и зафиксируйте порядок/типы/строки. Сгенерируйте Galaxy и зафиксируйте ошибки компиляции; только затем выполните Test Document на копии и запишите наблюдение. Для проверки выполнения используйте breakpoint или явный trace: визуальное отсутствие кинематического эффекта недостаточно.

Отдельно подготовьте в Editor before/after для одной FunctionCall без своей метки, с Debug, с Cinematics, с явно выбранным None и снова с default/inherit. Сохраните XML/TriggerStrings каждого состояния. Пока этот формат не доказан, trigger.labels/label_of только читают, set/clear недоступны. Заполните RESULTS.json фактическими результатами и версией Editor.
