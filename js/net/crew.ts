// js/net/crew.ts
// The crew's panel (net/play.ts has its state): a Crew button under the Rooms one (or its key, U), opening a card with
// the player's crew, the button to leave it, passive mode on and off (or its key, P), and the players nearby to invite
// (nearest first) or to report (cheating: the server writes it down for a person to read); and an invitation, when one
// comes, to accept or turn down. Big enough to tap on a phone. Safe DOM
// APIs only.
import { keyBindings } from '../input/keybindings.ts';
import { isTypingInField } from '../world/city-config.ts';
import { setText, t } from '../i18n/i18n.ts';
import type { MessageKey } from '../i18n/i18n.ts';
import type { CrewMember } from '../../shared/protocol-play.ts';
import type { RemoteTag } from './play.ts';

const NEAR_MAX = 8; // players listed to invite
const NEAR_REACH = 400; // m within which they are listed
const REFRESH_S = 1; // s between redraws of the open panel (who is near changes)
const ASK_S = 60; // s an invitation stays on screen (the server's INVITE_MS)
const INVITED_S = 20; // s an invited player's button stays "invited"

/** A player the panel lists: its id, name, where it was last (m), and its tag */
export interface ListedPlayer extends RemoteTag {
  id: number;
  name: string;
  samples: readonly { x: number; z: number }[];
}

/** What the panel asks of net/play.ts */
export interface CrewApi {
  players(): Iterable<ListedPlayer>;
  me(): number;
  crew(): readonly CrewMember[];
  passive(): boolean;
  isMate(r: RemoteTag): boolean;
  invite(id: number): void;
  answer(id: number, yes: boolean): void;
  leave(): void;
  report(id: number): void;
  setPassive(on: boolean): void;
  position(): { x: number; z: number };
  resetInput(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, key?: MessageKey): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = cls;
  if (key) setText(node, key);
  return node;
}
function button(cls: string, key: MessageKey): HTMLButtonElement {
  const b = el('button', cls, key);
  b.type = 'button';
  return b;
}

class CrewPanel {
  private readonly api: CrewApi;
  private readonly toggleBtn: HTMLButtonElement;
  private readonly card: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly asks: HTMLDivElement;
  private readonly invited = new Map<number, number>(); // id → s left showing "invited"
  private sinceRefresh = 0;

  constructor(after: Element, api: CrewApi) {
    this.api = api;
    this.toggleBtn = button('mp-rooms-btn mp-crew-btn', 'mp.crew');
    this.toggleBtn.addEventListener('click', () => { this.toggle(); });
    after.after(this.toggleBtn);

    this.card = el('div', 'mp-crew');
    this.card.setAttribute('role', 'dialog');
    this.card.hidden = true;
    const head = el('div', 'mp-crew-head');
    const close = button('mp-crew-close', 'lobby.close');
    close.addEventListener('click', () => { this.toggle(false); });
    head.append(el('h3', 'mp-crew-title', 'crew.title'), close);
    this.body = el('div', 'mp-crew-body');
    this.card.append(head, this.body);
    // (the game's keys stay out of it while it has the focus)
    this.card.addEventListener('keydown', (e) => { e.stopPropagation(); });
    document.body.append(this.card);

    this.asks = el('div', 'mp-crew-asks');
    this.asks.setAttribute('aria-live', 'polite');
    document.body.append(this.asks);

    window.addEventListener('keydown', (e) => {
      if (isTypingInField(e) || e.repeat) return;
      if (keyBindings.is('crew', e.code)) this.toggle();
      else if (keyBindings.is('passive', e.code)) api.setPassive(!api.passive());
    });
  }

  get open(): boolean {
    return !this.card.hidden;
  }

  toggle(on = !this.open): void {
    this.card.hidden = !on;
    this.toggleBtn.classList.toggle('mp-crew-btn-on', on);
    if (on) {
      // (under its button, which stays in reach to close it)
      this.card.style.top = `${String(Math.round(this.toggleBtn.getBoundingClientRect().bottom + 8))}px`;
      this.api.resetInput();
      this.refresh();
    }
  }

  /** Player `from` (`name`) invites the player into its crew */
  ask(from: number, name: string): void {
    for (const old of this.asks.querySelectorAll<HTMLElement>(`[data-from="${String(from)}"]`)) old.remove();
    const card = el('div', 'mp-crew-ask');
    card.dataset.from = String(from);
    const line = el('p', 'mp-crew-ask-text');
    line.textContent = t('crew.ask', { name });
    const yes = button('mp-crew-action mp-crew-yes', 'crew.accept');
    const no = button('mp-crew-action', 'crew.decline');
    const answer = (ok: boolean) => {
      this.api.answer(from, ok);
      card.remove();
    };
    yes.addEventListener('click', () => { answer(true); });
    no.addEventListener('click', () => { answer(false); });
    const row = el('div', 'mp-crew-row');
    row.append(yes, no);
    card.append(line, row);
    this.asks.append(card);
    setTimeout(() => { card.remove(); }, ASK_S * 1000);
  }

  /** Once a frame: the open panel redrawn now and then (who is near changes), the "invited" marks wearing off */
  tick(dt: number): void {
    for (const [id, left] of this.invited) {
      if (left - dt <= 0) this.invited.delete(id);
      else this.invited.set(id, left - dt);
    }
    if (!this.open) return;
    this.sinceRefresh += dt;
    if (this.sinceRefresh >= REFRESH_S) this.refresh();
  }

  /** The panel drawn again as things stand */
  refresh(): void {
    this.sinceRefresh = 0;
    if (!this.open) return;
    const api = this.api;
    const nodes: HTMLElement[] = [];

    const passive = api.passive();
    const passiveBtn = button(`mp-crew-action mp-crew-wide${passive ? ' mp-crew-yes' : ''}`, passive ? 'crew.passiveOn' : 'crew.passiveOff');
    passiveBtn.setAttribute('aria-pressed', String(passive));
    passiveBtn.addEventListener('click', () => { api.setPassive(!api.passive()); });
    nodes.push(passiveBtn, el('p', 'mp-crew-note', 'crew.passiveHint'));

    const crew = api.crew();
    if (crew.length) {
      const list = el('ul', 'mp-crew-list');
      for (const m of crew) {
        const item = el('li', 'mp-crew-member');
        item.textContent = m.id === api.me() ? t('mp.you', { name: m.name }) : m.name;
        list.append(item);
      }
      const leave = button('mp-crew-action mp-crew-wide', 'crew.leave');
      leave.addEventListener('click', () => { api.leave(); });
      nodes.push(list, leave);
    } else {
      nodes.push(el('p', 'mp-crew-note', 'crew.none'));
    }

    nodes.push(el('h4', 'mp-crew-sub', 'crew.near'));
    const here = api.position();
    const near: [ListedPlayer, number][] = [];
    for (const r of api.players()) {
      const s = r.samples.at(-1);
      if (!s) continue;
      const d = Math.hypot(s.x - here.x, s.z - here.z);
      if (d <= NEAR_REACH) near.push([r, d]);
    }
    near.sort((a, b) => a[1] - b[1]);
    if (!near.length) nodes.push(el('p', 'mp-crew-note', 'crew.nobody'));
    const list = el('ul', 'mp-crew-list');
    for (const [r, d] of near.slice(0, NEAR_MAX)) {
      const item = el('li', 'mp-crew-player');
      const who = el('span', 'mp-crew-name');
      who.textContent = r.name;
      const far = el('span', 'mp-crew-dist');
      far.textContent = `${String(Math.round(d))} m`;
      const mate = api.isMate(r);
      const invited = this.invited.has(r.id);
      const invite = button('mp-crew-action', mate ? 'crew.mate' : invited ? 'crew.invited' : 'crew.invite');
      invite.disabled = mate || invited;
      invite.addEventListener('click', () => {
        api.invite(r.id);
        this.invited.set(r.id, INVITED_S);
        this.refresh();
      });
      const report = button('mp-crew-action mp-crew-report', 'crew.report');
      report.setAttribute('aria-label', t('crew.reportLabel', { name: r.name }));
      report.addEventListener('click', () => {
        api.report(r.id);
        report.disabled = true;
      });
      item.append(who, far, invite, report);
      list.append(item);
    }
    if (near.length) nodes.push(list);
    this.body.replaceChildren(...nodes);
  }
}

export { CrewPanel };
