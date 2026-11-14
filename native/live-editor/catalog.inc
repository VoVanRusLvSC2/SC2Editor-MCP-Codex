// Read exact catalog identities through the original Data lists, including
// unsaved committed local objects. No catalog XML or map content is changed.
struct LiveCatalogView {
  HWND root = nullptr;
  std::wstring token, domain, id, originalSearch, expectedType, originalTypeText,
      originalSourceText;
  int originalType = -1, originalSource = -1;
  bool tableChanged = false, rawChanged = false;
};
static LiveCatalogView catalogView;
static bool CatalogChecked(HWND root, const wchar_t *label) {
  auto menu = GetMenu(root);
  SendMessageW(root, WM_INITMENU, reinterpret_cast<WPARAM>(menu), 0);
  const auto command = Command(root, menu, label);
  if (!command.id)
    return false;
  const auto state = GetMenuState(command.menu, command.position, MF_BYPOSITION);
  return state != UINT(-1) && (state & MF_CHECKED);
}
static std::wstring CatalogMenu(const std::wstring &display) {
  if (display == L"Ability")
    return L"Abilities";
  return display + L"s";
}
static bool CatalogViewOwned(HWND root) {
  // Restore only filters we still own. A manual filter change invalidates the
  // snapshot rather than being overwritten when the lookup finishes.
  return catalogView.root == root && Text(Control(root, 18, L"Edit")) == catalogView.id &&
         Text(Control(root, 21, L"ComboBox")) == catalogView.expectedType &&
         Text(Control(root, 19, L"ComboBox")) == L"All Data" &&
         CatalogChecked(root, L"Table View") && CatalogChecked(root, L"View Raw Data");
}
static void CatalogCombo(HWND combo, int index) {
  SendMessageW(combo, CB_SETCURSEL, index, 0);
  SendMessageW(GetParent(combo), WM_COMMAND, MAKEWPARAM(GetDlgCtrlID(combo), CBN_SELCHANGE),
               reinterpret_cast<LPARAM>(combo));
}
static void CatalogSearch(HWND edit, const std::wstring &text) {
  SendMessageW(edit, WM_SETTEXT, 0, reinterpret_cast<LPARAM>(text.c_str()));
  SendMessageW(GetParent(edit), WM_COMMAND, MAKEWPARAM(GetDlgCtrlID(edit), EN_CHANGE),
               reinterpret_cast<LPARAM>(edit));
}
static void CatalogExecute(LiveDataRequest *b, HWND root) {
  if (b->pid != GetCurrentProcessId() || !IsWindow(root) || !IsWindowEnabled(root) ||
      Text(root).rfind(L"Data - [", 0) != 0 ||
      PlacementTitle(Text(root)) != PlacementTitle(b->title)) {
    Fail(b, L"LIVE_CATALOG_CONTEXT_CHANGED");
    return;
  }
  auto type = Control(root, 21, L"ComboBox"), source = Control(root, 19, L"ComboBox"),
       search = Control(root, 18, L"Edit");
  if (!type || !source || !search || Inline(root) || DataXmlPendingManual(root)) {
    Fail(b, L"LIVE_CATALOG_PENDING_INPUT_OR_VIEW_UNAVAILABLE");
    return;
  }
  if (b->operation == 91) {
    if (catalogView.root) {
      Fail(b, L"LIVE_CATALOG_LOOKUP_BUSY");
      return;
    }
    std::wstring domain = b->value, display = domain;
    if (domain == L"Abil")
      display = L"Ability";
    else if (domain == L"RequirementNode")
      display = L"Requirement Node";
    if (domain.empty() || !b->unit[0] || !b->token[0]) {
      Fail(b, L"LIVE_CATALOG_REQUEST_INVALID");
      return;
    }
    int next = int(SendMessageW(type, CB_FINDSTRINGEXACT, WPARAM(-1),
                                reinterpret_cast<LPARAM>(display.c_str())));
    if (next < 0)
      next = int(SendMessageW(type, CB_FINDSTRINGEXACT, WPARAM(-1),
                              reinterpret_cast<LPARAM>(domain.c_str())));
    int all = int(SendMessageW(source, CB_FINDSTRINGEXACT, WPARAM(-1),
                               reinterpret_cast<LPARAM>(L"All Data")));
    int oldType = int(SendMessageW(type, CB_GETCURSEL, 0, 0)),
        oldSource = int(SendMessageW(source, CB_GETCURSEL, 0, 0));
    if (all < 0 || oldType < 0 || oldSource < 0) {
      b->error = 1;
      Result(b, L"{\"error\":\"LIVE_CATALOG_DOMAIN_UNAVAILABLE\",\"domain\":" + Quote(domain) +
                    L",\"next\":" + std::to_wstring(next) + L",\"all\":" + std::to_wstring(all) +
                    L",\"oldType\":" + std::to_wstring(oldType) + L",\"oldSource\":" +
                    std::to_wstring(oldSource) + L",\"typeText\":" + Quote(Text(type)) +
                    L",\"sourceText\":" + Quote(Text(source)) + L"}");
      return;
    }
    catalogView.root = root;
    catalogView.token = b->token;
    catalogView.domain = domain;
    catalogView.id = b->unit;
    catalogView.originalSearch = Text(search);
    catalogView.expectedType = display;
    catalogView.originalTypeText = Text(type);
    catalogView.originalSourceText = Text(source);
    catalogView.originalType = oldType;
    catalogView.originalSource = oldSource;
    // Raw IDs avoid localized-name matches; All Data includes loaded dependency
    // catalogs as well as committed, still-unsaved local objects.
    SetActiveWindow(root);
    if (!Invoke(root, L"Table View", true, &catalogView.tableChanged) ||
        !Invoke(root, L"View Raw Data", true, &catalogView.rawChanged)) {
      if (catalogView.rawChanged)
        Invoke(root, L"View Raw Data");
      if (catalogView.tableChanged)
        Invoke(root, L"Table View");
      catalogView = {};
      Fail(b, L"LIVE_CATALOG_NATIVE_VIEW_UNAVAILABLE");
      return;
    }
    if (next < 0) {
      std::wstring menu = CatalogMenu(display);
      if (!Invoke(root, menu.c_str()) || (Text(type) != display && Text(type) != domain)) {
        if (catalogView.rawChanged)
          Invoke(root, L"View Raw Data");
        if (catalogView.tableChanged)
          Invoke(root, L"Table View");
        catalogView = {};
        Fail(b, L"LIVE_CATALOG_DOMAIN_UNAVAILABLE");
        return;
      }
    } else if (oldType != next)
      CatalogCombo(type, next);
    catalogView.expectedType = Text(type);
    if (oldSource != all)
      CatalogCombo(source, all);
    CatalogSearch(search, catalogView.id);
    Result(b, L"{\"prepared\":true,\"mapMutation\":false}");
    return;
  }
  if (catalogView.root != root || catalogView.token != b->token) {
    Fail(b, L"LIVE_CATALOG_TOKEN_EXPIRED");
    return;
  }
  if (!CatalogViewOwned(root)) {
    catalogView = {};
    Fail(b, L"LIVE_CATALOG_USER_VIEW_CHANGED");
    return;
  }
  if (b->operation == 93) {
    auto saved = catalogView;
    catalogView = {};
    // The catalog combo may contain only currently opened catalogs. Reopen the
    // original one through its native menu, then reacquire the rebuilt controls.
    if (Text(type) != saved.originalTypeText &&
        !Invoke(root, CatalogMenu(saved.originalTypeText).c_str())) {
      Fail(b, L"LIVE_CATALOG_RESTORE_UNCONFIRMED");
      return;
    }
    type = Control(root, 21, L"ComboBox");
    source = Control(root, 19, L"ComboBox");
    search = Control(root, 18, L"Edit");
    int sourceIndex = int(SendMessageW(source, CB_FINDSTRINGEXACT, WPARAM(-1),
                                       reinterpret_cast<LPARAM>(saved.originalSourceText.c_str())));
    if (!type || !source || !search || Text(type) != saved.originalTypeText || sourceIndex < 0) {
      Fail(b, L"LIVE_CATALOG_RESTORE_UNCONFIRMED");
      return;
    }
    CatalogCombo(source, sourceIndex);
    CatalogSearch(search, saved.originalSearch);
    if (saved.rawChanged)
      Invoke(root, L"View Raw Data");
    if (saved.tableChanged)
      Invoke(root, L"Table View");
    Result(b, L"{\"viewRestored\":true,\"mapMutation\":false}");
    return;
  }
  auto list = Control(root, 1025, L"SysListView32");
  auto header = list ? reinterpret_cast<HWND>(SendMessageW(list, LVM_GETHEADER, 0, 0)) : nullptr;
  wchar_t label[256]{};
  HDITEMW column{};
  column.mask = HDI_TEXT;
  column.pszText = label;
  column.cchTextMax = 256;
  // Switching catalogs refreshes the list asynchronously. Its header must match
  // before any row can serve as evidence for the requested domain.
  if (!header || !SendMessageW(header, HDM_GETITEMW, 0, reinterpret_cast<LPARAM>(&column)) ||
      std::wstring(label) != catalogView.expectedType + L" Name") {
    Result(b, L"{\"ready\":false,\"mapMutation\":false}");
    return;
  }
  int row = UnitRow(root, catalogView.id.c_str());
  if (row < 0) {
    Result(b, L"{\"ready\":false,\"mapMutation\":false}");
    return;
  }
  auto origin = Cell(list, row, 1);
  if (origin.empty()) {
    Fail(b, L"LIVE_CATALOG_SOURCE_UNCONFIRMED");
    return;
  }
  Result(b, L"{\"ready\":true,\"domain\":" + Quote(catalogView.domain) + L",\"id\":" +
                Quote(catalogView.id) + L",\"label\":" + Quote(Cell(list, row, 0)) +
                L",\"source\":" + Quote(origin) + L",\"mapMutation\":false}");
}
