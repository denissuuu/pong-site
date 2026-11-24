/**
 * Petit client HTTP : JSON en entrée/sortie, erreurs transformées en messages français.
 */

export class ErreurApi extends Error {
  constructor(message, statut, code) {
    super(message);
    this.statut = statut;
    this.code = code;
  }
}

export async function requete(methode, url, { corps, entetes = {} } = {}) {
  let reponse;
  try {
    reponse = await fetch(url, {
      method: methode,
      headers: {
        Accept: 'application/json',
        ...(corps ? { 'Content-Type': 'application/json' } : {}),
        ...entetes,
      },
      body: corps ? JSON.stringify(corps) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new ErreurApi('Impossible de joindre le serveur. Vérifie ta connexion internet.', 0, 'reseau');
  }

  let donnees = null;
  try {
    donnees = await reponse.json();
  } catch {
    /* réponse vide ou non JSON */
  }

  if (!reponse.ok) {
    throw new ErreurApi(
      donnees?.erreur || 'Une erreur est survenue. Réessaie dans un instant.',
      reponse.status,
      donnees?.code || 'erreur',
    );
  }
  return donnees;
}
