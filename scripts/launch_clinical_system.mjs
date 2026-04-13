import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Конфигурация путей (предполагаем, что репозитории лежат в одной папке)
const PI_MONO_ROOT = path.resolve(__dirname, "..");
const PSF_ENGINE_ROOT = path.resolve(PI_MONO_ROOT, "..", "psf-engine-v2");

console.log("🚀 Запуск клинической системы Linda...");

function startProcess(name, command, args, cwd) {
  console.log(`[${name}] Запуск: ${command} ${args.join(" ")} in ${cwd}`);
  const proc = spawn(command, args, { 
    cwd, 
    shell: true, 
    stdio: "inherit",
    env: { ...process.env, FORCE_COLOR: "true" }
  });

  proc.on("error", (err) => {
    console.error(`[${name}] Ошибка запуска:`, err);
  });

  proc.on("exit", (code) => {
    console.log(`[${name}] Процесс завершен с кодом ${code}`);
  });

  return proc;
}

// 1. Запуск движка (Product: clinic-profile-os, Port: 3044)
const engineProc = startProcess(
  "ENGINE", 
  "npm", ["run", "dev", "-w", "@products/clinic-profile-os"], 
  PSF_ENGINE_ROOT
);

// 2. Запуск агента (WhatsApp & Telegram)
// Даем движку пару секунд на старт
setTimeout(() => {
  const agentProc = startProcess(
    "AGENT", 
    "npm", ["start"], 
    path.resolve(PI_MONO_ROOT, "packages", "linda-agent")
  );

  process.on("SIGINT", () => {
    console.log("\n🛑 Останавливаем всё...");
    engineProc.kill();
    agentProc.kill();
    process.exit();
  });
}, 3000);
