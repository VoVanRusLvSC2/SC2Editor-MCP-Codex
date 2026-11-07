// Load only this adapter's sibling plugin in an explicitly selected supported
// SC2 Editor. No game process, executable patch, arbitrary DLL path or map I/O.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <tlhelp32.h>
#include <filesystem>
#include <string>
#include <cstdio>
#pragma comment(lib, "version.lib")
static uintptr_t Module(DWORD pid, const wchar_t *path, bool full) {
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid);
  if (snapshot == INVALID_HANDLE_VALUE)
    return 0;
  MODULEENTRY32W e{};
  e.dwSize = sizeof(e);
  uintptr_t found = 0;
  if (Module32FirstW(snapshot, &e))
    do {
      if (!_wcsicmp(full ? e.szExePath : e.szModule, path)) {
        found = reinterpret_cast<uintptr_t>(e.modBaseAddr);
        break;
      }
    } while (Module32NextW(snapshot, &e));
  CloseHandle(snapshot);
  return found;
}
static bool Remote(HANDLE process, uintptr_t address, void *value, DWORD &result) {
  HANDLE thread = CreateRemoteThread(
      process, nullptr, 0, reinterpret_cast<LPTHREAD_START_ROUTINE>(address), value, 0, nullptr);
  if (!thread)
    return false;
  DWORD wait = WaitForSingleObject(thread, 30000);
  bool ok = wait == WAIT_OBJECT_0 && GetExitCodeThread(thread, &result);
  CloseHandle(thread);
  if (wait == WAIT_TIMEOUT)
    SetLastError(ERROR_TIMEOUT);
  return ok;
}
int wmain(int argc, wchar_t **argv) {
  if (argc != 4)
    return 2;
  DWORD pid = wcstoul(argv[1], nullptr, 10);
  auto ticks = _wcstoui64(argv[2], nullptr, 10);
  HWND window = reinterpret_cast<HWND>(_wcstoui64(argv[3], nullptr, 10));
  DWORD actual = 0;
  GetWindowThreadProcessId(window, &actual);
  if (!pid || actual != pid)
    return 3;
  HANDLE process = OpenProcess(PROCESS_CREATE_THREAD | PROCESS_QUERY_INFORMATION |
                                   PROCESS_VM_OPERATION | PROCESS_VM_WRITE | PROCESS_VM_READ,
                               FALSE, pid);
  if (!process)
    return 4;
  FILETIME created{}, a{}, b{}, c{};
  wchar_t image[32768]{};
  DWORD length = 32768;
  bool identity = GetProcessTimes(process, &created, &a, &b, &c) &&
                  QueryFullProcessImageNameW(process, 0, image, &length);
  auto nativeTicks =
      (static_cast<unsigned long long>(created.dwHighDateTime) << 32) | created.dwLowDateTime;
  if (!identity || nativeTicks + 504911232000000000ULL != ticks ||
      _wcsicmp(std::filesystem::path(image).filename().c_str(), L"SC2Editor_x64.exe")) {
    CloseHandle(process);
    return 5;
  }
  DWORD ignored = 0;
  DWORD size = GetFileVersionInfoSizeW(image, &ignored);
  std::string bytes(size, 0);
  VS_FIXEDFILEINFO *version = nullptr;
  UINT count = 0;
  if (!size || !GetFileVersionInfoW(image, 0, size, bytes.data()) ||
      !VerQueryValueW(bytes.data(), L"\\", reinterpret_cast<void **>(&version), &count) ||
      count < sizeof(*version) || version->dwFileVersionMS != MAKELONG(0, 5) ||
      version->dwFileVersionLS != MAKELONG(98310, 17)) {
    CloseHandle(process);
    return 6;
  }
  wchar_t self[32768]{};
  GetModuleFileNameW(nullptr, self, 32768);
  auto dll = (std::filesystem::path(self).parent_path() / L"sc2-mcp-live-data.dll").wstring();
  HMODULE local = LoadLibraryExW(dll.c_str(), nullptr, DONT_RESOLVE_DLL_REFERENCES);
  if (!local) {
    CloseHandle(process);
    return 7;
  }
  auto start = GetProcAddress(local, "LiveDataStart");
  if (!start) {
    FreeLibrary(local);
    CloseHandle(process);
    return 8;
  }
  uintptr_t remote = Module(pid, dll.c_str(), true);
  DWORD result = 0;
  bool pending = false;
  if (!remote) {
    size_t bytes = (dll.size() + 1) * sizeof(wchar_t);
    void *text = VirtualAllocEx(process, nullptr, bytes, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
    if (!text || !WriteProcessMemory(process, text, dll.c_str(), bytes, nullptr)) {
      FreeLibrary(local);
      CloseHandle(process);
      return 9;
    }
    auto load = GetProcAddress(GetModuleHandleW(L"kernel32.dll"), "LoadLibraryW");
    HMODULE owner = nullptr;
    GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS |
                           GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                       reinterpret_cast<LPCWSTR>(load), &owner);
    wchar_t modulePath[32768]{};
    GetModuleFileNameW(owner, modulePath, 32768);
    auto base = Module(pid, std::filesystem::path(modulePath).filename().c_str(), false);
    bool ok =
        base &&
        Remote(process,
               base + (reinterpret_cast<uintptr_t>(load) - reinterpret_cast<uintptr_t>(owner)),
               text, result);
    pending = !ok && GetLastError() == ERROR_TIMEOUT;
    if (!pending)
      VirtualFreeEx(process, text, 0, MEM_RELEASE);
    if (!ok) {
      FreeLibrary(local);
      CloseHandle(process);
      return pending ? 11 : 10;
    }
    remote = Module(pid, dll.c_str(), true);
  }
  bool ok =
      remote &&
      Remote(process,
             remote + (reinterpret_cast<uintptr_t>(start) - reinterpret_cast<uintptr_t>(local)),
             window, result);
  FreeLibrary(local);
  CloseHandle(process);
  if (!ok || result != 0) {
    std::printf("{\"error\":\"LIVE_MEMORY_INITIALIZATION_FAILED\",\"nativeError\":%lu}\n", result);
    return 12;
  }
  std::printf("{\"loaded\":true,\"protocol\":1,\"pid\":%lu}\n", pid);
  return 0;
}
