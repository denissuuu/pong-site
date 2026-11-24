/**
 * Gestion du temps en heure de Paris (Europe/Paris).
 *
 * Les fonctions Netlify tournent en UTC. On ne manipule donc JAMAIS l'heure
 * locale du serveur : on convertit explicitement "maintenant" en heure de Paris
 * grâce à Intl (qui connaît les règles de changement d'heure été/hiver).
 *
 * Ensuite, toute la logique travaille en "heure murale" parisienne :
 *   - une date "YYYY-MM-DD"
 *   - une heure en minutes depuis minuit (ex : 14h30 → 870)
 *
 * Pourquoi c'est sûr : les changements d'heure ont lieu entre 2h et 3h du matin,
 * alors que la table est ouverte de 10h à 21h. Aucun créneau n'est donc jamais
 * ambigu ou inexistant.
 */

export const FUSEAU = 'Europe/Paris';

const formateurParis = new Intl.DateTimeFormat('fr-FR', {
  timeZone: FUSEAU,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * Renvoie la date et l'heure actuelles à Paris.
 * @param {Date} [instant] instant à convertir (par défaut : maintenant). Utile pour les tests.
 * @returns {{ date: string, minutes: number, heure: string }}
 */
export function maintenantParis(instant = new Date()) {
  const parties = Object.fromEntries(
    formateurParis.formatToParts(instant).map((p) => [p.type, p.value]),
  );
  const date = `${parties.year}-${parties.month}-${parties.day}`;
  const minutes = Number(parties.hour) * 60 + Number(parties.minute);
  return { date, minutes, heure: `${parties.hour}:${parties.minute}` };
}

/** Vérifie qu'une chaîne est une vraie date calendaire au format YYYY-MM-DD. */
export function estDateValide(texte) {
  if (typeof texte !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(texte)) return false;
  const [a, m, j] = texte.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, j));
  return d.getUTCFullYear() === a && d.getUTCMonth() === m - 1 && d.getUTCDate() === j;
}

/**
 * Ajoute (ou retire) des jours à une date "YYYY-MM-DD".
 * Calcul fait en UTC pur sur des dates sans heure : aucun effet du changement d'heure.
 */
export function ajouterJours(date, nbJours) {
  const [a, m, j] = date.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, j + nbJours));
  return d.toISOString().slice(0, 10);
}

/** Jour de la semaine, lundi = 0 … dimanche = 6. */
export function jourDeSemaine(date) {
  const [a, m, j] = date.split('-').map(Number);
  return (new Date(Date.UTC(a, m - 1, j)).getUTCDay() + 6) % 7;
}

/** Lundi de la semaine contenant la date donnée. */
export function lundiDe(date) {
  return ajouterJours(date, -jourDeSemaine(date));
}

/** "14:30" → 870. Renvoie NaN si le format est invalide. */
export function hhmmVersMinutes(hhmm) {
  if (typeof hhmm !== 'string' || !/^\d{2}:\d{2}$/.test(hhmm)) return NaN;
  const [h, m] = hhmm.split(':').map(Number);
  if (h > 23 || m > 59) return NaN;
  return h * 60 + m;
}

/** 870 → "14:30" */
export function minutesVersHhmm(minutes) {
  const h = String(Math.floor(minutes / 60)).padStart(2, '0');
  const m = String(minutes % 60).padStart(2, '0');
  return `${h}:${m}`;
}
