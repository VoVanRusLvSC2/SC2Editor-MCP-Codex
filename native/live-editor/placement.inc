// Original visible Terrain controls. No map replacement, hidden worker or input injection.
static std::wstring TerrainMenus(HWND root, HMENU menu, int depth = 0) {
  if (!menu || depth > 6) return L"[]";
  std::wstring out = L"[";
  int count = GetMenuItemCount(menu);
  if (count < 0 || count > 128) return L"[]";
  for (int i = 0; i < count; i++) {
    if (i) out += L",";
    wchar_t text[256]{};
    GetMenuStringW(menu, i, text, 256, MF_BYPOSITION);
    HMENU child = GetSubMenu(menu, i);
    out += L"{\"label\":" + Quote(Clean(text)) + L",\"id\":" + std::to_wstring(GetMenuItemID(menu, i));
    if (child) out += L",\"children\":" + TerrainMenus(root, child, depth + 1);
    out += L"}";
  }
  return out + L"]";
}
static std::vector<HWND> placementBeforeDialogs;
static std::wstring placementDialogToken;
static std::wstring placementInitial;
static std::wstring placementExpectedType,placementExpectedName;
static HWND placementRoot=nullptr;
static UINT_PTR placementTimer=0;
static bool placementManual=false;
static std::wstring PlacementPropertiesHash(HWND dialog);
static bool PlacementPropertiesValid(HWND dialog);
static bool PlacementPropertiesMatch(HWND dialog);
static HWND PlacementDialog(HWND root);
static std::wstring PlacementTitle(std::wstring title) {
  auto marker=title.find(L"*]");if(marker!=std::wstring::npos)title.erase(marker,1);return title;
}
static HHOOK placementFocusHook=nullptr;
static HHOOK placementInputHook=nullptr;
static LRESULT CALLBACK PlacementInput(int code,WPARAM wp,LPARAM lp) {
  if(code>=0&&wp==PM_REMOVE) {
    auto message=reinterpret_cast<MSG *>(lp);
    auto m=message->message;
    bool keyboard=m==WM_CHAR||m==WM_KEYDOWN||m==WM_PASTE||m==WM_CUT||m==WM_CLEAR||m==WM_UNDO;
    bool click=m==WM_LBUTTONDOWN||m==WM_LBUTTONDBLCLK;
    if(!keyboard&&!click)return CallNextHookEx(placementInputHook,code,wp,lp);
    HWND dialog=PlacementDialog(placementRoot);
    if(dialog&&(message->hwnd==dialog||IsChild(dialog,message->hwnd))) {
      auto c=Class(message->hwnd);
      bool controlClick=click&&
        (c==L"Button"||c==L"ComboBox"||c==L"msctls_updown32"||c==L"SysTabControl32");
      // Only a real input message directed at our new properties dialog can
      // make its baseline uncertain. Pointer movement is never a field edit.
      if(keyboard||controlClick)placementManual=true;
    }
  }
  return CallNextHookEx(placementInputHook,code,wp,lp);
}
static LRESULT CALLBACK PlacementFocus(int code,WPARAM wp,LPARAM lp) {
  HWND candidate=reinterpret_cast<HWND>(wp);
  if(code==HCBT_ACTIVATE&&Class(candidate)==L"#32770"&&Text(candidate)==L"Object Properties"&&
      std::find(placementBeforeDialogs.begin(),placementBeforeDialogs.end(),candidate)==placementBeforeDialogs.end()) {
    HWND owner=GetWindow(candidate,GW_OWNER);
    for(int i=0;owner&&i<16;i++,owner=GetWindow(owner,GW_OWNER))if(owner==placementRoot)return 1;
  }
  return CallNextHookEx(placementFocusHook,code,wp,lp);
}
static void PlacementFocusBegin() {
  DWORD pid=0;GetWindowThreadProcessId(GetForegroundWindow(),&pid);
  placementInputHook=SetWindowsHookExW(WH_GETMESSAGE,PlacementInput,nullptr,GetCurrentThreadId());
  if(pid!=GetCurrentProcessId())placementFocusHook=SetWindowsHookExW(WH_CBT,PlacementFocus,nullptr,GetCurrentThreadId());
}
static void PlacementFocusEnd() {
  if(placementFocusHook)UnhookWindowsHookEx(placementFocusHook);placementFocusHook=nullptr;
  if(placementInputHook)UnhookWindowsHookEx(placementInputHook);placementInputHook=nullptr;
}
static std::wstring PlacementHash(const std::wstring &s) {
  unsigned long long h=14695981039346656037ULL;
  for(wchar_t c:s){h^=static_cast<unsigned short>(c);h*=1099511628211ULL;}
  return std::to_wstring(h);
}
static std::wstring PlacementKey(HWND list,int row) {
  auto id=SendMessageW(list,LVM_MAPINDEXTOID,row,0);
  return id<0?L"":std::to_wstring(static_cast<unsigned long long>(id));
}
static HWND PlacementList(HWND root) {
  HWND found=nullptr;
  for(HWND h:Children(root))if(IsWindowVisible(h)&&Class(h)==L"SysListView32") {
    HWND header=reinterpret_cast<HWND>(SendMessageW(h,LVM_GETHEADER,0,0));
    wchar_t label[64]{};HDITEMW item{};item.mask=HDI_TEXT;item.pszText=label;item.cchTextMax=64;
    SendMessageW(header,HDM_GETITEMW,0,reinterpret_cast<LPARAM>(&item));
    if(std::wstring(label)==L"Type"){if(found)return nullptr;found=h;}
  }
  return found;
}
static std::wstring PlacementLayer(HWND root) {
  std::wstring layer;
  for(HWND h:Children(root))if(IsWindowVisible(h)&&Class(h)==L"Static") {
    if(Text(h)==L"Layer: Doodads")layer=L"Doodads";
    if(Text(h)==L"Layer: Units")layer=L"Units";
  }
  return layer;
}
static std::wstring PlacementSceneHash(HWND list) {
  int count=int(SendMessageW(list,LVM_GETITEMCOUNT,0,0));std::wstring text;
  if(!list||count<0||count>256)return L"";
  for(int i=0;i<count;i++)text+=PlacementKey(list,i)+L"\x1f"+Cell(list,i,0)+L"\x1f"+Cell(list,i,1)+L"\x1e";
  return PlacementHash(text);
}
static std::wstring PlacementPropertiesHash(HWND dialog) {
  std::wstring values;
  for(HWND h:Children(dialog))if(IsWindowVisible(h)) {
    auto c=Class(h);
    if(c==L"Edit"||c==L"RichEdit20W"||c==L"ComboBox"||c==L"Button")
      values+=std::to_wstring(GetDlgCtrlID(h))+L":"+c+L":"+Text(h)+L":"+std::to_wstring(SendMessageW(h,BM_GETCHECK,0,0))+L"\x1e";
  }
  return PlacementHash(values);
}
static HWND PlacementDialog(HWND root) {
  HWND found = nullptr;
  for (HWND h : Roots()) {
    if (!IsWindowVisible(h) || Class(h) != L"#32770" ||
        std::find(placementBeforeDialogs.begin(), placementBeforeDialogs.end(), h) != placementBeforeDialogs.end()) continue;
    HWND owner = GetWindow(h, GW_OWNER); bool ours = false;
    for (int i = 0; owner && i < 16; i++, owner = GetWindow(owner, GW_OWNER)) if (owner == root) ours = true;
    if (ours) { if (found) return nullptr; found = h; }
  }
  return found;
}
static bool PlacementPropertiesValid(HWND dialog) {
  return dialog&&Text(dialog)==L"Object Properties"&&Control(dialog,34,L"Edit")&&Control(dialog,36,L"Edit")&&Control(dialog,14,L"RichEdit20W")&&Text(GetDlgItem(dialog,12))==L"Cancel"&&Clean(Text(GetDlgItem(dialog,11)))==L"OK";
}
static bool PlacementPropertiesMatch(HWND dialog) {
  bool type=false;for(HWND h:Children(dialog))if(Class(h)==L"Static"&&(Text(h)==placementExpectedType||(!placementExpectedName.empty()&&Text(h)==placementExpectedName)))type=true;
  return type&&Text(GetDlgItem(dialog,14))==placementExpectedName;
}
static void CALLBACK PlacementInitial(HWND root,UINT,UINT_PTR timer,DWORD) {
  HWND dialog=PlacementDialog(root);if(!PlacementPropertiesValid(dialog))return;
  if(!placementInitial.empty()){KillTimer(root,timer);placementTimer=0;return;}
  placementInitial=PlacementPropertiesHash(dialog);
  KillTimer(root,timer);placementTimer=0;
}
static void PlacementExecute(LiveDataRequest *b, HWND root) {
  bool ownModal = (b->operation == 30 || b->operation == 36 || b->operation == 38) &&
    b->token[0] && placementRoot==root && placementDialogToken == b->token && PlacementDialog(root);
  if (b->pid != GetCurrentProcessId() || !IsWindow(root) || PlacementTitle(Text(root)) != PlacementTitle(b->title) ||
      Text(root).rfind(L"Terrain - [", 0) != 0 || (!IsWindowEnabled(root) && !ownModal)) {
    Fail(b, L"LIVE_TERRAIN_CONTEXT_CHANGED"); return;
  }
  if(b->operation==37) {
    HWND list=PlacementList(root);int count=int(SendMessageW(list,LVM_GETITEMCOUNT,0,0));
    auto layer=PlacementLayer(root);std::wstring preview;
    for(HWND h:Children(root))if(Class(h)==L"Static"&&Text(h).rfind(L"Pasting: ",0)==0)preview=Text(h);
    if(layer.empty()||!list||count<0||count>256){Fail(b,L"LIVE_PLACEMENT_OBJECT_SCENE_BOUND");return;}
    int selected=int(SendMessageW(list,LVM_GETNEXTITEM,WPARAM(-1),LVNI_SELECTED));
    std::wstring selectedKey=SendMessageW(list,LVM_GETSELECTEDCOUNT,0,0)==1&&selected>=0?PlacementKey(list,selected):L"";
    std::wstring out=L"{\"layer\":"+Quote(layer)+L",\"count\":"+std::to_wstring(count)+L",\"selectedKey\":"+Quote(selectedKey)+L",\"sceneHash\":"+Quote(PlacementHash(layer+L":"+PlacementSceneHash(list)))+L",\"preview\":"+Quote(preview)+L",\"objects\":[";
    for(int i=0;i<count;i++){if(i)out+=L",";out+=L"{\"row\":"+std::to_wstring(i)+L",\"key\":"+Quote(PlacementKey(list,i))+L",\"type\":"+Quote(Cell(list,i,0))+L",\"name\":"+Quote(Cell(list,i,1))+L"}";}
    Result(b,out+L"]}");return;
  }
  if (b->operation == 30) {
    if(std::wstring(b->field)==L"menus") {
      Result(b,L"{\"menus\":"+TerrainMenus(root,GetMenu(root))+L",\"mapMutation\":false}");return;
    }
    if(std::wstring(b->field)==L"documents") {
      HMENU main=GetMenu(root);for(int i=0;i<GetMenuItemCount(main);i++){wchar_t name[128]{};GetMenuStringW(main,i,name,128,MF_BYPOSITION);if(Clean(name)==L"Window"){Result(b,L"{\"documents\":"+TerrainMenus(root,GetSubMenu(main,i))+L"}");return;}}
      Fail(b,L"LIVE_PLACEMENT_DOCUMENT_MENU_UNAVAILABLE");return;
    }
    std::wstring out = L"{\"title\":" + Quote(Text(root)) + L",\"controls\":[";
    bool comma = false;
    for (HWND h : Children(root)) {
      auto c = Class(h);
      if (!IsWindowVisible(h) || (c != L"SysListView32" && c != L"Edit" && c != L"ComboBox")) continue;
      if (comma) out += L","; comma = true;
      out += L"{\"id\":" + std::to_wstring(GetDlgCtrlID(h)) + L",\"type\":" + Quote(c) +
        L",\"text\":" + Quote(Text(h)) + L",\"table\":" + (c == L"SysListView32" ? Table(h, 8) : L"null") + L"}";
    }
    out += L"],\"dialogs\":[";
    HWND dialog = ownModal ? PlacementDialog(root) : nullptr;
    if (dialog) {
      out += L"{\"title\":" + Quote(Text(dialog)) + L",\"controls\":[";
      bool first = true;
      for (HWND h : Children(dialog)) {
        if (!IsWindowVisible(h)) continue;
        if (!first) out += L","; first = false;
        RECT r{}; GetWindowRect(h, &r); MapWindowPoints(nullptr, dialog, reinterpret_cast<POINT *>(&r), 2);
        out += L"{\"id\":" + std::to_wstring(GetDlgCtrlID(h)) + L",\"type\":" + Quote(Class(h)) + L",\"text\":" + Quote(Text(h)) +
          L",\"left\":" + std::to_wstring(r.left) + L",\"top\":" + std::to_wstring(r.top) + L"}";
      }
      out += L"]}";
    }
    out+=L"]";
    if(ownModal){HWND d=PlacementDialog(root);if(!PlacementPropertiesValid(d)||placementInitial.empty()){Fail(b,L"LIVE_PLACEMENT_PROPERTIES_NOT_READY");return;}
      out+=L",\"properties\":{\"fingerprint\":"+Quote(PlacementPropertiesHash(d))+L",\"initial\":"+Quote(placementInitial)+L",\"matches\":"+std::wstring(PlacementPropertiesMatch(d)?L"true":L"false")+L",\"manualInput\":"+std::wstring(placementManual?L"true":L"false")+L",\"x\":"+Quote(Text(GetDlgItem(d,34)))+L",\"y\":"+Quote(Text(GetDlgItem(d,36)))+L",\"name\":"+Quote(Text(GetDlgItem(d,14)))+L",\"owner\":"+Quote(Text(GetDlgItem(d,24)))+L"}";}
    Result(b, out + L",\"mapMutation\":false}");
    return;
  }
  if (b->operation == 31) {
    SetActiveWindow(root);
    if(std::wstring(b->field)==L"module") {
      std::wstring module=b->unit;
      if(module!=L"Data"&&module!=L"Triggers"&&module!=L"Import"&&module!=L"Text"&&module!=L"UI"){Fail(b,L"LIVE_MODULE_UNSUPPORTED");return;}
      if(!Invoke(root,module.c_str())){Fail(b,L"LIVE_DATA_MODULE_UNAVAILABLE");return;}
      Result(b,L"{\"moduleRequested\":"+Quote(module)+L",\"dataModuleRequested\":"+std::wstring(module==L"Data"?L"true":L"false")+L",\"mapMutation\":false}");return;
    }
    if(std::wstring(b->field)==L"document") {
      HMENU main=GetMenu(root);for(int i=0;i<GetMenuItemCount(main);i++){wchar_t name[128]{};GetMenuStringW(main,i,name,128,MF_BYPOSITION);if(Clean(name)!=L"Window")continue;HMENU menu=GetSubMenu(main,i);for(int j=0;j<GetMenuItemCount(menu);j++){wchar_t label[256]{};GetMenuStringW(menu,j,label,256,MF_BYPOSITION);if(!GetSubMenu(menu,j)&&Clean(label)==b->unit&&std::wstring(label).find(L".SC2Map")!=std::wstring::npos){SendMessageW(root,WM_COMMAND,GetMenuItemID(menu,j),0);Result(b,L"{\"existingDocumentSelectionRequested\":true}");return;}}}Fail(b,L"LIVE_PLACEMENT_EXISTING_DOCUMENT_UNAVAILABLE");return;
    }
    if(std::wstring(b->field)==L"selection"){
      HMENU main=GetMenu(root);for(int i=0;i<GetMenuItemCount(main);i++){wchar_t name[128]{};GetMenuStringW(main,i,name,128,MF_BYPOSITION);if(Clean(name)!=L"Tools")continue;HMENU tools=GetSubMenu(main,i);for(int j=0;j<GetMenuItemCount(tools);j++){wchar_t label[128]{};GetMenuStringW(tools,j,label,128,MF_BYPOSITION);if(!GetSubMenu(tools,j)&&Clean(label)==L"Selection Mode"){SendMessageW(root,WM_COMMAND,GetMenuItemID(tools,j),0);Result(b,L"{\"selectionModeRequested\":true}");return;}}}Fail(b,L"LIVE_PLACEMENT_SELECTION_MODE_UNAVAILABLE");return;
    }
    HMENU layer = nullptr, menu = GetMenu(root);
    for (int i = 0; i < GetMenuItemCount(menu); i++) {
      wchar_t label[128]{}; GetMenuStringW(menu, i, label, 128, MF_BYPOSITION);
      if (Clean(label) == L"Layer") layer = GetSubMenu(menu, i);
    }
    UINT id = 0;
    for (int i = 0; layer && i < GetMenuItemCount(layer); i++) {
      wchar_t label[128]{}; GetMenuStringW(layer, i, label, 128, MF_BYPOSITION);
      if (!GetSubMenu(layer, i) && Clean(label) == b->unit &&
          (Clean(label) == L"Doodads" || Clean(label) == L"Units" || Clean(label)==L"Terrain")) id = GetMenuItemID(layer, i);
    }
    if (!id) { Fail(b, L"LIVE_TERRAIN_LAYER_UNAVAILABLE"); return; }
    SendMessageW(root, WM_COMMAND, id, 0);
    Result(b, L"{\"layerRequested\":true,\"mapMutation\":false}"); return;
  }
  if (b->operation == 32) {
    SetActiveWindow(root);
    HWND list = nullptr;
    for (HWND h : Children(root)) {
      if (!IsWindowVisible(h) || Class(h) != L"SysListView32") continue;
      HWND header = reinterpret_cast<HWND>(SendMessageW(h, LVM_GETHEADER, 0, 0));
      wchar_t name[64]{}; HDITEMW x{}; x.mask = HDI_TEXT; x.pszText = name; x.cchTextMax = 64;
      SendMessageW(header, HDM_GETITEMW, 0, reinterpret_cast<LPARAM>(&x));
      if (std::wstring(name) == L"Type") { if (list) { Fail(b, L"LIVE_TERRAIN_AMBIGUOUS_OBJECT_LIST"); return; } list = h; }
    }
    wchar_t *end = nullptr; long row = wcstol(b->unit, &end, 10);
    if (!list || !b->unit[0] || !end || *end || row < 0 || row >= SendMessageW(list, LVM_GETITEMCOUNT, 0, 0) ||
        Cell(list, row, 0) != b->expected || PlacementKey(list,row)!=b->field) { Fail(b, L"LIVE_TERRAIN_ROW_CHANGED"); return; }
    SendMessageW(list,LVM_ENSUREVISIBLE,row,FALSE);
    RECT rect{}; rect.left=LVIR_LABEL;
    if (!SendMessageW(list,LVM_GETITEMRECT,row,reinterpret_cast<LPARAM>(&rect))) { Fail(b,L"LIVE_TERRAIN_ROW_NOT_VISIBLE");return; }
    SetFocus(list);
    LPARAM point=MAKELPARAM(rect.left+4,(rect.top+rect.bottom)/2);
    // Let the original control produce its complete native notification sequence.
    // A synchronous down would block in DragDetect before its up could be sent.
    PostMessageW(list,WM_MOUSEMOVE,0,point);
    PostMessageW(list,WM_LBUTTONDOWN,MK_LBUTTON,point);
    PostMessageW(list,WM_LBUTTONUP,0,point);
    Result(b, L"{\"selectedRow\":" + std::to_wstring(row) + L",\"selection\":" +
      std::to_wstring(SendMessageW(list,LVM_GETNEXTITEM,WPARAM(-1),LVNI_SELECTED)) +
      L",\"type\":" + Quote(Cell(list,row,0)) + L",\"mapMutation\":false}");return;
  }
  if (b->operation == 39) {
    HWND list=PlacementList(root);int row=list?int(SendMessageW(list,LVM_GETNEXTITEM,WPARAM(-1),LVNI_SELECTED)):-1;
    const auto layer=PlacementLayer(root);
    if(!list||row<0||SendMessageW(list,LVM_GETSELECTEDCOUNT,0,0)!=1||PlacementKey(list,row)!=b->unit||
       Cell(list,row,0)!=b->field||Cell(list,row,1)!=b->value||layer.empty()||
       PlacementHash(layer+L":"+PlacementSceneHash(list))!=b->expected) {Fail(b,L"LIVE_PLACEMENT_DELETE_SELECTION_CHANGED");return;}
    for(HWND h:Children(root))if(IsWindowVisible(h)&&Class(h)==L"Static"&&Text(h).rfind(L"Pasting: ",0)==0){Fail(b,L"LIVE_PLACEMENT_EXISTING_PASTE_PREVIEW");return;}
    HWND surface=Control(root,19,L"GfxViewClass");if(!surface||!IsWindowVisible(surface)){Fail(b,L"LIVE_PLACEMENT_VIEWPORT_UNAVAILABLE");return;}
    SetActiveWindow(root);SetFocus(surface);
    if(!Invoke(root,L"Clear")){Fail(b,L"LIVE_PLACEMENT_DELETE_UNAVAILABLE");return;}
    Result(b,L"{\"deleteRequested\":true,\"retryMutation\":false,\"verification\":\"exact_instance_count_and_remaining_properties_required\"}");return;
  }
  if (b->operation == 33) {
    SetActiveWindow(root);
    HWND list=PlacementList(root);int row=int(SendMessageW(list,LVM_GETNEXTITEM,WPARAM(-1),LVNI_SELECTED));
    if(!list||row<0||SendMessageW(list,LVM_GETSELECTEDCOUNT,0,0)!=1||PlacementKey(list,row)!=b->unit){Fail(b,L"LIVE_PLACEMENT_SOURCE_SELECTION_CHANGED");return;}
    if (!Invoke(root, L"Copy")) { Fail(b, L"LIVE_TERRAIN_COPY_UNAVAILABLE"); return; }
    Result(b,L"{\"copyInvoked\":true,\"mapMutation\":false}");return;
  }
  if (b->operation == 34) {
    SetActiveWindow(root);
    if(std::wstring(b->field)==L"commitPreview") {
      HWND surface=Control(root,19,L"GfxViewClass"); bool preview=false;
      for(HWND h:Children(root)) if(Class(h)==L"Static"&&Text(h)==b->unit)preview=true;
      if(std::wstring(b->unit).rfind(L"Pasting: ",0)!=0||PlacementHash(PlacementLayer(root)+L":"+PlacementSceneHash(PlacementList(root)))!=b->expected){Fail(b,L"LIVE_PLACEMENT_PREVIEW_CHANGED");return;}
      RECT area{};if(!surface||!preview||!GetClientRect(surface,&area)||area.right<100||area.bottom<100){Fail(b,L"LIVE_PLACEMENT_PREVIEW_REQUIRED");return;}
      SetFocus(surface);LPARAM point=MAKELPARAM(area.right/2,area.bottom/2);
      PostMessageW(surface,WM_MOUSEMOVE,0,point);
      PostMessageW(surface,WM_LBUTTONDOWN,MK_LBUTTON,point);
      PostMessageW(surface,WM_LBUTTONUP,0,point);
      Result(b,L"{\"placementRequested\":true,\"verification\":\"object_count_required\"}");return;
    }
    if (!Invoke(root, L"Paste")) { Fail(b,L"LIVE_PLACEMENT_PASTE_UNAVAILABLE"); return; }
    Result(b,L"{\"pasteInvoked\":true,\"verification\":\"native_object_readback_required\"}");return;
  }
  if (b->operation == 35) {
    HWND list=PlacementList(root);int row=int(SendMessageW(list,LVM_GETNEXTITEM,WPARAM(-1),LVNI_SELECTED));
    if (!b->token[0] || !list||row<0||SendMessageW(list,LVM_GETSELECTEDCOUNT,0,0)!=1||PlacementKey(list,row)!=b->unit||Cell(list,row,0)!=b->expected) { Fail(b,L"LIVE_PLACEMENT_OWNED_DIALOG_REQUIRED"); return; }
    placementBeforeDialogs=Roots(); placementDialogToken=b->token;placementRoot=root;placementInitial.clear();placementManual=false;placementExpectedType=b->expected;placementExpectedName=b->value;
    PlacementFocusBegin();
    placementTimer=SetTimer(root,0,50,PlacementInitial);
    SetActiveWindow(root);
    if (!Invoke(root,L"Modify Properties...")) { PlacementFocusEnd();if(placementTimer)KillTimer(root,placementTimer);placementTimer=0;Fail(b,L"LIVE_PLACEMENT_PROPERTIES_UNAVAILABLE"); return; }
    PlacementFocusEnd();
    if(placementTimer)KillTimer(root,placementTimer);placementTimer=0;
    Result(b,L"{\"propertiesClosed\":true}");return;
  }
  if ((b->operation==36||b->operation==38)&&ownModal) {
    HWND dialog=PlacementDialog(root); HWND cancel=GetDlgItem(dialog,12);
    if (!PlacementPropertiesValid(dialog)||!IsWindowEnabled(cancel)||placementInitial.empty()||placementManual||PlacementPropertiesHash(dialog)!=placementInitial||placementInitial!=b->expected) { Fail(b,L"LIVE_PLACEMENT_MANUAL_PROPERTIES_CHANGED");return; }
    if(b->operation==36) {
      if(!PlacementPropertiesMatch(dialog)){Fail(b,L"LIVE_PLACEMENT_SELECTED_OBJECT_MISMATCH");return;}
      wchar_t *endX=nullptr,*endY=nullptr;double x=wcstod(b->unit,&endX),y=wcstod(b->field,&endY);
      if(!b->unit[0]||!b->field[0]||!endX||!endY||*endX||*endY||!std::isfinite(x)||!std::isfinite(y)||x<0||y<0||x>4096||y>4096){Fail(b,L"LIVE_PLACEMENT_COORDINATES_INVALID");return;}
      for(int id:{34,36,14}){if(id==14&&!b->value[0])continue;HWND edit=GetDlgItem(dialog,id);const wchar_t *v=id==34?b->unit:id==36?b->field:(std::wstring(b->value)==L"\x1f"?L"":b->value);SendMessageW(edit,WM_SETTEXT,0,reinterpret_cast<LPARAM>(v));SendMessageW(dialog,WM_COMMAND,MAKEWPARAM(id,EN_CHANGE),reinterpret_cast<LPARAM>(edit));}
      PostMessageW(dialog,WM_COMMAND,MAKEWPARAM(11,BN_CLICKED),reinterpret_cast<LPARAM>(GetDlgItem(dialog,11)));Result(b,L"{\"commitRequested\":true,\"retryMutation\":false}");return;
    }
    PostMessageW(dialog,WM_COMMAND,MAKEWPARAM(12,BN_CLICKED),reinterpret_cast<LPARAM>(cancel));Result(b,L"{\"cancelRequested\":true}");return;
  }
  Fail(b, L"LIVE_TERRAIN_OPERATION_UNSUPPORTED");
}
