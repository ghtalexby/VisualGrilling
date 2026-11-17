using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;

// Compiled by install.ps1 with fixed absolute paths. Never invokes a shell.
internal static class NativeHost {
  private const string Node = @"@@NODE@@";
  private const string Script = @"@@SCRIPT@@";
  private const string Config = @"@@CONFIG@@";
  private const string Origin = @"@@ORIGIN@@";
  private static string Quote(string value) { return "\"" + value.Replace("\"", "\\\"") + "\""; }
  [STAThread]
  private static int Main(string[] args) {
    if (args.Length < 1 || args[0] != Origin) return 2;
    try {
      var start = new ProcessStartInfo(Node, Quote(Script) + " --config " + Quote(Config) + " --origin " + Quote(args[0]));
      start.UseShellExecute = false;
      start.CreateNoWindow = true;
      start.RedirectStandardInput = true;
      start.RedirectStandardOutput = true;
      start.RedirectStandardError = true;
      using (var child = Process.Start(start)) {
        var input = Task.Run(async () => {
          try { await Console.OpenStandardInput().CopyToAsync(child.StandardInput.BaseStream); }
          finally { child.StandardInput.Close(); }
        });
        var output = child.StandardOutput.BaseStream.CopyToAsync(Console.OpenStandardOutput());
        var errors = child.StandardError.BaseStream.CopyToAsync(Console.OpenStandardError());
        child.WaitForExit();
        output.GetAwaiter().GetResult();
        errors.GetAwaiter().GetResult();
        return child.ExitCode;
      }
    } catch { return 3; }
  }
}
