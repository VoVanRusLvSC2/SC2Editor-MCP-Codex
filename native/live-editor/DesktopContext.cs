// Optional owned SDK test desktop. Changes only this helper thread's desktop;
// never switches the user's input desktop or selects a secure/system desktop.
using System;
using System.Runtime.InteropServices;

internal static class DesktopContext {
  [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
  private static extern IntPtr OpenDesktop(string name,uint flags,bool inherit,uint access);
  [DllImport("user32.dll",SetLastError=true)]
  private static extern bool SetThreadDesktop(IntPtr desktop);
  [DllImport("user32.dll")] private static extern bool CloseDesktop(IntPtr desktop);
  private static IntPtr owned;
  public static void Initialize() {
    string name=Environment.GetEnvironmentVariable("SC2_LIVE_DESKTOP");
    if(String.IsNullOrEmpty(name))return;
    const string prefix="SC2Native-";Guid id;
    if(!name.StartsWith(prefix,StringComparison.Ordinal)||
       !Guid.TryParseExact(name.Substring(prefix.Length),"B",out id))
      throw new Exception("LIVE_DESKTOP_OWNED_SDK_NAME_REQUIRED");
    IntPtr handle=OpenDesktop(name,0,false,0x0001|0x0008|0x0040|0x0080);
    if(handle==IntPtr.Zero)throw new Exception("LIVE_DESKTOP_OPEN_FAILED: "+Marshal.GetLastWin32Error());
    if(!SetThreadDesktop(handle)) {
      int error=Marshal.GetLastWin32Error();CloseDesktop(handle);
      throw new Exception("LIVE_DESKTOP_ATTACH_FAILED: "+error);
    }
    owned=handle; // Retained until helper exit, while its thread uses this desktop.
  }
}
