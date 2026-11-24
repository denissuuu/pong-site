/**
 * Sécurité : jetons d'annulation, identifiants, authentification admin.
 */

import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

/** Jeton secret d'annulation : 32 octets aléatoires (256 bits), encodé en base64url. */
export function genererJeton() {
  return randomBytes(32).toString('base64url');
}

/** Hash SHA-256 (hexadécimal) — seul ce hash est stocké côté serveur. */
export function hacher(texte) {
  return createHash('sha256').update(String(texte), 'utf8').digest('hex');
}

/** Compare deux chaînes en temps constant (évite les attaques par mesure du temps). */
function egaliteTempsConstant(a, b) {
  // On compare les hash : longueurs toujours identiques, et aucune fuite de longueur.
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Vérifie un jeton d'annulation fourni par le navigateur contre le hash stocké.
 * @returns {boolean}
 */
export function verifierJeton(jeton, hashStocke) {
  if (typeof jeton !== 'string' || jeton.length < 20 || jeton.length > 200) return false;
  if (typeof hashStocke !== 'string' || hashStocke.length !== 64) return false;
  const hashFourni = Buffer.from(hacher(jeton), 'hex');
  const attendu = Buffer.from(hashStocke, 'hex');
  return attendu.length === 32 && timingSafeEqual(hashFourni, attendu);
}

/**
 * Identifiant de réservation ou de blocage. La date est incluse dans l'id, ce qui permet
 * de retrouver directement le document du jour : "r_2026-11-23_Xy3…".
 */
export function genererId(prefixe, date) {
  return `${prefixe}_${date}_${randomBytes(9).toString('base64url')}`;
}

/** Décode un id et renvoie sa date, ou null si le format est invalide. */
export function dateDepuisId(id, prefixe) {
  const motif = new RegExp(`^${prefixe}_(\\d{4}-\\d{2}-\\d{2})_[A-Za-z0-9_-]{12}$`);
  const m = typeof id === 'string' ? id.match(motif) : null;
  return m ? m[1] : null;
}

/**
 * Vérifie le mot de passe admin envoyé dans l'en-tête "Authorization: Bearer <mot de passe>".
 * Le mot de passe attendu vient UNIQUEMENT de la variable d'environnement ADMIN_PASSWORD.
 * @returns {'ok' | 'absent' | 'non-configure' | 'refuse'}
 */
export function verifierAdmin(req, motDePasseAttendu = process.env.ADMIN_PASSWORD) {
  if (!motDePasseAttendu) return 'non-configure';
  const entete = req.headers.get('authorization') || '';
  const m = entete.match(/^Bearer (.+)$/);
  if (!m) return 'absent';
  return egaliteTempsConstant(m[1], motDePasseAttendu) ? 'ok' : 'refuse';
}

/** Hash court de l'IP pour la limitation de débit : on ne stocke jamais l'IP en clair. */
export function empreinteIp(ip) {
  return hacher(`ping-pong:${ip || 'inconnue'}`).slice(0, 24);
}
