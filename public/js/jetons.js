/**
 * Jetons d'annulation stockés dans le navigateur (localStorage).
 *
 * Format : { "<id réservation>": { jeton, date, debut, duree } }
 * C'est la SEULE utilisation du stockage local : permettre d'annuler depuis cet appareil.
 * Le localStorage peut être indisponible (navigation privée stricte…) : tout est protégé par try/catch.
 */

import { hhmmVersMinutes } from './dates.js';

const CLE = 'pingpong-saulnieres.jetons';

function lire() {
  try {
    const brut = JSON.parse(localStorage.getItem(CLE) || '{}');
    return brut && typeof brut === 'object' ? brut : {};
  } catch {
    return {};
  }
}

function ecrire(jetons) {
  try {
    if (Object.keys(jetons).length) localStorage.setItem(CLE, JSON.stringify(jetons));
    else localStorage.removeItem(CLE);
  } catch {
    /* stockage plein ou interdit : l'annulation ne sera simplement pas possible */
  }
}

export function enregistrerJeton(id, infos) {
  const jetons = lire();
  jetons[id] = infos;
  ecrire(jetons);
}

export function jetonDe(id) {
  return lire()[id]?.jeton ?? null;
}

export function oublierJeton(id) {
  const jetons = lire();
  delete jetons[id];
  ecrire(jetons);
}

/**
 * Nettoyage :
 *  - supprime les jetons des réservations terminées ;
 *  - supprime ceux des réservations de la semaine affichée qui n'existent plus
 *    (annulées depuis l'admin, par exemple).
 * @param {{date: string, heure: string}} maintenant  heure de Paris donnée par le serveur
 * @param {{date: string, reservations: {id: string}[]}[]} jours  jours de la semaine affichée
 */
export function nettoyerJetons(maintenant, jours = []) {
  const jetons = lire();
  const minutes = hhmmVersMinutes(maintenant.heure);
  const datesAffichees = new Set(jours.map((j) => j.date));
  const idsExistants = new Set(jours.flatMap((j) => j.reservations.map((r) => r.id)));
  let modifie = false;

  for (const [id, infos] of Object.entries(jetons)) {
    const fin = hhmmVersMinutes(infos.debut || '00:00') + Number(infos.duree || 0);
    const terminee = !infos.date || infos.date < maintenant.date || (infos.date === maintenant.date && fin <= minutes);
    const disparue = datesAffichees.has(infos.date) && !idsExistants.has(id);
    if (terminee || disparue) {
      delete jetons[id];
      modifie = true;
    }
  }
  if (modifie) ecrire(jetons);
}
