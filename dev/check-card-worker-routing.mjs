// Read-only transport prerequisite, never a card-worker lifecycle acceptance test.
import { CodexRpc, resolveCodexCommand } from "../skills/grill/hub/codex.mjs";

const args = process.argv.slice(2);
if (args.length !== 1 || args[0] !== "--probe") {
  console.log("Проверка транспорта: node dev/check-card-worker-routing.mjs --probe");
  console.log("Без --probe подключение не выполняется. Жизненный цикл работников не проверен.");
  if (args.length) process.exitCode = 1;
} else {
  let rpc;
  try {
    const executable = resolveCodexCommand();
    rpc = new CodexRpc({ ...executable, args: [...executable.args, "--no-daemon", "app-server", "proxy"], transport: "proxy", timeoutMs: 5000 });
    await rpc.initialize();
    console.log(JSON.stringify({ transport: "existing-host-proxy", initialization: "passed", lifecycle: "unverified", inferenceStarted: false }));
  } catch (error) {
    console.error(JSON.stringify({ transport: "existing-host-proxy", initialization: "unavailable", lifecycle: "unverified", inferenceStarted: false, error: "Proxy initialization failed" }));
    process.exitCode = 1;
  } finally {
    // Close only our stdio proxy, never the host or a model session.
    rpc?.close();
  }
}
