/**
 * Accès à Netlify Blobs.
 *
 * Organisation : un store "reservations", une clé par jour ("2026-11-23"), contenant
 *   { reservations: [...], blocages: [...] }
 * Réservations ET blocages d'un même jour sont dans le même document : la vérification
 * des chevauchements et l'écriture portent donc sur un seul objet, ce qui rend
 * l'opération atomique grâce aux écritures conditionnelles.
 *
 * Concurrence (deux personnes qui réservent le même créneau en même temps) :
 *   1. on lit le document du jour ET son ETag (empreinte de version) ;
 *   2. on applique la modification en mémoire (avec revalidation complète des règles) ;
 *   3. on écrit SEULEMENT si le document n'a pas changé entre-temps
 *      (onlyIfMatch: etag, ou onlyIfNew si le jour n'existait pas) ;
 *   4. si quelqu'un a écrit avant nous (modified: false), on recommence au 1.
 * Le second arrivant relit donc la réservation du premier et reçoit l'erreur
 * « Ce créneau vient d'être réservé par quelqu'un d'autre ».
 */

import { getStore } from '@netlify/blobs';
import { ErreurMetier } from './regles.js';

const NB_ESSAIS = 5;

let storeParDefaut = null;

/** Store "reservations" en cohérence forte (on lit toujours la dernière version écrite). */
export function storeReservations() {
  storeParDefaut ??= getStore({ name: 'reservations', consistency: 'strong' });
  return storeParDefaut;
}

const jourVide = () => ({ reservations: [], blocages: [] });

/**
 * Lit le document d'un jour.
 * @returns {Promise<{ donnees: {reservations: any[], blocages: any[]}, etag: string|null }>}
 */
export async function lireJour(date, store = storeReservations()) {
  const resultat = await store.getWithMetadata(date, { type: 'json' });
  if (!resultat) return { donnees: jourVide(), etag: null, existe: false };
  const d = resultat.data || {};
  return {
    donnees: {
      reservations: Array.isArray(d.reservations) ? d.reservations : [],
      blocages: Array.isArray(d.blocages) ? d.blocages : [],
    },
    etag: resultat.etag || null,
    existe: true,
  };
}

/** Choisit la condition d'écriture adaptée à ce qu'on a lu. */
function conditionsEcriture({ etag, existe }) {
  if (etag) return { onlyIfMatch: etag }; // cas normal en production
  if (!existe) return { onlyIfNew: true }; // le jour n'existait pas encore
  // Document existant mais sans ETag : cela n'arrive qu'avec le simulateur local de
  // `netlify dev`, qui ne renvoie pas d'ETag en lecture. On écrit alors sans condition
  // (acceptable en développement, où il n'y a pas d'accès concurrents réels).
  if (!avertissementAffiche) {
    console.warn('[stockage] ETag absent (simulateur local ?) : écriture non conditionnelle.');
    avertissementAffiche = true;
  }
  return {};
}
let avertissementAffiche = false;

/**
 * Modifie le document d'un jour de façon sûre face aux écritures concurrentes.
 *
 * @param {string} date  clé du jour
 * @param {(donnees) => any} modifier  reçoit une copie du document, la modifie EN PLACE
 *        et renvoie un résultat. Peut lever une ErreurMetier (aucune écriture alors).
 *        Elle est rappelée à chaque nouvel essai : elle doit donc tout revalider.
 *        Renvoyer `{ __sansEcriture: true, ... }` permet de ne rien écrire.
 * @returns le résultat de `modifier`
 */
export async function modifierJour(date, modifier, store = storeReservations()) {
  for (let essai = 1; essai <= NB_ESSAIS; essai++) {
    const lu = await lireJour(date, store);
    const { donnees } = lu;
    const resultat = await modifier(donnees);
    if (resultat?.__sansEcriture) return resultat;

    const { modified } = await store.setJSON(date, donnees, conditionsEcriture(lu));
    if (modified) return resultat;

    // Quelqu'un a écrit juste avant nous : petite pause aléatoire puis on recommence.
    await new Promise((r) => setTimeout(r, 20 + Math.random() * 60 * essai));
  }
  throw new ErreurMetier(
    'Beaucoup de monde réserve en ce moment ! Réessaie dans quelques secondes.',
    503,
    'concurrence',
  );
}

/** Liste toutes les clés de jour présentes dans le store. */
export async function listerJours(store = storeReservations()) {
  const { blobs } = await store.list();
  return blobs.map((b) => b.key).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
}
