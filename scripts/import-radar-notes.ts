// Importa notas do radar (Obsidian) para POST /radar/items.
//
// Ponte enquanto o radar (Python, homelab) não envia direto para a API.
// Lê uma ou mais notas markdown geradas pelo radar, extrai os itens e envia
// em lote com o header x-radar-token. A dedup por link é feita pelo backend.
//
// Uso:
//   npm run radar:import -- "<nota.md | pasta>" [...] [--api URL] [--dry-run]
//
// Ex.: npm run radar:import -- ~/Documents/encyclopedia/inbox/radar --api http://localhost:3333
//
// Variáveis: RADAR_TOKEN (obrigatória, do .env) e RADAR_API_URL (default http://localhost:3333).
import 'dotenv/config';
import { readdirSync, readFileSync, statSync } from 'fs';
import { basename, join, resolve } from 'path';

type RunType = 'daily' | 'weekly';

interface RadarItemPayload {
  title: string;
  link: string;
  source: string;
  summary?: string | null;
  score?: number;
  hits?: string[];
  published_at?: string | null;
}

interface ParsedNote {
  file: string;
  run_type: RunType;
  date: string; // YYYY-MM-DD (frontmatter)
  items: RadarItemPayload[];
}

// Fuso do radar (roda no homelab, em Brasília). Sem horário de verão desde 2019.
const TZ_OFFSET = '-03:00';

// "- **38** · [Título](https://...) · Fonte · 23/09 08:29"   (score pode vir com espaço: "** 9**")
const ITEM_RE = /^- \*\*\s*(-?\d+)\s*\*\* · \[(.*)\]\((https?:\/\/[^)\s]+)\) · (.+?) · (\d{2})\/(\d{2}) (\d{2}):(\d{2})\s*$/;
const SUB_RE = /^ {2}- (.*)$/; // linhas "  - resumo" e "  - _hits_"
const HITS_RE = /^_(.*)_$/;

function parseFrontmatter(text: string): Record<string, string> {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  const out: Record<string, string> = {};
  if (!m) return out;
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function publishedAt(noteDate: string, dd: string, mm: string, hh: string, mi: string): string {
  const [noteYear, noteMonth] = noteDate.split('-').map(Number);
  // item de dezembro numa nota de janeiro => ano anterior
  const year = Number(mm) > noteMonth ? noteYear - 1 : noteYear;
  return `${year}-${mm}-${dd}T${hh}:${mi}:00${TZ_OFFSET}`;
}

export function parseNote(file: string): ParsedNote {
  const text = readFileSync(file, 'utf8');
  const fm = parseFrontmatter(text);
  if (fm.type !== 'radar') throw new Error(`${basename(file)}: frontmatter sem "type: radar"`);
  const run_type = fm.run as RunType;
  if (run_type !== 'daily' && run_type !== 'weekly') throw new Error(`${basename(file)}: run inválido "${fm.run}"`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fm.date ?? '')) throw new Error(`${basename(file)}: date inválida "${fm.date}"`);

  const items: RadarItemPayload[] = [];
  let current: RadarItemPayload | null = null;

  for (const line of text.split('\n')) {
    const item = line.match(ITEM_RE);
    if (item) {
      const [, score, title, link, source, dd, mm, hh, mi] = item;
      current = {
        title: title.trim(),
        link,
        source: source.trim(),
        score: Number(score),
        published_at: publishedAt(fm.date, dd, mm, hh, mi),
      };
      items.push(current);
      continue;
    }
    const sub = current && line.match(SUB_RE);
    if (sub) {
      const body = sub[1].trim();
      const hits = body.match(HITS_RE);
      if (hits) {
        current!.hits = hits[1].split(',').map((h) => h.trim()).filter(Boolean);
      } else if (current!.summary == null) {
        // remove o marcador de corte do feed ("[...]", "…") no fim do resumo
        current!.summary = body.replace(/\s*(\[\.\.\.\]|…)\s*$/u, '').trim() || null;
      }
      continue;
    }
    if (line.startsWith('## ') && !line.startsWith('## Notícias')) current = null; // saiu da lista
  }

  return { file, run_type, date: fm.date, items };
}

function collectFiles(paths: string[]): string[] {
  const files: string[] = [];
  for (const p of paths) {
    const abs = resolve(p.replace(/^~(?=$|\/)/, process.env.HOME ?? ''));
    const st = statSync(abs);
    if (st.isDirectory()) {
      for (const name of readdirSync(abs).sort()) {
        if (name.endsWith('.md')) files.push(join(abs, name));
      }
    } else {
      files.push(abs);
    }
  }
  return files;
}

async function send(api: string, token: string, note: ParsedNote) {
  const res = await fetch(`${api.replace(/\/$/, '')}/radar/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-radar-token': token },
    body: JSON.stringify({ run_type: note.run_type, items: note.items }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body)}`);
  return body as { inserted: number; skipped: number };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const apiIdx = args.indexOf('--api');
  const api = apiIdx >= 0 ? args[apiIdx + 1] : process.env.RADAR_API_URL || 'http://localhost:3333';
  const paths = args.filter((a, i) => !a.startsWith('--') && (apiIdx < 0 || i !== apiIdx + 1));

  if (paths.length === 0) {
    console.error('Uso: npm run radar:import -- "<nota.md | pasta>" [...] [--api URL] [--dry-run]');
    process.exit(1);
  }

  const token = process.env.RADAR_TOKEN;
  if (!dryRun && !token) {
    console.error('RADAR_TOKEN não definido no .env');
    process.exit(1);
  }

  const files = collectFiles(paths);
  let total = { inserted: 0, skipped: 0 };

  for (const file of files) {
    let note: ParsedNote;
    try {
      note = parseNote(file);
    } catch (err) {
      console.error(`skip  ${basename(file)}: ${(err as Error).message}`);
      continue;
    }
    if (note.items.length === 0) {
      console.log(`vazio ${basename(file)}`);
      continue;
    }
    if (dryRun) {
      console.log(`\n${basename(file)} (${note.run_type}, ${note.items.length} itens)`);
      console.log(JSON.stringify(note.items.slice(0, 2), null, 2), note.items.length > 2 ? `... +${note.items.length - 2}` : '');
      continue;
    }
    try {
      const r = await send(api, token!, note);
      total = { inserted: total.inserted + r.inserted, skipped: total.skipped + r.skipped };
      console.log(`ok    ${basename(file)}: ${note.items.length} itens → inseridos ${r.inserted}, já existiam ${r.skipped}`);
    } catch (err) {
      console.error(`erro  ${basename(file)}: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  }

  if (!dryRun) console.log(`\ntotal: inseridos ${total.inserted}, já existiam ${total.skipped} (${api})`);
}

main();
