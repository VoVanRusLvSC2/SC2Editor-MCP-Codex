// Transfer the original Data XML buffer, then use its native Commit XML Changes.
// No map archive writes, engine offsets, private Toolkit or replacement document.
constexpr size_t kDataXmlLimit = kLiveXmlLimit;
static std::map<HWND, std::pair<std::wstring, std::wstring>> liveCommittedXml;

static HWND DataXmlControl(HWND root) {
  HWND found = nullptr;
  for (HWND h : Children(root)) {
    if (!IsWindowVisible(h) || Class(h) != L"Scintilla")
      continue;
    if (found)
      return nullptr;
    found = h;
  }
  return found;
}

static bool DataXmlText(HWND edit, std::string &bytes, std::wstring &text) {
  return LiveXmlText(edit, bytes, text);
}
static bool DataXmlPendingManual(HWND root) {
  auto edit = DataXmlControl(root);
  if (!edit || !SendMessageW(edit, 2159, 0, 0))
    return false;
  const auto known = liveCommittedXml.find(root);
  if (known == liveCommittedXml.end() || known->second.first != PlacementTitle(Text(root)))
    return true;
  std::string bytes;
  std::wstring text;
  return !DataXmlText(edit, bytes, text) || PlacementHash(text) != known->second.second;
}

static std::wstring DataXmlTransfer(const wchar_t *token, bool candidate) {
  return LiveXmlTransfer(token, L"data", candidate);
}

static void DataXmlExecute(LiveDataRequest *b, HWND root) {
  if (b->pid != GetCurrentProcessId() || !IsWindow(root) ||
      PlacementTitle(Text(root)) != PlacementTitle(b->title) ||
      Text(root).rfind(L"Data - [", 0) != 0 || !IsWindowEnabled(root)) {
    Fail(b, L"LIVE_DATA_XML_CONTEXT_CHANGED");
    return;
  }
  if (b->operation == 42) {
    // Deliberately explicit view selection. Existing uncommitted XML is preserved.
    HWND existing = DataXmlControl(root);
    if (existing && SendMessageW(existing, 2159, 0, 0)) {
      Fail(b, L"LIVE_DATA_XML_UNCOMMITTED_USER_BUFFER");
      return;
    }
    SetActiveWindow(root);
    if (!Invoke(root, L"XML View", true)) {
      Fail(b, L"LIVE_DATA_XML_VIEW_UNAVAILABLE");
      return;
    }
    Result(b, L"{\"xmlViewRequested\":true,\"mapMutation\":false}");
    return;
  }
  HWND edit = DataXmlControl(root);
  if (b->operation == 40 && std::wstring(b->field) == L"messages") {
    std::wstring out = L"{\"windows\":[";
    bool comma = false;
    for (HWND message : Roots())
      if (IsWindowVisible(message) && Text(message) == L"Messages - StarCraft II Editor") {
        if (comma)
          out += L",";
        comma = true;
        out += L"{\"title\":" + Quote(Text(message)) + L",\"controls\":[";
        bool childComma = false;
        for (HWND h : Children(message))
          if (IsWindowVisible(h)) {
            if (childComma)
              out += L",";
            childComma = true;
            out += L"{\"type\":" + Quote(Class(h)) + L",\"text\":" + Quote(Text(h)) +
                   L",\"table\":" + (Class(h) == L"SysListView32" ? Table(h, 32) : L"null") + L"}";
          }
        out += L"]}";
      }
    Result(
        b,
        out +
            L"],\"sourceCoverage\":\"visible_original_Messages_window_only\",\"mapMutation\":false}");
    return;
  }
  if (b->operation == 40 && std::wstring(b->field) == L"status") {
    Result(b, L"{\"xmlControl\":" + std::wstring(edit ? L"true" : L"false") + L",\"modified\":" +
                  std::to_wstring(edit ? SendMessageW(edit, 2159, 0, 0) : -1) + L",\"readOnly\":" +
                  std::to_wstring(edit ? SendMessageW(edit, 2140, 0, 0) : -1) + L",\"selected\":" +
                  std::wstring(Selected(root, b->unit) ? L"true" : L"false") + L",\"mapLocal\":" +
                  std::wstring(LocalSource(root, b->unit) ? L"true" : L"false") +
                  L",\"mapMutation\":false}");
    return;
  }
  if (!edit || SendMessageW(edit, 2140, 0, 0) || !Selected(root, b->unit) ||
      !LocalSource(root, b->unit)) {
    Fail(b, L"LIVE_DATA_XML_COMMITTED_LOCAL_SOURCE_REQUIRED");
    return;
  }
  std::string bytes;
  std::wstring text;
  if (!DataXmlText(edit, bytes, text)) {
    Fail(b, L"LIVE_DATA_XML_BUFFER_BOUND");
    return;
  }
  const auto fingerprint = PlacementHash(text);
  if (b->operation == 40) {
    const auto file = DataXmlTransfer(b->token, false);
    if (file.empty()) {
      Fail(b, L"LIVE_DATA_XML_TRANSFER_PATH_INVALID");
      return;
    }
    HANDLE handle =
        CreateFileW(LiveFilePath(file).c_str(), GENERIC_WRITE, FILE_SHARE_READ, nullptr, CREATE_NEW,
                    FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
    if (handle == INVALID_HANDLE_VALUE) {
      Fail(b, L"LIVE_DATA_XML_SNAPSHOT_CREATE_FAILED");
      return;
    }
    DWORD written = 0;
    bool ok = WriteFile(handle, bytes.data(), DWORD(bytes.size()), &written, nullptr) &&
              written == bytes.size();
    CloseHandle(handle);
    if (!ok) {
      Fail(b, L"LIVE_DATA_XML_SNAPSHOT_WRITE_FAILED");
      return;
    }
    Result(b, L"{\"snapshotExported\":true,\"fingerprint\":" + Quote(fingerprint) + L",\"bytes\":" +
                  std::to_wstring(bytes.size()) + L",\"bufferModified\":" +
                  std::wstring(SendMessageW(edit, 2159, 0, 0) ? L"true" : L"false") +
                  L",\"mapMutation\":false}");
    return;
  }
  if (b->operation != 41 || fingerprint != b->expected) {
    Fail(b, L"LIVE_DATA_XML_STALE_BUFFER");
    return;
  }
  const auto file = DataXmlTransfer(b->token, true);
  HANDLE handle = file.empty()
                      ? INVALID_HANDLE_VALUE
                      : CreateFileW(LiveFilePath(file).c_str(), GENERIC_READ, FILE_SHARE_READ,
                                    nullptr, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
  if (handle == INVALID_HANDLE_VALUE) {
    Fail(b, L"LIVE_DATA_XML_CANDIDATE_UNAVAILABLE");
    return;
  }
  BY_HANDLE_FILE_INFORMATION info{};
  LARGE_INTEGER length{};
  bool valid =
      GetFileInformationByHandle(handle, &info) &&
      !(info.dwFileAttributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DIRECTORY)) &&
      GetFileSizeEx(handle, &length) && length.QuadPart > 0 && length.QuadPart <= kDataXmlLimit;
  std::vector<char> candidate(valid ? size_t(length.QuadPart) + 1 : 1);
  DWORD read = 0;
  valid = valid && ReadFile(handle, candidate.data(), DWORD(length.QuadPart), &read, nullptr) &&
          read == length.QuadPart;
  CloseHandle(handle);
  if (!valid ||
      std::find(candidate.begin(), candidate.begin() + read, '\0') != candidate.begin() + read ||
      !MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, candidate.data(), int(read), nullptr,
                           0)) {
    Fail(b, L"LIVE_DATA_XML_CANDIDATE_INVALID");
    return;
  }
  SetActiveWindow(root);
  SetFocus(edit);
  // One owned buffer write and one original semantic commit, never a retry.
  SendMessageW(edit, 2181, 0, reinterpret_cast<LPARAM>(candidate.data())); // SCI_SETTEXT
  if (!Invoke(root, L"Commit XML Changes")) {
    Fail(b, L"LIVE_DATA_XML_COMMIT_UNCERTAIN_PRESERVE_BUFFER");
    return;
  }
  // The native semantic commit may leave SCI_GETMODIFY set. Only this exact
  // tool-owned committed buffer qualifies; later user text remains protected.
  std::string committedBytes;
  std::wstring committedText;
  if (DataXmlText(edit, committedBytes, committedText))
    liveCommittedXml[root] = {PlacementTitle(Text(root)), PlacementHash(committedText)};
  Result(
      b,
      L"{\"commitRequested\":true,\"retryMutation\":false,\"verification\":\"fresh_native_xml_required\"}");
}
