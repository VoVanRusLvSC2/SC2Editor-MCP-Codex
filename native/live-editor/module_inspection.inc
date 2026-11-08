// Bounded original module views. Tree handles are UI snapshot identities only.
struct ModuleTreeView { std::wstring json,hash; };
static ModuleTreeView ModuleTree(HWND tree,bool rootsOnly=false) {
  struct Node {HTREEITEM item,parent;int depth;};
  int count=int(SendMessageW(tree,TVM_GETCOUNT,0,0));
  if(count<0||count>100000)return {};
  std::vector<Node> pending;std::vector<HTREEITEM> seen;
  auto first=reinterpret_cast<HTREEITEM>(SendMessageW(tree,TVM_GETNEXTITEM,TVGN_ROOT,0));
  if(first)pending.push_back({first,nullptr,0});
  std::wstring items=L"[",source=(rootsOnly?L"roots:":L"tree:")+std::to_wstring(GetDlgCtrlID(tree));bool truncated=false;
  while(!pending.empty()&&seen.size()<128) {
    auto node=pending.back();pending.pop_back();
    if(std::find(seen.begin(),seen.end(),node.item)!=seen.end())return {};
    seen.push_back(node.item);wchar_t text[512]{};TVITEMW item{};
    item.mask=TVIF_TEXT|TVIF_STATE;item.hItem=node.item;item.pszText=text;item.cchTextMax=512;item.stateMask=TVIS_SELECTED|TVIS_STATEIMAGEMASK;
    if(!SendMessageW(tree,TVM_GETITEMW,0,reinterpret_cast<LPARAM>(&item)))return {};
    if(wcslen(text)>=511)truncated=true;
    auto key=std::to_wstring(reinterpret_cast<uintptr_t>(node.item)),parent=std::to_wstring(reinterpret_cast<uintptr_t>(node.parent));
    if(seen.size()>1)items+=L",";
    auto check=(item.state&TVIS_STATEIMAGEMASK)>>12;
    items+=L"{\"handle\":"+Quote(key)+L",\"parent\":"+Quote(parent)+L",\"depth\":"+std::to_wstring(node.depth)+L",\"text\":"+Quote(text)+L",\"selected\":"+std::wstring(item.state&TVIS_SELECTED?L"true":L"false")+L",\"stateImage\":"+std::to_wstring(check)+L"}";
    source+=L"\x1e"+key+L":"+parent+L":"+text+L":"+std::to_wstring(check);
    auto next=reinterpret_cast<HTREEITEM>(SendMessageW(tree,TVM_GETNEXTITEM,TVGN_NEXT,reinterpret_cast<LPARAM>(node.item)));
    auto child=reinterpret_cast<HTREEITEM>(SendMessageW(tree,TVM_GETNEXTITEM,TVGN_CHILD,reinterpret_cast<LPARAM>(node.item)));
    if(next)pending.push_back({next,node.parent,node.depth});
    if(child&&!rootsOnly){if(node.depth<16)pending.push_back({child,node.item,node.depth+1});else truncated=true;}
  }
  truncated=truncated||!pending.empty();auto hash=PlacementHash(source);
  return {L"{\"id\":"+std::to_wstring(GetDlgCtrlID(tree))+L",\"count\":"+std::to_wstring(count)+L",\"fingerprint\":"+Quote(hash)+L",\"truncated\":"+std::wstring(truncated?L"true":L"false")+L",\"items\":"+items+L"]}",hash};
}
static void ModuleInspectExecute(LiveDataRequest *b,HWND root) {
  if(b->pid!=GetCurrentProcessId()||!IsWindow(root)||!IsWindowEnabled(root)||PlacementTitle(Text(root))!=PlacementTitle(b->title)) {Fail(b,L"LIVE_MODULE_CONTEXT_CHANGED");return;}
  if(b->operation==55) {
    wchar_t *end=nullptr;long id=wcstol(b->unit,&end,10);
    if(!b->unit[0]||!end||*end||id<1||id>10000){Fail(b,L"LIVE_MODULE_TREE_ID_INVALID");return;}
    bool rootsOnly=std::wstring(b->value)==L"roots";
    HWND tree=Control(root,int(id),L"SysTreeView32");auto snapshot=tree?ModuleTree(tree,rootsOnly):ModuleTreeView{};
    if(!tree||!IsWindowVisible(tree)||snapshot.hash.empty()||snapshot.hash!=b->expected){Fail(b,L"LIVE_MODULE_TREE_CHANGED");return;}
    wchar_t *itemEnd=nullptr;auto raw=_wcstoui64(b->field,&itemEnd,10);
    if(!b->field[0]||!itemEnd||*itemEnd||!raw){Fail(b,L"LIVE_MODULE_TREE_ITEM_INVALID");return;}
    HTREEITEM target=reinterpret_cast<HTREEITEM>(static_cast<uintptr_t>(raw));
    // Validate membership by a bounded walk, never pass an arbitrary caller pointer.
    std::vector<HTREEITEM> pending;auto first=reinterpret_cast<HTREEITEM>(SendMessageW(tree,TVM_GETNEXTITEM,TVGN_ROOT,0));if(first)pending.push_back(first);
    bool found=false;int visited=0;
    while(!pending.empty()&&visited++<128){auto item=pending.back();pending.pop_back();if(item==target){found=true;break;}auto next=reinterpret_cast<HTREEITEM>(SendMessageW(tree,TVM_GETNEXTITEM,TVGN_NEXT,reinterpret_cast<LPARAM>(item))),child=reinterpret_cast<HTREEITEM>(SendMessageW(tree,TVM_GETNEXTITEM,TVGN_CHILD,reinterpret_cast<LPARAM>(item)));if(next)pending.push_back(next);if(child&&!rootsOnly)pending.push_back(child);}
    if(!found){Fail(b,L"LIVE_MODULE_TREE_ITEM_INVALID");return;}
    if(Text(root).rfind(L"UI - [",0)==0) {
      HWND edit=Control(root,19,L"Scintilla");
      if(edit&&SendMessageW(edit,2159,0,0)&&!SendMessageW(edit,2140,0,0)) {
        auto selected=reinterpret_cast<HTREEITEM>(SendMessageW(tree,TVM_GETNEXTITEM,TVGN_CARET,0));
        if(selected!=target){Fail(b,L"LIVE_UI_PENDING_BUFFER_PRESERVED");return;}
        Result(b,L"{\"selectionRequested\":true,\"unchanged\":true,\"mapMutation\":false}");return;
      }
    }
    SetActiveWindow(root);SetFocus(tree);SendMessageW(tree,TVM_SELECTITEM,TVGN_CARET,reinterpret_cast<LPARAM>(target));
    Result(b,L"{\"selectionRequested\":true,\"mapMutation\":false}");return;
  }
  if(std::wstring(b->field)==L"menus"){Result(b,L"{\"menus\":"+TerrainMenus(root,GetMenu(root))+L",\"mapMutation\":false}");return;}
  if(std::wstring(b->field)==L"trees"||std::wstring(b->field)==L"roots") {
    std::wstring out=L"{\"trees\":[";bool comma=false;
    for(HWND h:Children(root))if(IsWindowVisible(h)&&Class(h)==L"SysTreeView32") {
      auto tree=ModuleTree(h,std::wstring(b->field)==L"roots");if(tree.json.empty()){Fail(b,L"LIVE_MODULE_TREE_UNREADABLE");return;}
      if(comma)out+=L",";comma=true;out+=tree.json;
    }
    Result(b,out+L"],\"mapMutation\":false}");return;
  }
  std::wstring out=L"{\"title\":"+Quote(Text(root))+L",\"controls\":[";bool comma=false;
  for(HWND h:Children(root))if(IsWindowVisible(h)) {
    if(comma)out+=L",";comma=true;
    out+=L"{\"id\":"+std::to_wstring(GetDlgCtrlID(h))+L",\"type\":"+Quote(Class(h))+L",\"text\":"+(Class(h)==L"Scintilla"?L"null":Quote(Text(h)));
    if(Class(h)==L"SysListView32")out+=L",\"table\":"+Table(h,8);
    if(Class(h)==L"ComboBox") {
      auto count=SendMessageW(h,CB_GETCOUNT,0,0);
      out+=L",\"optionsTotal\":"+std::to_wstring(count)+L",\"optionsTruncated\":"+std::wstring(count<0||count>32?L"true":L"false")+L",\"options\":[";
      for(int i=0;i<count&&i<32;i++) {
        auto length=SendMessageW(h,CB_GETLBTEXTLEN,i,0);
        if(length<0||length>1024){Fail(b,L"LIVE_MODULE_COMBO_TEXT_BOUND");return;}
        std::vector<wchar_t> label(size_t(length)+1);SendMessageW(h,CB_GETLBTEXT,i,reinterpret_cast<LPARAM>(label.data()));
        if(i)out+=L",";out+=L"{\"index\":"+std::to_wstring(i)+L",\"text\":"+Quote(label.data())+L"}";
      }
      out+=L"]";
    }
    out+=L"}";
  }
  Result(b,out+L"],\"mapMutation\":false}");
}
