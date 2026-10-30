// js/net/play.ts
// How the player plays with the others (shared/protocol-play.ts), the browser's side: its crew (who is in it, the
// invitations, the panel: net/crew.ts), passive mode, who it may hurt (hostile: not a crew mate, neither of the two in
// passive mode), the others' tags (crew, passive, stars, over their heads), their cars' looks (net/remote-looks.ts),
// the police after them (net/remote-police.ts), the crew mates on the map, and its profile (net/profile.ts). And what the
// server keeps of the player's health (server/vitals.ts): its health & armour as they drop (VITALS), its pickups (HEAL),
// and the server's word that it is dead (KILLED), which it obeys; and reports of other players (the crew card's).
import { encodeCrew, encodeHeal, encodeLook, encodePassive, encodeReport, encodeVitals, PLAY_OP } from '../../shared/protocol-play.ts';
import type { CarLookWire, CrewMember, HealKind, PlayServerMessage, ProfileWire } from '../../shared/protocol-play.ts';
import { RemoteLooks, lookKey } from './remote-looks.ts';
import { RemotePolice } from './remote-police.ts';
import type { PoliceCrime, TiltAt } from './remote-police.ts';
import { CrewPanel } from './crew.ts';
import { saveToken } from './profile.ts';
import { t } from '../i18n/i18n.ts';
import type { Blips } from '../sim/crime.ts';
import type { RemotePlayer } from './multiplayer.ts';
import type * as THREE from 'three/webgpu';

const LOOK_EVERY = 1; // s between looks at whether the player's car changed its look
const VITALS_EVERY = 0.3; // s between the player's health reports, at most (sent only when it changed)

/** A player's car look as the player's controllers keep it (player/controllers/types.ts CarLook) */
export interface OwnCarLook {
  bodyType: string;
  paint: number;
  police: boolean;
  model?: string | null;
}

/** What NetPlay uses of net/multiplayer.ts's Multiplayer */
export interface PlayHost {
  readonly id: number;
  readonly remotes: ReadonlyMap<number, RemotePlayer>;
  sendFrame(frame: Uint8Array<ArrayBuffer>): void;
  toast(text: string): void;
  /** where the player is (m) */
  position(): { x: number; z: number };
  /** the player's car as it looks now */
  carLook(): OwnCarLook;
  resetInput(): void;
  /** the server says the player is dead, killed by player `by` (0: nobody) */
  killed(by: number): void;
  /** the player's health & armour (hit points), null without the crime system */
  readonly crime: { readonly health: number; readonly armor: number } | null;
}

/** A remote player's tag: its crew (0: none), passive mode, wanted stars; and its car's look */
export interface RemoteTag {
  crew: number;
  passive: boolean;
  stars: number;
  look: CarLookWire | null;
}

class NetPlay {
  crew = 0; // the player's crew (0: none)
  members: CrewMember[] = [];
  passive = false;
  profile: ProfileWire | null = null;
  readonly looks: RemoteLooks;
  readonly police: RemotePolice | null;
  readonly panel: CrewPanel;
  private readonly host: PlayHost;
  private lookKey = '';
  private sinceLook = Infinity;
  private sinceVitals = 0;
  private sentHealth = -1; // the health & armour last reported (whole hit points)
  private sentArmor = -1;

  constructor(host: PlayHost, scene: THREE.Object3D, crime: PoliceCrime | null, tiltAt: TiltAt, after: Element) {
    this.host = host;
    this.looks = new RemoteLooks(scene);
    this.police = crime ? new RemotePolice(scene, crime, tiltAt, (f) => { host.sendFrame(f); }) : null;
    this.panel = new CrewPanel(after, {
      players: () => host.remotes.values(),
      me: () => host.id,
      crew: () => this.members,
      passive: () => this.passive,
      isMate: (r) => this.mate(r),
      invite: (id) => { host.sendFrame(encodeCrew('invite', id)); },
      answer: (id, yes) => { host.sendFrame(encodeCrew(yes ? 'accept' : 'decline', id)); },
      leave: () => { host.sendFrame(encodeCrew('leave')); },
      report: (id) => {
        host.sendFrame(encodeReport(id, 'cheating'));
        host.toast(t('crew.reported'));
      },
      setPassive: (on) => { this.setPassive(on); },
      position: () => host.position(),
      resetInput: () => { host.resetInput(); }
    });
  }

  /** In a room (again): the server knows nothing of the player's crew, passive mode or look there yet */
  welcome(): void {
    this.crew = 0;
    this.members = [];
    this.lookKey = '';
    this.sinceLook = Infinity;
    this.sentHealth = this.sentArmor = -1;
    if (this.passive) this.host.sendFrame(encodePassive(true));
    this.police?.rejoined();
    this.panel.refresh();
  }

  /** Passive mode on or off (the server may turn it down: the player's own TAG says) */
  setPassive(on: boolean): void {
    this.passive = on;
    this.host.sendFrame(encodePassive(on));
    this.host.toast(t(on ? 'crew.passiveOn' : 'crew.passiveOff'));
    this.panel.refresh();
  }

  /** The player took a pickup of `kind`: the server raises its count of the player's health too */
  healed(kind: HealKind): void {
    this.host.sendFrame(encodeHeal(kind));
  }

  /** Whether `r` is in the player's crew */
  mate(r: RemoteTag): boolean {
    return this.crew !== 0 && r.crew === this.crew;
  }

  /** Whether the player's shots, blows and car may hurt `r`: not a crew mate, neither of the two in passive mode */
  hostile(r: RemoteTag): boolean {
    return !this.passive && !r.passive && !this.mate(r);
  }

  receive(msg: PlayServerMessage, now: number): void {
    const host = this.host;
    if (msg.op === PLAY_OP.PROFILE) {
      if (msg.token) saveToken(msg.token);
      this.profile = { token: msg.token || this.profile?.token || '', kills: msg.kills, deaths: msg.deaths, best: msg.best, seconds: msg.seconds };
    } else if (msg.op === PLAY_OP.TAG) {
      if (msg.id === host.id) {
        // (the server's word on the player's own passive mode: it turns it down right after a fight)
        if (this.passive && !msg.passive) host.toast(t('crew.passiveRefused'));
        this.passive = msg.passive;
        this.panel.refresh();
        return;
      }
      const r = host.remotes.get(msg.id);
      if (!r) return;
      r.crew = msg.crew;
      r.passive = msg.passive;
      r.stars = msg.stars;
      this.dressLabel(r);
    } else if (msg.op === PLAY_OP.CREW_ASK) {
      this.panel.ask(msg.from, msg.name);
    } else if (msg.op === PLAY_OP.CREW_SET) {
      const had = this.crew;
      this.crew = msg.crew;
      this.members = msg.members;
      for (const m of msg.members) {
        const r = host.remotes.get(m.id);
        if (r) {
          r.crew = msg.crew;
          this.dressLabel(r);
        }
      }
      for (const r of host.remotes.values()) this.dressLabel(r);
      const others = msg.members.filter((m) => m.id !== host.id).map((m) => m.name);
      if (msg.crew && others.length) host.toast(t('crew.now', { names: others.join(', ') }));
      else if (had && !msg.crew) host.toast(t('crew.left'));
      this.panel.refresh();
    } else if (msg.op === PLAY_OP.LOOK_SEEN) {
      const r = host.remotes.get(msg.id);
      if (r) {
        r.look = msg.look;
        r.lookKey = lookKey(msg.look);
      }
    } else if (msg.op === PLAY_OP.KILLED) {
      host.killed(msg.by);
    } else {
      this.police?.receive(msg.from, msg.units, now);
    }
  }

  /** A remote player left the view */
  forget(id: number): void {
    this.police?.forget(id);
  }

  /** Once a frame, before the others are drawn: the player's car look out when it changed, the police */
  update(dt: number, now: number): void {
    this.sinceLook += dt;
    if (this.sinceLook >= LOOK_EVERY) {
      this.sinceLook = 0;
      const own = this.host.carLook();
      const look: CarLookWire = { body: own.bodyType, model: own.model ?? '', paint: own.paint, police: own.police };
      const key = `${look.body}|${look.model}|${String(look.paint)}|${String(look.police)}`;
      if (key !== this.lookKey) {
        this.lookKey = key;
        this.host.sendFrame(encodeLook(look));
      }
    }
    this.sendVitals(dt);
    this.police?.update(dt, now);
    this.panel.tick(dt);
  }

  // The player's health & armour when they changed, VITALS_EVERY s apart at most (the server lowers its count to them)
  private sendVitals(dt: number): void {
    const crime = this.host.crime;
    this.sinceVitals += dt;
    if (!crime || this.sinceVitals < VITALS_EVERY) return;
    const health = Math.max(0, Math.ceil(crime.health)), armor = Math.max(0, Math.ceil(crime.armor));
    if (health === this.sentHealth && armor === this.sentArmor) return;
    this.sinceVitals = 0;
    this.sentHealth = health;
    this.sentArmor = armor;
    this.host.sendFrame(encodeVitals(health, armor));
  }

  /** The crew mates and the others' police, on the maps (sim/crime.ts moreBlips) */
  blips(out: Blips): void {
    if (this.crew) {
      for (const r of this.host.remotes.values()) {
        const s = r.samples.at(-1);
        if (s && this.mate(r)) out.push('crew', s.x, s.z);
      }
    }
    this.police?.blips(out);
  }

  /** A remote player's name tag as its tag says: its stars after its name, a crew mate's and a passive one's look */
  dressLabel(r: RemotePlayer): void {
    const label = r.label;
    if (!label) return;
    const text = r.stars > 0 ? `${r.name} ${'★'.repeat(r.stars)}` : r.name;
    if (label.textContent !== text) label.textContent = text;
    label.classList.toggle('mp-label-crew', this.mate(r));
    label.classList.toggle('mp-label-passive', r.passive);
  }

  dispose(): void {
    this.looks.dispose();
    this.police?.dispose();
  }
}

export { NetPlay };
