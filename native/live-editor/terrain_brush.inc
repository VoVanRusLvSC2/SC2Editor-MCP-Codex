// Original terrain controls only. Pointer status is not a requested-point world pick.
static bool TerrainLayerActive(HWND root) {
  for(HWND h:Children(root))if(IsWindowVisible(h)&&Class(h)==L"Static"&&Text(h)==L"Layer: Terrain")return true;
  return false;
}
static void TerrainBrushExecute(LiveDataRequest *b,HWND root) {
  if(b->pid!=GetCurrentProcessId()||!IsWindow(root)||!IsWindowEnabled(root)||
     PlacementTitle(Text(root))!=PlacementTitle(b->title)||Text(root).rfind(L"Terrain - [",0)!=0||!TerrainLayerActive(root)) {
    Fail(b,L"LIVE_TERRAIN_BRUSH_CONTEXT_CHANGED");return;
  }
  HWND surface=Control(root,19,L"GfxViewClass");RECT area{};
  if(!surface||!IsWindowVisible(surface)||!GetClientRect(surface,&area)||area.right<100||area.bottom<100){Fail(b,L"LIVE_TERRAIN_VIEWPORT_UNAVAILABLE");return;}
  if(b->field[0]){Fail(b,L"LIVE_TERRAIN_INSPECT_OPERATION_UNSUPPORTED");return;}
  std::wstring out=L"{\"viewport\":{\"width\":"+std::to_wstring(area.right)+L",\"height\":"+std::to_wstring(area.bottom)+L"},\"controls\":[";bool comma=false;
  for(HWND h:Children(root))if(IsWindowVisible(h)) {
    auto type=Class(h);
    if(type!=L"Static"&&type!=L"Button"&&type!=L"Edit"&&type!=L"SysTabControl32")continue;
    if(comma)out+=L",";comma=true;
    out+=L"{\"id\":"+std::to_wstring(GetDlgCtrlID(h))+L",\"type\":"+Quote(type)+L",\"text\":"+Quote(Text(h));
    if(type==L"Button")out+=L",\"checked\":"+std::to_wstring(SendMessageW(h,BM_GETCHECK,0,0));
    if(type==L"SysTabControl32") {
      auto count=SendMessageW(h,TCM_GETITEMCOUNT,0,0);if(count<0||count>16){Fail(b,L"LIVE_TERRAIN_TAB_BOUND");return;}
      out+=L",\"selected\":"+std::to_wstring(SendMessageW(h,TCM_GETCURSEL,0,0))+L",\"tabs\":[";
      for(int i=0;i<count;i++){wchar_t text[128]{};TCITEMW item{};item.mask=TCIF_TEXT;item.pszText=text;item.cchTextMax=128;if(!SendMessageW(h,TCM_GETITEMW,i,reinterpret_cast<LPARAM>(&item))){Fail(b,L"LIVE_TERRAIN_TAB_UNAVAILABLE");return;}if(i)out+=L",";out+=Quote(text);}out+=L"]";
    }
    out+=L"}";
  }
  Result(b,out+L"],\"mapMutation\":false,\"worldPickingQualified\":false,\"mutationAvailable\":false,\"coordinateSource\":\"Original pointer status; not an authoritative requested-point sample\"}");
}
