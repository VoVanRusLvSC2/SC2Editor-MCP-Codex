// Original document commands. No archive writer or physical input.
static std::wstring PlacementHash(const std::wstring &s);
struct DocumentRefreshState {bool ready;std::wstring fingerprint;unsigned documents;bool dirty;unsigned pendingXml;bool pendingInput;};
static DocumentRefreshState DocumentRefreshInspect(HWND root) {
  auto title=Text(root);auto bracket=title.find(L'[');
  if(bracket==std::wstring::npos)return {false,L"",0};
  auto normalize=[](std::wstring s){auto p=s.find(L"*]");if(p!=std::wstring::npos)s.erase(p,1);return s;};
  auto suffix=normalize(title.substr(bracket));std::wstring source=title;
  bool dirty=title.find(L"*]")!=std::wstring::npos,ready=IsWindowEnabled(root)&&!dirty,pendingInput=false;
  unsigned pendingXml=0;
  HWND focus=GetFocus();
  unsigned documents=0;HMENU menu=GetMenu(root);
  for(int i=0;i<GetMenuItemCount(menu);i++) {
    wchar_t text[128]{};GetMenuStringW(menu,i,text,128,MF_BYPOSITION);
    if(Clean(text)!=L"Window")continue;
    HMENU windows=GetSubMenu(menu,i);
    for(int j=0;j<GetMenuItemCount(windows);j++) {
      wchar_t label[512]{};GetMenuStringW(windows,j,label,512,MF_BYPOSITION);std::wstring name=label;
      std::transform(name.begin(),name.end(),name.begin(),[](wchar_t c){return towlower(c);});
      if(name.find(L".sc2map")!=std::wstring::npos||name.find(L".sc2mod")!=std::wstring::npos){documents++;source+=L"\x1e:document:"+name;}
    }
  }
  if(documents!=1)ready=false;
  for(HWND frame:Roots()) {
    auto name=Text(frame);auto p=name.find(L'[');
    HWND owner=GetWindow(frame,GW_OWNER);
    if(IsWindowVisible(frame)&&Class(frame)==L"#32770"&&frame!=root&&owner&&!IsWindowEnabled(owner)){ready=false;source+=L"\x1e:dialog:"+name;}
    if(p==std::wstring::npos||normalize(name.substr(p))!=suffix)continue;
    source+=L"\x1e"+std::to_wstring(reinterpret_cast<uintptr_t>(frame))+L":"+name;
    if(!IsWindowEnabled(frame))ready=false;
    if(name.find(L"*]")!=std::wstring::npos){ready=false;dirty=true;}
    for(HWND h:Children(frame)) {
      const auto type=Class(h);
      if(type==L"Scintilla") {
        const auto modified=SendMessageW(h,2159,0,0),readOnly=SendMessageW(h,2140,0,0);
        source+=L":"+std::to_wstring(reinterpret_cast<uintptr_t>(h))+L":"+std::to_wstring(modified)+L":"+std::to_wstring(readOnly);
        if(modified&&!readOnly){ready=false;pendingXml++;}
      }
      if(h==focus&&(type==L"Edit"||type==L"RichEdit20W")) {
        const bool editable=!(GetWindowLongW(h,GWL_STYLE)&ES_READONLY);
        const auto modified=SendMessageW(h,EM_GETMODIFY,0,0);
        const bool pending=editable&&(GetDlgCtrlID(h)==65535||modified);
        source+=L":focused-input:"+std::to_wstring(reinterpret_cast<uintptr_t>(h))+L":"+std::to_wstring(modified);
        if(pending){ready=false;pendingInput=true;}
      }
    }
  }
  return {ready,PlacementHash(source),documents,dirty,pendingXml,pendingInput};
}
static void DocumentExecute(LiveDataRequest *b, HWND root) {
  if (b->pid != GetCurrentProcessId() || !IsWindow(root) || Text(root) != b->title ||
      Text(root).rfind(L"Terrain - [", 0) != 0 || (b->operation!=25&&!IsWindowEnabled(root))) {
    Fail(b, L"LIVE_DOCUMENT_CONTEXT_CHANGED"); return;
  }
  if(b->operation==25) {
    auto refresh=DocumentRefreshInspect(root);
    std::wstring out=L"{\"dialogs\":[";bool comma=false;
    for(HWND dialog:Roots())if(IsWindowVisible(dialog)&&Class(dialog)==L"#32770"&&dialog!=root&&GetWindow(dialog,GW_OWNER)&&!IsWindowEnabled(GetWindow(dialog,GW_OWNER))) {
      bool owned=false;HWND owner=GetWindow(dialog,GW_OWNER);
      for(int i=0;owner&&i<16;i++,owner=GetWindow(owner,GW_OWNER))if(owner==root)owned=true;
      if(comma)out+=L",";comma=true;
      out+=L"{\"handle\":"+Quote(std::to_wstring(reinterpret_cast<uintptr_t>(dialog)))+L",\"title\":"+Quote(Text(dialog))+L",\"targetOwned\":"+std::wstring(owned?L"true":L"false")+L",\"controls\":[";bool child=false;
      for(HWND h:Children(dialog))if(IsWindowVisible(h)&&(Class(h)==L"Static"||Class(h)==L"Button"||Class(h)==L"Edit")) {
        if(child)out+=L",";child=true;
        out+=L"{\"id\":"+std::to_wstring(GetDlgCtrlID(h))+L",\"type\":"+Quote(Class(h))+L",\"text\":"+Quote(Text(h))+L",\"enabled\":"+std::wstring(IsWindowEnabled(h)?L"true":L"false")+L"}";
      }
      out+=L"]}";
    }
    Result(b,out+L"],\"refreshReady\":"+std::wstring(refresh.ready?L"true":L"false")+L",\"refreshFingerprint\":"+Quote(refresh.fingerprint)+L",\"openDocuments\":"+std::to_wstring(refresh.documents)+L",\"documentDirty\":"+std::wstring(refresh.dirty?L"true":L"false")+L",\"pendingXmlBuffers\":"+std::to_wstring(refresh.pendingXml)+L",\"pendingInput\":"+std::wstring(refresh.pendingInput?L"true":L"false")+L",\"mapMutation\":false}");return;
  }
  if(b->operation==26) {
    const auto state=DocumentRefreshInspect(root);
    if(!b->token[0]||!state.ready||state.fingerprint!=b->expected){Fail(b,L"LIVE_DOCUMENT_REFRESH_NOT_CLEAN");return;}
    if(!Invoke(root,L"Close")){Fail(b,L"LIVE_DOCUMENT_CLOSE_UNAVAILABLE");return;}
    Result(b,L"{\"closeRequested\":true,\"retryMutation\":false,\"verification\":\"same_process_empty_frame_and_released_file_required\"}");return;
  }
  if (b->operation == 24) {
    const auto state=DocumentRefreshInspect(root);
    if(state.pendingInput){Fail(b,L"LIVE_DOCUMENT_PENDING_INLINE_INPUT");return;}
    if (!state.dirty&&!state.pendingXml) { Result(b, L"{\"status\":\"already_clean\",\"saveRequested\":false}"); return; }
    SetActiveWindow(root);
    if (!Invoke(root, L"Save")) { Fail(b, L"LIVE_DOCUMENT_SAVE_UNAVAILABLE"); return; }
    Result(b, L"{\"saveRequested\":true,\"verification\":\"disk_and_document_readback_required\"}"); return;
  }
  Fail(b, L"LIVE_DOCUMENT_OPERATION_UNSUPPORTED");
}
