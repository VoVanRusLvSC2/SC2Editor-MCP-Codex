// Short per-user transport storage, shared by packaged clients and the Editor.
#include <shlobj.h>
#pragma comment(lib, "shell32.lib")
static std::wstring LiveFilePath(std::wstring path) {
  std::replace(path.begin(),path.end(),L'/',L'\\');
  if(path.rfind(L"\\\\?\\",0)==0)return path;
  if(path.rfind(L"\\\\",0)==0)return L"\\\\?\\UNC\\"+path.substr(2);
  return path.size()>2&&path[1]==L':'&&path[2]==L'\\'?L"\\\\?\\"+path:path;
}
static std::wstring LiveTemporaryDirectory() {
  // AppData writes can be redirected into an MSIX client's private LocalCache.
  // A tool-owned user-profile directory has the same physical identity in SC2.
  wchar_t profile[MAX_PATH]{};
  if(FAILED(SHGetFolderPathW(nullptr,CSIDL_PROFILE,nullptr,SHGFP_TYPE_CURRENT,profile)))return L"";
  return std::wstring(profile)+L"\\.sc2mcp\\transfer\\";
}
static std::wstring LiveComponentDirectory() {
  auto root=LiveTemporaryDirectory();if(root.empty())return L"";
  auto directory=root+L"SC2EditorToolkit-live-components";
  // UUID + .SC2Lib directory + separator + the longest accepted asset name.
  return directory.size()+1+36+7+1+96<MAX_PATH?directory:L"";
}
static bool LiveEnsureTransferDirectory(const std::wstring &directory) {
  const auto root=LiveTemporaryDirectory();if(root.empty()||directory.rfind(root,0)!=0)return false;
  const auto parent=root.substr(0,root.size()-1);
  const auto store=parent.substr(0,parent.find_last_of(L'\\'));
  for(const auto &path:{store,parent,directory}) {
    if(!CreateDirectoryW(LiveFilePath(path).c_str(),nullptr)&&GetLastError()!=ERROR_ALREADY_EXISTS)return false;
    const auto attrs=GetFileAttributesW(LiveFilePath(path).c_str());
    if(attrs==INVALID_FILE_ATTRIBUTES||!(attrs&FILE_ATTRIBUTE_DIRECTORY)||(attrs&FILE_ATTRIBUTE_REPARSE_POINT))return false;
  }
  return true;
}
