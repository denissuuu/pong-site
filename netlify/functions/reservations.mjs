/**
 * API publique des réservations.
 *
 *   GET    /api/reservations?semaine=YYYY-MM-DD  → planning de la semaine (réservations + blocages)
 *   POST   /api/reservations                     → crée une réservation, renvoie { id, jeton }
 *   DELETE /api/reservations/:id                 → annule (en-tête X-Jeton-Annulation requis)
 */

import {
  maintenantParis,
  estDateValide,
  lundiDe,
  ajouterJours,
} from '../lib/temps-paris.js';
import {
  validerReservation,
  versionPublique,
  blocagePublic,
  dateMaxReservable,
  estTerminee,
  jourExpire,
  ErreurMetier,
} from '../lib/regles.js';
import { genererJeton, hacher, verifierJeton, genererId, dateDepuisId } from '../lib/securite.js';
import { lireJour, modifierJour } from '../lib/stockage.js';
import { consommer } from '../lib/limite-debit.js';
import { json, erreur, depuisException, lireCorpsJson, idDepuisChemin } from '../lib/reponses.js';

export const config = {
  path: ['/api/reservations', '/api/reservations/:id([A-Za-z0-9_-]+)'],
};

const MAX_CREATIONS_PAR_MINUTE = 10;

export default async function gestionnaire(req, context) {
  try {
    const id = idDepuisChemin(req, '/api/reservations');
    if (req.method === 'GET' && !id) return await planningDeLaSemaine(req);
    if (req.method === 'POST' && !id) return await creerReservation(req, context);
    if (req.method === 'DELETE' && id) return await annulerReservation(req, id);
    return erreur('Méthode non autorisée.', 405, 'methode');
  } catch (e) {
    return depuisException(e);
  }
}

// ---------------------------------------------------------------------------
// GET : planning d'une semaine
// ---------------------------------------------------------------------------
async function planningDeLaSemaine(req) {
  const maintenant = maintenantParis();
  const param = new URL(req.url).searchParams.get('semaine');
  if (param && !estDateValide(param)) return erreur('Paramètre "semaine" invalide (YYYY-MM-DD).');

  const lundi = lundiDe(param || maintenant.date);
  const dates = Array.from({ length: 7 }, (_, i) => ajouterJours(lundi, i));

  const jours = await Promise.all(
    dates.map(async (date) => {
      // Nettoyage à la lecture : on n'affiche plus les jours expirés (> 7 jours).
      if (jourExpire(date, maintenant.date)) return { date, reservations: [], blocages: [] };
      const { donnees } = await lireJour(date);
      return {
        date,
        reservations: donnees.reservations.map(versionPublique).sort(parDebut),
        blocages: donnees.blocages.map(blocagePublic).sort(parDebut),
      };
    }),
  );

  return json({
    semaine: lundi,
    maintenant: { date: maintenant.date, heure: maintenant.heure },
    limites: {
      premiereSemaine: lundiDe(maintenant.date),
      derniereSemaine: lundiDe(dateMaxReservable(maintenant.date)),
      dateMax: dateMaxReservable(maintenant.date),
    },
    jours,
  });
}

const parDebut = (a, b) => a.debut.localeCompare(b.debut);

// ---------------------------------------------------------------------------
// POST : créer une réservation
// ---------------------------------------------------------------------------
async function creerReservation(req, context) {
  // Anti-abus : 10 créations max par minute et par IP.
  const autorise = await consommer('creation', context.ip, MAX_CREATIONS_PAR_MINUTE);
  if (!autorise) {
    return erreur(
      'Trop de réservations en peu de temps. Patiente une minute avant de réessayer.',
      429,
      'trop-de-requetes',
      { 'retry-after': '60' },
    );
  }

  const demande = await lireCorpsJson(req);
  if (!estDateValide(demande?.date)) throw new ErreurMetier('Date invalide.', 400, 'date');

  const jeton = genererJeton();

  const reservation = await modifierJour(demande.date, (jour) => {
    // Revalidation COMPLÈTE à chaque essai, avec l'état le plus récent du jour.
    const valide = validerReservation(demande, jour, maintenantParis());
    const nouvelle = {
      id: genererId('r', valide.date),
      ...valide,
      hashJeton: hacher(jeton), // seul le hash est stocké
      creeLe: new Date().toISOString(),
    };
    jour.reservations.push(nouvelle);
    return nouvelle;
  });

  return json({ id: reservation.id, jeton, reservation: versionPublique(reservation) }, 201);
}

// ---------------------------------------------------------------------------
// DELETE : annuler sa réservation grâce au jeton
// ---------------------------------------------------------------------------
async function annulerReservation(req, id) {
  const date = dateDepuisId(id, 'r');
  if (!date) return erreur('Réservation introuvable.', 404, 'introuvable');

  const jeton = req.headers.get('x-jeton-annulation');
  if (!jeton) return erreur("Jeton d'annulation manquant.", 401, 'jeton');

  await modifierJour(date, (jour) => {
    const index = jour.reservations.findIndex((r) => r.id === id);
    if (index === -1) {
      throw new ErreurMetier('Cette réservation a déjà été annulée ou supprimée.', 404, 'introuvable');
    }
    const r = jour.reservations[index];
    if (!verifierJeton(jeton, r.hashJeton)) {
      throw new ErreurMetier("Tu ne peux pas annuler cette réservation depuis cet appareil.", 403, 'jeton');
    }
    if (estTerminee(r, maintenantParis())) {
      throw new ErreurMetier('Ce créneau est déjà terminé.', 400, 'passe');
    }
    jour.reservations.splice(index, 1);
  });

  return json({ ok: true, message: 'Réservation annulée.' });
}
