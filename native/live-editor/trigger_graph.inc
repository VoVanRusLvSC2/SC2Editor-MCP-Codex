// Same-document GUI subtree transfer through the original Cut/Paste handlers.
// Clipboard payloads stay in native memory and are never returned to the client.
struct TriggerGraphRow {
  HTREEITEM handle;
  int parent, depth;
  std::wstring text;
};
static std::vector<TriggerGraphRow> TriggerGraphRows(HWND tree) {
  struct Pending {
    HTREEITEM handle;
    int parent, depth;
  };
  std::vector<Pending> pending;
  auto first = reinterpret_cast<HTREEITEM>(SendMessageW(tree, TVM_GETNEXTITEM, TVGN_ROOT, 0));
  if (first)
    pending.push_back({first, -1, 0});
  std::vector<TriggerGraphRow> rows;
  std::unordered_set<HTREEITEM> seen;
  while (!pending.empty() && rows.size() < 8192) {
    const auto node = pending.back();
    pending.pop_back();
    if (node.depth > 16 || !seen.insert(node.handle).second)
      return {};
    wchar_t text[512]{};
    TVITEMW item{};
    item.mask = TVIF_TEXT;
    item.hItem = node.handle;
    item.pszText = text;
    item.cchTextMax = 512;
    if (!SendMessageW(tree, TVM_GETITEMW, 0, reinterpret_cast<LPARAM>(&item)) ||
        wcslen(text) >= 511)
      return {};
    int index = int(rows.size());
    rows.push_back({node.handle, node.parent, node.depth, text});
    auto next = reinterpret_cast<HTREEITEM>(
        SendMessageW(tree, TVM_GETNEXTITEM, TVGN_NEXT, reinterpret_cast<LPARAM>(node.handle)));
    auto child = reinterpret_cast<HTREEITEM>(
        SendMessageW(tree, TVM_GETNEXTITEM, TVGN_CHILD, reinterpret_cast<LPARAM>(node.handle)));
    if (next)
      pending.push_back({next, node.parent, node.depth});
    if (child)
      pending.push_back({child, index, node.depth + 1});
  }
  if (!pending.empty() || rows.size() != size_t(SendMessageW(tree, TVM_GETCOUNT, 0, 0)))
    return {};
  return rows;
}
static std::wstring TriggerGraphShape(const std::vector<TriggerGraphRow> &rows, int skipStart = -1,
                                      int skipEnd = -1) {
  std::wstring out;
  std::map<int, int> indices;
  int next = 0;
  for (int i = 0; i < int(rows.size()); i++)
    if (i < skipStart || i >= skipEnd) {
      auto parent = rows[i].parent;
      if (parent >= 0 && !indices.count(parent))
        return L"";
      out += L"\x1e" + std::to_wstring(parent < 0 ? -1 : indices[parent]) + L":" +
             std::to_wstring(rows[i].depth) + L":" + std::to_wstring(rows[i].text.size()) + L"#" +
             rows[i].text;
      indices[i] = next++;
    }
  return out;
}
static bool TriggerGraphSingleSelection(HWND tree) {
  const auto rows = TriggerGraphRows(tree);
  int count = 0;
  for (const auto &row : rows)
    if (SendMessageW(tree, TVM_GETITEMSTATE, reinterpret_cast<WPARAM>(row.handle), TVIS_SELECTED) &
        TVIS_SELECTED)
      count++;
  return count == 1;
}
struct TriggerClipboardCopy {
  UINT format;
  HANDLE data;
};
static void TriggerFreeClipboard(TriggerClipboardCopy &item) {
  if (!item.data)
    return;
  if (item.format == CF_BITMAP || item.format == CF_DSPBITMAP)
    DeleteObject(item.data);
  else if (item.format == CF_ENHMETAFILE || item.format == CF_DSPENHMETAFILE)
    DeleteEnhMetaFile(static_cast<HENHMETAFILE>(item.data));
  else
    GlobalFree(item.data);
  item.data = nullptr;
}
struct TriggerClipboard {
  std::vector<TriggerClipboardCopy> items;
  bool captured = false;
  DWORD initialSequence = 0;
  ~TriggerClipboard() {
    for (auto &item : items)
      TriggerFreeClipboard(item);
  }
  bool capture(HWND owner) {
    if (!OpenClipboard(owner))
      return false;
    bool ok = true;
    SIZE_T bytes = 0;
    UINT format = 0;
    while ((format = EnumClipboardFormats(format)) != 0) {
      if (items.size() >= 64) {
        ok = false;
        break;
      }
      if (format == CF_METAFILEPICT || format == CF_DSPMETAFILEPICT || format == CF_PALETTE ||
          format == CF_OWNERDISPLAY) {
        ok = false;
        break;
      }
      HANDLE source = GetClipboardData(format), copy = nullptr;
      if (!source) {
        ok = false;
        break;
      }
      if (format == CF_BITMAP || format == CF_DSPBITMAP) {
        BITMAP info{};
        if (!GetObjectW(source, sizeof(info), &info) || info.bmWidth <= 0 || info.bmHeight <= 0 ||
            double(info.bmWidth) * info.bmHeight * info.bmBitsPixel * info.bmPlanes >
                128.0 * 1024 * 1024) {
          ok = false;
          break;
        }
        copy = CopyImage(source, IMAGE_BITMAP, 0, 0, LR_CREATEDIBSECTION);
      } else if (format == CF_ENHMETAFILE || format == CF_DSPENHMETAFILE) {
        copy = CopyEnhMetaFileW(static_cast<HENHMETAFILE>(source), nullptr);
      } else {
        // Unknown non-HGLOBAL formats are refused before Cut, never dropped.
        SIZE_T size = GlobalSize(source);
        bytes += size;
        if (!size || bytes > 16 * 1024 * 1024 || GlobalFlags(source) == GMEM_INVALID_HANDLE) {
          ok = false;
          break;
        }
        void *data = GlobalLock(source);
        if (!data) {
          ok = false;
          break;
        }
        copy = GlobalAlloc(GMEM_MOVEABLE, size);
        void *target = copy ? GlobalLock(copy) : nullptr;
        if (target) {
          memcpy(target, data, size);
          GlobalUnlock(copy);
        } else {
          if (copy)
            GlobalFree(copy);
          copy = nullptr;
        }
        GlobalUnlock(source);
      }
      if (!copy) {
        ok = false;
        break;
      }
      items.push_back({format, copy});
    }
    CloseClipboard();
    initialSequence = GetClipboardSequenceNumber();
    captured = ok;
    return ok;
  }
  bool restore(HWND owner, DWORD sequence) {
    if (captured && sequence == initialSequence && GetClipboardSequenceNumber() == sequence)
      return true;
    if (!captured || GetClipboardSequenceNumber() != sequence || !OpenClipboard(owner))
      return false;
    if (GetClipboardSequenceNumber() != sequence || !EmptyClipboard()) {
      CloseClipboard();
      return false;
    }
    bool ok = true;
    for (auto &item : items) {
      if (SetClipboardData(item.format, item.data))
        item.data = nullptr;
      else
        ok = false;
    }
    CloseClipboard();
    return ok;
  }
};
struct TriggerTransferState {
  HWND root = nullptr, tree = nullptr;
  HHOOK input = nullptr;
  bool manual = false;
  std::wstring token, documentTitle, original, cut, expected, copyExpected, pasteBefore,
      phase = L"cut";
  std::vector<TriggerGraphRow> before;
  int source = 0, end = 0, target = 0, originalAfterCopy = 0;
  TriggerClipboard clipboard;
  DWORD sequence = 0;
};
static TriggerTransferState *triggerTransfer = nullptr;
static LRESULT CALLBACK TriggerTransferInput(int code, WPARAM wp, LPARAM lp) {
  if (code >= 0 && wp == PM_REMOVE && triggerTransfer) {
    const auto message = reinterpret_cast<MSG *>(lp);
    const auto m = message->message;
    if ((m == WM_CHAR || m == WM_KEYDOWN || m == WM_LBUTTONDOWN || m == WM_LBUTTONDBLCLK) &&
        (message->hwnd == triggerTransfer->root || IsChild(triggerTransfer->root, message->hwnd)))
      triggerTransfer->manual = true;
  }
  return CallNextHookEx(nullptr, code, wp, lp);
}
static bool TriggerRestoreClipboard(TriggerTransferState *state) {
  DWORD owner = 0;
  GetWindowThreadProcessId(GetClipboardOwner(), &owner);
  const DWORD sequence = GetClipboardSequenceNumber();
  if (sequence != state->clipboard.initialSequence && owner != 0 && owner != GetCurrentProcessId())
    return false;
  return state->clipboard.restore(state->root, sequence);
}
static void TriggerTransferDone(LiveDataRequest *b, const wchar_t *phase, bool verified) {
  auto state = triggerTransfer;
  const bool restored = TriggerRestoreClipboard(state);
  if (state->input)
    UnhookWindowsHookEx(state->input);
  triggerTransfer = nullptr;
  delete state;
  Result(b, L"{\"submitted\":true,\"phase\":" + Quote(phase) + L",\"nativeTreeVerified\":" +
                std::wstring(verified ? L"true" : L"false") + L",\"clipboardRestored\":" +
                std::wstring(restored ? L"true" : L"false") + L",\"retryMutation\":false}");
}
static void TriggerTransferPending(LiveDataRequest *b) {
  Result(b, L"{\"status\":\"pending\",\"phase\":" + Quote(triggerTransfer->phase) +
                L",\"retryMutation\":false}");
}
static void TriggerGraphTransfer(LiveDataRequest *b, HWND root) {
  HWND tree = Control(root, 134, L"SysTreeView32");
  if (b->pid != GetCurrentProcessId() || !IsWindowEnabled(root) ||
      Text(root).rfind(L"Triggers - [", 0) != 0 ||
      PlacementTitle(Text(root)) != PlacementTitle(b->title) || !tree || !IsWindowVisible(tree)) {
    Fail(b, L"LIVE_TRIGGER_TRANSFER_CONTEXT_CHANGED");
    return;
  }
  if (std::wstring(b->value) != L"begin") {
    auto state = triggerTransfer;
    if (!state || state->root != root || state->token != b->token ||
        state->documentTitle != PlacementTitle(Text(root))) {
      Fail(b, L"LIVE_TRIGGER_TRANSFER_TOKEN_REQUIRED");
      return;
    }
    const auto now = TriggerGraphRows(tree);
    const auto shape = TriggerGraphShape(now);
    if (now.empty() || shape.empty()) {
      Fail(b, L"LIVE_TRIGGER_TRANSFER_TREE_UNREADABLE");
      return;
    }
    if (std::wstring(b->value) == L"cancel") {
      if (shape == state->original) {
        TriggerTransferDone(b, L"cancelled", true);
        return;
      }
      if (state->manual) {
        Fail(b, L"LIVE_TRIGGER_TRANSFER_MANUAL_INPUT");
        return;
      }
      if (state->phase == L"cut" && shape == state->cut) {
        SetFocus(tree);
        if (!Invoke(root, L"Undo")) {
          Fail(b, L"LIVE_TRIGGER_TRANSFER_UNDO_UNAVAILABLE");
          return;
        }
        state->phase = L"rollback";
        TriggerTransferPending(b);
        return;
      }
      Fail(b, L"LIVE_TRIGGER_TRANSFER_CANCEL_STATE_CHANGED");
      return;
    }
    if (std::wstring(b->value) != L"advance") {
      Fail(b, L"LIVE_TRIGGER_TRANSFER_PHASE_INVALID");
      return;
    }
    if (state->manual) {
      if (shape == state->expected && (state->phase == L"paste" || state->phase == L"remove")) {
        TriggerTransferDone(b, L"pasted", true);
        return;
      }
      Fail(b, L"LIVE_TRIGGER_TRANSFER_MANUAL_INPUT");
      return;
    }
    if (state->phase == L"rollback") {
      if (shape == state->original) {
        TriggerTransferDone(b, L"cancelled", true);
        return;
      }
      TriggerTransferPending(b);
      return;
    }
    if (state->phase == L"cut") {
      const bool deferredCut = shape == state->original;
      if (!deferredCut && shape != state->cut) {
        Fail(b, L"LIVE_TRIGGER_TRANSFER_CUT_MODEL_CHANGED");
        return;
      }
      const int target = !deferredCut && state->target >= state->end
                             ? state->target - (state->end - state->source)
                             : state->target;
      if (target < 0 || target >= int(now.size())) {
        Fail(b, L"LIVE_TRIGGER_TRANSFER_TARGET_CHANGED");
        return;
      }
      DWORD owner = 0;
      GetWindowThreadProcessId(GetClipboardOwner(), &owner);
      const auto sequence = GetClipboardSequenceNumber();
      if (sequence != state->clipboard.initialSequence && owner != 0 &&
          owner != GetCurrentProcessId()) {
        Fail(b, L"LIVE_TRIGGER_TRANSFER_CLIPBOARD_CHANGED");
        return;
      }
      SetActiveWindow(root);
      SetFocus(tree);
      SendMessageW(tree, TVM_SELECTITEM, TVGN_CARET, reinterpret_cast<LPARAM>(now[target].handle));
      if (!Invoke(root, L"Paste")) {
        Fail(b, L"LIVE_TRIGGER_TRANSFER_PASTE_UNAVAILABLE");
        return;
      }
      state->pasteBefore = shape;
      state->phase = L"paste";
      state->sequence = sequence;
      TriggerTransferPending(b);
      return;
    }
    if (state->phase == L"paste") {
      if (shape == state->pasteBefore) {
        TriggerTransferPending(b);
        return;
      }
      if (shape == state->copyExpected) {
        // Some Editor builds keep the cut source until insertion, or expose
        // Copy semantics here. Clear only the exact original after confirming
        // the complete duplicate graph, never by its recycled item handle.
        const int original = state->originalAfterCopy;
        if (original < 0 || original >= int(now.size())) {
          Fail(b, L"LIVE_TRIGGER_TRANSFER_SOURCE_CHANGED");
          return;
        }
        SetFocus(tree);
        SendMessageW(tree, TVM_SELECTITEM, TVGN_CARET,
                     reinterpret_cast<LPARAM>(now[original].handle));
        if (!Invoke(root, L"Clear")) {
          Fail(b, L"LIVE_TRIGGER_TRANSFER_CLEAR_UNAVAILABLE");
          return;
        }
        state->phase = L"remove";
        TriggerTransferPending(b);
        return;
      }
      TriggerTransferDone(b, shape == state->expected ? L"pasted" : L"verification_failed",
                          shape == state->expected);
      return;
    }
    if (state->phase == L"remove") {
      if (shape == state->copyExpected) {
        TriggerTransferPending(b);
        return;
      }
      TriggerTransferDone(b, shape == state->expected ? L"pasted" : L"verification_failed",
                          shape == state->expected);
      return;
    }
    Fail(b, L"LIVE_TRIGGER_TRANSFER_PHASE_INVALID");
    return;
  }
  if (triggerTransfer || !b->token[0]) {
    Fail(b, L"LIVE_TRIGGER_TRANSFER_BUSY");
    return;
  }
  if (ModuleTree(tree).hash != b->expected) {
    Fail(b, L"LIVE_MODULE_TREE_CHANGED");
    return;
  }
  auto before = TriggerGraphRows(tree);
  if (before.empty()) {
    Fail(b, L"LIVE_TRIGGER_TRANSFER_TREE_UNREADABLE");
    return;
  }
  int source = -1, target = -1;
  const auto src = std::wstring(b->field), dst = std::wstring(b->unit);
  for (int i = 0; i < int(before.size()); i++) {
    auto id = std::to_wstring(reinterpret_cast<uintptr_t>(before[i].handle));
    if (id == src)
      source = i;
    if (id == dst)
      target = i;
  }
  if (source < 0 || target < 0 || before[source].parent < 0) {
    Fail(b, L"LIVE_TRIGGER_TRANSFER_SELECTION_INVALID");
    return;
  }
  int end = source + 1;
  while (end < int(before.size()) && before[end].depth > before[source].depth)
    end++;
  const auto name = before[source].text;
  if ((target >= source && target < end) || name == L"Actions" || name == L"Conditions" ||
      name == L"Events" || name == L"If" || name == L"Then" || name == L"Else" ||
      name == L"Local Variables") {
    Fail(b, L"LIVE_TRIGGER_TRANSFER_PROTECTED_OR_CYCLIC");
    return;
  }
  const auto label = before[target].text;
  const bool container = label == L"Actions" || label == L"Conditions" || label == L"Events" ||
                         label == L"If" || label == L"Then" || label == L"Else";
  const int parent = container ? target : before[target].parent;
  if (parent < 0) {
    Fail(b, L"LIVE_TRIGGER_TRANSFER_TARGET_CHANGED");
    return;
  }
  std::vector<int> order;
  for (int i = 0; i < int(before.size()); i++)
    if (i < source || i >= end)
      order.push_back(i);
  auto where = std::find(order.begin(), order.end(), target);
  int at = int(where - order.begin()) + 1;
  if (!container)
    while (at < int(order.size()) && before[order[at]].depth > before[target].depth)
      at++;
  std::vector<int> moved;
  for (int i = source; i < end; i++)
    moved.push_back(i);
  order.insert(order.begin() + at, moved.begin(), moved.end());
  std::map<int, int> remap;
  for (int i = 0; i < int(order.size()); i++)
    remap[order[i]] = i;
  auto expected = before;
  for (int i = 0; i < int(order.size()); i++) {
    const auto old = order[i];
    auto row = before[old];
    int p = old == source ? parent : row.parent;
    row.parent = p < 0 ? -1 : remap[p];
    if (old >= source && old < end)
      row.depth += before[parent].depth + 1 - before[source].depth;
    expected[i] = row;
  }
  const int count = int(before.size());
  std::vector<int> copyOrder;
  for (int i = 0; i < count; i++)
    copyOrder.push_back(i);
  int copyAt = target + 1;
  if (!container)
    while (copyAt < count && before[copyAt].depth > before[target].depth)
      copyAt++;
  std::vector<int> clones;
  for (int i = source; i < end; i++)
    clones.push_back(i + count);
  copyOrder.insert(copyOrder.begin() + copyAt, clones.begin(), clones.end());
  std::map<int, int> copyIndices;
  for (int i = 0; i < int(copyOrder.size()); i++)
    copyIndices[copyOrder[i]] = i;
  std::vector<TriggerGraphRow> copied;
  for (int id : copyOrder) {
    const int old = id >= count ? id - count : id;
    auto row = before[old];
    int p = row.parent;
    if (id >= count) {
      p = old == source ? parent : p + count;
      row.depth += before[parent].depth + 1 - before[source].depth;
    }
    row.parent = p < 0 ? -1 : copyIndices[p];
    copied.push_back(row);
  }
  auto state = new TriggerTransferState();
  state->copyExpected = TriggerGraphShape(copied);
  state->originalAfterCopy = copyIndices[source];
  if (!state->clipboard.capture(root)) {
    delete state;
    Fail(b, L"LIVE_TRIGGER_CLIPBOARD_BACKUP_UNAVAILABLE");
    return;
  }
  state->root = root;
  state->documentTitle = PlacementTitle(Text(root));
  state->tree = tree;
  state->token = b->token;
  state->source = source;
  state->end = end;
  state->target = target;
  state->before = before;
  state->original = TriggerGraphShape(before);
  state->cut = TriggerGraphShape(before, source, end);
  state->expected = TriggerGraphShape(expected);
  triggerTransfer = state;
  state->input =
      SetWindowsHookExW(WH_GETMESSAGE, TriggerTransferInput, nullptr, GetCurrentThreadId());
  if (!state->input) {
    triggerTransfer = nullptr;
    delete state;
    Fail(b, L"LIVE_TRIGGER_TRANSFER_INPUT_GUARD_UNAVAILABLE");
    return;
  }
  SetActiveWindow(root);
  SetFocus(tree);
  SendMessageW(tree, TVM_SELECTITEM, TVGN_CARET, reinterpret_cast<LPARAM>(before[source].handle));
  if (GetFocus() != tree || !TriggerGraphSingleSelection(tree) || !Invoke(root, L"Cut")) {
    UnhookWindowsHookEx(state->input);
    triggerTransfer = nullptr;
    delete state;
    Fail(b, L"LIVE_TRIGGER_TRANSFER_CUT_UNAVAILABLE");
    return;
  }
  TriggerTransferPending(b);
}
