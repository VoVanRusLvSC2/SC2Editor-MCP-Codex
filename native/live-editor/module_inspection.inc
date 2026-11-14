// Bounded original module views. Tree handles are UI snapshot identities only.
struct ModuleTreeView {
  std::wstring json, hash;
};
static ModuleTreeView ModuleTree(HWND tree, bool rootsOnly = false, int offset = 0,
                                 bool paged = false) {
  struct Node {
    HTREEITEM item, parent;
    int depth;
  };
  int count = int(SendMessageW(tree, TVM_GETCOUNT, 0, 0));
  if (count < 0 || count > 100000)
    return {};
  std::vector<Node> pending;
  std::unordered_set<HTREEITEM> seen;
  auto first = reinterpret_cast<HTREEITEM>(SendMessageW(tree, TVM_GETNEXTITEM, TVGN_ROOT, 0));
  if (first)
    pending.push_back({first, nullptr, 0});
  std::wstring items = L"[",
               source = (rootsOnly ? L"roots:" : L"tree:") + std::to_wstring(GetDlgCtrlID(tree));
  bool incomplete = false, pageFull = false;
  int emitted = 0;
  while (!pending.empty() && seen.size() < 8192) {
    auto node = pending.back();
    pending.pop_back();
    if (!seen.insert(node.item).second)
      return {};
    wchar_t text[512]{};
    TVITEMW item{};
    item.mask = TVIF_TEXT | TVIF_STATE;
    item.hItem = node.item;
    item.pszText = text;
    item.cchTextMax = 512;
    item.stateMask = TVIS_SELECTED | TVIS_STATEIMAGEMASK;
    if (!SendMessageW(tree, TVM_GETITEMW, 0, reinterpret_cast<LPARAM>(&item)))
      return {};
    if (wcslen(text) >= 511)
      incomplete = true;
    auto key = std::to_wstring(reinterpret_cast<uintptr_t>(node.item)),
         parent = std::to_wstring(reinterpret_cast<uintptr_t>(node.parent));
    auto check = (item.state & TVIS_STATEIMAGEMASK) >> 12;
    auto row = L"{\"handle\":" + Quote(key) + L",\"parent\":" + Quote(parent) + L",\"depth\":" +
               std::to_wstring(node.depth) + L",\"text\":" + Quote(text) + L",\"selected\":" +
               std::wstring(item.state & TVIS_SELECTED ? L"true" : L"false") + L",\"stateImage\":" +
               std::to_wstring(check) + L"}";
    if (int(seen.size()) > offset && !pageFull) {
      if (emitted >= 128 || (paged && items.size() + row.size() > 24000))
        pageFull = true;
      else {
        if (emitted)
          items += L",";
        items += row;
        emitted++;
      }
    }
    // Hash the whole traversal even for a page. Otherwise a change outside this
    // page could go unnoticed when the client assembles the complete tree.
    source += L"\x1e" + key + L":" + parent + L":" + text + L":" + std::to_wstring(check);
    auto next = reinterpret_cast<HTREEITEM>(
        SendMessageW(tree, TVM_GETNEXTITEM, TVGN_NEXT, reinterpret_cast<LPARAM>(node.item)));
    auto child = reinterpret_cast<HTREEITEM>(
        SendMessageW(tree, TVM_GETNEXTITEM, TVGN_CHILD, reinterpret_cast<LPARAM>(node.item)));
    if (next)
      pending.push_back({next, node.parent, node.depth});
    if (child && !rootsOnly) {
      if (node.depth < 16)
        pending.push_back({child, node.item, node.depth + 1});
      else
        incomplete = true;
    }
  }
  incomplete = incomplete || !pending.empty() || (!rootsOnly && int(seen.size()) != count);
  if (incomplete)
    return {};
  auto hash = PlacementHash(source);
  bool truncated = !paged && offset + emitted < int(seen.size());
  return {L"{\"id\":" + std::to_wstring(GetDlgCtrlID(tree)) + L",\"count\":" +
              std::to_wstring(count) + L",\"total\":" + std::to_wstring(seen.size()) +
              L",\"offset\":" + std::to_wstring(offset) + L",\"fingerprint\":" + Quote(hash) +
              L",\"truncated\":" + std::wstring(truncated ? L"true" : L"false") + L",\"items\":" +
              items + L"]}",
          hash};
}
#include "trigger_graph.inc"
static void ModuleInspectExecute(LiveDataRequest *b, HWND root) {
  if (b->operation == 68) {
    TriggerGraphTransfer(b, root);
    return;
  }
  if (b->pid != GetCurrentProcessId() || !IsWindow(root) || !IsWindowEnabled(root) ||
      PlacementTitle(Text(root)) != PlacementTitle(b->title)) {
    Fail(b, L"LIVE_MODULE_CONTEXT_CHANGED");
    return;
  }
  if (b->operation == 55 || b->operation == 66 || b->operation == 67) {
    bool rename = b->operation == 66, editGraph = b->operation == 67;
    if (rename && Text(root).rfind(L"Triggers - [", 0) != 0) {
      Fail(b, L"LIVE_TRIGGER_RENAME_CONTEXT_REQUIRED");
      return;
    }
    wchar_t *end = nullptr;
    long id = wcstol(b->unit, &end, 10);
    if (!b->unit[0] || !end || *end || id < 1 || id > 10000) {
      Fail(b, L"LIVE_MODULE_TREE_ID_INVALID");
      return;
    }
    bool rootsOnly = !rename && std::wstring(b->value) == L"roots";
    HWND tree = Control(root, int(id), L"SysTreeView32");
    auto snapshot = tree ? ModuleTree(tree, rootsOnly) : ModuleTreeView{};
    if (!tree || !IsWindowVisible(tree) || snapshot.hash.empty() || snapshot.hash != b->expected) {
      Fail(b, L"LIVE_MODULE_TREE_CHANGED");
      return;
    }
    wchar_t *itemEnd = nullptr;
    auto raw = _wcstoui64(b->field, &itemEnd, 10);
    if (!b->field[0] || !itemEnd || *itemEnd || !raw) {
      Fail(b, L"LIVE_MODULE_TREE_ITEM_INVALID");
      return;
    }
    HTREEITEM target = reinterpret_cast<HTREEITEM>(static_cast<uintptr_t>(raw));
    // Validate membership by a bounded walk, never pass an arbitrary caller pointer.
    std::vector<HTREEITEM> pending;
    auto first = reinterpret_cast<HTREEITEM>(SendMessageW(tree, TVM_GETNEXTITEM, TVGN_ROOT, 0));
    if (first)
      pending.push_back(first);
    bool found = false;
    int visited = 0;
    while (!pending.empty() && visited++ < 8192) {
      auto item = pending.back();
      pending.pop_back();
      if (item == target) {
        found = true;
        break;
      }
      auto next = reinterpret_cast<HTREEITEM>(
               SendMessageW(tree, TVM_GETNEXTITEM, TVGN_NEXT, reinterpret_cast<LPARAM>(item))),
           child = reinterpret_cast<HTREEITEM>(
               SendMessageW(tree, TVM_GETNEXTITEM, TVGN_CHILD, reinterpret_cast<LPARAM>(item)));
      if (next)
        pending.push_back(next);
      if (child && !rootsOnly)
        pending.push_back(child);
    }
    if (!found) {
      Fail(b, L"LIVE_MODULE_TREE_ITEM_INVALID");
      return;
    }
    if (editGraph) {
      const auto action = std::wstring(b->value);
      const wchar_t *label = action == L"delete" ? L"Clear"
                             : action == L"up"   ? L"Move Up"
                             : action == L"down" ? L"Move Down"
                             : action == L"in"   ? L"Move In"
                             : action == L"out"  ? L"Move Out"
                                                 : nullptr;
      if (Text(root).rfind(L"Triggers - [", 0) != 0 || id != 134 || !label ||
          SendMessageW(tree, TVM_GETEDITCONTROL, 0, 0)) {
        Fail(b, L"LIVE_TRIGGER_GRAPH_COMMAND_INVALID");
        return;
      }
      SetActiveWindow(root);
      SetFocus(tree);
      SendMessageW(tree, TVM_SELECTITEM, TVGN_CARET, reinterpret_cast<LPARAM>(target));
      if (GetFocus() != tree || reinterpret_cast<HTREEITEM>(
                                    SendMessageW(tree, TVM_GETNEXTITEM, TVGN_CARET, 0)) != target) {
        Fail(b, L"LIVE_TRIGGER_GRAPH_SELECTION_CHANGED");
        return;
      }
      if (!TriggerGraphSingleSelection(tree) || !Invoke(root, label)) {
        Fail(b, L"LIVE_TRIGGER_GRAPH_COMMAND_UNAVAILABLE");
        return;
      }
      Result(b, L"{\"submitted\":true,\"retryMutation\":false}");
      return;
    }
    if (rename) {
      auto name = std::wstring(b->value);
      if (id != 28 || name.empty() || name.size() > 80 ||
          std::any_of(name.begin(), name.end(), [](wchar_t c) { return c < 32 || c == L'*'; }) ||
          SendMessageW(tree, TVM_GETEDITCONTROL, 0, 0)) {
        Fail(b, L"LIVE_TRIGGER_RENAME_INPUT_INVALID_OR_BUSY");
        return;
      }
      wchar_t old[512]{};
      TVITEMW item{};
      item.mask = TVIF_TEXT;
      item.hItem = target;
      item.pszText = old;
      item.cchTextMax = 512;
      if (!SendMessageW(tree, TVM_GETITEMW, 0, reinterpret_cast<LPARAM>(&item))) {
        Fail(b, L"LIVE_TRIGGER_RENAME_ITEM_UNREADABLE");
        return;
      }
      SetActiveWindow(root);
      SetFocus(tree);
      SendMessageW(tree, TVM_SELECTITEM, TVGN_CARET, reinterpret_cast<LPARAM>(target));
      if (!Invoke(root, L"Rename")) {
        Fail(b, L"LIVE_TRIGGER_RENAME_COMMAND_UNAVAILABLE");
        return;
      }
      HWND edit = reinterpret_cast<HWND>(SendMessageW(tree, TVM_GETEDITCONTROL, 0, 0));
      std::wstring label = old, editable = edit ? Text(edit) : L"";
      bool decorated = !editable.empty() && label.size() > editable.size() + 3 &&
                       label.rfind(editable + L" <", 0) == 0 && label.back() == L'>';
      if (!edit || Class(edit) != L"Edit" || (editable != label && !decorated)) {
        if (edit && Class(edit) == L"Edit")
          SendMessageW(tree, TVM_ENDEDITLABELNOW, TRUE, 0);
        Fail(b, L"LIVE_TRIGGER_RENAME_INLINE_MISMATCH");
        return;
      }
      SendMessageW(edit, WM_SETTEXT, 0, reinterpret_cast<LPARAM>(name.c_str()));
      if (Text(edit) != name) {
        SendMessageW(tree, TVM_ENDEDITLABELNOW, TRUE, 0);
        Fail(b, L"LIVE_TRIGGER_RENAME_VALUE_UNCONFIRMED");
        return;
      }
      // The Editor can return zero even after its rename handler committed.
      // Treat the message as submitted and verify the actual tree separately.
      SendMessageW(tree, TVM_ENDEDITLABELNOW, FALSE, 0);
      Result(b, L"{\"submitted\":true,\"displaySuffix\":" +
                    Quote(decorated ? label.substr(editable.size()) : L"") +
                    L",\"retryMutation\":false}");
      return;
    }
    if (Text(root).rfind(L"UI - [", 0) == 0) {
      HWND edit = Control(root, 19, L"Scintilla");
      if (edit && SendMessageW(edit, 2159, 0, 0) && !SendMessageW(edit, 2140, 0, 0)) {
        auto selected =
            reinterpret_cast<HTREEITEM>(SendMessageW(tree, TVM_GETNEXTITEM, TVGN_CARET, 0));
        if (selected != target) {
          Fail(b, L"LIVE_UI_PENDING_BUFFER_PRESERVED");
          return;
        }
        Result(b, L"{\"selectionRequested\":true,\"unchanged\":true,\"mapMutation\":false}");
        return;
      }
    }
    SetActiveWindow(root);
    SetFocus(tree);
    SendMessageW(tree, TVM_SELECTITEM, TVGN_CARET, reinterpret_cast<LPARAM>(target));
    Result(b, L"{\"selectionRequested\":true,\"mapMutation\":false}");
    return;
  }
  if (std::wstring(b->field) == L"menus") {
    Result(b, L"{\"menus\":" + TerrainMenus(root, GetMenu(root)) + L",\"mapMutation\":false}");
    return;
  }
  if (std::wstring(b->field) == L"tree_page") {
    wchar_t *idEnd = nullptr, *offsetEnd = nullptr;
    long id = wcstol(b->unit, &idEnd, 10), offset = wcstol(b->value, &offsetEnd, 10);
    if (!b->unit[0] || !idEnd || *idEnd || id < 1 || id > 10000 || !b->value[0] || !offsetEnd ||
        *offsetEnd || offset < 0 || offset > 8192) {
      Fail(b, L"LIVE_MODULE_TREE_PAGE_INVALID");
      return;
    }
    HWND tree = Control(root, int(id), L"SysTreeView32");
    auto snapshot = tree ? ModuleTree(tree, false, int(offset), true) : ModuleTreeView{};
    if (!tree || !IsWindowVisible(tree) || snapshot.hash.empty()) {
      Fail(b, L"LIVE_MODULE_TREE_UNREADABLE");
      return;
    }
    if (b->expected[0] && snapshot.hash != b->expected) {
      Fail(b, L"LIVE_MODULE_TREE_CHANGED");
      return;
    }
    Result(b, L"{\"tree\":" + snapshot.json + L",\"mapMutation\":false}");
    return;
  }
  if (std::wstring(b->field) == L"trees" || std::wstring(b->field) == L"roots") {
    std::wstring out = L"{\"trees\":[";
    bool comma = false;
    for (HWND h : Children(root))
      if (IsWindowVisible(h) && Class(h) == L"SysTreeView32") {
        auto tree = ModuleTree(h, std::wstring(b->field) == L"roots");
        if (tree.json.empty()) {
          Fail(b, L"LIVE_MODULE_TREE_UNREADABLE");
          return;
        }
        if (comma)
          out += L",";
        comma = true;
        out += tree.json;
      }
    Result(b, out + L"],\"mapMutation\":false}");
    return;
  }
  std::wstring out = L"{\"title\":" + Quote(Text(root)) + L",\"controls\":[";
  bool comma = false;
  for (HWND h : Children(root))
    if (IsWindowVisible(h)) {
      if (comma)
        out += L",";
      comma = true;
      out += L"{\"id\":" + std::to_wstring(GetDlgCtrlID(h)) + L",\"type\":" + Quote(Class(h)) +
             L",\"text\":" + (Class(h) == L"Scintilla" ? L"null" : Quote(Text(h)));
      if (Class(h) == L"SysListView32")
        out += L",\"table\":" + Table(h, 8);
      if (Class(h) == L"ComboBox") {
        auto count = SendMessageW(h, CB_GETCOUNT, 0, 0);
        out += L",\"optionsTotal\":" + std::to_wstring(count) + L",\"optionsTruncated\":" +
               std::wstring(count < 0 || count > 32 ? L"true" : L"false") + L",\"options\":[";
        for (int i = 0; i < count && i < 32; i++) {
          auto length = SendMessageW(h, CB_GETLBTEXTLEN, i, 0);
          if (length < 0 || length > 1024) {
            Fail(b, L"LIVE_MODULE_COMBO_TEXT_BOUND");
            return;
          }
          std::vector<wchar_t> label(size_t(length) + 1);
          SendMessageW(h, CB_GETLBTEXT, i, reinterpret_cast<LPARAM>(label.data()));
          if (i)
            out += L",";
          out += L"{\"index\":" + std::to_wstring(i) + L",\"text\":" + Quote(label.data()) + L"}";
        }
        out += L"]";
      }
      out += L"}";
    }
  Result(b, out + L"],\"mapMutation\":false}");
}
