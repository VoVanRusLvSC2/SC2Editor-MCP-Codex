// Inventory/file-drop does not load a DLL. Explicit memory-* commands use our
// separate opt-in visible Data adapter, never the hidden native test worker.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;

internal static partial class LiveEditor {
  private delegate bool EnumWindow(IntPtr hwnd, IntPtr arg);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindow callback, IntPtr arg);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern bool IsWindowEnabled(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder text, int count);
  [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr hwnd, uint command);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] private static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);
  [DllImport("user32.dll", SetLastError=true)] private static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wparam, IntPtr lparam);
  [DllImport("kernel32.dll")] private static extern IntPtr GlobalAlloc(uint flags, UIntPtr bytes);
  [DllImport("kernel32.dll")] private static extern IntPtr GlobalLock(IntPtr handle);
  [DllImport("kernel32.dll")] private static extern bool GlobalUnlock(IntPtr handle);
  [DllImport("kernel32.dll")] private static extern IntPtr GlobalFree(IntPtr handle);

  private sealed class Window {
    public string windowId; public int processId; public string processStart;
    public string title; public bool enabled; public bool acceptsFiles;
  }
  private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
  private static Window Read(IntPtr hwnd) {
    if (!IsWindowVisible(hwnd)) return null;
    uint pid; GetWindowThreadProcessId(hwnd, out pid);
    using (Process process = Process.GetProcessById((int)pid)) {
      string name = Path.GetFileName(process.MainModule.FileName);
      if (!String.Equals(name, "SC2Editor_x64.exe", StringComparison.OrdinalIgnoreCase) &&
          !String.Equals(name, "SC2Editor.exe", StringComparison.OrdinalIgnoreCase)) return null;
      StringBuilder title = new StringBuilder(8192); GetWindowText(hwnd, title, title.Capacity);
      if (!title.ToString().Contains("StarCraft II Editor")) {
        // Native parameter/function dialogs omit the product name. Include
        // owned modal windows in read-only inventory instead of hiding the
        // reason a document frame is disabled. Other process names still refuse.
        StringBuilder kind = new StringBuilder(64); GetClassName(hwnd, kind, kind.Capacity);
        if(kind.ToString()!="#32770" || GetWindow(hwnd,4)==IntPtr.Zero) return null;
      }
      return new Window { windowId=hwnd.ToInt64().ToString(), processId=(int)pid,
        processStart=process.StartTime.ToUniversalTime().Ticks.ToString(), title=title.ToString(),
        enabled=IsWindowEnabled(hwnd), acceptsFiles=(GetWindowLongPtr(hwnd,-20).ToInt64() & 16)!=0 };
    }
  }
  private static object Run(string[] args) {
    if(args.Length==2&&args[0]=="window")return Read(new IntPtr(Int64.Parse(args[1])));
    if(args.Length==6&&args[0]=="archive-owner") {
      IntPtr hwnd=new IntPtr(Int64.Parse(args[1]));Window w=Read(hwnd);
      if(w==null||w.processId.ToString()!=args[2]||w.processStart!=args[3]||w.title!=args[4])
        throw new Exception("LIVE_MAP_IDENTITY_WINDOW_CHANGED");
      return ReadArchiveIdentity(hwnd,w,args[5]);
    }
    if((args.Length==5&&args[0]=="memory-inspect")||(args.Length==11&&args[0]=="memory-command")){
      uint operation=args.Length==5?0:UInt32.Parse(args[5]);
      IntPtr hwnd=new IntPtr(Int64.Parse(args[1]));Window w=Read(hwnd);
      bool terrain=(operation>=24&&operation<=26)||operation==63||(operation>=30&&operation<=39)||(operation>=43&&operation<=45);
      bool modalPlacement=operation==25||operation==30||operation==36||operation==38||(operation>=52&&operation<=54)||(operation>=56&&operation<=59);
      bool inspection=(((operation>=50&&operation<=59)||(operation>=60&&operation<=62)||operation==64||operation==65)&&w!=null&&(w.title.StartsWith("Triggers - [")||w.title.StartsWith("UI - [")||w.title.StartsWith("Import - [")||w.title.StartsWith("Text - [")||w.title.StartsWith("Terrain - [")||w.title.StartsWith("Data - [")))||((operation==66||operation==67||operation==68)&&w!=null&&w.title.StartsWith("Triggers - ["));
      if(w==null||w.processId.ToString()!=args[2]||w.processStart!=args[3]||w.title.Replace("*]","]")!=args[4].Replace("*]","]")||(!w.enabled&&(operation<4||operation>6)&&!modalPlacement)||(!inspection&&!w.title.StartsWith(terrain?"Terrain - [":"Data - [")))throw new Exception(terrain?"LIVE_EXACT_TERRAIN_WINDOW_REQUIRED":"LIVE_MEMORY_EXACT_DATA_WINDOW_REQUIRED");
      return args.Length==5?MemoryData.Inspect(hwnd):MemoryData.Call(hwnd,operation,args[6],args[7],args[8],args[9],args[10]);
    }
    if (args.Length == 1 && args[0] == "list") {
      List<Window> result = new List<Window>();
      EnumWindows(delegate(IntPtr hwnd, IntPtr unused) { try { Window w=Read(hwnd); if(w!=null) result.Add(w); } catch { } return true; },IntPtr.Zero);
      return result;
    }
    if (args.Length != 6 || args[0] != "open") throw new Exception("LIVE_ARGUMENTS_INVALID");
    IntPtr target = new IntPtr(Int64.Parse(args[1])); Window current = Read(target);
    if (current == null || current.processId.ToString()!=args[2] || current.processStart!=args[3] || current.title!=args[4])
      throw new Exception("LIVE_WINDOW_CHANGED");
    if (!current.enabled || current.title.Contains("*]")) throw new Exception("LIVE_SAVE_OR_DIALOG_REQUIRED");
    if (!current.acceptsFiles) throw new Exception("LIVE_FILE_DROP_UNSUPPORTED");
    string archive=Path.GetFullPath(args[5]);
    if (!File.Exists(archive) || (!archive.EndsWith(".SC2Map",StringComparison.OrdinalIgnoreCase) && !archive.EndsWith(".SC2Mod",StringComparison.OrdinalIgnoreCase)))
      throw new Exception("LIVE_ARCHIVE_REQUIRED");
    byte[] names=Encoding.Unicode.GetBytes(archive+"\0\0");
    IntPtr block=GlobalAlloc(0x42,new UIntPtr((uint)(20+names.Length)));
    if(block==IntPtr.Zero) throw new Exception("LIVE_ALLOCATION_FAILED");
    bool transferred=false;
    try {
      IntPtr pointer=GlobalLock(block); if(pointer==IntPtr.Zero) throw new Exception("LIVE_ALLOCATION_FAILED");
      try { Marshal.WriteInt32(pointer,0,20); Marshal.WriteInt32(pointer,16,1); Marshal.Copy(names,0,IntPtr.Add(pointer,20),names.Length); }
      finally { GlobalUnlock(block); }
      if(!PostMessage(target,0x233,block,IntPtr.Zero)) throw new Exception("LIVE_OPEN_REQUEST_FAILED");
      transferred=true;
      return new { status="open_requested", nativeLoadConfirmed=false, saveDialogsHandled=false };
    } finally { if(!transferred) GlobalFree(block); }
  }
  public static void Main(string[] args) {
    Console.InputEncoding=new UTF8Encoding(false);
    Console.OutputEncoding=new UTF8Encoding(false);
    try { DesktopContext.Initialize(); }
    catch(Exception error) { Console.WriteLine(Json.Serialize(new {error=error.Message}));return; }
    if(args.Length==1&&args[0]=="memory-stdio"){
      string line;
      while((line=Console.ReadLine())!=null){
        try {
          if(line.Length>16384)throw new Exception("LIVE_MEMORY_REQUEST_BOUND");
          var request=Json.Deserialize<string[]>(line);
          if(request==null||!((request.Length==11&&request[0]=="memory-command")||(request.Length==1&&request[0]=="list")||(request.Length==2&&request[0]=="window")||(request.Length==6&&request[0]=="archive-owner")))throw new Exception("LIVE_MEMORY_REQUEST_INVALID");
          Console.WriteLine(Json.Serialize(Run(request)));
        }catch(Exception error){Console.WriteLine(Json.Serialize(new {error=error.Message}));}
      }
      return;
    }
    try { Console.WriteLine(Json.Serialize(Run(args))); }
    catch(Exception error) { Console.WriteLine(Json.Serialize(new { error=error.Message })); }
  }
}
