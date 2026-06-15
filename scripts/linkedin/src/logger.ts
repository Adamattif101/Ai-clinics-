import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { EngagementLog, WeeklyReflection } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.join(__dirname, '../logs');

function todayFile(): string {
  const date = new Date().toISOString().split('T')[0];
  return path.join(LOGS_DIR, `engagements-${date}.json`);
}

function ensureLogsDir(): void {
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
}

export function logEngagement(entry: EngagementLog): void {
  ensureLogsDir();
  const file = todayFile();
  const logs: EngagementLog[] = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf-8'))
    : [];
  logs.push(entry);
  fs.writeFileSync(file, JSON.stringify(logs, null, 2));

  const icon = entry.status === 'comment_posted' ? '✓' :
               entry.status === 'dry_run' ? '~' :
               entry.status === 'skipped_already_commented' ? '↩' : '✗';
  console.log(`${icon} [${entry.status}] ${entry.author_name}`);
  if (entry.comment_text) console.log(`  → "${entry.comment_text.slice(0, 80)}..."`);
}

export function logWeeklyReflection(reflection: WeeklyReflection): void {
  ensureLogsDir();
  const file = path.join(LOGS_DIR, `weekly-${reflection.date}.json`);
  fs.writeFileSync(file, JSON.stringify(reflection, null, 2));
  console.log(`Weekly reflection saved: ${file}`);
}

export function readWeekLogs(): EngagementLog[] {
  ensureLogsDir();
  return fs.readdirSync(LOGS_DIR)
    .filter(f => f.startsWith('engagements-') && f.endsWith('.json'))
    .sort()
    .slice(-7)
    .flatMap(f => {
      try {
        return JSON.parse(fs.readFileSync(path.join(LOGS_DIR, f), 'utf-8')) as EngagementLog[];
      } catch {
        return [];
      }
    });
}

export function getPostedUrls(): Set<string> {
  ensureLogsDir();
  const urls = new Set<string>();
  fs.readdirSync(LOGS_DIR)
    .filter(f => f.startsWith('engagements-') && f.endsWith('.json'))
    .sort()
    .slice(-14) // last 2 weeks
    .forEach(f => {
      try {
        const logs: EngagementLog[] = JSON.parse(
          fs.readFileSync(path.join(LOGS_DIR, f), 'utf-8')
        );
        logs
          .filter(l => l.status === 'comment_posted')
          .forEach(l => urls.add(l.post_url));
      } catch {
        // skip
      }
    });
  return urls;
}
