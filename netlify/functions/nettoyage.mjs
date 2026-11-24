/**
 * Fonction planifiée : chaque nuit, supprime
 *   - les jours dont les créneaux sont passés depuis plus de 7 jours (RGPD) ;
 *   - les compteurs anti-abus périmés.
 *
 * Netlify l'exécute automatiquement (planification "@daily", en UTC — peu importe ici,
 * le calcul de la date limite est fait en heure de Paris).
 * En local : `netlify functions:invoke nettoyage`.
 */

import { maintenantParis } from '../lib/temps-paris.js';
import { jourExpire } from '../lib/regles.js';
import { listerJours, storeReservations } from '../lib/stockage.js';
import { purgerLimites } from '../lib/limite-debit.js';

export const config = {
  schedule: '@daily',
};

export default async function nettoyage() {
  const aujourdhui = maintenantParis().date;
  const store = storeReservations();

  const aSupprimer = (await listerJours(store)).filter((d) => jourExpire(d, aujourdhui));
  for (const date of aSupprimer) await store.delete(date);

  const compteurs = await purgerLimites();

  console.log(`[nettoyage] ${aSupprimer.length} jour(s) supprimé(s), ${compteurs} compteur(s) purgé(s).`);
  return new Response('ok');
}

