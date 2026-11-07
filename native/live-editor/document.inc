// Original visible Terrain File > Save; no archive writer, reopen or physical input.
static void DocumentExecute(LiveDataRequest *b, HWND root) {
  if (b->pid != GetCurrentProcessId() || !IsWindow(root) || Text(root) != b->title ||
      Text(root).rfind(L"Terrain - [", 0) != 0 || !IsWindowEnabled(root)) {
    Fail(b, L"LIVE_DOCUMENT_CONTEXT_CHANGED"); return;
  }
  if (b->operation == 24) {
    if (Text(root).find(L"*]") == std::wstring::npos) { Result(b, L"{\"status\":\"already_clean\",\"saveRequested\":false}"); return; }
    if (!Invoke(root, L"Save")) { Fail(b, L"LIVE_DOCUMENT_SAVE_UNAVAILABLE"); return; }
    Result(b, L"{\"saveRequested\":true,\"verification\":\"disk_and_document_readback_required\"}"); return;
  }
  Fail(b, L"LIVE_DOCUMENT_OPERATION_UNSUPPORTED");
}
