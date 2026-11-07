// Original Win32 Data controls on the selected Editor GUI thread. No offsets,
// private Toolkit code, archive changes or hardware input. Explicit opt-in only.
#include "memory_protocol.h"
#include <commctrl.h>
#include <string>
#include <vector>
#include <algorithm>
#include <cmath>
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "comctl32.lib")
static HWND boundWindow = nullptr;
static WNDPROC previousProcedure = nullptr;
static LiveDataRequest editStorage{};
static LiveDataRequest *activeEdit = nullptr;
static HWND ownInline = nullptr;
static ULONGLONG editStarted = 0;
static std::wstring inlineInitial;
static uintptr_t inlineGeneration = 0;
static bool deadlineSent = false;
static UINT_PTR deadlineTimer = 0;
static std::vector<HWND> beforeDialogs;
static std::wstring Text(HWND h) {
  wchar_t b[4096]{};
  GetWindowTextW(h, b, 4096);
  return b;
}
static std::wstring Class(HWND h) {
  wchar_t b[128]{};
  GetClassNameW(h, b, 128);
  return b;
}
static BOOL CALLBACK Child(HWND h, LPARAM p) {
  reinterpret_cast<std::vector<HWND> *>(p)->push_back(h);
  return TRUE;
}
static std::vector<HWND> Children(HWND h) {
  std::vector<HWND> v;
  EnumChildWindows(h, Child, reinterpret_cast<LPARAM>(&v));
  return v;
}
static std::vector<HWND> Roots() {
  std::vector<HWND> v;
  EnumThreadWindows(GetCurrentThreadId(), Child, reinterpret_cast<LPARAM>(&v));
  return v;
}
static HWND Control(HWND root, int id, const wchar_t *type) {
  HWND found = nullptr;
  for (HWND h : Children(root))
    if (GetDlgCtrlID(h) == id && Class(h) == type) {
      if (found)
        return nullptr;
      found = h;
    }
  return found;
}
static std::wstring Cell(HWND list, int row, int col) {
  wchar_t b[8192]{};
  LVITEMW x{};
  x.iSubItem = col;
  x.pszText = b;
  x.cchTextMax = 8192;
  SendMessageW(list, LVM_GETITEMTEXTW, row, reinterpret_cast<LPARAM>(&x));
  return b;
}
static std::wstring Quote(const std::wstring &text) {
  std::wstring s = L"\"";
  for (auto c : text) {
    if (c == L'"' || c == L'\\')
      s += L'\\';
    if (c == L'\n')
      s += L"\\n";
    else if (c == L'\r')
      s += L"\\r";
    else if (c == L'\t')
      s += L"\\t";
    else if (c >= 32)
      s += c;
  }
  return s + L"\"";
}
static std::wstring Table(HWND list, int limit) {
  if (!list)
    return L"null";
  int rows = int(SendMessageW(list, LVM_GETITEMCOUNT, 0, 0));
  HWND header = reinterpret_cast<HWND>(SendMessageW(list, LVM_GETHEADER, 0, 0));
  int cols = int(SendMessageW(header, HDM_GETITEMCOUNT, 0, 0));
  if (rows < 0 || rows > 200000 || cols < 0 || cols > 16)
    return L"null";
  std::wstring j = L"{\"count\":" + std::to_wstring(rows) + L",\"selected\":" +
                   std::to_wstring(SendMessageW(list, LVM_GETNEXTITEM, WPARAM(-1), LVNI_SELECTED)) +
                   L",\"headers\":[";
  for (int c = 0; c < cols; c++) {
    if (c)
      j += L",";
    wchar_t b[256]{};
    HDITEMW x{};
    x.mask = HDI_TEXT;
    x.pszText = b;
    x.cchTextMax = 256;
    SendMessageW(header, HDM_GETITEMW, c, reinterpret_cast<LPARAM>(&x));
    j += Quote(b);
  }
  j += L"],\"rows\":[";
  for (int r = 0; r < (std::min)(rows, limit); r++) {
    if (r)
      j += L",";
    j += L"[";
    for (int c = 0; c < cols; c++) {
      if (c)
        j += L",";
      j += Quote(Cell(list, r, c));
    }
    j += L"]";
  }
  return j + L"]}";
}
static std::wstring Clean(std::wstring s) {
  s.erase(std::remove(s.begin(), s.end(), L'&'), s.end());
  auto p = s.find(L'\t');
  if (p != s.npos)
    s.resize(p);
  return s;
}
struct MenuCommand {
  HMENU menu = nullptr;
  int position = -1;
  UINT id = 0;
};
static MenuCommand Command(HWND root, HMENU menu, const std::wstring &name, int depth = 0) {
  if (!menu || depth > 8)
    return {};
  MenuCommand found;
  int count = GetMenuItemCount(menu);
  if (count < 0 || count > 256)
    return {};
  for (int i = 0; i < count; i++) {
    wchar_t label[256]{};
    GetMenuStringW(menu, i, label, 256, MF_BYPOSITION);
    HMENU sub = GetSubMenu(menu, i);
    MenuCommand candidate;
    if (sub) {
      SendMessageW(root, WM_INITMENUPOPUP, reinterpret_cast<WPARAM>(sub), MAKELPARAM(i, FALSE));
      candidate = Command(root, sub, name, depth + 1);
    } else if (Clean(label) == name)
      candidate = {menu, i, GetMenuItemID(menu, i)};
    if (candidate.id) {
      if (found.id)
        return {};
      found = candidate;
    }
  }
  return found;
}
static bool Invoke(HWND root, const wchar_t *label, bool checkedOnly = false,
                   bool *changed = nullptr) {
  HMENU menu = GetMenu(root);
  SendMessageW(root, WM_INITMENU, reinterpret_cast<WPARAM>(menu), 0);
  auto command = Command(root, menu, label);
  if (!command.id)
    return false;
  UINT state = GetMenuState(command.menu, command.position, MF_BYPOSITION);
  if (state == UINT(-1) || (state & (MF_DISABLED | MF_GRAYED)))
    return false;
  if (!checkedOnly || !(state & MF_CHECKED)) {
    if (changed)
      *changed = true;
    SendMessageW(root, WM_COMMAND, command.id, 0);
  }
  return true;
}
static void Result(LiveDataRequest *b, const std::wstring &s) {
  if (s.size() >= 32768) {
    b->error = 2;
    wcscpy_s(b->result, L"{\"error\":\"LIVE_MEMORY_RESULT_BOUND\"}");
  } else
    wcscpy_s(b->result, s.c_str());
}
static bool Fail(LiveDataRequest *b, const wchar_t *code) {
  b->error = 1;
  Result(b, L"{\"error\":" + Quote(code) + L"}");
  return false;
}
static int UnitRow(HWND root, const wchar_t *unit) {
  auto list = Control(root, 1025, L"SysListView32");
  if (!list)
    return -1;
  int found = -1, count = int(SendMessageW(list, LVM_GETITEMCOUNT, 0, 0));
  if (count < 0 || count > 10000)
    return -1;
  for (int i = 0; i < count; i++) {
    auto label = Cell(list, i, 0);
    std::wstring id = unit;
    if (label != id && !(label.rfind(id + L" (", 0) == 0 && label.back() == L')'))
      continue;
    if (found >= 0)
      return -1;
    found = i;
  }
  return found;
}
static std::wstring Raw(std::wstring name) {
  const std::wstring prefix = L"(Basic) ";
  if (name.rfind(prefix, 0) == 0)
    name = name.substr(prefix.size());
  if (name.rfind(L"* ", 0) == 0)
    name = name.substr(2);
  return name;
}
static int FieldRow(HWND root, const wchar_t *field, int &valueColumn) {
  auto names = Control(root, 2025, L"SysListView32"),
       values = Control(root, 2026, L"SysListView32");
  if (!names || !values)
    return -1;
  auto header = reinterpret_cast<HWND>(SendMessageW(values, LVM_GETHEADER, 0, 0));
  if (SendMessageW(header, HDM_GETITEMCOUNT, 0, 0) != 1)
    return -1;
  valueColumn = 0;
  int found = -1, count = int(SendMessageW(names, LVM_GETITEMCOUNT, 0, 0));
  if (count < 0 || count > 2000 || SendMessageW(values, LVM_GETITEMCOUNT, 0, 0) != count)
    return -1;
  auto key = std::wstring(L"CUnit_") + field;
  for (int i = 0; i < count; i++)
    if (Raw(Cell(names, i, 0)) == key ||
        (count == 1 && Text(Control(root, 2020, L"Edit")) == key &&
         Raw(Cell(names, i, 0)).size() >= 3 && key.rfind(Raw(Cell(names, i, 0)), 0) == 0)) {
      if (found >= 0)
        return -1;
      found = i;
    }
  return found;
}
static bool Selected(HWND root, const wchar_t *unit) {
  auto list = Control(root, 1025, L"SysListView32");
  int row = UnitRow(root, unit);
  return row >= 0 && SendMessageW(list, LVM_GETSELECTEDCOUNT, 0, 0) == 1 &&
         SendMessageW(list, LVM_GETNEXTITEM, WPARAM(-1), LVNI_SELECTED) == row;
}
static HWND OwnDialog() {
  HWND found = nullptr;
  for (auto h : Roots())
    if (IsWindowVisible(h) && Class(h) == L"#32770" &&
        std::find(beforeDialogs.begin(), beforeDialogs.end(), h) == beforeDialogs.end()) {
      auto owner = GetWindow(h, GW_OWNER);
      bool ours = false;
      for (int i = 0; owner && i < 16; i++, owner = GetWindow(owner, GW_OWNER))
        if (owner == boundWindow)
          ours = true;
      if (ours) {
        if (found)
          return nullptr;
        found = h;
      }
    }
  return found;
}
static HWND Inline(HWND root) {
  auto values = Control(root, 2026, L"SysListView32");
  HWND found = nullptr;
  for (auto h : Children(values))
    if (Class(h) == L"Edit" && GetDlgCtrlID(h) == 65535 && IsWindowVisible(h)) {
      if (found)
        return nullptr;
      found = h;
    }
  return found;
}
static bool Numeric(const std::wstring &text, double &number) {
  wchar_t *end = nullptr;
  number = wcstod(text.c_str(), &end);
  return !text.empty() && end && !*end && std::isfinite(number);
}
static bool LocalSource(HWND root, const wchar_t *unit) {
  auto title = Text(root);
  auto end = title.find(L"] - StarCraft II Editor");
  if (end == title.npos)
    return false;
  auto start = title.find_last_of(L"/\\", end);
  if (start == title.npos)
    return false;
  auto file = title.substr(start + 1, end - start - 1);
  if (!file.empty() && file.back() == L'*')
    file.pop_back();
  int row = UnitRow(root, unit);
  return row >= 0 && Cell(Control(root, 1025, L"SysListView32"), row, 1) == file;
}
static bool OwnInline() {
  return ownInline && IsWindow(ownInline) && Inline(boundWindow) == ownInline &&
         GetPropW(ownInline, kLiveMemoryMessage) == reinterpret_cast<HANDLE>(inlineGeneration);
}
static bool CancelInline() {
  if (!OwnInline() || Text(ownInline) != inlineInitial)
    return false;
  PostMessageW(ownInline, WM_KEYDOWN, VK_ESCAPE, 0);
  PostMessageW(ownInline, WM_KEYUP, VK_ESCAPE, 0);
  return true;
}
static void CALLBACK EditDeadline(HWND, UINT, UINT_PTR, DWORD) {
  if (activeEdit && !deadlineSent && GetTickCount64() - editStarted > 30000) {
    deadlineSent = true;
    CancelInline();
  }
}
static void Execute(LiveDataRequest *b, HWND root) {
  if (activeEdit && !OwnDialog() &&
      (!ownInline || !IsWindow(ownInline) || !IsWindowVisible(ownInline))) {
    if (ownInline &&
        GetPropW(ownInline, kLiveMemoryMessage) == reinterpret_cast<HANDLE>(inlineGeneration))
      RemovePropW(ownInline, kLiveMemoryMessage);
    activeEdit = nullptr;
    ownInline = nullptr;
  }
  if (b->pid != GetCurrentProcessId() || !IsWindow(root) || Text(root) != b->title ||
      Text(root).rfind(L"Data - [", 0) != 0 || (!IsWindowEnabled(root) && b->operation < 4)) {
    Fail(b, L"LIVE_MEMORY_CONTEXT_CHANGED");
    return;
  }
  if (activeEdit && b->operation < 4) {
    Fail(b, L"LIVE_MEMORY_EDIT_BUSY");
    return;
  }
  if (b->operation == 0) {
    std::wstring j = L"{\"title\":" + Quote(Text(root)) + L",\"controls\":[";
    bool comma = false;
    for (HWND h : Children(root)) {
      auto c = Class(h);
      if (!IsWindowVisible(h) || (c != L"Edit" && c != L"ComboBox" && c != L"SysListView32"))
        continue;
      if (comma)
        j += L",";
      comma = true;
      j += L"{\"id\":" + std::to_wstring(GetDlgCtrlID(h)) + L",\"type\":" + Quote(c) +
           L",\"text\":" + Quote(Text(h)) + L",\"table\":" +
           (c == L"SysListView32" ? Table(h, 6) : L"null") + L"}";
    }
    Result(b, j + L"],\"objects\":" + Table(Control(root, 1025, L"SysListView32"), 5) +
                  L",\"fields\":" + Table(Control(root, 2025, L"SysListView32"), 10) +
                  L",\"fieldValues\":" + Table(Control(root, 2026, L"SysListView32"), 10) +
                  L",\"mapMutation\":false}");
    return;
  }
  if (b->operation == 1) {
    bool refresh = false;
    auto type = Control(root, 21, L"ComboBox");
    if (((!type || Text(type) != L"Unit") && !Invoke(root, L"Units", false, &refresh)) ||
        !Invoke(root, L"Table View", true, &refresh) ||
        !Invoke(root, L"View Raw Data", true, &refresh)) {
      b->error = 3;
      Result(b, L"{\"error\":\"LIVE_MEMORY_NATIVE_VIEW_UNAVAILABLE\"}");
      return;
    }
    auto search = Control(root, 18, L"Edit");
    if (!search) {
      b->error = 4;
      return;
    }
    if (Text(search) != b->unit) {
      refresh = true;
      SendMessageW(search, WM_SETTEXT, 0, reinterpret_cast<LPARAM>(b->unit));
      SendMessageW(GetParent(search), WM_COMMAND, MAKEWPARAM(18, EN_CHANGE),
                   reinterpret_cast<LPARAM>(search));
    }
    Result(b, L"{\"prepared\":true,\"refreshRequired\":" +
                  std::wstring(refresh ? L"true" : L"false") + L",\"mapMutation\":false}");
    return;
  }
  if (b->operation == 2) {
    auto list = Control(root, 1025, L"SysListView32");
    int row = UnitRow(root, b->unit);
    if (row < 0) {
      Fail(b, L"LIVE_MEMORY_EXACT_UNIT_NOT_READY");
      return;
    }
    bool refresh = !Selected(root, b->unit);
    if (refresh) {
      LVITEMW item{};
      item.stateMask = LVIS_SELECTED | LVIS_FOCUSED;
      SendMessageW(list, LVM_SETITEMSTATE, WPARAM(-1), reinterpret_cast<LPARAM>(&item));
      item.state = LVIS_SELECTED | LVIS_FOCUSED;
      SendMessageW(list, LVM_SETITEMSTATE, row, reinterpret_cast<LPARAM>(&item));
      NMITEMACTIVATE event{};
      event.hdr.hwndFrom = list;
      event.hdr.idFrom = 1025;
      event.hdr.code = NM_CLICK;
      event.iItem = row;
      LVITEMW native{};
      native.mask = LVIF_PARAM;
      native.iItem = row;
      SendMessageW(list, LVM_GETITEMW, 0, reinterpret_cast<LPARAM>(&native));
      event.lParam = native.lParam;
      SendMessageW(GetParent(list), WM_NOTIFY, 1025, reinterpret_cast<LPARAM>(&event));
    }
    auto search = Control(root, 2020, L"Edit");
    auto key = std::wstring(L"CUnit_") + b->field;
    if (search && Text(search) != key) {
      refresh = true;
      SendMessageW(search, WM_SETTEXT, 0, reinterpret_cast<LPARAM>(key.c_str()));
      SendMessageW(GetParent(search), WM_COMMAND, MAKEWPARAM(2020, EN_CHANGE),
                   reinterpret_cast<LPARAM>(search));
    }
    Result(b, L"{\"selected\":true,\"unit\":" + Quote(b->unit) + L",\"source\":" +
                  Quote(Cell(list, row, 1)) + L",\"refreshRequired\":" +
                  std::wstring(refresh ? L"true" : L"false") + L",\"mapMutation\":false}");
    return;
  }
  if (b->operation == 3) {
    if (Inline(root)) {
      Fail(b, L"LIVE_MEMORY_EXISTING_INLINE_EDIT");
      return;
    }
    if (!Selected(root, b->unit) || !LocalSource(root, b->unit)) {
      Fail(b, L"LIVE_MEMORY_LOCAL_SELECTION_REQUIRED");
      return;
    }
    int column = 0, row = FieldRow(root, b->field, column);
    auto list = Control(root, 2026, L"SysListView32");
    if (row < 0) {
      Fail(b, L"LIVE_MEMORY_FIELD_UNRESOLVED");
      return;
    }
    // Display cells may be clipped. The complete original dialog value is checked before any
    // commit.
    double value = 0;
    if (!Numeric(b->value, value) || value < 0 || value >= 524288) {
      Fail(b, L"LIVE_MEMORY_SCALAR_INVALID");
      return;
    }
    const std::vector<std::wstring> allowed = {L"LifeMax",      L"LifeStart", L"ShieldsMax",
                                               L"ShieldsStart", L"EnergyMax", L"EnergyStart",
                                               L"Speed",        L"LifeArmor"};
    if (std::find(allowed.begin(), allowed.end(), b->field) == allowed.end()) {
      Fail(b, L"LIVE_MEMORY_FIELD_UNSUPPORTED");
      return;
    }
    beforeDialogs = Roots();
    editStorage = *b;
    activeEdit = &editStorage;
    editStarted = GetTickCount64();
    deadlineSent = false;
    for (HWND table : {list, Control(root, 2025, L"SysListView32")}) {
      LVITEMW item{};
      item.stateMask = LVIS_SELECTED | LVIS_FOCUSED;
      SendMessageW(table, LVM_SETITEMSTATE, WPARAM(-1), reinterpret_cast<LPARAM>(&item));
      item.state = LVIS_SELECTED | LVIS_FOCUSED;
      SendMessageW(table, LVM_SETITEMSTATE, row, reinterpret_cast<LPARAM>(&item));
      SendMessageW(table, LVM_SETSELECTIONMARK, 0, row);
    }
    NMITEMACTIVATE event{};
    event.hdr.hwndFrom = list;
    event.hdr.idFrom = 2026;
    event.hdr.code = NM_CLICK;
    event.iItem = row;
    event.iSubItem = column;
    LVITEMW native{};
    native.mask = LVIF_PARAM;
    native.iItem = row;
    SendMessageW(list, LVM_GETITEMW, 0, reinterpret_cast<LPARAM>(&native));
    event.lParam = native.lParam;
    RECT rectangle{};
    rectangle.top = column;
    rectangle.left = LVIR_BOUNDS;
    if (SendMessageW(list, LVM_GETSUBITEMRECT, row, reinterpret_cast<LPARAM>(&rectangle))) {
      event.ptAction.x = (rectangle.left + rectangle.right) / 2;
      event.ptAction.y = (rectangle.top + rectangle.bottom) / 2;
    }
    SendMessageW(GetParent(list), WM_NOTIFY, 2026, reinterpret_cast<LPARAM>(&event));
    SetActiveWindow(root);
    SetFocus(list);
    if (!Invoke(root, L"Modify Value")) {
      activeEdit = nullptr;
      Fail(b, L"LIVE_MEMORY_MODIFY_UNAVAILABLE");
      return;
    }
    ownInline = Inline(root);
    if (ownInline) {
      inlineInitial = Text(ownInline);
      inlineGeneration++;
      SetPropW(ownInline, kLiveMemoryMessage, reinterpret_cast<HANDLE>(inlineGeneration));
    }
    if (!OwnDialog() && !ownInline)
      activeEdit = nullptr;
    Result(b, L"{\"editOpened\":" + std::wstring(activeEdit ? L"true" : L"false") + L",\"token\":" +
                  Quote(b->token) + L",\"verification\":\"read_back_required\"}");
    return;
  }
  if (b->operation >= 4 && b->operation <= 6) {
    if (!activeEdit || wcscmp(b->token, activeEdit->token) || !b->token[0]) {
      Fail(b, L"LIVE_MEMORY_OWNED_EDIT_REQUIRED");
      return;
    }
    if (OwnInline()) {
      if (b->operation == 4) {
        Result(b, L"{\"editor\":\"inline\",\"unit\":" + Quote(activeEdit->unit) + L",\"field\":" +
                      Quote(activeEdit->field) + L",\"value\":" + Quote(Text(ownInline)) + L"}");
        return;
      }
      if (b->operation == 6) {
        if (!CancelInline()) {
          Fail(b, L"LIVE_MEMORY_MANUAL_INLINE_CHANGE_PRESERVED");
          return;
        }
        Result(b, L"{\"cancelRequested\":true}");
        return;
      }
      int column = 0;
      double expected = 0, current = 0;
      if (!Numeric(activeEdit->expected, expected) || !Numeric(Text(ownInline), current) ||
          current != expected || !Selected(root, activeEdit->unit) ||
          !LocalSource(root, activeEdit->unit) || FieldRow(root, activeEdit->field, column) < 0) {
        Fail(b, L"LIVE_MEMORY_STALE_INLINE_VALUE");
        return;
      }
      SendMessageW(ownInline, WM_SETTEXT, 0, reinterpret_cast<LPARAM>(activeEdit->value));
      PostMessageW(ownInline, WM_KEYDOWN, VK_RETURN, 0);
      PostMessageW(ownInline, WM_KEYUP, VK_RETURN, 0);
      Result(b, L"{\"commitRequested\":true,\"verification\":\"read_back_required\"}");
      return;
    }
    HWND dialog = OwnDialog();
    if (!dialog) {
      Fail(b, L"LIVE_MEMORY_OWNED_DIALOG_UNRESOLVED");
      return;
    }
    if (b->operation == 4) {
      std::wstring j = L"{\"dialog\":" + Quote(Text(dialog)) + L",\"controls\":[";
      bool comma = false;
      for (auto h : Children(dialog)) {
        auto c = Class(h);
        if (c != L"Edit" && c != L"Button")
          continue;
        if (comma)
          j += L",";
        comma = true;
        j += L"{\"id\":" + std::to_wstring(GetDlgCtrlID(h)) + L",\"type\":" + Quote(c) +
             L",\"text\":" + Quote(Text(h)) + L",\"enabled\":" +
             (IsWindowEnabled(h) ? L"true" : L"false") + L"}";
      }
      Result(b, j + L"]}");
      return;
    }
    if (b->operation == 6) {
      auto cancel = GetDlgItem(dialog, IDCANCEL);
      if (!cancel || !IsWindowEnabled(cancel)) {
        Fail(b, L"LIVE_MEMORY_CANCEL_UNAVAILABLE");
        return;
      }
      PostMessageW(dialog, WM_COMMAND, IDCANCEL, 0);
      Result(b, L"{\"cancelRequested\":true}");
      return;
    }
    Fail(b, L"LIVE_MEMORY_INLINE_ONLY");
    return;
  }
  b->error = 5;
  Result(b, L"{\"error\":\"LIVE_MEMORY_OPERATION_UNSUPPORTED\"}");
}
static void ExecuteSafe(LiveDataRequest *b, HWND window) {
  __try {
    Execute(b, window);
  } __except (EXCEPTION_EXECUTE_HANDLER) {
    Fail(b, L"LIVE_MEMORY_NATIVE_EXCEPTION_UNCERTAIN");
  }
}
static void Dispatch(HWND window, WPARAM atom) {
  wchar_t name[256]{};
  if (!GlobalGetAtomNameW(ATOM(atom), name, 256)) {
    SetPropW(boundWindow, L"SC2LiveData.Debug.Error",
             reinterpret_cast<HANDLE>(static_cast<uintptr_t>(GetLastError())));
    return;
  }
  HANDLE map = OpenFileMappingW(FILE_MAP_ALL_ACCESS, FALSE, name);
  if (!map) {
    SetPropW(boundWindow, L"SC2LiveData.Debug.Error",
             reinterpret_cast<HANDLE>(static_cast<uintptr_t>(GetLastError())));
    return;
  }
  auto b = static_cast<LiveDataRequest *>(
      MapViewOfFile(map, FILE_MAP_ALL_ACCESS, 0, 0, sizeof(LiveDataRequest)));
  if (b) {
    if (b->magic == kLiveMemoryMagic && b->version == kLiveMemoryVersion &&
        b->window == reinterpret_cast<unsigned long long>(window) &&
        InterlockedCompareExchange(&b->state, 1, 0) == 0) {
      ExecuteSafe(b, window);
      InterlockedExchange(&b->state, 2);
    }
    UnmapViewOfFile(b);
  } else
    SetPropW(boundWindow, L"SC2LiveData.Debug.Error",
             reinterpret_cast<HANDLE>(static_cast<uintptr_t>(GetLastError())));
  CloseHandle(map);
}
static LRESULT CALLBACK LiveDataWindow(HWND window, UINT message, WPARAM wp, LPARAM lp) {
  if (message == RegisterWindowMessageW(kLiveMemoryMessage)) {
    Dispatch(window, wp);
    return 0;
  }
  auto result = CallWindowProcW(previousProcedure, window, message, wp, lp);
  if (message == WM_NCDESTROY) {
    if (deadlineTimer)
      KillTimer(window, deadlineTimer);
    RemovePropW(window, kLiveMemoryMessage);
    boundWindow = nullptr;
    previousProcedure = nullptr;
  }
  return result;
}
extern "C" __declspec(dllexport) DWORD WINAPI LiveDataStart(void *argument) {
  HWND target = static_cast<HWND>(argument);
  DWORD pid = 0;
  GetWindowThreadProcessId(target, &pid);
  wchar_t path[32768]{};
  GetModuleFileNameW(nullptr, path, 32768);
  auto name = wcsrchr(path, L'\\');
  name = name ? name + 1 : path;
  if (pid != GetCurrentProcessId() || _wcsicmp(name, L"SC2Editor_x64.exe") ||
      Text(target).rfind(L"Data - [", 0) != 0)
    return ERROR_INVALID_PARAMETER;
  if (boundWindow && boundWindow != target)
    return ERROR_BUSY;
  if (!previousProcedure) {
    boundWindow = target;
    SetLastError(0);
    previousProcedure = reinterpret_cast<WNDPROC>(
        SetWindowLongPtrW(target, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(LiveDataWindow)));
    if (!previousProcedure)
      return GetLastError();
    deadlineTimer = SetTimer(target, 0, 1000, EditDeadline);
  }
  SetPropW(target, kLiveMemoryMessage, reinterpret_cast<HANDLE>(1));
  return ERROR_SUCCESS;
}
