#pragma once
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
constexpr unsigned kLiveMemoryMagic = 0x5343324c;
constexpr unsigned kLiveMemoryVersion = 1;
#ifndef SC2_LIVE_BUILD_TAG
#define SC2_LIVE_BUILD_TAG "dev"
#endif
#define LIVE_WIDEN_(x) L##x
#define LIVE_WIDEN(x) LIVE_WIDEN_(x)
constexpr wchar_t kLiveMemoryMessage[] =
    L"SC2EditorToolkit.LiveData.v1." LIVE_WIDEN(SC2_LIVE_BUILD_TAG);
struct LiveDataRequest {
  unsigned magic, version, operation;
  volatile LONG state;
  unsigned error, pid;
  unsigned long long window;
  wchar_t title[1024], unit[128], field[128], expected[128], value[128], token[64];
  wchar_t result[32768];
};
