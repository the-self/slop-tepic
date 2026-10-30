// server/profiles.ts
// The players' profiles: what the server keeps of each one between visits, its kills and deaths of other players, its
// best run of kills without dying and the time it has played, and the rankings made of them (GET /rankings). There is
// no sign-up: a player's first HELLO gets a token (PROFILE), its browser keeps it, and the token is the profile; typed
// on another device (the lobby shows it), it is the same player there. The file keeps only each token's SHA-256, so a
// copy of it leaks nobody's. A new profile is kept only once it has played KEEP_AFTER_S or fought (so a private window,
// or a script connecting over and over, leaves nothing behind). Kept in DATA_DIR/profiles.json, written a few seconds after a change (and on close) by
// way of a temporary file, so a crash mid-write never loses the old one; without a DATA_DIR, in memory only.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { TOKEN_LENGTH, isToken } from '../shared/protocol-play.ts';

const SAVE_AFTER_MS = 5000;
const KEEP_AFTER_S = 60; // s a new profile plays before it is kept (unless it kills or dies before)
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/** A profile as the server keeps it (counts of players, s played; ms Date.now() for the dates) */
export interface Profile {
  key: string; // its token's SHA-256, hex
  name: string; // the name it last played under
  kills: number;
  deaths: number;
  best: number; // the most kills it made without dying
  streak: number; // its kills since it last died
  seconds: number;
  createdAt: number;
  seenAt: number;
}

/** A row of GET /rankings */
export interface Ranking {
  name: string;
  kills: number;
  deaths: number;
  best: number;
  hours: number;
}

interface ProfileFile {
  version: 1;
  profiles: Profile[];
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

function newToken(): string {
  const bytes = randomBytes(TOKEN_LENGTH);
  return Array.from(bytes, (b) => BASE32[b & 31]).join('');
}

class ProfileStore {
  private readonly file: string | null;
  private readonly log: (message: string) => void;
  private readonly byKey = new Map<string, Profile>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> | null = null;
  private dirty = false;

  /** `dir`: where profiles.json lives (null: kept in memory only) */
  constructor(dir: string | null, log: (message: string) => void = console.log) {
    this.file = dir ? path.join(dir, 'profiles.json') : null;
    this.log = log;
    if (this.file) this.load(this.file);
  }

  get size(): number {
    return this.byKey.size;
  }

  /** The profile of `token` (a new one, with its new token, when it is '' or no profile's), under the name `name` */
  open(token: string, name: string, now = Date.now()): { token: string; profile: Profile } {
    const known = isToken(token) ? this.byKey.get(hash(token)) : undefined;
    if (known) {
      known.name = name;
      known.seenAt = now;
      this.changed();
      return { token, profile: known };
    }
    // (kept once it has played a while: keep())
    const fresh = newToken();
    const profile: Profile = { key: hash(fresh), name, kills: 0, deaths: 0, best: 0, streak: 0, seconds: 0, createdAt: now, seenAt: now };
    return { token: fresh, profile };
  }

  /** `killer` killed `victim` (another player) */
  kill(killer: Profile, victim: Profile): void {
    killer.kills++;
    killer.streak++;
    killer.best = Math.max(killer.best, killer.streak);
    victim.deaths++;
    victim.streak = 0;
    this.keep(killer);
    this.keep(victim);
  }

  /** `profile` died by nobody's hand: its run of kills ends */
  died(profile: Profile): void {
    profile.streak = 0;
    this.keep(profile);
  }

  /** `profile` played `seconds` more */
  played(profile: Profile, seconds: number): void {
    if (seconds <= 0) return;
    profile.seconds += seconds;
    this.keep(profile);
  }

  /** The `n` players with the most kills (then the best run, then the fewest deaths) */
  rankings(n = 20): Ranking[] {
    return [...this.byKey.values()]
      .filter((p) => p.kills > 0)
      .sort((a, b) => b.kills - a.kills || b.best - a.best || a.deaths - b.deaths)
      .slice(0, n)
      .map((p) => ({ name: p.name, kills: p.kills, deaths: p.deaths, best: p.best, hours: Math.round((p.seconds / 3600) * 10) / 10 }));
  }

  /** Writes what changed now (the server closing) */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.writing;
    if (this.dirty) await this.write();
  }

  // A profile that has played or fought is kept (a new one only from then on); every change to a kept one is saved
  private keep(profile: Profile): void {
    if (!this.byKey.has(profile.key)) {
      if (profile.seconds < KEEP_AFTER_S && !profile.kills && !profile.deaths) return;
      this.byKey.set(profile.key, profile);
    }
    this.changed();
  }

  private changed(): void {
    this.dirty = true;
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.write();
    }, SAVE_AFTER_MS);
  }

  private async write(): Promise<void> {
    const file = this.file;
    if (!file) {
      this.dirty = false;
      return;
    }
    if (this.writing) {
      await this.writing;
      if (!this.dirty) return;
    }
    this.dirty = false;
    const data: ProfileFile = { version: 1, profiles: [...this.byKey.values()] };
    const tmp = `${file}.tmp`;
    this.writing = fs.promises.mkdir(path.dirname(file), { recursive: true })
      .then(() => fs.promises.writeFile(tmp, JSON.stringify(data)))
      .then(() => fs.promises.rename(tmp, file))
      .catch((err: unknown) => {
        this.dirty = true; // (tried again at the next change)
        this.log(`[mp] could not save the profiles: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => { this.writing = null; });
    await this.writing;
  }

  private load(file: string): void {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return; // (none yet)
    }
    try {
      const data = JSON.parse(text) as ProfileFile; // (written by write() above)
      for (const p of data.profiles) if (typeof p.key === 'string') this.byKey.set(p.key, { ...p, streak: p.streak || 0 });
      this.log(`[mp] ${String(this.byKey.size)} profiles from ${file}`);
    } catch (err) {
      // (kept aside, not written over by the next save)
      const aside = `${file}.bad-${String(Date.now())}`;
      fs.copyFileSync(file, aside);
      this.log(`[mp] could not read ${file} (kept as ${aside}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export { ProfileStore, newToken };
