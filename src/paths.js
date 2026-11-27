import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function defaultDataDirectory() {
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(base, 'QStudy');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'QStudy');
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'qstudy');
}

export const DATA_DIR = path.resolve(process.env.QSTUDY_DATA_DIR || defaultDataDirectory());
export const DB_PATH = path.join(DATA_DIR, 'qureo.db');
export const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
export const SESSION_PATH = path.join(DATA_DIR, 'session.dpapi');
export const ANSWERS_DIR = path.join(DATA_DIR, 'answers');
export const EXPORTS_DIR = path.join(DATA_DIR, 'exports');

function copyMissingFiles(source, destination) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copyMissingFiles(sourcePath, destinationPath);
    } else if (entry.isFile() && !fs.existsSync(destinationPath)) {
      fs.copyFileSync(sourcePath, destinationPath);
    }
  }
}

function migrateLegacyData() {
  const legacyData = path.join(ROOT, 'data');
  if (path.resolve(legacyData) !== path.resolve(DATA_DIR)) copyMissingFiles(legacyData, DATA_DIR);

  const legacyAnswers = path.join(ROOT, 'answers');
  if (path.resolve(legacyAnswers) !== path.resolve(ANSWERS_DIR)) copyMissingFiles(legacyAnswers, ANSWERS_DIR);

  const legacyConfig = path.join(ROOT, 'qureo.config.json');
  if (fs.existsSync(legacyConfig) && !fs.existsSync(CONFIG_PATH)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.copyFileSync(legacyConfig, CONFIG_PATH);
  }
}

fs.mkdirSync(DATA_DIR, { recursive: true });
migrateLegacyData();
