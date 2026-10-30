// server/conduct.ts
// What the server does about players who cheat or are reported: a player whose moves or hits it keeps turning down
// (server/checks.ts) beyond what lag explains is kicked, and one kicked KICKS_TO_BAN times in KICK_WINDOW_MS is banned,
// its profile and its address, for BAN_MS (doubling with each ban). Reports go to DATA_DIR/reports.log, one JSON line
// each, for a person to read, with what the server knows of the one reported. And a kill counts on the rankings once
// every FARM_MS for the same killer and victim, so two friends can't trade kills up the table.
// The bans are kept in DATA_DIR/bans.json (without a DATA_DIR, in memory only).
import fs from 'node:fs';
import path from 'node:path';

const REFUSED_MOVES_KICK = 300; // moves refused (fading by half a minute, checks.ts) past which a player is kicked...
const REFUSED_HITS_KICK = 40; // ...or hits (and shots from nowhere near it)
const KICK_WINDOW_MS = 30 * 60000;
const KICKS_TO_BAN = 3;
const BAN_MS = 60 * 60000; // a first ban: an hour, then twice as long each time
const REPORT_EVERY_MS = 20000; // a player reports another this often at most
const FARM_MS = 3 * 60000; // a kill of the same victim by the same killer counts on the rankings this often

/** What a player's conduct is judged on: its counts of refusals (server/checks.ts) */
export interface Refusals {
  refusedMoves: number;
  refusedHits: number;
}

/** A report as reports.log keeps it */
export interface ReportLine {
  at: string; // ISO date
  room: string;
  reason: string;
  reporter: { name: string; profile: string };
  reported: { name: string; profile: string; address: string; refusedMoves: number; refusedHits: number };
}

interface BanFile {
  version: 1;
  bans: [key: string, until: number][];
  strikes: [key: string, bans: number][];
}

class Conduct {
  private readonly dir: string | null;
  private readonly log: (message: string) => void;
  private readonly bans = new Map<string, number>(); // 'p:<profile key>' or 'a:<address>' → ms it ends
  private readonly strikes = new Map<string, number>(); // the same keys → bans so far
  private readonly kicks = new Map<string, number[]>(); // the same keys → ms of its recent kicks
  private readonly reported = new Map<string, number>(); // '<reporter>>' + '<reported>' → ms
  private readonly kills = new Map<string, number>(); // '<killer key>><victim key>' → ms it last counted

  constructor(dir: string | null, log: (message: string) => void = console.log) {
    this.dir = dir;
    this.log = log;
    if (dir) this.load(path.join(dir, 'bans.json'));
  }

  /** Until when (ms) the profile `profile` or the address `address` is banned at `now` (0: it isn't) */
  banned(profile: string, address: string, now: number): number {
    const until = Math.max(this.bans.get(`p:${profile}`) ?? 0, this.bans.get(`a:${address}`) ?? 0);
    return until > now ? until : 0;
  }

  /** Whether a player with these refusals is to be kicked */
  judge(r: Refusals): boolean {
    return r.refusedMoves > REFUSED_MOVES_KICK || r.refusedHits > REFUSED_HITS_KICK;
  }

  /** The player of profile `profile` at `address` was kicked at `now` (ms): banned too when it keeps coming back to
   *  it (the ban's end, else 0) */
  kicked(profile: string, address: string, name: string, now: number): number {
    let until = 0;
    for (const key of [`p:${profile}`, `a:${address}`]) {
      const recent = (this.kicks.get(key) ?? []).filter((t) => now - t < KICK_WINDOW_MS);
      recent.push(now);
      this.kicks.set(key, recent);
      if (recent.length < KICKS_TO_BAN) continue;
      const strikes = (this.strikes.get(key) ?? 0) + 1;
      this.strikes.set(key, strikes);
      until = Math.max(until, now + BAN_MS * 2 ** (strikes - 1));
      this.kicks.delete(key);
    }
    if (until) {
      this.bans.set(`p:${profile}`, until);
      this.bans.set(`a:${address}`, until);
      this.log(`[mp] banned ${name} (${address}) until ${new Date(until).toISOString()}`);
      this.save();
    } else {
      this.log(`[mp] kicked ${name} (${address}) for moves or hits it couldn't have made`);
    }
    return until;
  }

  /** Whether `reporter` may report `reported` (profile keys) now, at most every REPORT_EVERY_MS */
  mayReport(reporter: string, reported: string, now: number): boolean {
    const key = `${reporter}>${reported}`;
    if (now - (this.reported.get(key) ?? -Infinity) < REPORT_EVERY_MS) return false;
    this.reported.set(key, now);
    return true;
  }

  /** A report, written down for a person to read */
  report(line: ReportLine): void {
    const text = JSON.stringify(line);
    this.log(`[mp] report: ${line.reporter.name} reports ${line.reported.name} (${line.reason})`);
    if (!this.dir) return;
    fs.promises.mkdir(this.dir, { recursive: true })
      .then(() => fs.promises.appendFile(path.join(this.dir ?? '.', 'reports.log'), `${text}\n`))
      .catch((err: unknown) => { this.log(`[mp] could not write the report: ${err instanceof Error ? err.message : String(err)}`); });
  }

  /** Whether `killer`'s kill of `victim` (profile keys) at `now` counts on the rankings (once every FARM_MS) */
  countsKill(killer: string, victim: string, now: number): boolean {
    const key = `${killer}>${victim}`;
    if (now - (this.kills.get(key) ?? -Infinity) < FARM_MS) return false;
    this.kills.set(key, now);
    if (this.kills.size > 50000) for (const [k, t] of this.kills) if (now - t >= FARM_MS) this.kills.delete(k);
    return true;
  }

  private save(): void {
    if (!this.dir) return;
    const now = Date.now();
    for (const [key, until] of this.bans) if (until <= now) this.bans.delete(key);
    const data: BanFile = { version: 1, bans: [...this.bans], strikes: [...this.strikes] };
    const file = path.join(this.dir, 'bans.json');
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(data));
      fs.renameSync(`${file}.tmp`, file);
    } catch (err) {
      this.log(`[mp] could not save the bans: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private load(file: string): void {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8')) as BanFile; // (written by save() above)
      for (const [key, until] of data.bans) this.bans.set(key, until);
      for (const [key, n] of data.strikes) this.strikes.set(key, n);
    } catch {
      // (none yet, or unreadable: nobody banned)
    }
  }
}

export { Conduct, FARM_MS };
