/**
 * Outils de dates côté navigateur, au format français.
 * Les dates sont manipulées en chaînes "YYYY-MM-DD" (heure murale de Paris fournie par le serveur),
 * et les calculs se font en UTC pur pour éviter tout décalage lié au fuseau de l'appareil.
 */

export const OUVERTURE = 10 * 60;
export const FERMETURE = 21 * 60;
export const PAS = 30;
export const DUREES = [30, 60, 90];
export const MAX_PAR_PRENOM = 90;

const versDate = (d) => {
  const [a, m, j] = d.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, j));
};

export function ajouterJours(date, n) {
  const d = versDate(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Lundi = 0 … dimanche = 6 */
export const jourDeSemaine = (date) => (versDate(date).getUTCDay() + 6) % 7;
export const lundiDe = (date) => ajouterJours(date, -jourDeSemaine(date));

export function hhmmVersMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
export function minutesVersHhmm(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** 870 → "14h30" */
export function heureFr(minutesOuHhmm) {
  const min = typeof minutesOuHhmm === 'number' ? minutesOuHhmm : hhmmVersMinutes(minutesOuHhmm);
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}

/** 30 → "30 min", 60 → "1h", 90 → "1h30" */
export function dureeFr(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

const fmt = (options) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', ...options });
const fmtJourLong = fmt({ weekday: 'long' });
const fmtJourCourt = fmt({ weekday: 'short' });
const fmtMoisCourt = fmt({ month: 'short' });
const fmtMoisLong = fmt({ month: 'long' });
const fmtComplet = fmt({ weekday: 'long', day: 'numeric', month: 'long' });

const majuscule = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Mardi 25 nov." */
export function jourCourtFr(date) {
  const d = versDate(date);
  return `${majuscule(fmtJourLong.format(d))} ${d.getUTCDate()} ${fmtMoisCourt.format(d)}`;
}
/** "mardi 25 novembre" */
export const jourLongFr = (date) => fmtComplet.format(versDate(date));
/** "lun." */
export const nomJourCourt = (date) => fmtJourCourt.format(versDate(date)).replace('.', '');
export const numeroJour = (date) => versDate(date).getUTCDate();

/** "Du 23 au 29 novembre" · "Du 30 novembre au 6 décembre" · avec l'année si elle change */
export function titreSemaine(lundi) {
  const dimanche = ajouterJours(lundi, 6);
  const a = versDate(lundi);
  const b = versDate(dimanche);
  const moisA = fmtMoisLong.format(a);
  const moisB = fmtMoisLong.format(b);
  const anneeA = a.getUTCFullYear();
  const anneeB = b.getUTCFullYear();
  const jA = a.getUTCDate() === 1 ? '1er' : a.getUTCDate();
  const jB = b.getUTCDate() === 1 ? '1er' : b.getUTCDate();
  if (anneeA !== anneeB) return `Du ${jA} ${moisA} ${anneeA} au ${jB} ${moisB} ${anneeB}`;
  if (moisA !== moisB) return `Du ${jA} ${moisA} au ${jB} ${moisB}`;
  return `Du ${jA} au ${jB} ${moisB}`;
}

/** Clé de comparaison d'un prénom (identique au serveur). */
export function cleDePrenom(prenom) {
  return prenom.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, '');
}
