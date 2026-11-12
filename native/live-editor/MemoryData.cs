// Explicit opt-in IPC to our separate live Data adapter, on the selected GUI thread.
// No private Toolkit binary, process-memory patch, map file replacement or physical input.
using System;
using System.IO;
using System.IO.MemoryMappedFiles;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
internal static class MemoryData {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  sealed class Request {
    public uint magic = 0x5343324c, version = 1, operation;
    public int state;
    public uint error, pid;
    public ulong window;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 1024)]
    public string title = "";
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
    public string unit = "";
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
    public string field = "";
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
    public string expected = "";
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
    public string value = "";
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
    public string token = "";
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32768)]
    public string result = "";
  }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
  static extern ushort GlobalAddAtom(string name);
  [DllImport("kernel32.dll")]
  static extern ushort GlobalDeleteAtom(ushort atom);
  [DllImport("user32.dll")]
  static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern uint RegisterWindowMessage(string name);
  [DllImport("user32.dll", SetLastError = true)]
  static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wp, IntPtr lp);
  [DllImport("user32.dll", SetLastError = true)]
  static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint message, IntPtr wp, IntPtr lp,
                                          uint flags, uint timeout, out IntPtr result);
  static byte[] Encode(Request r) {
    int size = Marshal.SizeOf(typeof(Request));
    var p = Marshal.AllocHGlobal(size);
    try {
      Marshal.StructureToPtr(r, p, false);
      var b = new byte[size];
      Marshal.Copy(p, b, 0, size);
      return b;
    } finally {
      Marshal.FreeHGlobal(p);
    }
  }
  static Request Decode(byte[] bytes) {
    var p = Marshal.AllocHGlobal(bytes.Length);
    try {
      Marshal.Copy(bytes, 0, p, bytes.Length);
      return (Request)Marshal.PtrToStructure(p, typeof(Request));
    } finally {
      Marshal.FreeHGlobal(p);
    }
  }
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern IntPtr GetProp(IntPtr hwnd, string name);
  static string Verify(string home, string file, string expected) {
    using (var sha = SHA256.Create()) {
      string got =
          BitConverter.ToString(sha.ComputeHash(File.ReadAllBytes(Path.Combine(home, file))))
              .Replace("-", "")
              .ToLowerInvariant();
      if (got != expected)
        throw new Exception("LIVE_MEMORY_BINARY_MISMATCH");
      return Path.Combine(home, file);
    }
  }
  public static object Call(IntPtr hwnd, uint operation, string unit = "", string field = "",
                            string expected = "", string value = "", string token = "") {
    uint pid;
    uint thread = GetWindowThreadProcessId(hwnd, out pid);
    var title = new StringBuilder(1024);
    GetWindowText(hwnd, title, 1024);
    if ((operation > 6 && (operation<91||operation>93) && (operation<24||operation>26) && operation!=63 && operation!=64 && operation!=65 && operation!=66 && (operation < 60 || operation > 62) && (operation < 50 || operation > 59) && (operation < 30 || operation > 39) && (operation < 40 || operation > 45)) || title.Length >= 1023 || unit.Length >= 128 || field.Length >= 128 ||
        expected.Length >= 128 || value.Length >= 128 || token.Length >= 64)
      throw new Exception("LIVE_MEMORY_REQUEST_INVALID");
    var request =
        new Request { pid = pid,
                      window = (ulong)hwnd.ToInt64(),
                      operation = operation,
                      title = title.ToString(),
                      unit = unit,
                      field = field,
                      expected = expected,
                      value = value,
                      token = operation == 3 && token.Length == 0 ? Guid.NewGuid().ToString("N")
                                                                  : token };
    string baseDir = Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory);
    var runtimeDirectory=new DirectoryInfo(baseDir);
    if(runtimeDirectory.Parent!=null&&runtimeDirectory.Parent.Name=="live-bridge"&&runtimeDirectory.Parent.Parent!=null)
      baseDir=runtimeDirectory.Parent.Parent.FullName;
    var config = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(
        File.ReadAllText(Path.Combine(baseDir, "sc2-mcp-live-memory.json")));
    string home = Path.GetFullPath(Path.Combine(baseDir, (string)config["home"]));
    if (!home.StartsWith(Path.Combine(baseDir, "live-memory") + Path.DirectorySeparatorChar,
                         StringComparison.OrdinalIgnoreCase))
      throw new Exception("LIVE_MEMORY_RUNTIME_PATH_INVALID");
    string message = (string)config["message"];
    var files = (Dictionary<string, object>)config["files"];
    Verify(home, "sc2-mcp-live-data.dll", (string)files["sc2-mcp-live-data.dll"]);
    string loader =
        Verify(home, "sc2-mcp-live-loader.exe", (string)files["sc2-mcp-live-loader.exe"]);
    if (GetProp(hwnd, message) != new IntPtr(1)) {
      string args = pid + " " + Process.GetProcessById((int)pid).StartTime.ToUniversalTime().Ticks +
                    " " + hwnd.ToInt64();
      using (var process = Process.Start(new ProcessStartInfo(loader, args) {
        UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden,
        RedirectStandardOutput = true
      })) {
        if (!process.WaitForExit(35000))
          throw new Exception("LIVE_MEMORY_LOADER_UNCERTAIN");
        if (process.ExitCode != 0)
          throw new Exception("LIVE_MEMORY_LOADER_FAILED: " + process.ExitCode + " " +
                              process.StandardOutput.ReadToEnd());
      }
      if (GetProp(hwnd, message) != new IntPtr(1))
        throw new Exception("LIVE_MEMORY_DISPATCH_UNCONFIRMED");
    }
    ushort atom = 0;
    string name = "Local\\SC2LiveData-" + Guid.NewGuid().ToString("N");
    try {
      var bytes = Encode(request);
      using (var mapping = MemoryMappedFile.CreateNew(name, bytes.Length)) using (
          var view = mapping.CreateViewAccessor()) {
        view.WriteArray(0, bytes, 0, bytes.Length);
        atom = GlobalAddAtom(name);
        if (atom == 0)
          throw new Exception("LIVE_MEMORY_SUBMIT_FAILED");
        if (operation == 0) {
          IntPtr response;
          SendMessageTimeout(hwnd, RegisterWindowMessage(message), new IntPtr(atom), IntPtr.Zero, 2,
                             3000, out response);
        } else if (!PostMessage(hwnd, RegisterWindowMessage(message), new IntPtr(atom),
                                IntPtr.Zero))
          throw new Exception("LIVE_MEMORY_SUBMIT_FAILED");
        for (int i = 0; i < 400; i++) {
          Thread.Sleep(20);
          view.ReadArray(0, bytes, 0, bytes.Length);
          request = Decode(bytes);
          if ((operation == 32 || operation == 35 || operation == 41 || operation == 51) && request.state == 1 && i >= 9)
            return new { status = "pending", token = request.token, retryMutation = false };
          if (operation == 24 && request.state == 1 && i >= 9)
            return new { status = "save_pending", saveRequested = true, retryMutation = false };
          if(operation==39&&request.state==1&&i>=9)
            return new{status="delete_pending",deleteRequested=true,retryMutation=false};
          if (operation == 3 && request.state == 1 && i >= 9)
            return new { status = "pending", token = request.token, nativeState = request.state,
                         commitRequested = false };
          if (request.state == 2) {
            if (request.error != 0)
              throw new Exception(request.result.Length > 0
                                      ? request.result
                                      : "LIVE_MEMORY_NATIVE_ERROR: " + request.error);
            return new JavaScriptSerializer().DeserializeObject(request.result);
          }
        }
        return new { status = "unknown",
                     nativeState = request.state,
                     retryMutation = false,
                     error = "LIVE_MEMORY_NATIVE_TIMEOUT",
                     hookCalls = GetProp(hwnd, "SC2LiveData.Debug.Calls").ToInt64(),
                     nativeError = GetProp(hwnd, "SC2LiveData.Debug.Error").ToInt64(),
                     requestBytes = bytes.Length,
                     threadId = thread };
      }
    } finally {
      if (atom != 0)
        GlobalDeleteAtom(atom);
    }
  }
  public static object Inspect(IntPtr window) { return Call(window, 0); }
}
