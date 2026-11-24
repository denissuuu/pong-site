/**
 * Limitation de débit simple, stockée dans Netlify Blobs (store "limites").
 *
 * Une clé par (action, IP hachée, minute) : "creation/ab12…/29123456".
 * - L'IP n'est jamais stockée en clair (hash salé).
 * - Le compteur est incrémenté par écriture conditionnelle ; en cas de course
 *   extrême on peut sous-compter d'une ou deux unités. C'est volontairement
 *   approximatif : le but est de freiner les abus, pas d'être un pare-feu.
 * - Les clés anciennes sont supprimées par la fonction planifiée de nettoyage.
 */

import { getStore } from '@netlify/blobs';
import { empreinteIp } from './securite.js';

let storeLimites = null;
const store = () => (storeLimites ??= getStore({ name: 'limites', consistency: 'strong' }));

const minuteActuelle = () => Math.floor(Date.now() / 60000);
const cle = (action, ip) => `${action}/${empreinteIp(ip)}/${minuteActuelle()}`;

/** Nombre d'actions déjà comptées pour cette IP dans la minute en cours. */
export async function compter(action, ip) {
  const r = await store().get(cle(action, ip), { type: 'json' });
  return r?.n ?? 0;
}

/** Ajoute 1 au compteur de la minute en cours. */
export async function incrementer(action, ip) {
  const k = cle(action, ip);
  for (let essai = 0; essai < 3; essai++) {
    const r = await store().getWithMetadata(k, { type: 'json' });
    const n = (r?.data?.n ?? 0) + 1;
    // Sans ETag sur un compteur existant (simulateur local), on écrit sans condition.
    const conditions = r?.etag ? { onlyIfMatch: r.etag } : r ? {} : { onlyIfNew: true };
    const { modified } = await store().setJSON(k, { n }, conditions);
    if (modified) return n;
  }
  return null; // abandon silencieux : la limite reste approximative
}

/**
 * Vérifie puis consomme une unité.
 * @returns {Promise<boolean>} true si l'action est autorisée
 */
export async function consommer(action, ip, max) {
  if ((await compter(action, ip)) >= max) return false;
  await incrementer(action, ip);
  return true;
}

/** Supprime les compteurs de plus de 10 minutes (appelé par le nettoyage planifié). */
export async function purgerLimites() {
  const limite = minuteActuelle() - 10;
  const { blobs } = await store().list();
  let n = 0;
  for (const { key } of blobs) {
    const minute = Number(key.split('/').pop());
    if (!Number.isFinite(minute) || minute < limite) {
      await store().delete(key);
      n++;
    }
  }
  return n;
}
