// js/net/profile.ts
// The player's profile on the room server (server/profiles.ts): the token that is the profile, kept in this browser
// (the server hands one out on the first visit, PROFILE), and how it reads as a code to type on another device to be
// the same player there: its 20 letters in groups of four ("abcd-efgh-…"), any case, dashes and spaces optional.
import { isToken } from '../../shared/protocol-play.ts';

const TOKEN_KEY = 'mp-token';

/** The profile's token this browser keeps ('' when it has none yet, or storage is blocked) */
function savedToken(): string {
  try {
    const token = localStorage.getItem(TOKEN_KEY) ?? '';
    return isToken(token) ? token : '';
  } catch {
    return '';
  }
}

/** Keeps `token` as this browser's profile */
function saveToken(token: string): void {
  if (!isToken(token)) return;
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // storage blocked: a new profile next visit
  }
}

/** The token as a code to read off a screen: five groups of four */
function tokenCode(token: string): string {
  return token.match(/.{1,4}/g)?.join('-') ?? '';
}

/** A code typed in (tokenCode's, however it was written) as its token, or '' when it is none */
function codeToken(code: string): string {
  const token = code.toLowerCase().replace(/[\s-]+/g, '');
  return isToken(token) ? token : '';
}

export { savedToken, saveToken, tokenCode, codeToken };
