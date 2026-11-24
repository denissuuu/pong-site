/**
 * API d'administration (mairie), protégée par la variable d'environnement ADMIN_PASSWORD.
 * Le mot de passe est envoyé dans l'en-tête "Authorization: Bearer <mot de passe>".
 *
 *   GET    /api/admin/reservations          → toutes les réservations et tous les blocages
 *   DELETE /api/admin/reservations/:id      → supprimer une réservation
 *   POST   /api/admin/blocages              → bloquer un créneau ou une journée (avec motif)
 *   DELETE /api/admin/blocages/:id          → supprimer un blocage
 */

import { maintenantParis } from '../lib/temps-paris.js';
import {
  validerBlocage,
  versionPublique,
  blocagePublic,
  bornesReservation,
  bornesBlocage,
  chevauche,
  jourExpire,
  ErreurMetier,
} from '../lib/regles.js';
import { verifierAdmin, genererId, dateDepuisId } from '../lib/securite.js';
import { lireJour, modifierJour, listerJours } from '../lib/stockage.js';
import { compter, incrementer } from '../lib/limite-debit.js';
import { json, erreur, depuisException, lireCorpsJson, idDepuisChemin } from '../lib/reponses.js';

export const config = {
  path: [
    '/api/admin/reservations',
    '/api/admin/reservations/:id([A-Za-z0-9_-]+)',
    '/api/admin/blocages',
    '/api/admin/blocages/:id([A-Za-z0-9_-]+)',
  ],
};

// Anti force brute : au-delà de 10 mauvais mots de passe par minute et par IP, on bloque.
const MAX_ECHECS_PAR_MINUTE = 10;

export default async function gestionnaire(req, context) {
  try {
    // --- Authentification
    if ((await compter('admin-echec', context.ip)) >= MAX_ECHECS_PAR_MINUTE) {
      return erreur('Trop de tentatives. Patiente une minute.', 429, 'trop-de-requetes', {
        'retry-after': '60',
      });
    }
    const auth = verifierAdmin(req);
    if (auth === 'non-configure') {
      return erreur(
        "L'administration n'est pas configurée (variable ADMIN_PASSWORD absente sur Netlify).",
        503,
        'non-configure',
      );
    }
    if (auth !== 'ok') {
      if (auth === 'refuse') await incrementer('admin-echec', context.ip);
      return erreur('Mot de passe incorrect.', 401, 'auth');
    }

    // --- Routage
    const { pathname } = new URL(req.url);
    const surBlocages = pathname.startsWith('/api/admin/blocages');
    const id = idDepuisChemin(req, surBlocages ? '/api/admin/blocages' : '/api/admin/reservations');

    if (!surBlocages && req.method === 'GET' && !id) return await toutLister();
    if (!surBlocages && req.method === 'DELETE' && id) return await supprimerReservation(id);
    if (surBlocages && req.method === 'POST' && !id) return await creerBlocage(req);
    if (surBlocages && req.method === 'DELETE' && id) return await supprimerBlocage(id);
    return erreur('Méthode non autorisée.', 405, 'methode');
  } catch (e) {
    return depuisException(e);
  }
}

/** Tous les jours encore conservés, du plus ancien au plus récent. */
async function toutLister() {
  const maintenant = maintenantParis();
  const dates = (await listerJours()).filter((d) => !jourExpire(d, maintenant.date));
  const jours = await Promise.all(dates.map((d) => lireJour(d)));

  const reservations = [];
  const blocages = [];
  jours.forEach(({ donnees }) => {
    reservations.push(...donnees.reservations.map((r) => ({ ...versionPublique(r), creeLe: r.creeLe })));
    blocages.push(...donnees.blocages.map(blocagePublic));
  });
  const tri = (a, b) => (a.date + a.debut).localeCompare(b.date + b.debut);

  return json({
    maintenant: { date: maintenant.date, heure: maintenant.heure },
    reservations: reservations.sort(tri),
    blocages: blocages.sort(tri),
  });
}

async function supprimerReservation(id) {
  const date = dateDepuisId(id, 'r');
  if (!date) return erreur('Réservation introuvable.', 404, 'introuvable');
  await modifierJour(date, (jour) => {
    const avant = jour.reservations.length;
    jour.reservations = jour.reservations.filter((r) => r.id !== id);
    if (jour.reservations.length === avant) {
      throw new ErreurMetier('Cette réservation a déjà été supprimée.', 404, 'introuvable');
    }
  });
  return json({ ok: true, message: 'Réservation supprimée.' });
}

async function creerBlocage(req) {
  const demande = await lireCorpsJson(req);
  // Validation préalable (date, horaires, motif) avant tout accès au stockage.
  validerBlocage(demande, maintenantParis());

  const resultat = await modifierJour(demande.date, (jour) => {
    const valide = validerBlocage(demande, maintenantParis());
    const blocage = { id: genererId('b', valide.date), ...valide, creeLe: new Date().toISOString() };
    jour.blocages.push(blocage);

    // On prévient la mairie des réservations déjà présentes sur cette plage :
    // elles ne sont pas supprimées automatiquement, la mairie choisit.
    const bb = bornesBlocage(blocage);
    const conflits = jour.reservations
      .filter((r) => {
        const br = bornesReservation(r);
        return chevauche(bb.debut, bb.fin, br.debut, br.fin);
      })
      .map(versionPublique);
    return { blocage: blocagePublic(blocage), conflits };
  });
  return json(resultat, 201);
}

async function supprimerBlocage(id) {
  const date = dateDepuisId(id, 'b');
  if (!date) return erreur('Blocage introuvable.', 404, 'introuvable');
  await modifierJour(date, (jour) => {
    const avant = jour.blocages.length;
    jour.blocages = jour.blocages.filter((b) => b.id !== id);
    if (jour.blocages.length === avant) {
      throw new ErreurMetier('Ce blocage a déjà été supprimé.', 404, 'introuvable');
    }
  });
  return json({ ok: true, message: 'Blocage supprimé.' });
}
