import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const projectDir = fs.realpathSync(process.cwd());
const backupDir = path.join(os.homedir(), 'Documents', 'trackingwork-backups');
fs.mkdirSync(backupDir, { recursive: true });

const labelArg = process.argv.find((a) => a.startsWith('--label='));
const rawLabel = labelArg ? labelArg.split('=')[1] : 'manual';
const safeLabel = (rawLabel || 'manual').replace(/[^a-zA-Z0-9_-]/g, '_');

const EXCLUDED_DIRS = new Set(['node_modules', '.next', '.git', '.vercel']);

function collectFiles(dir, relBase = '') {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...collectFiles(full, rel));
    } else if (entry.isFile() && !entry.name.endsWith('.zip')) {
      results.push({ full, rel });
    }
  }
  return results;
}

const files = collectFiles(projectDir);

// Vietnam local time (UTC+7)
const vnMs = Date.now() + 7 * 3600 * 1000;
const vnDate = new Date(vnMs);
const pad = (n) => String(n).padStart(2, '0');
const tsFile = `${vnDate.getUTCFullYear()}-${pad(vnDate.getUTCMonth() + 1)}-${pad(vnDate.getUTCDate())}_${pad(vnDate.getUTCHours())}-${pad(vnDate.getUTCMinutes())}-${pad(vnDate.getUTCSeconds())}`;
const tsIso = `${vnDate.getUTCFullYear()}-${pad(vnDate.getUTCMonth() + 1)}-${pad(vnDate.getUTCDate())} ${pad(vnDate.getUTCHours())}:${pad(vnDate.getUTCMinutes())}:${pad(vnDate.getUTCSeconds())} +07:00`;

const zipName = `trackingwork_backup_${tsFile}_${safeLabel}.zip`;
const zipPath = path.join(backupDir, zipName);
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

if (process.platform === 'win32') {
  const manifestPath = path.join(os.tmpdir(), `tw-backup-${Date.now()}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(files), 'utf8');
  try {
    const psScript = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$items = Get-Content -Raw -Encoding UTF8 -Path ${JSON.stringify(manifestPath)} | ConvertFrom-Json
$dest = ${JSON.stringify(zipPath)}
$zip = [System.IO.Compression.ZipFile]::Open($dest, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($item in $items) {
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $item.full, $item.rel, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally {
  $zip.Dispose()
}
`.trim();
    const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
    execFileSync('powershell', ['-NoProfile', '-EncodedCommand', encoded], { stdio: 'inherit' });
  } finally {
    if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);
  }
} else {
  execFileSync(
    'zip',
    ['-rq', zipPath, '.', '-x', 'node_modules/*', '.next/*', '.git/*', '.vercel/*'],
    { cwd: projectDir, stdio: 'inherit' },
  );
}

const stat = fs.statSync(zipPath);
let gitHead = 'unknown';
try {
  gitHead = execSync('git rev-parse --short HEAD', { cwd: projectDir, encoding: 'utf8' }).trim();
} catch {
  // ignore git lookup error
}

const logPath = path.join(backupDir, 'VERSION_MEMORY_LOG.txt');
const logEntry = [
  '================================================================================',
  `BACKUP TIMESTAMP (UTC+7): ${tsIso}`,
  `ARCHIVE FILENAME        : ${zipName}`,
  `ARCHIVE FULL PATH       : ${zipPath}`,
  `FILES ARCHIVED          : ${files.length} (excluding node_modules, .next, .git, .vercel)`,
  `ARCHIVE SIZE BYTES      : ${stat.size}`,
  `GIT COMMIT              : ${gitHead}`,
  '================================================================================',
  '',
].join('\n');

fs.appendFileSync(logPath, logEntry, 'utf8');
console.log(`Backup saved: ${zipPath} (${stat.size} bytes, ${files.length} files)`);
