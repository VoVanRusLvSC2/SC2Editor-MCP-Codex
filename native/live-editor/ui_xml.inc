// Current UI document: original source filter, tree and XML editor. No archive I/O.
static std::wstring UiSelectedLayout(HWND tree) {
  auto item=reinterpret_cast<HTREEITEM>(SendMessageW(tree,TVM_GETNEXTITEM,TVGN_CARET,0));
  if(!item)return L"";
  for(int n=0;n<32;n++) {
    auto parent=reinterpret_cast<HTREEITEM>(SendMessageW(tree,TVM_GETNEXTITEM,TVGN_PARENT,reinterpret_cast<LPARAM>(item)));
    if(!parent)break;item=parent;if(n==31)return L"";
  }
  wchar_t text[512]{};TVITEMW value{};value.mask=TVIF_TEXT;value.hItem=item;value.pszText=text;value.cchTextMax=512;
  if(!SendMessageW(tree,TVM_GETITEMW,0,reinterpret_cast<LPARAM>(&value)))return L"";
  std::wstring label=text;if(!label.empty()&&label.back()==L'*')label.pop_back();
  const std::wstring extension=L".SC2Layout";
  if(label.size()>extension.size()&&label.substr(label.size()-extension.size())==extension)label.resize(label.size()-extension.size());
  return label;
}
static void UiXmlExecute(LiveDataRequest *b,HWND root) {
  if(b->pid!=GetCurrentProcessId()||!IsWindow(root)||!IsWindowEnabled(root)||Text(root).rfind(L"UI - [",0)!=0||PlacementTitle(Text(root))!=PlacementTitle(b->title)) {Fail(b,L"LIVE_UI_CONTEXT_CHANGED");return;}
  HWND edit=Control(root,19,L"Scintilla"),tree=Control(root,18,L"SysTreeView32"),source=Control(root,16,L"ComboBox");
  if(!edit||!tree||!source||!IsWindowVisible(edit)||!IsWindowVisible(tree)||!IsWindowVisible(source)){Fail(b,L"LIVE_UI_CONTROLS_UNAVAILABLE");return;}
  if(b->operation==61) {
    std::wstring expected=b->field;
    if(expected.empty()||Text(root).find(expected)==std::wstring::npos){Fail(b,L"LIVE_UI_SOURCE_IDENTITY_INVALID");return;}
    if(Text(source)==expected){Result(b,L"{\"sourceSelected\":true,\"changed\":false,\"mapMutation\":false}");return;}
    if(SendMessageW(edit,2159,0,0)&&!SendMessageW(edit,2140,0,0)){Fail(b,L"LIVE_UI_PENDING_BUFFER_PRESERVED");return;}
    auto count=SendMessageW(source,CB_GETCOUNT,0,0);int match=-1;
    if(count<0||count>32){Fail(b,L"LIVE_UI_SOURCE_BOUND");return;}
    for(int i=0;i<count;i++) {
      auto length=SendMessageW(source,CB_GETLBTEXTLEN,i,0);if(length<0||length>1024){Fail(b,L"LIVE_UI_SOURCE_TEXT_BOUND");return;}
      std::vector<wchar_t> value(size_t(length)+1);SendMessageW(source,CB_GETLBTEXT,i,reinterpret_cast<LPARAM>(value.data()));
      if(expected==value.data()){if(match>=0){Fail(b,L"LIVE_UI_SOURCE_AMBIGUOUS");return;}match=i;}
    }
    if(match<0){Fail(b,L"LIVE_UI_LOCAL_SOURCE_UNAVAILABLE");return;}
    SendMessageW(source,CB_SETCURSEL,match,0);SendMessageW(root,WM_COMMAND,MAKEWPARAM(16,CBN_SELCHANGE),reinterpret_cast<LPARAM>(source));
    Result(b,L"{\"sourceSelected\":true,\"changed\":true,\"mapMutation\":false}");return;
  }
  if(b->operation==60&&std::wstring(b->field)==L"status") {
    Result(b,L"{\"layout\":"+Quote(UiSelectedLayout(tree))+L",\"source\":"+Quote(Text(source))+L",\"bufferModified\":"+std::wstring(SendMessageW(edit,2159,0,0)?L"true":L"false")+L"}");return;
  }
  if(Text(source)!=b->field||UiSelectedLayout(tree)!=b->unit||SendMessageW(edit,2140,0,0)){Fail(b,L"LIVE_UI_LOCAL_LAYOUT_REQUIRED");return;}
  std::string bytes;std::wstring text;
  if(!LiveXmlText(edit,bytes,text)){Fail(b,L"LIVE_UI_XML_BUFFER_BOUND");return;}
  const auto fingerprint=PlacementHash(text);
  if(b->operation==65) {
    if(fingerprint!=b->expected||Text(root).find(L"*]")!=std::wstring::npos){Fail(b,L"LIVE_UI_PERSISTED_BUFFER_CHANGED");return;}
    // The caller proved byte equality with this layout in the stable saved archive.
    // No source/Undo changes: only mark that exact original text buffer as saved.
    SendMessageW(edit,2014,0,0); // SCI_SETSAVEPOINT
    Result(b,L"{\"persistedBufferAcknowledged\":true,\"mapMutation\":false}");return;
  }
  if(b->operation==60) {
    const auto path=LiveXmlTransfer(b->token,L"ui",false);
    HANDLE output=path.empty()?INVALID_HANDLE_VALUE:CreateFileW(LiveFilePath(path).c_str(),GENERIC_WRITE,FILE_SHARE_READ,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL|FILE_FLAG_OPEN_REPARSE_POINT,nullptr);
    if(output==INVALID_HANDLE_VALUE){Fail(b,L"LIVE_UI_SNAPSHOT_CREATE_FAILED");return;}
    DWORD written=0;bool ok=WriteFile(output,bytes.data(),DWORD(bytes.size()),&written,nullptr)&&written==bytes.size();CloseHandle(output);
    if(!ok){Fail(b,L"LIVE_UI_SNAPSHOT_WRITE_FAILED");return;}
    Result(b,L"{\"snapshotExported\":true,\"fingerprint\":"+Quote(fingerprint)+L",\"bytes\":"+std::to_wstring(bytes.size())+L",\"layout\":"+Quote(UiSelectedLayout(tree))+L",\"bufferModified\":"+std::wstring(SendMessageW(edit,2159,0,0)?L"true":L"false")+L",\"mapMutation\":false}");return;
  }
  if(b->operation!=62||fingerprint!=b->expected){Fail(b,L"LIVE_UI_STALE_BUFFER");return;}
  const auto path=LiveXmlTransfer(b->token,L"ui",true);
  HANDLE input=path.empty()?INVALID_HANDLE_VALUE:ComponentImportSource(path,b->value);
  if(input==INVALID_HANDLE_VALUE){Fail(b,L"LIVE_UI_CANDIDATE_CHANGED");return;}
  LARGE_INTEGER length{},zero{};bool ok=GetFileSizeEx(input,&length)&&length.QuadPart>0&&length.QuadPart<=kLiveXmlLimit&&SetFilePointerEx(input,zero,nullptr,FILE_BEGIN);
  std::vector<char> candidate(ok?size_t(length.QuadPart)+1:1);DWORD read=0;
  ok=ok&&ReadFile(input,candidate.data(),DWORD(length.QuadPart),&read,nullptr)&&read==length.QuadPart;CloseHandle(input);
  if(!ok||std::find(candidate.begin(),candidate.begin()+read,'\0')!=candidate.begin()+read||!MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,candidate.data(),int(read),nullptr,0)){Fail(b,L"LIVE_UI_CANDIDATE_INVALID");return;}
  SetActiveWindow(root);SetFocus(edit);SendMessageW(edit,2181,0,reinterpret_cast<LPARAM>(candidate.data()));
  SetFocus(tree);
  Result(b,L"{\"bufferWriteRequested\":true,\"retryMutation\":false,\"verification\":\"native_model_and_saved_component_readback_required\"}");
}
