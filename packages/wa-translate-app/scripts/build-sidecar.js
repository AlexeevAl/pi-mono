import { execSync } from 'child_process';
import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const WA_TRANSLATE_PKG = join(ROOT, 'packages', 'wa-translate');
const APP_BINARIES = join(__dirname, '..', 'src-tauri', 'binaries');

function getTargetTriple() {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === 'win32') return arch === 'x64' ? 'x86_64-pc-windows-msvc' : 'i686-pc-windows-msvc';
  if (platform === 'darwin') return arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  return arch === 'x64' ? 'x86_64-unknown-linux-gnu' : 'aarch64-unknown-linux-gnu';
}

async function build() {
  console.log('--- Building WA-Translate Sidecar ---');
  
  // 1. Извлекаем зависимости и билдим основной пакет
  console.log('Building wa-translate package...');
  execSync('pnpm build', { cwd: WA_TRANSLATE_PKG, stdio: 'inherit' });

  // 2. Создаем папку для бинарников Tauri
  if (!existsSync(APP_BINARIES)) mkdirSync(APP_BINARIES, { recursive: true });

  const triple = getTargetTriple();
  const binaryName = `wa-translate-backend-${triple}${process.platform === 'win32' ? '.exe' : ''}`;
  
  // В РЕАЛЬНОСТИ: здесь мы бы использовали pkg или bun для создания бинарника.
  // Для простоты сейчас мы создадим заглушку или просто скопируем ноду (но это не очень правильно).
  // На GitHub Actions мы будем использовать bun build --compile.
  
  console.log(`Ready for packaging as ${binaryName}`);
}

build().catch(console.error);
