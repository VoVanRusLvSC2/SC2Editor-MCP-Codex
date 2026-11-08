// Original Import Files parent; component sources stay pinned until its handler returns.
static bool ImportAssetName(const std::wstring &name) {
  if(name.empty()||name.size()>96||!iswalnum(name[0])||name.find(L"..")!=std::wstring::npos)return false;
  return std::all_of(name.begin(),name.end(),[](wchar_t c){return (c>=L'A'&&c<=L'Z')||(c>=L'a'&&c<=L'z')||(c>=L'0'&&c<=L'9')||c==L'.'||c==L'_'||c==L'-';});
}
static bool ImportDirectoryMatches(const std::wstring &directory) {
  auto attrs=GetFileAttributesW(LiveFilePath(directory).c_str());
  if(attrs==INVALID_FILE_ATTRIBUTES||!(attrs&FILE_ATTRIBUTE_DIRECTORY)||(attrs&FILE_ATTRIBUTE_REPARSE_POINT))return false;
  WIN32_FIND_DATAW entry{};HANDLE search=FindFirstFileW(LiveFilePath(directory+L"\\*").c_str(),&entry);
  if(search==INVALID_HANDLE_VALUE)return false;
  size_t count=0;bool valid=true;
  do {
    std::wstring name=entry.cFileName;if(name==L"."||name==L"..")continue;
    if((entry.dwFileAttributes&(FILE_ATTRIBUTE_DIRECTORY|FILE_ATTRIBUTE_REPARSE_POINT))||
       std::find(componentDialog.importNames.begin(),componentDialog.importNames.end(),name)==componentDialog.importNames.end()){valid=false;break;}
    count++;
  }while(FindNextFileW(search,&entry));
  FindClose(search);return valid&&count==componentDialog.importNames.size();
}
static bool ImportPinSources(const std::wstring &directory,const std::wstring &expected) {
  const auto manifest=directory+L".assets";
  componentDialog.source=ComponentImportSource(manifest,expected,4096);
  if(componentDialog.source==INVALID_HANDLE_VALUE)return false;
  SetFilePointer(componentDialog.source,0,nullptr,FILE_BEGIN);char bytes[4097]{};DWORD read=0;
  if(!ReadFile(componentDialog.source,bytes,4096,&read,nullptr)||!read)return false;
  std::string source(bytes,read);size_t position=0;unsigned long long total=0;
  while(position<source.size()) {
    auto end=source.find('\n',position);if(end==std::string::npos)return false;
    auto line=source.substr(position,end-position);position=end+1;
    if(line.size()<67||line[64]!='\t'||componentDialog.importNames.size()>=16)return false;
    if(std::any_of(line.begin(),line.end(),[](unsigned char c){return c>127||c=='\r'||c==0;}))return false;
    std::wstring hash(line.begin(),line.begin()+64),name(line.begin()+65,line.end());
    if(!ImportAssetName(name)||std::find(componentDialog.importNames.begin(),componentDialog.importNames.end(),name)!=componentDialog.importNames.end())return false;
    auto file=ComponentImportSource(directory+L"\\"+name,hash,16*1024*1024);
    if(file==INVALID_HANDLE_VALUE)return false;
    componentDialog.importSources.push_back(file);componentDialog.importNames.push_back(name);
    total+=GetFileSize(file,nullptr);if(total>64*1024*1024)return false;
  }
  return !componentDialog.importNames.empty()&&ImportDirectoryMatches(directory);
}
static bool ImportTreeMatches(HWND dialog) {
  HWND tree=Control(dialog,15,L"SysTreeView32");
  if(!tree||SendMessageW(tree,TVM_GETCOUNT,0,0)!=componentDialog.importNames.size()+1)return false;
  auto root=reinterpret_cast<HTREEITEM>(SendMessageW(tree,TVM_GETNEXTITEM,TVGN_ROOT,0));
  if(!root||SendMessageW(tree,TVM_GETNEXTITEM,TVGN_NEXT,reinterpret_cast<LPARAM>(root)))return false;
  auto item=reinterpret_cast<HTREEITEM>(SendMessageW(tree,TVM_GETNEXTITEM,TVGN_CHILD,reinterpret_cast<LPARAM>(root)));
  std::vector<std::wstring> names;
  while(item&&names.size()<16) {
    wchar_t text[128]{};TVITEMW value{};value.mask=TVIF_TEXT|TVIF_STATE;value.hItem=item;value.pszText=text;value.cchTextMax=128;value.stateMask=TVIS_STATEIMAGEMASK;
    if(!SendMessageW(tree,TVM_GETITEMW,0,reinterpret_cast<LPARAM>(&value))||((value.state&TVIS_STATEIMAGEMASK)>>12)!=2||
       SendMessageW(tree,TVM_GETNEXTITEM,TVGN_CHILD,reinterpret_cast<LPARAM>(item)))return false;
    names.push_back(text);item=reinterpret_cast<HTREEITEM>(SendMessageW(tree,TVM_GETNEXTITEM,TVGN_NEXT,reinterpret_cast<LPARAM>(item)));
  }
  auto expected=componentDialog.importNames;std::sort(names.begin(),names.end());std::sort(expected.begin(),expected.end());
  return !item&&names==expected;
}
static bool ImportPrefixValid(const std::wstring &prefix) {
  if(prefix.size()<8||prefix.size()>96||prefix.rfind(L"Assets/",0)!=0||prefix.back()!=L'/'||prefix.find(L"//")!=std::wstring::npos)return false;
  return std::all_of(prefix.begin(),prefix.end(),[](wchar_t c){return (c>=L'A'&&c<=L'Z')||(c>=L'a'&&c<=L'z')||(c>=L'0'&&c<=L'9')||c==L'/'||c==L'_'||c==L'-';});
}
static void ImportDialogExecute(LiveDataRequest *b,HWND dialog) {
  if(componentDialog.parent||componentDialog.transition||Text(dialog)!=L"Import Files"||!componentDialog.fileSubmitted||
     componentDialog.chosenPath!=componentDialog.path||!ImportDirectoryMatches(componentDialog.path)||!ImportTreeMatches(dialog)) {
    Fail(b,L"LIVE_IMPORT_DIALOG_CHANGED");return;
  }
  HWND edit=Control(dialog,13,L"Edit"),accept=GetDlgItem(dialog,11);
  if(!edit||!accept||Clean(Text(accept))!=L"OK"||!IsWindowEnabled(accept)){Fail(b,L"LIVE_IMPORT_CONTROLS_UNAVAILABLE");return;}
  if(b->operation==59) {
    std::wstring prefix=b->value;if(!ImportPrefixValid(prefix)){Fail(b,L"LIVE_IMPORT_PREFIX_INVALID");return;}
    SendMessageW(edit,WM_SETTEXT,0,reinterpret_cast<LPARAM>(prefix.c_str()));
    SendMessageW(dialog,WM_COMMAND,MAKEWPARAM(13,EN_CHANGE),reinterpret_cast<LPARAM>(edit));
    if(Text(edit)!=prefix){Fail(b,L"LIVE_IMPORT_PREFIX_UNCONFIRMED");return;}
    componentDialog.importPrefix=prefix;componentDialog.initial=ComponentDialogFingerprint(dialog);
    Result(b,L"{\"optionsSet\":true,\"fingerprint\":"+Quote(componentDialog.initial)+L",\"mapMutation\":false}");return;
  }
  if(componentDialog.importPrefix.empty()||Text(edit)!=componentDialog.importPrefix){Fail(b,L"LIVE_IMPORT_PREFIX_UNCONFIRMED");return;}
  PostMessageW(accept,BM_CLICK,0,0);
  Result(b,L"{\"submitted\":true,\"retryMutation\":false,\"mapMutation\":true}");
}
