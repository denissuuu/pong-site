/**
 * Planning public : chargement de la semaine, rendu de la grille, réservation et annulation.
 */

import {
  OUVERTURE, FERMETURE, PAS, MAX_PAR_PRENOM,
  ajouterJours, hhmmVersMinutes, minutesVersHhmm, heureFr, dureeFr,
  jourCourtFr, jourLongFr, nomJourCourt, numeroJour, titreSemaine, cleDePrenom,
} from './dates.js';
import { requete } from './api.js';
import { enregistrerJeton, jetonDe, oublierJeton, nettoyerJetons } from './jetons.js';
import { el, icone, annoncer, preparerFenetre, ouvrirFenetre, fermerFenetre } from './dom.js';

// ---------------------------------------------------------------------------
// État de la page
// ---------------------------------------------------------------------------
const etat = {
  donnees: null,      // dernière réponse de GET /api/reservations
  jourActif: null,    // jour affiché sur mobile
  selection: null,    // { date, debut } du créneau en cours de réservation
  annulation: null,   // réservation en cours d'annulation
  dernierPrenom: '',  // gardé en mémoire (pas stocké) pour enchaîner deux réservations
};

const $ = (id) => document.getElementById(id);
const grille = $('grille');
const onglets = $('onglets');
const fenetreResa = $('fenetre-reservation');
const fenetreAnnul = $('fenetre-annulation');
const formulaire = $('formulaire');
const champPrenom = $('prenom');

const NB_LIGNES = (FERMETURE - OUVERTURE) / PAS; // 22 demi-heures

// ---------------------------------------------------------------------------
// Chargement
// ---------------------------------------------------------------------------
async function charger(semaine, { direction = null, silencieux = false } = {}) {
  try {
    const url = semaine ? `/api/reservations?semaine=${encodeURIComponent(semaine)}` : '/api/reservations';
    const donnees = await requete('GET', url);
    etat.donnees = donnees;
    nettoyerJetons(donnees.maintenant, donnees.jours);

    // Jour affiché sur mobile : on garde le même jour de la semaine si possible.
    const dates = donnees.jours.map((j) => j.date);
    if (!dates.includes(etat.jourActif)) {
      const decalage = etat.jourActif ? dates.findIndex((d) => d.slice(8) === etat.jourActif.slice(8)) : -1;
      etat.jourActif = dates.includes(donnees.maintenant.date) ? donnees.maintenant.date : dates[Math.max(decalage, 0)];
    }
    rendre(direction);
  } catch (e) {
    if (!silencieux) annoncer(e.message, 'erreur');
    if (!etat.donnees) {
      grille.replaceChildren(
        el('p', { class: 'alerte', role: 'alert' }, icone('alerte'), e.message),
      );
      grille.setAttribute('aria-busy', 'false');
    }
  }
}

// ---------------------------------------------------------------------------
// Découpage d'une journée en blocs à afficher
// ---------------------------------------------------------------------------

/**
 * Transforme les réservations / blocages d'un jour en une liste chronologique de blocs :
 *   { type: 'libre' | 'passe' | 'ferme' | 'reserve' | 'moi' | 'bloque', debut, fin, objet? }
 */
function decouperJour(jour, maintenant, dateMax) {
  const aujourdhui = maintenant.date;
  const minutesMaintenant = hhmmVersMinutes(maintenant.heure);

  // Jour au-delà de l'horizon de 3 semaines
  if (jour.date > dateMax) return [{ type: 'ferme', debut: OUVERTURE, fin: FERMETURE }];

  const estPasse = (min) => jour.date < aujourdhui || (jour.date === aujourdhui && min <= minutesMaintenant);
  const estTermine = (fin) => jour.date < aujourdhui || (jour.date === aujourdhui && fin <= minutesMaintenant);

  // Occupations : les blocages de la mairie sont prioritaires sur l'affichage.
  const occupations = [];
  for (const b of jour.blocages) {
    occupations.push({ type: 'bloque', debut: hhmmVersMinutes(b.debut), fin: hhmmVersMinutes(b.fin), objet: b });
  }
  for (const r of jour.reservations) {
    const debut = hhmmVersMinutes(r.debut);
    const fin = debut + r.duree;
    if (occupations.some((o) => o.type === 'bloque' && debut < o.fin && o.debut < fin)) continue;
    occupations.push({ type: jetonDe(r.id) ? 'moi' : 'reserve', debut, fin, objet: r });
  }
  occupations.sort((a, b) => a.debut - b.debut);

  // On remplit les trous avec des demi-heures libres (ou passées, regroupées).
  const blocs = [];
  let t = OUVERTURE;
  const remplir = (jusqua) => {
    for (; t < jusqua; t += PAS) {
      if (estPasse(t)) {
        const precedent = blocs.at(-1);
        if (precedent?.type === 'passe' && precedent.fin === t) precedent.fin = t + PAS;
        else blocs.push({ type: 'passe', debut: t, fin: t + PAS });
      } else {
        blocs.push({ type: 'libre', debut: t, fin: t + PAS });
      }
    }
  };
  for (const o of occupations) {
    if (o.debut < t) continue; // chevauchement résiduel (cas anormal) : ignoré
    remplir(o.debut);
    blocs.push({ ...o, termine: estTermine(o.fin) });
    t = o.fin;
  }
  remplir(FERMETURE);
  return blocs;
}

/** Fin maximale possible pour une réservation commençant à `debut` (prochaine occupation ou 21h). */
function finMaximale(jour, debut) {
  const debutsSuivants = [
    ...jour.reservations.map((r) => hhmmVersMinutes(r.debut)),
    ...jour.blocages.map((b) => hhmmVersMinutes(b.debut)),
  ].filter((m) => m > debut);
  return Math.min(FERMETURE, ...debutsSuivants);
}

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------
function rendre(direction) {
  const { semaine, jours, maintenant, limites } = etat.donnees;

  // Mémorise le créneau qui avait le focus pour le restaurer après le rendu.
  const cleFocus = grille.contains(document.activeElement) ? document.activeElement.dataset.cle : null;

  // --- En-tête de semaine
  const ecart = Math.round((Date.parse(semaine) - Date.parse(limites.premiereSemaine)) / (7 * 864e5));
  $('sur-titre-semaine').textContent =
    ['Cette semaine', 'La semaine prochaine', 'Dans 2 semaines', 'Dans 3 semaines'][ecart] ?? 'Semaine';
  $('titre-semaine').textContent = titreSemaine(semaine);
  $('precedente').disabled = semaine <= limites.premiereSemaine;
  $('suivante').disabled = semaine >= limites.derniereSemaine;
  $('aujourdhui').disabled = semaine === limites.premiereSemaine && etat.jourActif === maintenant.date;

  // --- Colonnes
  const colonneHeures = el('div', { class: 'heures', 'aria-hidden': 'true' },
    el('span'),
    Array.from({ length: NB_LIGNES }, (_, i) => el('span', {}, heureFr(OUVERTURE + i * PAS).replace('h00', 'h'))),
  );

  const decoupes = jours.map((jour) => ({ jour, blocs: decouperJour(jour, maintenant, limites.dateMax) }));
  const colonnes = decoupes.map(({ jour, blocs }) => rendreJour(jour, blocs, maintenant));

  grille.replaceChildren(colonneHeures, ...colonnes);
  grille.setAttribute('aria-busy', 'false');

  // --- Onglets (mobile)
  onglets.replaceChildren(...decoupes.map(({ jour, blocs }) => rendreOnglet(jour, blocs, maintenant)));
  // Centre l'onglet actif horizontalement (sans faire défiler la page verticalement).
  const ongletActif = onglets.querySelector('[aria-pressed="true"]');
  if (ongletActif && onglets.scrollWidth > onglets.clientWidth) {
    onglets.scrollLeft = ongletActif.offsetLeft - (onglets.clientWidth - ongletActif.offsetWidth) / 2;
  }

  // --- Animation de transition entre semaines
  if (direction) {
    grille.classList.remove('entree-suivante', 'entree-precedente');
    void grille.offsetWidth; // relance l'animation
    grille.classList.add(direction === 'suivante' ? 'entree-suivante' : 'entree-precedente');
  }

  if (cleFocus) grille.querySelector(`[data-cle="${CSS.escape(cleFocus)}"]`)?.focus();
}

function rendreOnglet(jour, blocs, maintenant) {
  const libres = blocs.filter((b) => b.type === 'libre').length;
  const passe = jour.date < maintenant.date;
  const termine = blocs.every((b) => b.type === 'passe' || b.termine); // plus rien à venir ce jour-là
  const resume =
    jour.date > etat.donnees.limites.dateMax ? 'Bientôt'
    : passe ? 'Passé'
    : termine ? 'Terminé'
    : libres ? `${libres} libre${libres > 1 ? 's' : ''}`
    : 'Complet';
  return el('button', {
    type: 'button',
    class: `onglet${jour.date === maintenant.date ? ' est-aujourdhui' : ''}${passe ? ' est-passe' : ''}`,
    'aria-pressed': String(jour.date === etat.jourActif),
    'aria-controls': `jour-${jour.date}`,
    onclick: () => {
      etat.jourActif = jour.date;
      rendre();
    },
  },
    // Version abrégée pour l'œil, version complète pour les lecteurs d'écran
    el('span', { class: 'onglet__jour', 'aria-hidden': 'true' }, jour.date === maintenant.date ? 'Auj.' : nomJourCourt(jour.date)),
    el('span', { class: 'onglet__num', 'aria-hidden': 'true' }, numeroJour(jour.date)),
    el('span', { class: 'onglet__libres', 'aria-hidden': 'true' }, resume),
    el('span', { class: 'visuellement-cache' },
      `${jourLongFr(jour.date)}${jour.date === maintenant.date ? ", aujourd'hui" : ''} : ${resume}`),
  );
}

function rendreJour(jour, blocs, maintenant) {
  const estAujourdhui = jour.date === maintenant.date;
  const classes = ['jour'];
  if (jour.date === etat.jourActif) classes.push('est-actif');
  if (estAujourdhui) classes.push('est-aujourdhui');
  if (jour.date < maintenant.date) classes.push('est-passe');

  const titreId = `titre-${jour.date}`;
  return el('section', { class: classes.join(' '), id: `jour-${jour.date}`, 'aria-labelledby': titreId },
    el('h3', { class: 'jour__titre', id: titreId, 'aria-label': `${jourLongFr(jour.date)}${estAujourdhui ? ", aujourd'hui" : ''}` },
      el('span', { class: 'jour__nom' }, nomJourCourt(jour.date)),
      el('span', { class: 'jour__num' }, numeroJour(jour.date)),
    ),
    el('h3', { class: 'jour__titre-mobile' }, estAujourdhui ? `Aujourd'hui, ${jourLongFr(jour.date)}` : jourCourtFr(jour.date).replace(/\.$/, '')),
    el('div', { class: 'jour__creneaux' }, blocs.map((b) => rendreBloc(jour, b))),
  );
}

function rendreBloc(jour, bloc) {
  const nbLignes = (bloc.fin - bloc.debut) / PAS;
  const placement = { gridRow: `${(bloc.debut - OUVERTURE) / PAS + 1} / span ${nbLignes}` };
  const court = nbLignes === 1 ? ' est-court' : '';
  const plage = `${heureFr(bloc.debut)} – ${heureFr(bloc.fin)}`;
  const cle = `${jour.date}-${bloc.debut}`;

  switch (bloc.type) {
    case 'libre':
      return el('button', {
        type: 'button',
        class: 'creneau creneau--libre',
        style: placement,
        dataset: { cle },
        'aria-label': `Réserver le ${jourLongFr(jour.date)} à ${heureFr(bloc.debut)}`,
        onclick: () => ouvrirReservation(jour.date, bloc.debut),
      },
        el('span', { class: 'creneau__heure' }, heureFr(bloc.debut)),
        el('span', { class: 'creneau__etat' }, 'Libre'),
        el('span', { class: 'creneau__cta', 'aria-hidden': 'true' }, 'Réserver', icone('chevron')),
      );

    case 'passe':
      return el('div', { class: 'creneau creneau--passe', style: placement },
        el('span', {}, nbLignes > 1 || window.matchMedia('(max-width: 899px)').matches ? `${plage} · passé` : 'Passé'),
      );

    case 'ferme':
      return el('div', { class: 'creneau creneau--ferme', style: placement },
        el('span', {}, `Réservable à partir du ${jourCourtFr(ajouterJours(jour.date, -21))}`),
      );

    case 'bloque':
      return el('div', { class: `creneau creneau--bloque${court}`, style: placement },
        icone('cadenas'),
        el('span', { class: 'creneau__texte' },
          el('span', { class: 'visuellement-cache' }, 'Indisponible : '),
          el('span', { class: 'creneau__nom' }, bloc.objet.motif),
          el('span', { class: 'creneau__detail' }, bloc.objet.journee ? 'Toute la journée' : plage),
        ),
      );

    case 'reserve':
      return el('div', { class: `creneau creneau--reserve${court}${bloc.termine ? ' est-passe' : ''}`, style: placement },
        el('span', { class: 'icone-raquette' }, icone('raquette')),
        el('span', { class: 'creneau__texte' },
          el('span', { class: 'visuellement-cache' }, 'Réservé par '),
          el('span', { class: 'creneau__nom' }, bloc.objet.prenom),
          el('span', { class: 'creneau__detail' }, plage),
        ),
      );

    case 'moi': {
      const r = bloc.objet;
      return el('div', { class: `creneau creneau--moi${court}${bloc.termine ? ' est-passe' : ''}`, style: placement },
        el('span', { class: 'creneau__texte' },
          el('span', { class: 'badge-moi' }, court ? 'Toi' : 'Ta réservation'),
          el('span', { class: 'creneau__nom' }, r.prenom),
          el('span', { class: 'creneau__detail' }, plage),
        ),
        !bloc.termine &&
          el('button', {
            type: 'button',
            class: 'btn-annuler',
            dataset: { cle },
            'aria-label': `Annuler ta réservation du ${jourLongFr(jour.date)} à ${heureFr(bloc.debut)}`,
            title: 'Annuler',
            onclick: () => ouvrirAnnulation(r),
          }, icone('croix'), el('span', {}, 'Annuler')),
      );
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fenêtre de réservation
// ---------------------------------------------------------------------------
function jourDe(date) {
  return etat.donnees.jours.find((j) => j.date === date);
}

function ouvrirReservation(date, debut) {
  etat.selection = { date, debut };
  formulaire.hidden = false;
  $('confirmation').hidden = true;
  $('erreur-formulaire').textContent = '';
  champPrenom.removeAttribute('aria-invalid');
  $('prenom-erreur').textContent = '';
  if (!champPrenom.value) champPrenom.value = etat.dernierPrenom;
  formulaire.querySelector('[type="submit"]').classList.remove('est-chargement');

  // Durée par défaut : 1h si possible, sinon 30 min.
  const defaut = formulaire.querySelector('input[name="duree"][value="60"]');
  defaut.checked = true;
  majDurees();
  ouvrirFenetre(fenetreResa);
  if (!champPrenom.value) champPrenom.focus();
}

/** Active / désactive les durées selon la place disponible et le quota du prénom. */
function majDurees() {
  if (!etat.selection) return;
  const { date, debut } = etat.selection;
  const jour = jourDe(date);
  const finMax = finMaximale(jour, debut);

  const cle = cleDePrenom(champPrenom.value.trim());
  const deja = cle.length >= 2
    ? jour.reservations.filter((r) => cleDePrenom(r.prenom) === cle).reduce((t, r) => t + r.duree, 0)
    : 0;

  const radios = [...formulaire.querySelectorAll('input[name="duree"]')];
  for (const radio of radios) {
    const d = Number(radio.value);
    radio.disabled = debut + d > finMax || deja + d > MAX_PAR_PRENOM;
  }
  // Si la durée choisie devient impossible, on bascule sur la plus longue possible.
  if (radios.find((r) => r.checked)?.disabled) {
    const possible = radios.filter((r) => !r.disabled).at(-1);
    radios.forEach((r) => (r.checked = r === possible));
  }

  // Explication des durées grisées
  let info = '';
  if (deja >= MAX_PAR_PRENOM) {
    info = `${champPrenom.value.trim()} a déjà réservé 1h30 ce jour-là : c'est le maximum par jour.`;
  } else if (deja > 0 && radios.some((r) => r.disabled && debut + Number(r.value) <= finMax)) {
    info = `${champPrenom.value.trim()} a déjà ${dureeFr(deja)} ce jour-là (1h30 max par jour).`;
  } else if (finMax < debut + 90) {
    info = finMax === FERMETURE ? 'La table ferme à 21h00.' : `La table est déjà prise à ${heureFr(finMax)}.`;
  }
  $('duree-info').textContent = info;

  const choisi = radios.find((r) => r.checked);
  formulaire.querySelector('[type="submit"]').disabled = !choisi;
  majRecap($('recap-reservation'), date, debut, choisi ? Number(choisi.value) : PAS);
}

function majRecap(conteneur, date, debut, duree) {
  conteneur.querySelector('.recap__jour').textContent = jourCourtFr(date);
  const heures = conteneur.querySelector('.recap__heures');
  heures.replaceChildren(
    heureFr(debut),
    el('span', { class: 'recap__fleche', 'aria-label': 'à' }, ' → '),
    heureFr(debut + duree),
  );
}

const MOTIF_PRENOM = /^\p{L}[\p{L}\p{M} '’-]*$/u;

function validerPrenomLocal(prenom) {
  const n = [...prenom].length;
  if (n < 2 || n > 20) return 'Ton prénom doit faire entre 2 et 20 caractères.';
  if (!MOTIF_PRENOM.test(prenom)) return 'Uniquement des lettres, espaces, tirets ou apostrophes.';
  return '';
}

async function soumettre(e) {
  e.preventDefault();
  const prenom = champPrenom.value.replace(/\s+/g, ' ').trim();
  const erreurPrenom = validerPrenomLocal(prenom);
  $('prenom-erreur').textContent = erreurPrenom;
  if (erreurPrenom) {
    champPrenom.setAttribute('aria-invalid', 'true');
    champPrenom.focus();
    return;
  }
  champPrenom.removeAttribute('aria-invalid');

  const duree = Number(formulaire.querySelector('input[name="duree"]:checked')?.value);
  const { date, debut } = etat.selection;
  const bouton = formulaire.querySelector('[type="submit"]');
  bouton.classList.add('est-chargement');
  $('erreur-formulaire').textContent = '';

  try {
    const r = await requete('POST', '/api/reservations', {
      corps: { prenom, date, debut: minutesVersHhmm(debut), duree },
    });
    enregistrerJeton(r.id, { jeton: r.jeton, date, debut: r.reservation.debut, duree });
    etat.dernierPrenom = prenom;
    afficherConfirmation(r.reservation);
    charger(etat.donnees.semaine, { silencieux: true });
  } catch (err) {
    $('erreur-formulaire').textContent = err.message;
    // Le planning a changé (créneau pris, blocage…) : on le recharge et on met à jour les durées.
    if (err.statut === 409) {
      await charger(etat.donnees.semaine, { silencieux: true });
      majDurees();
    }
  } finally {
    bouton.classList.remove('est-chargement');
  }
}

function afficherConfirmation(reservation) {
  formulaire.hidden = true;
  const conf = $('confirmation');
  conf.hidden = false;
  $('confirmation-titre').textContent = `C'est réservé, ${reservation.prenom} !`;
  majRecap($('recap-confirmation'), reservation.date, hhmmVersMinutes(reservation.debut), reservation.duree);
  // Relance l'animation de la balle à chaque confirmation
  const balle = conf.querySelector('.rebond');
  balle.replaceWith(balle.cloneNode(true));
  $('confirmation-ok').focus();
}

// ---------------------------------------------------------------------------
// Annulation
// ---------------------------------------------------------------------------
function ouvrirAnnulation(reservation) {
  etat.annulation = reservation;
  const debut = hhmmVersMinutes(reservation.debut);
  majRecap($('recap-annulation'), reservation.date, debut, reservation.duree);
  $('erreur-annulation').textContent = '';
  ouvrirFenetre(fenetreAnnul);
}

async function confirmerAnnulation() {
  const r = etat.annulation;
  const bouton = $('confirmer-annulation');
  bouton.classList.add('est-chargement');
  try {
    await requete('DELETE', `/api/reservations/${encodeURIComponent(r.id)}`, {
      entetes: { 'X-Jeton-Annulation': jetonDe(r.id) || '' },
    });
    oublierJeton(r.id);
    fermerFenetre(fenetreAnnul);
    annoncer('Ta réservation est annulée. Le créneau est de nouveau libre.');
  } catch (err) {
    if (err.statut === 404 || err.statut === 403) {
      oublierJeton(r.id);
      fermerFenetre(fenetreAnnul);
      annoncer(err.message, 'erreur');
    } else {
      $('erreur-annulation').textContent = err.message;
    }
  } finally {
    bouton.classList.remove('est-chargement');
    charger(etat.donnees.semaine, { silencieux: true });
  }
}

// ---------------------------------------------------------------------------
// Navigation et initialisation
// ---------------------------------------------------------------------------
function changerSemaine(decalage) {
  const cible = ajouterJours(etat.donnees.semaine, 7 * decalage);
  charger(cible, { direction: decalage > 0 ? 'suivante' : 'precedente' });
}

$('precedente').addEventListener('click', () => changerSemaine(-1));
$('suivante').addEventListener('click', () => changerSemaine(1));
$('aujourdhui').addEventListener('click', () => {
  const { semaine, limites, maintenant } = etat.donnees;
  etat.jourActif = maintenant.date;
  if (semaine === limites.premiereSemaine) rendre();
  else charger(limites.premiereSemaine, { direction: 'precedente' });
  document.getElementById(`jour-${maintenant.date}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

preparerFenetre(fenetreResa);
preparerFenetre(fenetreAnnul);
formulaire.addEventListener('submit', soumettre);
formulaire.addEventListener('change', (e) => { if (e.target.name === 'duree') majDurees(); });
champPrenom.addEventListener('input', () => {
  if (champPrenom.getAttribute('aria-invalid')) {
    const msg = validerPrenomLocal(champPrenom.value.trim());
    $('prenom-erreur').textContent = msg;
    if (!msg) champPrenom.removeAttribute('aria-invalid');
  }
  majDurees();
});
$('confirmation-ok').addEventListener('click', () => fermerFenetre(fenetreResa));
$('confirmer-annulation').addEventListener('click', confirmerAnnulation);

// Rafraîchissement automatique : toutes les minutes quand la page est visible,
// et au retour sur l'onglet (les créneaux passés se grisent, les nouvelles réservations apparaissent).
const fenetreOuverte = () => fenetreResa.open || fenetreAnnul.open;
setInterval(() => {
  if (document.visibilityState === 'visible' && !fenetreOuverte() && etat.donnees) {
    charger(etat.donnees.semaine, { silencieux: true });
  }
}, 60_000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && etat.donnees && !fenetreOuverte()) {
    charger(etat.donnees.semaine, { silencieux: true });
  }
});

// Changement de largeur (rotation, redimensionnement) : les libellés "passé" s'adaptent.
window.matchMedia('(max-width: 899px)').addEventListener('change', () => etat.donnees && rendre());

charger();
