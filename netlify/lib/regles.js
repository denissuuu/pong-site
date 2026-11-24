/**
 * Règles métier de la réservation — fonctions PURES (aucun accès réseau ni stockage),
 * donc faciles à tester. Le serveur revalide tout ici : on ne fait jamais confiance au front.
 */

import {
  estDateValide,
  ajouterJours,
  hhmmVersMinutes,
  minutesVersHhmm,
} from './temps-paris.js';

// ---------------------------------------------------------------------------
// Paramètres (heures exprimées en minutes depuis minuit, heure de Paris)
// ---------------------------------------------------------------------------
export const OUVERTURE = 10 * 60; // 10h00
export const FERMETURE = 21 * 60; // 21h00
export const PAS = 30; // granularité des créneaux
export const DUREES = [30, 60, 90]; // durées autorisées
export const MAX_PAR_PRENOM_PAR_JOUR = 90; // 1h30 cumulées max par prénom et par jour
export const JOURS_AVANCE_MAX = 21; // 3 semaines à l'avance
export const JOURS_CONSERVATION = 7; // suppression 7 jours après le créneau

/** Erreur métier : porte un statut HTTP et un message clair en français. */
export class ErreurMetier extends Error {
  constructor(message, statut = 400, code = 'invalide') {
    super(message);
    this.statut = statut;
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Prénom
// ---------------------------------------------------------------------------

/**
 * Nettoie un prénom saisi : supprime toute balise HTML, les caractères de contrôle,
 * normalise les apostrophes et compacte les espaces.
 */
export function nettoyerPrenom(brut) {
  if (typeof brut !== 'string') return '';
  return brut
    .normalize('NFC')
    .replace(/<[^>]*>/g, '') // pas de HTML
    .replace(/[\u0000-\u001F\u007F]/g, '') // pas de caractères de contrôle
    .replace(/[’`´]/g, "'") // apostrophes typographiques → droite
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lettres (accents compris), espaces, tirets et apostrophes uniquement. Doit commencer par une lettre. */
const MOTIF_PRENOM = /^\p{L}[\p{L}\p{M} '-]*$/u;

/** Valide un prénom déjà nettoyé. Lève une ErreurMetier si invalide. */
export function validerPrenom(prenom) {
  const longueur = [...prenom].length;
  if (longueur < 2 || longueur > 20) {
    throw new ErreurMetier('Le prénom doit faire entre 2 et 20 caractères.', 400, 'prenom');
  }
  if (!MOTIF_PRENOM.test(prenom)) {
    throw new ErreurMetier(
      'Le prénom ne peut contenir que des lettres, des espaces, des tirets ou des apostrophes.',
      400,
      'prenom',
    );
  }
}

/**
 * Clé de comparaison d'un prénom : insensible à la casse et aux accents, espaces supprimés.
 * "Éloïse", "eloise" et "ELOÏSE" → "eloise" ; "Jean Marc" et "jeanmarc" → "jeanmarc".
 * (Les tirets et apostrophes sont conservés : "Jean-Marc" reste distinct de "Jean Marc".)
 */
export function cleDePrenom(prenom) {
  return prenom
    .normalize('NFD')
    .replace(/\p{M}/gu, '') // retire les accents (marques diacritiques)
    .toLowerCase()
    .replace(/\s+/g, '');
}

// ---------------------------------------------------------------------------
// Outils horaires
// ---------------------------------------------------------------------------

/** Deux intervalles [a0, a1[ et [b0, b1[ se chevauchent-ils ? (bornes de fin exclues) */
export function chevauche(a0, a1, b0, b1) {
  return a0 < b1 && b0 < a1;
}

/** Début / fin (en minutes) d'une réservation stockée. */
export function bornesReservation(r) {
  const debut = hhmmVersMinutes(r.debut);
  return { debut, fin: debut + r.duree };
}

/** Début / fin (en minutes) d'un blocage stocké. */
export function bornesBlocage(b) {
  return { debut: hhmmVersMinutes(b.debut), fin: hhmmVersMinutes(b.fin) };
}

/** Une heure est-elle un début de créneau valide (10:00 … 20:30, par pas de 30 min) ? */
export function estDebutDeCreneau(minutes) {
  return (
    Number.isInteger(minutes) &&
    minutes >= OUVERTURE &&
    minutes < FERMETURE &&
    (minutes - OUVERTURE) % PAS === 0
  );
}

/** Date maximale réservable à partir d'aujourd'hui (incluse). */
export function dateMaxReservable(aujourdhui) {
  return ajouterJours(aujourdhui, JOURS_AVANCE_MAX);
}

// ---------------------------------------------------------------------------
// Validation d'une nouvelle réservation
// ---------------------------------------------------------------------------

/**
 * Valide une demande de réservation face à l'état actuel de la journée.
 *
 * @param {object} demande  { prenom, date, debut, duree } tels que reçus du client
 * @param {object} jour     document du jour : { reservations: [], blocages: [] }
 * @param {object} maintenant  { date, minutes } en heure de Paris (voir maintenantParis)
 * @returns {{ prenom: string, date: string, debut: string, duree: number }} demande nettoyée
 * @throws {ErreurMetier}
 */
export function validerReservation(demande, jour, maintenant) {
  if (!demande || typeof demande !== 'object') {
    throw new ErreurMetier('Requête invalide.');
  }

  // --- Prénom
  const prenom = nettoyerPrenom(demande.prenom);
  validerPrenom(prenom);

  // --- Date
  const { date } = demande;
  if (!estDateValide(date)) {
    throw new ErreurMetier('Date invalide.', 400, 'date');
  }

  // --- Heure de début
  const debut = hhmmVersMinutes(demande.debut);
  if (!estDebutDeCreneau(debut)) {
    throw new ErreurMetier(
      'Les créneaux commencent toutes les 30 minutes, entre 10h00 et 20h30.',
      400,
      'debut',
    );
  }

  // --- Durée
  const duree = Number(demande.duree);
  if (!DUREES.includes(duree)) {
    throw new ErreurMetier('La durée doit être de 30 min, 1h ou 1h30.', 400, 'duree');
  }
  const fin = debut + duree;
  if (fin > FERMETURE) {
    throw new ErreurMetier('La réservation doit se terminer au plus tard à 21h00.', 400, 'duree');
  }

  // --- Pas dans le passé (un créneau déjà commencé est considéré comme passé)
  if (date < maintenant.date || (date === maintenant.date && debut <= maintenant.minutes)) {
    throw new ErreurMetier('Impossible de réserver un créneau passé.', 400, 'passe');
  }

  // --- Pas plus de 3 semaines à l'avance
  if (date > dateMaxReservable(maintenant.date)) {
    throw new ErreurMetier(
      "On ne peut pas réserver plus de 3 semaines à l'avance.",
      400,
      'trop-loin',
    );
  }

  const reservations = jour?.reservations ?? [];
  const blocages = jour?.blocages ?? [];

  // --- Blocages posés par la mairie
  const blocage = blocages.find((b) => {
    const bb = bornesBlocage(b);
    return chevauche(debut, fin, bb.debut, bb.fin);
  });
  if (blocage) {
    throw new ErreurMetier(
      `Ce créneau n'est pas disponible (${blocage.motif}).`,
      409,
      'bloque',
    );
  }

  // --- Chevauchement avec une autre réservation
  const conflit = reservations.some((r) => {
    const br = bornesReservation(r);
    return chevauche(debut, fin, br.debut, br.fin);
  });
  if (conflit) {
    throw new ErreurMetier(
      "Ce créneau vient d'être réservé par quelqu'un d'autre. Choisis-en un autre !",
      409,
      'pris',
    );
  }

  // --- 1h30 maximum par prénom et par jour
  const cle = cleDePrenom(prenom);
  const dejaReserve = reservations
    .filter((r) => cleDePrenom(r.prenom) === cle)
    .reduce((total, r) => total + r.duree, 0);
  if (dejaReserve + duree > MAX_PAR_PRENOM_PAR_JOUR) {
    const reste = MAX_PAR_PRENOM_PAR_JOUR - dejaReserve;
    throw new ErreurMetier(
      reste > 0
        ? `${prenom} a déjà réservé ${formaterDuree(dejaReserve)} ce jour-là : il ne reste que ${formaterDuree(reste)} possible (1h30 maximum par jour).`
        : `${prenom} a déjà réservé 1h30 ce jour-là, c'est le maximum par jour.`,
      409,
      'quota',
    );
  }

  return { prenom, date, debut: minutesVersHhmm(debut), duree };
}

// ---------------------------------------------------------------------------
// Validation d'un blocage (admin)
// ---------------------------------------------------------------------------

/**
 * Valide une demande de blocage.
 * { date, journee: boolean, debut?: "HH:MM", fin?: "HH:MM", motif }
 */
export function validerBlocage(demande, maintenant) {
  if (!demande || typeof demande !== 'object') throw new ErreurMetier('Requête invalide.');

  const { date } = demande;
  if (!estDateValide(date)) throw new ErreurMetier('Date invalide.', 400, 'date');
  if (date < maintenant.date) {
    throw new ErreurMetier('Impossible de bloquer une date passée.', 400, 'passe');
  }
  if (date > ajouterJours(maintenant.date, 366)) {
    throw new ErreurMetier("On ne peut pas bloquer plus d'un an à l'avance.", 400, 'trop-loin');
  }

  let debut = OUVERTURE;
  let fin = FERMETURE;
  if (!demande.journee) {
    debut = hhmmVersMinutes(demande.debut);
    fin = hhmmVersMinutes(demande.fin);
    const valide = (m) => Number.isInteger(m) && m >= OUVERTURE && m <= FERMETURE && m % PAS === 0;
    if (!valide(debut) || !valide(fin) || fin <= debut) {
      throw new ErreurMetier(
        "Plage horaire invalide : choisis un début et une fin entre 10h00 et 21h00, la fin après le début.",
        400,
        'horaire',
      );
    }
  }

  const motif = nettoyerTexte(demande.motif, 80);
  if (motif.length < 2) {
    throw new ErreurMetier('Indique un motif (2 à 80 caractères).', 400, 'motif');
  }

  return {
    date,
    debut: minutesVersHhmm(debut),
    fin: minutesVersHhmm(fin),
    journee: debut === OUVERTURE && fin === FERMETURE,
    motif,
  };
}

/** Nettoyage générique d'un texte libre court (motif) : sans HTML ni contrôle, tronqué. */
export function nettoyerTexte(brut, max) {
  if (typeof brut !== 'string') return '';
  return [...brut.replace(/<[^>]*>/g, '').replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim()]
    .slice(0, max)
    .join('');
}

// ---------------------------------------------------------------------------
// Divers
// ---------------------------------------------------------------------------

/** 30 → "30 min", 60 → "1h", 90 → "1h30" */
export function formaterDuree(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

/** Une réservation est-elle terminée ? (utile pour l'annulation) */
export function estTerminee(r, maintenant) {
  const { fin } = bornesReservation(r);
  return r.date < maintenant.date || (r.date === maintenant.date && fin <= maintenant.minutes);
}

/** Version publique d'une réservation : on ne renvoie JAMAIS le hash du jeton. */
export function versionPublique(r) {
  return { id: r.id, prenom: r.prenom, date: r.date, debut: r.debut, duree: r.duree };
}

/** Version publique d'un blocage. */
export function blocagePublic(b) {
  return { id: b.id, date: b.date, debut: b.debut, fin: b.fin, journee: b.journee, motif: b.motif };
}

/** Une clé de jour est-elle à supprimer (créneau passé depuis plus de 7 jours) ? */
export function jourExpire(date, aujourdhui) {
  return date < ajouterJours(aujourdhui, -JOURS_CONSERVATION);
}
