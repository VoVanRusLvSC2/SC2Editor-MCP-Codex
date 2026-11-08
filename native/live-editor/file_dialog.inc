// Owned original component dialogs. Paths belong to tool storage, never map archives.
#include <bcrypt.h>
#pragma comment(lib, "bcrypt.lib")
struct ComponentDialogState {
  HWND root=nullptr;
  HWND active=nullptr,parent=nullptr;
  std::wstring token,mode,path,chosenPath,locale,initial,importPrefix;
  std::vector<std::wstring> importNames;
  std::vector<HANDLE> importSources;
  std::vector<HWND> before;
  HHOOK input=nullptr;
  UINT_PTR timer=0;
  bool manual=false;
  bool deferred=false,opened=false;
  bool fileSubmitted=false;
  int transition=0; // 1: our Browse child; 2: return from our submitted/cancelled child.
  std::vector<HWND> childBefore;
  ULONGLONG expires=0;
  HANDLE source=INVALID_HANDLE_VALUE;
  HANDLE localeSource=INVALID_HANDLE_VALUE;
};
static ComponentDialogState componentDialog;
struct ComponentCommand {const wchar_t *mode,*module,*command;bool deferred;};
static const ComponentCommand *ComponentCommandFor(const std::wstring &mode) {
  static const ComponentCommand commands[]={
    {L"library.export",L"Triggers",L"Export Library...",false},
    {L"library.import",L"Triggers",L"Import Library...",false},
    {L"layout.add",L"UI",L"Add Layout...",true},
    {L"terrain.heightfield",L"Terrain",L"Modify Height Field...",true},
    {L"import.files",L"Import",L"Import Files...",true},
    {L"locale.export",L"Text",L"Export Locales...",true},
    {L"locale.import",L"Text",L"Import Locales...",true},
  };
  for(const auto &command:commands)if(mode==command.mode)return &command;
  return nullptr;
}

static HANDLE ComponentImportSource(const std::wstring &path,const std::wstring &expected,DWORD limit=1024*1024) {
  if(expected.size()!=64)return INVALID_HANDLE_VALUE;
  HANDLE file=CreateFileW(LiveFilePath(path).c_str(),GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT,nullptr);
  if(file==INVALID_HANDLE_VALUE)return file;
  BY_HANDLE_FILE_INFORMATION info{};
  if(!GetFileInformationByHandle(file,&info)||(info.dwFileAttributes&(FILE_ATTRIBUTE_REPARSE_POINT|FILE_ATTRIBUTE_DIRECTORY))||info.nFileSizeHigh||!info.nFileSizeLow||info.nFileSizeLow>limit){CloseHandle(file);return INVALID_HANDLE_VALUE;}
  std::vector<BYTE> bytes(info.nFileSizeLow);DWORD read=0;
  if(!ReadFile(file,bytes.data(),DWORD(bytes.size()),&read,nullptr)||read!=bytes.size()){CloseHandle(file);return INVALID_HANDLE_VALUE;}
  BCRYPT_ALG_HANDLE algorithm=nullptr;BCRYPT_HASH_HANDLE hash=nullptr;BYTE digest[32]{};
  bool ok=BCryptOpenAlgorithmProvider(&algorithm,BCRYPT_SHA256_ALGORITHM,nullptr,0)>=0&&
    BCryptCreateHash(algorithm,&hash,nullptr,0,nullptr,0,0)>=0&&
    BCryptHashData(hash,bytes.data(),ULONG(bytes.size()),0)>=0&&BCryptFinishHash(hash,digest,32,0)>=0;
  if(hash)BCryptDestroyHash(hash);if(algorithm)BCryptCloseAlgorithmProvider(algorithm,0);
  std::wstring actual;const wchar_t *hex=L"0123456789abcdef";
  for(BYTE value:digest){actual+=hex[value>>4];actual+=hex[value&15];}
  if(!ok||actual!=expected){CloseHandle(file);return INVALID_HANDLE_VALUE;}
  return file; // Denies writes/deletion until the native import command returns.
}

static std::wstring ComponentLibraryPath(const wchar_t *token,const wchar_t *suffix=L".SC2Lib") {
  std::wstring id=token;
  if(id.size()!=36||std::any_of(id.begin(),id.end(),[](wchar_t c){return !(c>=L'0'&&c<=L'9')&&!(c>=L'a'&&c<=L'f')&&c!=L'-';}))return L"";
  const auto directory=LiveComponentDirectory();if(directory.empty())return L"";
  if(!LiveEnsureTransferDirectory(directory))return L"";
  return directory+L"\\"+id+suffix;
}

static bool ComponentDescendant(HWND child,HWND parent) {
  HWND owner=GetWindow(child,GW_OWNER);
  for(int i=0;owner&&i<16;i++,owner=GetWindow(owner,GW_OWNER))if(owner==parent)return true;
  return false;
}

static HWND ComponentDialogWindow() {
  if(!componentDialog.input)return nullptr;
  HWND found=nullptr;
  for(HWND h:Roots()) {
    if(!IsWindowVisible(h)||Class(h)!=L"#32770"||h==componentDialog.root||
       std::find(componentDialog.before.begin(),componentDialog.before.end(),h)!=componentDialog.before.end())continue;
    bool ours=false;HWND owner=GetWindow(h,GW_OWNER);
    for(int i=0;owner&&i<16;i++,owner=GetWindow(owner,GW_OWNER))if(owner==componentDialog.root)ours=true;
    if(ours){
      if(componentDialog.mode==L"layout.add"&&(Text(h)!=L"Enter Layout File Name"||!Control(h,13,L"Edit")||!GetDlgItem(h,11)||!GetDlgItem(h,12)))continue;
      if(found&&!ComponentDescendant(found,h)&&!ComponentDescendant(h,found))return nullptr;
      if(!found||ComponentDescendant(h,found))found=h;
    }
  }
  return found;
}
static std::wstring ComponentDialogFingerprint(HWND dialog) {
  std::wstring text=Text(dialog);
  for(HWND h:Children(dialog))if(IsWindowVisible(h)) {
    auto c=Class(h);
    if(c==L"Edit"||c==L"RichEdit20W"||c==L"ComboBox"||c==L"Static")
      text+=L"\x1e"+std::to_wstring(GetDlgCtrlID(h))+L":"+c+L":"+Text(h);
    if(c==L"Button")text+=L"\x1e"+std::to_wstring(GetDlgCtrlID(h))+L":check:"+std::to_wstring(SendMessageW(h,BM_GETCHECK,0,0));
    if(c==L"msctls_trackbar32")text+=L"\x1e"+std::to_wstring(GetDlgCtrlID(h))+L":position:"+std::to_wstring(SendMessageW(h,TBM_GETPOS,0,0));
    if(c==L"SysTreeView32"&&(GetDlgCtrlID(h)==14||GetDlgCtrlID(h)==15))text+=L"\x1e"+ModuleTree(h).hash;
  }
  return PlacementHash(text);
}
static LRESULT CALLBACK ComponentInput(int code,WPARAM wp,LPARAM lp) {
  if(code>=0&&wp==PM_REMOVE) {
    auto message=reinterpret_cast<MSG *>(lp);auto m=message->message;
    if(m==WM_CHAR||m==WM_KEYDOWN||m==WM_LBUTTONDOWN||m==WM_LBUTTONDBLCLK) {
      HWND dialog=ComponentDialogWindow();
      if(dialog&&(message->hwnd==dialog||IsChild(dialog,message->hwnd)))componentDialog.manual=true;
    }
  }
  return CallNextHookEx(componentDialog.input,code,wp,lp);
}
static void ComponentFinish() {
  if(componentDialog.timer)KillTimer(componentDialog.root,componentDialog.timer);componentDialog.timer=0;
  if(componentDialog.input)UnhookWindowsHookEx(componentDialog.input);componentDialog.input=nullptr;
  if(componentDialog.source!=INVALID_HANDLE_VALUE)CloseHandle(componentDialog.source);componentDialog.source=INVALID_HANDLE_VALUE;
  if(componentDialog.localeSource!=INVALID_HANDLE_VALUE)CloseHandle(componentDialog.localeSource);componentDialog.localeSource=INVALID_HANDLE_VALUE;
  for(auto file:componentDialog.importSources)CloseHandle(file);componentDialog.importSources.clear();componentDialog.importNames.clear();componentDialog.importPrefix.clear();
  componentDialog.deferred=false;
  componentDialog.active=nullptr;componentDialog.parent=nullptr;componentDialog.transition=0;
}
static void CALLBACK ComponentInitial(HWND,UINT,UINT_PTR,DWORD) {
  HWND dialog=ComponentDialogWindow();
  if(!dialog) {
    if(componentDialog.deferred&&(componentDialog.opened||GetTickCount64()>componentDialog.expires))ComponentFinish();
    return;
  }
  componentDialog.opened=true;
  if(!componentDialog.active){componentDialog.active=dialog;componentDialog.initial=ComponentDialogFingerprint(dialog);}
  else if(componentDialog.active!=dialog) {
    if(componentDialog.transition==1&&ComponentDescendant(dialog,componentDialog.active)&&
       std::find(componentDialog.childBefore.begin(),componentDialog.childBefore.end(),dialog)==componentDialog.childBefore.end()) {
      componentDialog.parent=componentDialog.active;
    } else if(componentDialog.transition==2&&dialog==componentDialog.parent) {
      componentDialog.parent=nullptr;
    } else return; // Never adopt a manually opened or unrelated replacement modal.
    componentDialog.active=dialog;componentDialog.initial=ComponentDialogFingerprint(dialog);componentDialog.transition=0;
  }
  if(!componentDialog.deferred){KillTimer(componentDialog.root,componentDialog.timer);componentDialog.timer=0;}
}
static bool ComponentOwned(LiveDataRequest *b,HWND root) {
  return componentDialog.input&&componentDialog.root==root&&b->token[0]&&componentDialog.token==b->token&&
    componentDialog.active&&ComponentDialogWindow()==componentDialog.active;
}
struct ComponentLocale {HTREEITEM item;std::wstring code;unsigned checked;bool available;};
static std::vector<ComponentLocale> ComponentLocales(HWND dialog) {
  HWND tree=Control(dialog,14,L"SysTreeView32");std::vector<ComponentLocale> result;
  if(!tree||SendMessageW(tree,TVM_GETCOUNT,0,0)>32)return result;
  auto item=reinterpret_cast<HTREEITEM>(SendMessageW(tree,TVM_GETNEXTITEM,TVGN_ROOT,0));
  while(item&&result.size()<32) {
    wchar_t text[256]{};TVITEMW value{};value.mask=TVIF_TEXT|TVIF_STATE;value.stateMask=TVIS_STATEIMAGEMASK;value.hItem=item;value.pszText=text;value.cchTextMax=256;
    if(!SendMessageW(tree,TVM_GETITEMW,0,reinterpret_cast<LPARAM>(&value)))return {};
    std::wstring name=text;auto p=name.rfind(L'<');
    if(p==std::wstring::npos||name.size()<p+6||name[p+5]!=L'>'||
       (name.substr(p+6)!=L""&&name.substr(p+6)!=L" (Not Found)"))return {};
    auto code=name.substr(p+1,4);if(std::any_of(result.begin(),result.end(),[&](const ComponentLocale &entry){return entry.code==code;}))return {};
    result.push_back({item,code,(value.state&TVIS_STATEIMAGEMASK)>>12,name.size()==p+6});
    item=reinterpret_cast<HTREEITEM>(SendMessageW(tree,TVM_GETNEXTITEM,TVGN_NEXT,reinterpret_cast<LPARAM>(item)));
  }
  if(item||result.size()!=SendMessageW(tree,TVM_GETCOUNT,0,0))return {};
  return result;
}
#include "import_dialog.inc"
static void ComponentExecute(LiveDataRequest *b,HWND root) {
  bool owned=ComponentOwned(b,root);
  // Synchronous library commands enter a nested modal loop too. Its filename
  // dialog may be visible before the initialization timer has observed it.
  // A matching read must wait, rather than misclassify our disabled frame as a
  // changed context. Token/root/deadline checks still reject unrelated dialogs.
  bool awaiting=componentDialog.input&&
    componentDialog.root==root&&componentDialog.token==b->token&&
    ((!componentDialog.opened&&GetTickCount64()<=componentDialog.expires)||componentDialog.transition!=0);
  std::wstring mode=b->operation==51?b->field:componentDialog.mode;
  const auto spec=ComponentCommandFor(mode);
  if(!spec){Fail(b,L"LIVE_COMPONENT_OPERATION_UNSUPPORTED");return;}
  bool ui=mode==L"layout.add";
  if(b->pid!=GetCurrentProcessId()||!IsWindow(root)||PlacementTitle(Text(root))!=PlacementTitle(b->title)||
     Text(root).rfind(std::wstring(spec->module)+L" - [",0)!=0||(!IsWindowEnabled(root)&&!owned&&!awaiting)) {
    Fail(b,L"LIVE_COMPONENT_CONTEXT_CHANGED");return;
  }
  if(b->operation==51) {
    if(componentDialog.input||ComponentDialogWindow()||!b->token[0]){Fail(b,L"LIVE_COMPONENT_DIALOG_BUSY");return;}
    if(ui) {HWND edit=Control(root,19,L"Scintilla");if(edit&&SendMessageW(edit,2159,0,0)&&!SendMessageW(edit,2140,0,0)){Fail(b,L"LIVE_UI_PENDING_BUFFER_PRESERVED");return;}}
    std::wstring path=ComponentLibraryPath(b->unit,mode.rfind(L"locale.",0)==0?L".txt":L".SC2Lib");
    if(path.empty()){Fail(b,L"LIVE_COMPONENT_OPERATION_UNSUPPORTED");return;}
    DWORD attrs=GetFileAttributesW(LiveFilePath(path).c_str());
    bool exporting=mode==L"library.export"||mode==L"locale.export",importing=mode==L"library.import"||mode==L"locale.import";
    if((exporting&&attrs!=INVALID_FILE_ATTRIBUTES)||
       (importing&&(attrs==INVALID_FILE_ATTRIBUTES||(attrs&(FILE_ATTRIBUTE_DIRECTORY|FILE_ATTRIBUTE_REPARSE_POINT))))) {
      Fail(b,L"LIVE_COMPONENT_TRANSFER_FILE_INVALID");return;
    }
    if(importing) {
      componentDialog.source=ComponentImportSource(path,b->expected);
      if(componentDialog.source==INVALID_HANDLE_VALUE){Fail(b,L"LIVE_COMPONENT_SOURCE_CHANGED");return;}
      if(mode==L"locale.import") {
        std::wstring locale=b->value;
        if(locale.size()!=4||!iswlower(locale[0])||!iswlower(locale[1])||!iswupper(locale[2])||!iswupper(locale[3])) {
          CloseHandle(componentDialog.source);componentDialog.source=INVALID_HANDLE_VALUE;Fail(b,L"LIVE_LOCALE_INVALID");return;
        }
        const auto localized=path.substr(0,path.size()-4)+L"_"+locale+L".txt";
        componentDialog.localeSource=ComponentImportSource(localized,b->expected);
        if(componentDialog.localeSource==INVALID_HANDLE_VALUE) {
          CloseHandle(componentDialog.source);componentDialog.source=INVALID_HANDLE_VALUE;Fail(b,L"LIVE_COMPONENT_SOURCE_CHANGED");return;
        }
      }
    }
    if(mode==L"import.files"&&!ImportPinSources(path,b->expected)){ComponentFinish();Fail(b,L"LIVE_IMPORT_SOURCE_INVALID");return;}
    componentDialog.root=root;componentDialog.token=b->token;componentDialog.mode=mode;
    componentDialog.path=path;componentDialog.chosenPath.clear();componentDialog.locale=mode==L"locale.import"?b->value:L"";componentDialog.before=Roots();componentDialog.initial.clear();componentDialog.manual=false;
    componentDialog.active=nullptr;componentDialog.parent=nullptr;componentDialog.transition=0;componentDialog.fileSubmitted=false;
    componentDialog.deferred=spec->deferred;componentDialog.opened=false;componentDialog.expires=GetTickCount64()+5000;
    componentDialog.input=SetWindowsHookExW(WH_GETMESSAGE,ComponentInput,nullptr,GetCurrentThreadId());
    componentDialog.timer=SetTimer(root,0,50,ComponentInitial);
    if(!componentDialog.input||!componentDialog.timer) {
      ComponentFinish();
      Fail(b,L"LIVE_COMPONENT_DIALOG_GUARD_UNAVAILABLE");return;
    }
    SetActiveWindow(root);
    bool invoked=Invoke(root,spec->command);
    if(spec->deferred&&invoked){Result(b,L"{\"status\":\"pending\",\"token\":"+Quote(componentDialog.token)+L",\"retryMutation\":false}");return;}
    ComponentFinish();
    if(!invoked){Fail(b,L"LIVE_COMPONENT_COMMAND_UNAVAILABLE");return;}
    Result(b,L"{\"dialogClosed\":true,\"mapMutation\":"+std::wstring(mode!=L"library.export"?L"true":L"false")+L"}");return;
  }
  if(!owned){Fail(b,awaiting&&b->operation==52?L"LIVE_COMPONENT_DIALOG_NOT_READY":L"LIVE_COMPONENT_OWNED_DIALOG_REQUIRED");return;}
  HWND dialog=ComponentDialogWindow();
  if(componentDialog.initial.empty()){Fail(b,L"LIVE_COMPONENT_DIALOG_NOT_READY");return;}
  auto fingerprint=ComponentDialogFingerprint(dialog);
  if(b->operation==52) {
    std::wstring out=L"{\"title\":"+Quote(Text(dialog))+L",\"fingerprint\":"+Quote(fingerprint)+L",\"initial\":"+Quote(componentDialog.initial)+
      L",\"manualInput\":"+std::wstring(componentDialog.manual?L"true":L"false")+L",\"controls\":[";bool comma=false;
    for(HWND h:Children(dialog))if(IsWindowVisible(h)) {
      if(comma)out+=L",";comma=true;
      out+=L"{\"id\":"+std::to_wstring(GetDlgCtrlID(h))+L",\"type\":"+Quote(Class(h))+L",\"text\":"+Quote(Text(h))+L",\"enabled\":"+std::wstring(IsWindowEnabled(h)?L"true":L"false");
      if(Class(h)==L"Button")out+=L",\"checked\":"+std::to_wstring(SendMessageW(h,BM_GETCHECK,0,0));
      if(Class(h)==L"msctls_trackbar32")out+=L",\"position\":"+std::to_wstring(SendMessageW(h,TBM_GETPOS,0,0));
      if(Class(h)==L"SysTreeView32"&&(GetDlgCtrlID(h)==14||GetDlgCtrlID(h)==15))out+=L",\"tree\":"+ModuleTree(h).json;
      out+=L"}";
    }
    Result(b,out+L"],\"mapMutation\":false}");return;
  }
  if(componentDialog.manual||fingerprint!=componentDialog.initial||fingerprint!=b->expected){Fail(b,L"LIVE_COMPONENT_MANUAL_DIALOG_CHANGED");return;}
  if(mode==L"import.files"&&(b->operation==58||b->operation==59)){ImportDialogExecute(b,dialog);return;}
  if(b->operation==59) {
    if(componentDialog.parent||componentDialog.transition||mode.rfind(L"locale.",0)!=0||
       (Text(dialog)!=L"Export Localized Text"&&Text(dialog)!=L"Import Localized Text")) {Fail(b,L"LIVE_LOCALE_DIALOG_REQUIRED");return;}
    auto locales=ComponentLocales(dialog);
    if(locales.empty()||std::none_of(locales.begin(),locales.end(),[&](const ComponentLocale &entry){return entry.code==b->field&&entry.available;})||
       (std::wstring(b->value)!=L"editor"&&b->value[0])){Fail(b,L"LIVE_LOCALE_OPTIONS_INVALID");return;}
    HWND tree=Control(dialog,14,L"SysTreeView32"),include=GetDlgItem(dialog,15);
    if(!include||Text(include)!=L"Include Text Which Only Displays In Editor"){Fail(b,L"LIVE_LOCALE_OPTIONS_UNAVAILABLE");return;}
    for(const auto &locale:locales) {
      unsigned desired=locale.code==b->field?2:1;if(locale.checked==desired)continue;
      SendMessageW(tree,TVM_ENSUREVISIBLE,0,reinterpret_cast<LPARAM>(locale.item));
      SendMessageW(tree,TVM_SELECTITEM,TVGN_CARET,reinterpret_cast<LPARAM>(locale.item));
      SetActiveWindow(dialog);SetFocus(tree);
      SendMessageW(tree,WM_KEYDOWN,VK_SPACE,1);SendMessageW(tree,WM_KEYUP,VK_SPACE,1);
    }
    const bool editor=std::wstring(b->value)==L"editor";
    if((SendMessageW(include,BM_GETCHECK,0,0)==BST_CHECKED)!=editor){SetActiveWindow(dialog);SendMessageW(include,BM_CLICK,0,0);}
    locales=ComponentLocales(dialog);
    if(locales.empty()||std::any_of(locales.begin(),locales.end(),[&](const ComponentLocale &entry){return entry.checked!=(entry.code==b->field?2u:1u);})||
       (SendMessageW(include,BM_GETCHECK,0,0)==BST_CHECKED)!=editor){Fail(b,L"LIVE_LOCALE_OPTIONS_UNCONFIRMED");return;}
    componentDialog.initial=ComponentDialogFingerprint(dialog);
    Result(b,L"{\"optionsSet\":true,\"fingerprint\":"+Quote(componentDialog.initial)+L",\"locale\":"+Quote(b->field)+L",\"mapMutation\":false}");return;
  }
  if(b->operation==58) {
    bool exporting=mode==L"locale.export";
    if(componentDialog.parent||componentDialog.transition||
       (exporting?Text(dialog)!=L"Export Localized Text":mode!=L"locale.import"||Text(dialog)!=L"Import Localized Text")) {Fail(b,L"LIVE_LOCALE_DIALOG_REQUIRED");return;}
    bool pathFound=false;auto normalize=[](std::wstring value){std::replace(value.begin(),value.end(),L'/',L'\\');return value;};
    for(const auto &path:{componentDialog.path,componentDialog.chosenPath})if(!path.empty()) {
      const auto separator=path.find_last_of(L'\\');const auto abbreviated=path.substr(0,3)+L"...\\"+path.substr(separator+1);
      for(HWND h:Children(dialog))if(Class(h)==L"Static"&&(normalize(Text(h))==path||normalize(Text(h))==abbreviated))pathFound=true;
    }
    HWND accept=GetDlgItem(dialog,11);
    if(!componentDialog.fileSubmitted||!pathFound){Fail(b,L"LIVE_LOCALE_PATH_UNCONFIRMED");return;}
    if(!accept||Clean(Text(accept))!=L"OK"){Fail(b,L"LIVE_LOCALE_ACCEPT_UNAVAILABLE");return;}
    if(!IsWindowEnabled(accept)){Fail(b,L"LIVE_LOCALE_COMMAND_DISABLED");return;}
    if(exporting&&GetFileAttributesW(LiveFilePath(componentDialog.path).c_str())!=INVALID_FILE_ATTRIBUTES){Fail(b,L"LIVE_COMPONENT_EXPORT_ALREADY_EXISTS");return;}
    if(exporting)for(const auto &locale:ComponentLocales(dialog))if(locale.checked==2) {
      const auto output=componentDialog.path.substr(0,componentDialog.path.size()-4)+L"_"+locale.code+L".txt";
      if(GetFileAttributesW(LiveFilePath(output).c_str())!=INVALID_FILE_ATTRIBUTES){Fail(b,L"LIVE_COMPONENT_EXPORT_ALREADY_EXISTS");return;}
    }
    PostMessageW(accept,BM_CLICK,0,0);
    Result(b,L"{\"submitted\":true,\"retryMutation\":false,\"mapMutation\":"+std::wstring(exporting?L"false":L"true")+L"}");return;
  }
  if(b->operation==57) {
    int id=mode==L"import.files"?14:13;
    const auto title=Text(dialog);
    if(componentDialog.parent||componentDialog.transition||
       !((mode==L"locale.export"&&title==L"Export Localized Text")||
         (mode==L"locale.import"&&title==L"Import Localized Text")||
         (mode==L"import.files"&&title==L"Import Files"))){Fail(b,L"LIVE_COMPONENT_BROWSE_UNSUPPORTED");return;}
    HWND browse=GetDlgItem(dialog,id);
    if(!browse||Class(browse)!=L"Button"||Text(browse)!=L"Browse..."||!IsWindowEnabled(browse)){Fail(b,L"LIVE_COMPONENT_BROWSE_UNAVAILABLE");return;}
    componentDialog.childBefore=Roots();componentDialog.transition=1;
    PostMessageW(dialog,WM_COMMAND,MAKEWPARAM(id,BN_CLICKED),reinterpret_cast<LPARAM>(browse));
    Result(b,L"{\"browseRequested\":true,\"retryMutation\":false,\"mapMutation\":false}");return;
  }
  if(b->operation==56) {
    std::wstring name=b->value;
    if(mode!=L"layout.add"||name.empty()||name.size()>80||
       std::any_of(name.begin(),name.end(),[](wchar_t c){return !(c>=L'A'&&c<=L'Z')&&!(c>=L'a'&&c<=L'z')&&!(c>=L'0'&&c<=L'9')&&c!=L'_';})||
       (name[0]>=L'0'&&name[0]<=L'9')){Fail(b,L"LIVE_LAYOUT_NAME_INVALID");return;}
    HWND edit=Control(dialog,13,L"Edit"),accept=GetDlgItem(dialog,11);
    if(!edit||!accept||!IsWindowEnabled(accept)||Clean(Text(accept))!=L"OK"){Fail(b,L"LIVE_LAYOUT_NAME_DIALOG_CHANGED");return;}
    SendMessageW(edit,WM_SETTEXT,0,reinterpret_cast<LPARAM>(name.c_str()));
    SendMessageW(dialog,WM_COMMAND,MAKEWPARAM(13,EN_CHANGE),reinterpret_cast<LPARAM>(edit));
    PostMessageW(dialog,WM_COMMAND,MAKEWPARAM(11,BN_CLICKED),reinterpret_cast<LPARAM>(accept));
    Result(b,L"{\"submitted\":true,\"retryMutation\":false,\"operation\":\"layout.add\"}");return;
  }
  if(b->operation==54) {
    HWND cancel=nullptr;
    for(HWND h:Children(dialog))if(IsWindowVisible(h)&&IsWindowEnabled(h)&&Class(h)==L"Button"&&Clean(Text(h))==L"Cancel") {
      if(cancel){Fail(b,L"LIVE_COMPONENT_CANCEL_UNAVAILABLE");return;}cancel=h;
    }
    if(!cancel){Fail(b,L"LIVE_COMPONENT_CANCEL_UNAVAILABLE");return;}
    if(componentDialog.parent)componentDialog.transition=2;
    PostMessageW(dialog,WM_COMMAND,MAKEWPARAM(GetDlgCtrlID(cancel),BN_CLICKED),reinterpret_cast<LPARAM>(cancel));
    Result(b,L"{\"cancelRequested\":true}");return;
  }
  if(b->operation==53) {
    if(mode==L"import.files"&&Text(dialog)==L"Browse For Folder") {
      HWND folder=Control(dialog,14148,L"Edit"),accept=GetDlgItem(dialog,IDOK);
      const auto attrs=GetFileAttributesW(LiveFilePath(componentDialog.path).c_str());
      if(!folder||!accept||!IsWindowEnabled(accept)||Clean(Text(accept))!=L"OK"||attrs==INVALID_FILE_ATTRIBUTES||
         !(attrs&FILE_ATTRIBUTE_DIRECTORY)||(attrs&FILE_ATTRIBUTE_REPARSE_POINT)){Fail(b,L"LIVE_IMPORT_DIRECTORY_UNAVAILABLE");return;}
      const auto separator=componentDialog.path.find_last_of(L'\\');const auto name=componentDialog.path.substr(separator+1);
      if(std::wstring(b->field)==L"selectFolder") {
        SendMessageW(dialog,WM_USER+103,TRUE,reinterpret_cast<LPARAM>(componentDialog.path.c_str()));
        if(Text(folder)!=name&&Text(folder)!=componentDialog.path){Fail(b,L"LIVE_IMPORT_DIRECTORY_SELECTION_UNCONFIRMED");return;}
        componentDialog.chosenPath=componentDialog.path;componentDialog.initial=ComponentDialogFingerprint(dialog);
        Result(b,L"{\"folderSelected\":true,\"fingerprint\":"+Quote(componentDialog.initial)+L",\"mapMutation\":false}");return;
      }
      if(std::wstring(b->field)!=L"confirmFolder"||componentDialog.chosenPath!=componentDialog.path||
         (Text(folder)!=name&&Text(folder)!=componentDialog.path)){Fail(b,L"LIVE_IMPORT_DIRECTORY_SELECTION_UNCONFIRMED");return;}
      componentDialog.transition=2;componentDialog.fileSubmitted=true;
      PostMessageW(accept,BM_CLICK,0,0);Result(b,L"{\"submitted\":true,\"retryMutation\":false,\"mapMutation\":false}");return;
    }
    HWND edit=nullptr;
    for(int id:{1148,1001,1152}) {
      auto candidate=Control(dialog,id,L"Edit");
      if(candidate&&IsWindowVisible(candidate)&&IsWindowEnabled(candidate)){if(edit){Fail(b,L"LIVE_COMPONENT_FILENAME_AMBIGUOUS");return;}edit=candidate;}
    }
    HWND accept=GetDlgItem(dialog,IDOK);
    auto label=Clean(Text(accept));
    if(!edit||!accept||!IsWindowEnabled(accept)||(label!=L"Save"&&label!=L"Open")){Fail(b,L"LIVE_COMPONENT_FILENAME_UNSUPPORTED");return;}
    if((componentDialog.mode==L"library.export"||componentDialog.mode==L"locale.export")&&GetFileAttributesW(LiveFilePath(componentDialog.path).c_str())!=INVALID_FILE_ATTRIBUTES){Fail(b,L"LIVE_COMPONENT_EXPORT_ALREADY_EXISTS");return;}
    componentDialog.chosenPath=mode==L"locale.import"?componentDialog.path.substr(0,componentDialog.path.size()-4)+L"_"+componentDialog.locale+L".txt":componentDialog.path;
    SendMessageW(edit,WM_SETTEXT,0,reinterpret_cast<LPARAM>(componentDialog.chosenPath.c_str()));
    if(Text(edit)!=componentDialog.chosenPath){Fail(b,L"LIVE_COMPONENT_FILENAME_WRITE_UNCONFIRMED");return;}
    SendMessageW(GetParent(edit),WM_COMMAND,MAKEWPARAM(GetDlgCtrlID(edit),EN_CHANGE),reinterpret_cast<LPARAM>(edit));
    if(componentDialog.parent)componentDialog.transition=2;
    componentDialog.fileSubmitted=true;
    PostMessageW(dialog,WM_COMMAND,MAKEWPARAM(IDOK,BN_CLICKED),reinterpret_cast<LPARAM>(accept));
    Result(b,L"{\"submitted\":true,\"retryMutation\":false,\"operation\":"+Quote(componentDialog.mode)+L"}");return;
  }
  Fail(b,L"LIVE_COMPONENT_OPERATION_UNSUPPORTED");
}
