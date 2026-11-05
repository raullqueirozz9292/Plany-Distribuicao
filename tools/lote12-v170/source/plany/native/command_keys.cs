// Prepared with Plany; forwards viewport keys only while its capture event is
// enabled. Idle callbacks pass through without translating or recording input.
using System;
using System.Diagnostics;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class CommandKeys
{
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x100;
    private const int WM_QUIT = 0x12;
    private const int VK_CONTROL = 0x11;
    private const int VK_MENU = 0x12;
    private const int VK_LWIN = 0x5B;
    private const int VK_RWIN = 0x5C;
    private const int VK_SHIFT = 0x10;
    private static readonly HookProc Callback = KeyboardCallback;
    private static IntPtr hook;
    private static IntPtr mainWindow;
    private static IntPtr viewport;
    private static uint sketchupThread;
    private static NetworkStream stream;
    private static uint hookThread;
    private static volatile bool connected;
    private static EventWaitHandle captureEnabled;
    private static int captureSession;

    private delegate IntPtr HookProc(int code, IntPtr message, IntPtr data);
    private delegate bool EnumProc(IntPtr window, IntPtr data);

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    private struct GuiThreadInfo
    {
        public uint Size, Flags;
        public IntPtr Active, Focus, Capture, MenuOwner, MoveSize, Caret;
        public Rect CaretRect;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)]
    private struct Message
    {
        public IntPtr Window;
        public uint Id;
        public IntPtr WParam, LParam;
        public uint Time;
        public Point Location;
    }

    [DllImport("user32.dll")] private static extern IntPtr SetWindowsHookEx(int kind, HookProc callback, IntPtr module, uint thread);
    [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr handle);
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr handle, int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool GetGUIThreadInfo(uint thread, ref GuiThreadInfo info);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc callback, IntPtr data);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder text, int capacity);
    [DllImport("user32.dll")] private static extern bool IsChild(IntPtr parent, IntPtr child);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder name, int capacity);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, IntPtr process);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] private static extern uint MapVirtualKey(uint key, uint mode);
    [DllImport("user32.dll")] private static extern IntPtr GetKeyboardLayout(uint thread);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int ToUnicodeEx(uint key, uint scan, byte[] state, StringBuilder output, int capacity, uint flags, IntPtr layout);
    [DllImport("user32.dll")] private static extern int GetMessage(out Message message, IntPtr window, uint min, uint max);
    [DllImport("user32.dll")] private static extern bool PeekMessage(out Message message, IntPtr window, uint min, uint max, uint remove);
    [DllImport("user32.dll")] private static extern bool PostThreadMessage(uint thread, uint message, IntPtr wparam, IntPtr lparam);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string name);

    private static void Main(string[] args)
    {
        if (args.Length != 5) return;
        int port, parent;
        if (!int.TryParse(args[0], out port) || !int.TryParse(args[2], out parent)) return;
        try
        {
            using (var process = Process.GetProcessById(parent))
            using (var client = new TcpClient())
            using (var ready = EventWaitHandle.OpenExisting(args[3]))
            using (captureEnabled = EventWaitHandle.OpenExisting(args[4]))
            {
                mainWindow = FindMainWindow(parent);
                if (mainWindow == IntPtr.Zero) return;
                sketchupThread = GetWindowThreadProcessId(mainWindow, IntPtr.Zero);
                viewport = FindViewport(mainWindow);
                if (viewport == IntPtr.Zero) return;
                client.Connect("127.0.0.1", port);
                client.NoDelay = true;
                stream = client.GetStream();
                connected = true;
                hookThread = GetCurrentThreadId();
                Message message;
                PeekMessage(out message, IntPtr.Zero, 0, 0, 0);
                var reader = new Thread(() =>
                {
                    try
                    {
                        using (var commands = new System.IO.StreamReader(stream, Encoding.ASCII))
                        {
                            string command;
                            while ((command = commands.ReadLine()) != null)
                            {
                                int session;
                                if (command.StartsWith("on:", StringComparison.Ordinal) &&
                                    int.TryParse(command.Substring(3), out session) && session > 0)
                                {
                                    Interlocked.Exchange(ref captureSession, session);
                                    if (!Send("active:" + session + "\n")) break;
                                    ready.Set();
                                }
                            }
                        }
                    }
                    catch { }
                    connected = false;
                    PostThreadMessage(hookThread, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
                });
                reader.IsBackground = true;
                reader.Start();
                hook = SetWindowsHookEx(WH_KEYBOARD_LL, Callback, GetModuleHandle(null), 0);
                if (hook == IntPtr.Zero) return;
                if (!Send(args[1] + "\n")) { UnhookWindowsHookEx(hook); return; }
                ready.Set();
                while (connected && GetMessage(out message, IntPtr.Zero, 0, 0) > 0) { }
                UnhookWindowsHookEx(hook);
                connected = false;
            }
        }
        catch { /* An unavailable bridge must never block SketchUp. */ }
    }

    private static IntPtr FindViewport(IntPtr parent)
    {
        IntPtr best = IntPtr.Zero;
        long area = 0;
        EnumChildWindows(parent, (window, data) =>
        {
            var name = new StringBuilder(256);
            GetClassName(window, name, name.Capacity);
            Rect rect;
            if (name.ToString().StartsWith("AfxFrameOrView", StringComparison.Ordinal) && GetWindowRect(window, out rect))
            {
                long candidate = (long)(rect.Right - rect.Left) * (rect.Bottom - rect.Top);
                if (candidate > area) { best = window; area = candidate; }
            }
            return true;
        }, IntPtr.Zero);
        // SketchUp 2024 moved its viewport into the Qt main window; it has
        // no AfxFrameOrView child. Never fall back for an unknown host.
        if (best == IntPtr.Zero)
        {
            var name = new StringBuilder(256);
            GetClassName(parent, name, name.Capacity);
            if (name.ToString().StartsWith("Qt", StringComparison.Ordinal)) best = parent;
        }
        return best;
    }

    private static IntPtr FindMainWindow(int pid)
    {
        IntPtr best = IntPtr.Zero;
        long area = 0;
        EnumWindows((window, data) =>
        {
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            if (owner != (uint)pid || !IsWindowVisible(window)) return true;
            var title = new StringBuilder(512);
            GetWindowText(window, title, title.Capacity);
            // HtmlDialogs and toolbars can be Process.MainWindowHandle.
            // The actual model window has the SketchUp title and a viewport.
            Rect rect;
            IntPtr view = FindViewport(window);
            if (view != IntPtr.Zero && (view != window || title.ToString().IndexOf("SketchUp", StringComparison.OrdinalIgnoreCase) >= 0) && GetWindowRect(window, out rect))
            {
                long candidate = (long)(rect.Right - rect.Left) * (rect.Bottom - rect.Top);
                if (candidate > area) { best = window; area = candidate; }
            }
            return true;
        }, IntPtr.Zero);
        return best;
    }

    private static bool ModelHasFocus()
    {
        if (GetForegroundWindow() != mainWindow) return false;
        var info = new GuiThreadInfo { Size = (uint)Marshal.SizeOf(typeof(GuiThreadInfo)) };
        if (!GetGUIThreadInfo(0, ref info)) return false;
        if (info.Focus == viewport || info.Focus == mainWindow) return true;
        if (viewport == mainWindow && IsChild(mainWindow, info.Focus)) return true;
        var name = new StringBuilder(256);
        GetClassName(info.Focus, name, name.Capacity);
        // A toolbar click can retain toolbar focus after activating the Tool.
        return name.ToString().StartsWith("Afx:ToolBar", StringComparison.Ordinal);
    }

    private static int ActiveSession()
    {
        int session = Interlocked.CompareExchange(ref captureSession, 0, 0);
        return connected && session > 0 && captureEnabled != null && captureEnabled.WaitOne(0) &&
               session == Interlocked.CompareExchange(ref captureSession, 0, 0) ? session : 0;
    }

    private static IntPtr KeyboardCallback(int code, IntPtr message, IntPtr data)
    {
        int session = code < 0 ? 0 : ActiveSession();
        if (session == 0 || message.ToInt32() != WM_KEYDOWN || !ModelHasFocus())
            return CallNextHookEx(hook, code, message, data);
        if ((GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0 || (GetAsyncKeyState(VK_MENU) & 0x8000) != 0 ||
            (GetAsyncKeyState(VK_LWIN) & 0x8000) != 0 || (GetAsyncKeyState(VK_RWIN) & 0x8000) != 0)
            return CallNextHookEx(hook, code, message, data);
        int key = Marshal.ReadInt32(data);
        string value = null;
        if (key != 8 && key != 13 && key != 27 && key != 38 && key != 40)
        {
            var state = new byte[256];
            state[VK_SHIFT] = (byte)(((GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0) ? 0x80 : 0);
            state[key] = 0x80;
            var translated = new StringBuilder(8);
            int count = ToUnicodeEx((uint)key, MapVirtualKey((uint)key, 0), state, translated,
                                    translated.Capacity, 0, GetKeyboardLayout(sketchupThread));
            if (count != 1) return CallNextHookEx(hook, code, message, data);
            value = translated.ToString();
            if (value.Length != 1 || !(char.IsLetterOrDigit(value[0]) || " ;,.-+".IndexOf(value[0]) >= 0))
                return CallNextHookEx(hook, code, message, data);
        }
        string hex = value == null ? "" : BitConverter.ToString(Encoding.UTF8.GetBytes(value)).Replace("-", "");
        if (!Send(session + ":" + key + ":" + hex + "\n")) return CallNextHookEx(hook, code, message, data);
        return (IntPtr)1;
    }

    private static bool Send(string data)
    {
        try
        {
            byte[] bytes = Encoding.ASCII.GetBytes(data);
            lock (stream) { stream.Write(bytes, 0, bytes.Length); }
            return true;
        }
        catch { connected = false; return false; }
    }
}
