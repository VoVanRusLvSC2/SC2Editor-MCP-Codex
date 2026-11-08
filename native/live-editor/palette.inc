// Original catalog palette selection and one native brush placement.
static HWND PaletteList(HWND root) {
  auto layer=PlacementLayer(root);
  return Control(root,layer==L"Units"?337:537,L"SysListView32");
}
static std::wstring PaletteHash(HWND root,HWND list) {
  int count=int(SendMessageW(list,LVM_GETITEMCOUNT,0,0));
  if(!list||!IsWindowVisible(list)||count<0||count>10000)return L"";
  std::wstring source=PlacementLayer(root)+L":"+std::to_wstring(count);
  for(int i=0;i<count;i++)source+=L"\x1e"+Cell(list,i,0);
  return PlacementHash(source);
}
static std::wstring PaletteBrush(HWND root) {
  std::wstring brush;
  for(HWND h:Children(root))if(IsWindowVisible(h)&&Class(h)==L"Static"&&Text(h).rfind(L"Brush: ",0)==0) {
    if(!brush.empty())return L"";brush=Text(h);
  }
  return brush;
}
static bool PaletteOwner(HWND root,const std::wstring &requested,bool set) {
  if(PlacementLayer(root)!=L"Units")return requested.empty();
  wchar_t *end=nullptr;long owner=wcstol(requested.c_str(),&end,10);
  if(requested.empty()||!end||*end||owner<0||owner>16)return false;
  HWND combo=Control(root,326,L"ComboBox");
  if(!combo||!IsWindowVisible(combo))return false;
  if(!set)return Text(combo).rfind(L"("+requested+L")",0)==0;
  int count=int(SendMessageW(combo,CB_GETCOUNT,0,0)),found=-1;
  if(count<0||count>32)return false;
  for(int i=0;i<count;i++) {
    wchar_t label[256]{};
    auto length=SendMessageW(combo,CB_GETLBTEXTLEN,i,0);
    if(length<0||length>=256)return false;
    SendMessageW(combo,CB_GETLBTEXT,i,reinterpret_cast<LPARAM>(label));
    if(std::wstring(label).rfind(L"("+requested+L")",0)==0){if(found>=0)return false;found=i;}
  }
  if(found<0)return false;
  SendMessageW(combo,CB_SETCURSEL,found,0);
  SendMessageW(GetParent(combo),WM_COMMAND,MAKEWPARAM(326,CBN_SELCHANGE),reinterpret_cast<LPARAM>(combo));
  return PaletteOwner(root,requested,false);
}
static void PaletteExecute(LiveDataRequest *b,HWND root) {
  if(b->pid!=GetCurrentProcessId()||!IsWindow(root)||!IsWindowEnabled(root)||
     Text(root).rfind(L"Terrain - [",0)!=0||PlacementTitle(Text(root))!=PlacementTitle(b->title)||PlacementLayer(root).empty()) {
    Fail(b,L"LIVE_PALETTE_CONTEXT_CHANGED");return;
  }
  if(b->operation==43&&std::wstring(b->field)==L"list") {
    SetActiveWindow(root);
    if(!Invoke(root,L"List",true)){Fail(b,L"LIVE_PALETTE_LIST_UNAVAILABLE");return;}
    Result(b,L"{\"listStyleRequested\":true,\"mapMutation\":false}");return;
  }
  HWND list=PaletteList(root);auto hash=PaletteHash(root,list);
  if(hash.empty()){Fail(b,L"LIVE_PALETTE_LIST_NOT_READY");return;}
  if(b->operation==43) {
    wchar_t *end=nullptr;long offset=b->value[0]?wcstol(b->value,&end,10):0;
    if(offset<0||offset>10000||(b->value[0]&&(!end||*end))){Fail(b,L"LIVE_PALETTE_OFFSET_INVALID");return;}
    int count=int(SendMessageW(list,LVM_GETITEMCOUNT,0,0)),matches=0,shown=0;
    std::wstring query=b->unit;for(auto &c:query)c=towlower(c);
    std::wstring rows=L"[";
    for(int i=0;i<count;i++) {
      auto name=Cell(list,i,0),lower=name;for(auto &c:lower)c=towlower(c);
      if(lower.find(query)==std::wstring::npos)continue;
      if(matches++<offset||shown>=16)continue;
      if(shown++)rows+=L",";
      rows+=L"{\"row\":"+std::to_wstring(i)+L",\"type\":"+Quote(name)+L"}";
    }
    std::wstring owners=L"[";int ownersShown=0;
    HWND combo=PlacementLayer(root)==L"Units"?Control(root,326,L"ComboBox"):nullptr;
    int players=combo?int(SendMessageW(combo,CB_GETCOUNT,0,0)):0;
    if(players<0||players>32){Fail(b,L"LIVE_PALETTE_OWNER_LIST_BOUND");return;}
    for(int i=0;i<players;i++) {
      wchar_t label[256]{};auto length=SendMessageW(combo,CB_GETLBTEXTLEN,i,0);
      if(length<0||length>=256){Fail(b,L"LIVE_PALETTE_OWNER_LABEL_BOUND");return;}
      SendMessageW(combo,CB_GETLBTEXT,i,reinterpret_cast<LPARAM>(label));int id=-1;
      if(swscanf_s(label,L"(%d)",&id)!=1||id<0||id>16)continue;
      if(ownersShown++)owners+=L",";owners+=L"{\"id\":"+std::to_wstring(id)+L",\"label\":"+Quote(label)+L"}";
    }
    Result(b,L"{\"layer\":"+Quote(PlacementLayer(root))+L",\"catalogHash\":"+Quote(hash)+L",\"brush\":"+Quote(PaletteBrush(root))+L",\"total\":"+std::to_wstring(count)+L",\"matches\":"+std::to_wstring(matches)+L",\"offset\":"+std::to_wstring(offset)+L",\"owners\":"+owners+L"],\"rows\":"+rows+L"],\"mapMutation\":false}");return;
  }
  if(b->operation==44) {
    wchar_t *end=nullptr;long row=wcstol(b->unit,&end,10);
    if(!b->unit[0]||!end||*end||row<0||row>=SendMessageW(list,LVM_GETITEMCOUNT,0,0)||hash!=b->expected||Cell(list,row,0)!=b->field) {
      Fail(b,L"LIVE_PALETTE_ROW_CHANGED");return;
    }
    if(!PaletteOwner(root,b->value,true)){Fail(b,L"LIVE_PALETTE_OWNER_UNAVAILABLE");return;}
    SendMessageW(list,LVM_ENSUREVISIBLE,row,FALSE);RECT rect{};rect.left=LVIR_LABEL;
    if(!SendMessageW(list,LVM_GETITEMRECT,row,reinterpret_cast<LPARAM>(&rect))){Fail(b,L"LIVE_PALETTE_ROW_NOT_VISIBLE");return;}
    SetActiveWindow(root);SetFocus(list);auto point=MAKELPARAM(rect.left+4,(rect.top+rect.bottom)/2);
    PostMessageW(list,WM_MOUSEMOVE,0,point);PostMessageW(list,WM_LBUTTONDOWN,MK_LBUTTON,point);PostMessageW(list,WM_LBUTTONUP,0,point);
    Result(b,L"{\"paletteSelectionRequested\":true,\"mapMutation\":false}");return;
  }
  if(b->operation==45) {
    wchar_t *end=nullptr;long row=wcstol(b->value,&end,10);
    int selected=int(SendMessageW(list,LVM_GETNEXTITEM,WPARAM(-1),LVNI_SELECTED));
    auto sceneHash=PlacementHash(PlacementLayer(root)+L":"+PlacementSceneHash(PlacementList(root)));
    if(!b->value[0]||!end||*end||row!=selected||hash!=b->field||sceneHash!=b->expected||PaletteBrush(root)!=b->unit||std::wstring(b->unit).rfind(L"Brush: ",0)!=0||!PaletteOwner(root,b->token,false)) {
      Fail(b,L"LIVE_PALETTE_BRUSH_CHANGED");return;
    }
    HWND surface=Control(root,19,L"GfxViewClass");RECT area{};
    if(!surface||!GetClientRect(surface,&area)||area.right<100||area.bottom<100){Fail(b,L"LIVE_PALETTE_VIEWPORT_UNAVAILABLE");return;}
    SetFocus(surface);auto point=MAKELPARAM(area.right/2,area.bottom/2);
    PostMessageW(surface,WM_MOUSEMOVE,0,point);PostMessageW(surface,WM_LBUTTONDOWN,MK_LBUTTON,point);PostMessageW(surface,WM_LBUTTONUP,0,point);
    Result(b,L"{\"placementRequested\":true,\"retryMutation\":false}");return;
  }
  Fail(b,L"LIVE_PALETTE_OPERATION_UNSUPPORTED");
}
