// Read-only archive ownership and original Window-menu identity. No restart,
// save dialog, process injection or application input is used by this adapter.
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

internal static partial class LiveEditor {
  [StructLayout(LayoutKind.Sequential)] private struct ArchiveProcess {
    public uint pid; public System.Runtime.InteropServices.ComTypes.FILETIME started;
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] private struct ArchiveOwner {
    public ArchiveProcess process;
    [MarshalAs(UnmanagedType.ByValTStr,SizeConst=256)] public string app;
    [MarshalAs(UnmanagedType.ByValTStr,SizeConst=64)] public string service;
    public uint type,status,session;
    [MarshalAs(UnmanagedType.Bool)] public bool restartable;
  }
  [DllImport("rstrtmgr.dll",CharSet=CharSet.Unicode)] private static extern uint RmStartSession(out uint session,uint flags,string key);
  [DllImport("rstrtmgr.dll",CharSet=CharSet.Unicode)] private static extern uint RmRegisterResources(uint session,uint count,string[] files,uint apps,IntPtr processes,uint services,IntPtr names);
  [DllImport("rstrtmgr.dll")] private static extern uint RmGetList(uint session,out uint needed,ref uint count,[In,Out] ArchiveOwner[] rows,ref uint reasons);
  [DllImport("rstrtmgr.dll")] private static extern uint RmEndSession(uint session);
  [DllImport("user32.dll")] private static extern IntPtr GetMenu(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern IntPtr GetSubMenu(IntPtr menu,int position);
  [DllImport("user32.dll")] private static extern int GetMenuItemCount(IntPtr menu);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] private static extern int GetMenuString(IntPtr menu,uint item,StringBuilder text,int count,uint flags);

  private static string MenuLabel(IntPtr menu,int i) {
    var text=new StringBuilder(4096);int n=GetMenuString(menu,(uint)i,text,text.Capacity,0x400);
    if(n>=text.Capacity-1)throw new Exception("LIVE_MAP_IDENTITY_MENU_BOUND");
    return text.ToString().Split('\t')[0].Replace("&&","\u0001").Replace("&","").Replace("\u0001","&").Trim();
  }
  private static List<string> OpenArchiveDocuments(IntPtr hwnd) {
    IntPtr menu=GetMenu(hwnd);int count=GetMenuItemCount(menu);
    if(menu==IntPtr.Zero||count<1||count>32)throw new Exception("LIVE_MAP_IDENTITY_MENU_UNAVAILABLE");
    for(int i=0;i<count;i++)if(MenuLabel(menu,i)=="Window") {
      var result=new List<string>();IntPtr window=GetSubMenu(menu,i);int n=GetMenuItemCount(window);
      if(n<1||n>128)throw new Exception("LIVE_MAP_IDENTITY_MENU_BOUND");
      for(int j=0;j<n;j++) {
        string name=MenuLabel(window,j).TrimEnd('*');
        if(name.EndsWith(".SC2Map",StringComparison.OrdinalIgnoreCase)||name.EndsWith(".SC2Mod",StringComparison.OrdinalIgnoreCase))result.Add(name);
      }
      return result;
    }
    throw new Exception("LIVE_MAP_IDENTITY_MENU_UNAVAILABLE");
  }
  private static bool ArchiveHeldBy(string archive,Window w) {
    uint session;uint code=RmStartSession(out session,0,Guid.NewGuid().ToString("N"));
    if(code!=0)throw new Exception("LIVE_MAP_IDENTITY_SESSION_FAILED: "+code);
    try {
      code=RmRegisterResources(session,1,new[]{archive},0,IntPtr.Zero,0,IntPtr.Zero);
      if(code!=0)throw new Exception("LIVE_MAP_IDENTITY_REGISTER_FAILED: "+code);
      uint needed,count=0,reasons=0;code=RmGetList(session,out needed,ref count,null,ref reasons);
      if(code==0)return false;
      if(code!=234||needed>64)throw new Exception("LIVE_MAP_IDENTITY_OWNER_QUERY_FAILED: "+code);
      count=needed;var rows=new ArchiveOwner[count];code=RmGetList(session,out needed,ref count,rows,ref reasons);
      if(code!=0)throw new Exception("LIVE_MAP_IDENTITY_OWNER_QUERY_FAILED: "+code);
      for(int i=0;i<count;i++) {
        var p=rows[i].process;long time=(long)(((ulong)(uint)p.started.dwHighDateTime<<32)|(uint)p.started.dwLowDateTime);
        if(p.pid==w.processId&&DateTime.FromFileTimeUtc(time).Ticks.ToString()==w.processStart)return true;
      }
      return false;
    } finally { RmEndSession(session); }
  }
  private static object ReadArchiveIdentity(IntPtr hwnd,Window before,string input) {
    string archive=Path.GetFullPath(input);
    if(!File.Exists(archive)||archive.StartsWith(@"\\")||!archive.EndsWith(".SC2Map",StringComparison.OrdinalIgnoreCase))
      return new { verified=false,reason="local_map_required" };
    string name=Path.GetFileName(archive),title=before.title;
    int begin=title.IndexOf('['),end=title.LastIndexOf("] - StarCraft II Editor",StringComparison.Ordinal);
    if(begin<0||end<=begin||!String.Equals(Path.GetFileName(title.Substring(begin+1,end-begin-1).TrimEnd('*').Replace('/','\\')),name,StringComparison.OrdinalIgnoreCase))
      return new { verified=false,reason="caption_mismatch" };
    var docs=OpenArchiveDocuments(hwnd);int matches=0;
    foreach(string doc in docs)if(String.Equals(Path.GetFileName(doc.Replace('/','\\')),name,StringComparison.OrdinalIgnoreCase))matches++;
    if(matches!=1)return new { verified=false,reason="ambiguous_document_name" };
    if(!ArchiveHeldBy(archive,before))return new { verified=false,reason="archive_owner_not_confirmed" };
    Window after=Read(hwnd);
    if(after==null||after.processId!=before.processId||after.processStart!=before.processStart||after.title!=before.title||after.enabled!=before.enabled||
       String.Join("\u001e",docs.ToArray())!=String.Join("\u001e",OpenArchiveDocuments(hwnd).ToArray()))
      return new { verified=false,reason="document_changed" };
    return new { verified=true,archive=archive,windowId=before.windowId,processId=before.processId,
      processStart=before.processStart,title=before.title,matchingDocuments=matches,
      lockedByProcess=true,scope="map_archive_owner_and_unique_document" };
  }
}
