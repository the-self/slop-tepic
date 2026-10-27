// js/net/lobby.ts
// The multiplayer lobby (in the multiplayer chunk, net/multiplayer.ts): the player's name, the region's rooms (GET
// /rooms on the room server) to join, a friend's room by its code and password, and a room of one's own to open with
// its title, password, sky (the time of day and the weather) and rules (police, PvP). Opened again from the HUD's
// Rooms button, it also shows the room the player is in, its code to share and, to its host, its sky and rules to
// change. Safe DOM APIs only.
import { DEFAULT_RULES, NAME_MAX, PASSWORD_MAX, SKY_TIMES, SKY_WEATHERS, TITLE_MAX } from '../../shared/protocol.ts';
import type { RoomRules, RoomSpec, SkyTime, SkyWeather } from '../../shared/protocol.ts';
import { setText, t } from '../i18n/i18n.ts';
import type { MessageKey } from '../i18n/i18n.ts';

/** Where the player goes: the region's public rooms, a room by its id or code, or a room of its own */
export type RoomEntry =
  | { kind: 'public' }
  | { kind: 'join'; room: string; password: string }
  | { kind: 'create'; spec: RoomSpec };

/** What the lobby hands back: the player's name and where to go */
export interface LobbyChoice {
  name: string;
  entry: RoomEntry;
}

/** How a room is played: its sky and its rules */
export interface RoomSetup {
  time: SkyTime;
  weather: SkyWeather;
  rules: RoomRules;
}

/** The room the player is in now (WELCOME, SKY_SET, ROOM), for the lobby to show */
export interface CurrentRoom extends RoomSetup {
  title: string;
  code: string;
  host: boolean; // the player hosts it: its sky and rules are theirs to change
}

export interface LobbyOptions {
  roomsUrl: string; // GET /rooms?region=… on the room server
  name: string;
  /** an ERROR code from the server ('room', 'password', 'roomfull', 'wait'...) to explain first */
  error?: string;
  current?: CurrentRoom | null;
  /** the host saved the room's new sky and rules */
  onSave?: (setup: RoomSetup) => void;
}

/** One room of GET /rooms (server/rooms.ts RoomSummary) */
interface ListedRoom extends RoomSetup {
  id: string;
  title: string;
  code: string;
  players: number;
  capacity: number;
  locked: boolean;
}

// What each weather and time of day reads as
const WEATHER_LABELS: Readonly<Record<SkyWeather, MessageKey>> = {
  live: 'room.weatherLive', clear: 'weather.clear', cloudy: 'weather.partlyCloudy', overcast: 'weather.overcast',
  rain: 'weather.rain', storm: 'weather.thunderstorm', fog: 'weather.fog'
};
const TIME_LABELS: Readonly<Record<SkyTime, MessageKey>> = {
  live: 'room.timeLive', golden: 'time.golden', midday: 'time.midday', twilight: 'time.twilight', midnight: 'time.night'
};
// Why the server turned the player away
const ERRORS: Readonly<Partial<Record<string, MessageKey>>> = {
  room: 'lobby.error.room', password: 'lobby.error.password', roomfull: 'lobby.error.roomfull', wait: 'lobby.error.wait',
  full: 'lobby.error.full', version: 'lobby.error.version'
};
const NAME_KEY = 'mp-name';
let closeOpen: (() => void) | null = null; // the lobby on screen, if any: opening another closes it first

/** The rules as a short line ('' when they are the usual ones): "Sin policía · Sin PvP" */
function rulesSummary(r: RoomRules): string {
  const parts: string[] = [];
  if (!r.police) parts.push(t('room.policeOff'));
  if (!r.pvp) parts.push(t('room.pvpOff'));
  return parts.join(' · ');
}

/** A room's setup as a short line: "Lluvia · Hora real · Sin policía" (the weather only shows under the real time) */
function setupSummary(s: RoomSetup): string {
  const parts = s.time === 'live' ? [t(WEATHER_LABELS[s.weather]), t(TIME_LABELS[s.time])] : [t(TIME_LABELS[s.time])];
  const rules = rulesSummary(s.rules);
  if (rules) parts.push(rules);
  return parts.join(' · ');
}

// Small DOM helpers: an element with a class (and its text by key), a labelled field
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, key?: MessageKey): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = cls;
  if (key) setText(node, key);
  return node;
}
function field(labelKey: MessageKey, control: HTMLElement): HTMLLabelElement {
  const label = el('label', 'lobby-field');
  label.append(el('span', 'lobby-field-label', labelKey), control);
  return label;
}
function input(type: string, max: number, placeholderKey?: MessageKey): HTMLInputElement {
  const box = el('input', 'lobby-input');
  box.type = type;
  box.maxLength = max;
  box.autocomplete = 'off';
  box.spellcheck = false;
  if (placeholderKey) {
    box.dataset.i18nPlaceholder = placeholderKey;
    box.placeholder = t(placeholderKey);
  }
  return box;
}
function select<V extends string>(values: readonly V[], labels: Readonly<Record<V, MessageKey>>, value: V): HTMLSelectElement {
  const box = el('select', 'lobby-input');
  for (const v of values) {
    const option = document.createElement('option');
    option.value = v;
    setText(option, labels[v]);
    box.append(option);
  }
  box.value = value;
  return box;
}
function toggle(labelKey: MessageKey, on: boolean): [HTMLLabelElement, HTMLInputElement] {
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = on;
  const label = el('label', 'lobby-toggle');
  label.append(box, el('span', '', labelKey));
  return [label, box];
}
const button = (cls: string, key: MessageKey) => {
  const b = el('button', `lobby-btn ${cls}`, key);
  b.type = 'button';
  return b;
};

// The setup's controls (the create form's, and the host's for the room it is in); `read` gives what they say. The
// weather shows under the real time of day only (the fixed ones are clear presets), so it waits greyed out otherwise
function setupForm(start: RoomSetup): { node: HTMLDivElement; read: () => RoomSetup } {
  const time = select(SKY_TIMES, TIME_LABELS, start.time);
  const weather = select(SKY_WEATHERS, WEATHER_LABELS, start.weather);
  const [policeRow, police] = toggle('lobby.police', start.rules.police);
  const [pvpRow, pvp] = toggle('lobby.pvp', start.rules.pvp);
  const node = el('div', 'lobby-settings');
  node.append(field('lobby.time', time), field('lobby.weather', weather), policeRow, pvpRow);
  const showWeather = () => { weather.disabled = time.value !== 'live'; };
  time.addEventListener('change', showWeather);
  showWeather();
  const isWeather = (v: string): v is SkyWeather => SKY_WEATHERS.some((w) => w === v);
  const isTime = (v: string): v is SkyTime => SKY_TIMES.some((h) => h === v);
  return {
    node,
    read: () => ({
      time: isTime(time.value) ? time.value : 'live',
      weather: isWeather(weather.value) ? weather.value : 'live',
      rules: { police: police.checked, pvp: pvp.checked }
    })
  };
}

/**
 * Opens the lobby over the game; resolves with the player's choice, or null when they close it to stay where they
 * are (only offered while they are in a room)
 */
function openLobby({ roomsUrl, name, error, current = null, onSave }: LobbyOptions): Promise<LobbyChoice | null> {
  closeOpen?.();
  return new Promise((resolve) => {
    const overlay = el('div', 'mp-lobby');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    const panel = el('div', 'lobby-panel');
    panel.tabIndex = -1;
    overlay.append(panel);
    // (the game's keys stay out of the lobby's fields)
    overlay.addEventListener('keydown', (e) => { e.stopPropagation(); });
    overlay.addEventListener('keyup', (e) => { e.stopPropagation(); });

    const finish = (choice: LobbyChoice | null) => {
      overlay.remove();
      closeOpen = null;
      resolve(choice);
    };
    closeOpen = () => { finish(null); };
    const nameBox = input('text', NAME_MAX, 'lobby.namePlaceholder');
    nameBox.value = name;
    // the name, remembered for next time
    const go = (entry: RoomEntry) => {
      const chosen = nameBox.value.trim();
      try {
        if (chosen) localStorage.setItem(NAME_KEY, chosen);
      } catch { /* storage blocked: asked again next time */ }
      finish({ name: chosen, entry });
    };

    const head = el('div', 'lobby-head');
    head.append(el('h2', 'lobby-title', 'lobby.title'));
    if (current) {
      const close = button('lobby-close', 'lobby.close');
      close.addEventListener('click', () => { finish(null); });
      head.append(close);
    }
    panel.append(head);

    const errorKey = error ? ERRORS[error] : undefined;
    if (error) {
      const line = el('p', 'lobby-error');
      if (errorKey) setText(line, errorKey);
      else line.textContent = t('mp.errorDetail', { detail: error });
      panel.append(line);
    }

    // the room the player is in: its code to share, and its settings to its host
    if (current) {
      const here = el('section', 'lobby-card lobby-current');
      const title = el('h3', 'lobby-sub');
      title.textContent = t('lobby.current', { title: current.title || t('lobby.publicTitle') });
      here.append(title);
      if (current.code) {
        const code = el('p', 'lobby-code');
        code.textContent = t('lobby.currentCode', { code: current.code });
        here.append(code);
      }
      if (current.host && onSave) {
        here.append(el('p', 'lobby-note', 'lobby.host'));
        const form = setupForm(current);
        const save = button('lobby-primary', 'lobby.save');
        save.addEventListener('click', () => {
          onSave(form.read());
          finish(null);
        });
        here.append(form.node, save);
      } else {
        const line = el('p', 'lobby-note');
        line.textContent = setupSummary(current);
        here.append(line);
      }
      panel.append(here);
    }

    // who the player is, and the quickest way in
    const who = el('section', 'lobby-card');
    const publicBtn = button('lobby-primary lobby-wide', 'lobby.public');
    publicBtn.addEventListener('click', () => { go({ kind: 'public' }); });
    who.append(field('lobby.name', nameBox), publicBtn, el('p', 'lobby-note', 'lobby.publicHint'));
    panel.append(who);

    // the region's rooms
    const listCard = el('section', 'lobby-card');
    const listHead = el('div', 'lobby-row');
    const refresh = button('lobby-ghost', 'lobby.refresh');
    listHead.append(el('h3', 'lobby-sub', 'lobby.rooms'), refresh);
    const list = el('ul', 'lobby-list');
    listCard.append(listHead, list);
    panel.append(listCard);
    const showRooms = (rooms: readonly ListedRoom[]) => {
      if (!rooms.length) {
        list.replaceChildren(el('li', 'lobby-note', 'lobby.empty'));
        return;
      }
      list.replaceChildren(...rooms.map((room, i) => {
        const row = el('li', 'lobby-room');
        const info = el('div', 'lobby-room-info');
        const title = el('span', 'lobby-room-title');
        title.textContent = room.title || t('lobby.publicRoom', { n: i + 1 });
        const meta = el('span', 'lobby-room-meta');
        meta.textContent = `${room.locked ? '🔒 ' : ''}${setupSummary(room)}`;
        info.append(title, meta);
        const count = el('span', 'lobby-room-count');
        count.textContent = t('lobby.players', { count: room.players, capacity: room.capacity });
        const join = button('lobby-ghost', 'lobby.join');
        row.append(info, count, join);
        const password = input('password', PASSWORD_MAX, 'lobby.password');
        join.addEventListener('click', () => {
          // a locked room asks for its password first, right there
          if (room.locked && !row.contains(password)) {
            row.append(password);
            password.focus();
            return;
          }
          go({ kind: 'join', room: room.id, password: password.value });
        });
        password.addEventListener('keydown', (e) => { if (e.key === 'Enter') go({ kind: 'join', room: room.id, password: password.value }); });
        return row;
      }));
    };
    const load = () => {
      list.replaceChildren(el('li', 'lobby-note', 'lobby.loading'));
      fetch(roomsUrl, { cache: 'no-store' })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
          return res.json() as Promise<{ rooms?: ListedRoom[] }>; // (server/index.ts RoomList)
        })
        .then((data) => { showRooms(data.rooms ?? []); })
        .catch(() => { list.replaceChildren(el('li', 'lobby-note lobby-error', 'lobby.unreachable')); });
    };
    refresh.addEventListener('click', load);
    load();

    // a friend's room by its code
    const codeCard = el('section', 'lobby-card');
    const codeBox = input('text', TITLE_MAX, 'lobby.codePlaceholder');
    codeBox.classList.add('lobby-code-input');
    const codePassword = input('password', PASSWORD_MAX, 'lobby.passwordOptional');
    const codeBtn = button('lobby-ghost lobby-wide', 'lobby.joinCode');
    codeBtn.addEventListener('click', () => {
      if (codeBox.value.trim()) go({ kind: 'join', room: codeBox.value.trim(), password: codePassword.value });
    });
    codeCard.append(el('h3', 'lobby-sub', 'lobby.joinCode'), field('lobby.code', codeBox), field('lobby.password', codePassword), codeBtn);
    panel.append(codeCard);

    // a room of one's own
    const createCard = el('section', 'lobby-card');
    const titleBox = input('text', TITLE_MAX, 'lobby.titlePlaceholder');
    const createPassword = input('password', PASSWORD_MAX, 'lobby.passwordOptional');
    const form = setupForm({ time: 'live', weather: 'live', rules: DEFAULT_RULES });
    const createBtn = button('lobby-primary lobby-wide', 'lobby.createBtn');
    createBtn.addEventListener('click', () => {
      go({ kind: 'create', spec: { title: titleBox.value.trim(), password: createPassword.value, ...form.read() } });
    });
    createCard.append(el('h3', 'lobby-sub', 'lobby.create'), field('lobby.roomTitle', titleBox), field('lobby.passwordOptional', createPassword), form.node, createBtn);
    panel.append(createCard);

    document.body.append(overlay);
    (current ? panel : nameBox).focus();
  });
}

export { openLobby, rulesSummary, setupSummary, NAME_KEY };
