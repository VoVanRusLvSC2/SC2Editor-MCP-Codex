// Optional thread attachment to this session's explicitly selected SDK test desktop.
// Does not switch the user's input desktop or accept secure/system desktop names.
#pragma once
#include <windows.h>
#include <string>
inline int AttachOwnedSdkDesktop() {
  wchar_t value[128]{};
  DWORD n=GetEnvironmentVariableW(L"SC2_LIVE_DESKTOP",value,128);
  if(!n)return 0;
  std::wstring name=value,prefix=L"SC2Native-";
  if(n>=128||name.size()!=prefix.size()+38||name.rfind(prefix,0)!=0||
     name[prefix.size()]!=L'{'||name.back()!=L'}')return 20;
  const auto guid=name.substr(prefix.size()+1,36);
  for(size_t i=0;i<guid.size();i++) {
    if(i==8||i==13||i==18||i==23) {if(guid[i]!=L'-')return 20;}
    else if(!((guid[i]>=L'0'&&guid[i]<=L'9')||(guid[i]>=L'a'&&guid[i]<=L'f')||
              (guid[i]>=L'A'&&guid[i]<=L'F')))return 20;
  }
  HDESK desktop=OpenDesktopW(name.c_str(),0,FALSE,
    DESKTOP_READOBJECTS|DESKTOP_WRITEOBJECTS|DESKTOP_ENUMERATE|DESKTOP_HOOKCONTROL);
  if(!desktop)return 21;
  if(!SetThreadDesktop(desktop)){CloseDesktop(desktop);return 22;}
  // This process retains the handle while its thread uses the desktop; exit releases it.
  return 0;
}
