/**
 * Petites aides pour fabriquer des réponses HTTP JSON homogènes.
 */

import { ErreurMetier } from './regles.js';

const ENTETES = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

export function json(corps, statut = 200, entetes = {}) {
  return new Response(JSON.stringify(corps), { status: statut, headers: { ...ENTETES, ...entetes } });
}

/** Réponse d'erreur : { erreur: "message en français", code } */
export function erreur(message, statut = 400, code = 'erreur', entetes = {}) {
  return json({ erreur: message, code }, statut, entetes);
}

/** Transforme une exception en réponse propre (sans fuite de détails techniques). */
export function depuisException(e) {
  if (e instanceof ErreurMetier) return erreur(e.message, e.statut, e.code);
  console.error('[erreur interne]', e);
  return erreur('Oups, une erreur est survenue. Réessaie dans un instant.', 500, 'interne');
}

/**
 * Extrait l'identifiant d'une URL du type "<base>/<id>".
 * On le lit directement dans le chemin plutôt que via context.params : `netlify dev`
 * rejoue les réponses 4xx sur des variantes d'URL (".html", "/index.html") en réinvoquant
 * la fonction sans paramètres. Avec cette lecture tolérante, chaque variante donne
 * le même identifiant, donc la même réponse.
 */
export function idDepuisChemin(req, base) {
  const { pathname } = new URL(req.url);
  if (!pathname.startsWith(`${base}/`)) return null;
  const m = pathname.slice(base.length + 1).match(/^[A-Za-z0-9_-]+/);
  return m ? m[0] : null;
}

/** Lit le corps JSON de la requête, en limitant sa taille (4 Ko suffisent largement). */
export async function lireCorpsJson(req) {
  const texte = await req.text();
  if (texte.length > 4096) throw new ErreurMetier('Requête trop volumineuse.', 413, 'taille');
  try {
    return JSON.parse(texte);
  } catch {
    throw new ErreurMetier('Requête invalide (JSON attendu).', 400, 'json');
  }
}
