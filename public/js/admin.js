/**
 * Interface admin (mairie).
 * Le mot de passe est saisi par l'utilisateur, envoyé dans l'en-tête Authorization,
 * et conservé uniquement en sessionStorage (effacé à la fermeture de l'onglet).
 * Il n'est jamais écrit dans le code.
 */

import { OUVERTURE, FERMETURE, PAS, heureFr, dureeFr, jourLongFr, hhmmVersMinutes, minutesVersHhmm } from './dates.js';
import { requete } from './api.js';
import { el, icone, annoncer } from './dom.js';

const CLE_SESSION = 'pingpong-saulnieres.admin';
const $ = (id) => document.getElementById(id);

const etat = { motDePasse: null, donnees: null };

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------
function lireSession() {
  try { return sessionStorage.getItem(CLE_SESSION); } catch { return null; }
}
function ecrireSession(valeur) {
  try {
    if (valeur) sessionStorage.setItem(CLE_SESSION, valeur);
    else sessionStorage.removeItem(CLE_SESSION);
  } catch { /* indisponible : il faudra se reconnecter à chaque visite */ }
}

/** Requête authentifiée ; en cas de 401 on revient à l'écran de connexion. */
async function api(methode, url, corps) {
  try {
    return await requete(methode, url, { corps, entetes: { Authorization: `Bearer ${etat.motDePasse}` } });
  } catch (e) {
    if (e.statut === 401) {
      deconnecter();
      $('erreur-connexion').textContent = 'Session expirée ou mot de passe modifié. Reconnecte-toi.';
    }
    throw e;
  }
}

function afficherEcran(connecte) {
  $('ecran-connexion').hidden = connecte;
  $('ecran-admin').hidden = !connecte;
  $('deconnexion').hidden = !connecte;
}

function deconnecter() {
  etat.motDePasse = null;
  etat.donnees = null;
  ecrireSession(null);
  afficherEcran(false);
  $('mot-de-passe').value = '';
}

async function connecter(motDePasse) {
  etat.motDePasse = motDePasse;
  etat.donnees = await requete('GET', '/api/admin/reservations', {
    entetes: { Authorization: `Bearer ${motDePasse}` },
  });
  ecrireSession(motDePasse);
  afficherEcran(true);
  initialiserFormulaireBlocage();
  rendre();
}

// ---------------------------------------------------------------------------
// Chargement et rendu
// ---------------------------------------------------------------------------
async function recharger() {
  etat.donnees = await api('GET', '/api/admin/reservations');
  rendre();
}

const estTerminee = (r, m) => {
  const fin = hhmmVersMinutes(r.debut) + r.duree;
  return r.date < m.date || (r.date === m.date && fin <= hhmmVersMinutes(m.heure));
};

function rendre() {
  const { reservations, blocages, maintenant } = etat.donnees;

  // Résumé
  $('stat-aujourdhui').textContent = reservations.filter((r) => r.date === maintenant.date).length;
  $('stat-avenir').textContent = reservations.filter((r) => !estTerminee(r, maintenant)).length;
  const blocagesActifs = blocages.filter((b) => b.date >= maintenant.date);
  $('stat-blocages').textContent = blocagesActifs.length;

  rendreBlocages(blocagesActifs);
  rendreReservations();
}

function rendreBlocages(blocages) {
  const liste = $('liste-blocages');
  if (!blocages.length) {
    liste.replaceChildren(el('li', { class: 'vide' }, 'Aucun blocage prévu.'));
    return;
  }
  liste.replaceChildren(...blocages.map((b) =>
    el('li', { class: 'ligne ligne--blocage' },
      el('span', { class: 'ligne__heure' }, b.journee ? 'Journée' : `${heureFr(b.debut)} – ${heureFr(b.fin)}`),
      el('span', { class: 'ligne__texte' },
        el('span', { class: 'ligne__titre' }, b.motif),
        el('span', { class: 'ligne__meta' }, majuscule(jourLongFr(b.date))),
      ),
      boutonSupprimer(`le blocage « ${b.motif} » du ${jourLongFr(b.date)}`, async (ligne) => {
        await api('DELETE', `/api/admin/blocages/${encodeURIComponent(b.id)}`);
        await retirerLigne(ligne);
        annoncer('Blocage supprimé.');
        await recharger();
      }),
    ),
  ));
}

function rendreReservations() {
  const { reservations, maintenant } = etat.donnees;
  const filtreDate = $('filtre-date').value;
  const filtrePrenom = normaliser($('filtre-prenom').value.trim());
  const avecPassees = $('filtre-passees').checked;

  const visibles = reservations.filter((r) =>
    (!filtreDate || r.date === filtreDate) &&
    (!filtrePrenom || normaliser(r.prenom).includes(filtrePrenom)) &&
    (avecPassees || filtreDate || !estTerminee(r, maintenant)),
  );

  const conteneur = $('liste-reservations');
  if (!visibles.length) {
    conteneur.replaceChildren(el('div', { class: 'vide' }, icone('raquette'),
      filtreDate || filtrePrenom ? 'Aucune réservation ne correspond à ces filtres.' : 'Aucune réservation à venir.'));
    return;
  }

  // Regroupement par jour
  const parJour = Map.groupBy
    ? Map.groupBy(visibles, (r) => r.date)
    : visibles.reduce((m, r) => m.set(r.date, [...(m.get(r.date) || []), r]), new Map());

  conteneur.replaceChildren(...[...parJour].map(([date, liste]) =>
    el('section', { class: `groupe-jour${date === maintenant.date ? ' est-aujourdhui' : ''}` },
      el('h3', {},
        date === maintenant.date ? `Aujourd'hui, ${jourLongFr(date)}` : majuscule(jourLongFr(date)),
        el('span', { class: 'compte' }, `${liste.length} réservation${liste.length > 1 ? 's' : ''}`),
      ),
      el('ul', { class: 'liste' }, liste.map((r) => ligneReservation(r, maintenant))),
    ),
  ));
}

function ligneReservation(r, maintenant) {
  const debut = hhmmVersMinutes(r.debut);
  const creeLe = r.creeLe ? new Date(r.creeLe).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' }) : '';
  return el('li', { class: `ligne${estTerminee(r, maintenant) ? ' est-passee' : ''}` },
    el('span', { class: 'ligne__heure' }, `${heureFr(debut)} – ${heureFr(debut + r.duree)}`),
    el('span', { class: 'ligne__texte' },
      el('span', { class: 'ligne__titre' }, r.prenom),
      el('span', { class: 'ligne__meta' }, `${dureeFr(r.duree)}${creeLe ? ` · réservé le ${creeLe}` : ''}`),
    ),
    boutonSupprimer(`la réservation de ${r.prenom} (${jourLongFr(r.date)}, ${heureFr(debut)})`, async (ligne) => {
      await api('DELETE', `/api/admin/reservations/${encodeURIComponent(r.id)}`);
      await retirerLigne(ligne);
      annoncer(`Réservation de ${r.prenom} supprimée.`);
      await recharger();
    }),
  );
}

/**
 * Bouton de suppression en deux temps : un premier clic demande confirmation,
 * le second supprime. Sans réponse en 4 s, le bouton revient à son état initial.
 */
function boutonSupprimer(description, action) {
  let minuteur = null;
  const libelle = el('span', {}, 'Supprimer');
  const bouton = el('button', {
    type: 'button',
    class: 'btn-supprimer',
    'aria-label': `Supprimer ${description}`,
    onclick: async () => {
      if (!bouton.classList.contains('est-confirmation')) {
        bouton.classList.add('est-confirmation');
        libelle.textContent = 'Confirmer ?';
        bouton.setAttribute('aria-label', `Confirmer la suppression de ${description}`);
        minuteur = setTimeout(reinitialiser, 4000);
        return;
      }
      clearTimeout(minuteur);
      bouton.disabled = true;
      try {
        await action(bouton.closest('li'));
      } catch (e) {
        annoncer(e.message, 'erreur');
        reinitialiser();
        bouton.disabled = false;
      }
    },
  }, icone('poubelle'), libelle);

  function reinitialiser() {
    bouton.classList.remove('est-confirmation');
    libelle.textContent = 'Supprimer';
    bouton.setAttribute('aria-label', `Supprimer ${description}`);
  }
  return bouton;
}

function retirerLigne(ligne) {
  return new Promise((resolve) => {
    if (!ligne) return resolve();
    ligne.classList.add('est-sortie');
    setTimeout(resolve, 220);
  });
}

// ---------------------------------------------------------------------------
// Formulaire de blocage
// ---------------------------------------------------------------------------
let formulaireInitialise = false;
function initialiserFormulaireBlocage() {
  const aujourdhui = etat.donnees.maintenant.date;
  $('blocage-date').min = aujourdhui;
  if (!$('blocage-date').value) $('blocage-date').value = aujourdhui;
  if (formulaireInitialise) return;
  formulaireInitialise = true;

  const options = (de, a, selection) => {
    const liste = [];
    for (let m = de; m <= a; m += PAS) {
      liste.push(el('option', { value: minutesVersHhmm(m), selected: m === selection }, heureFr(m)));
    }
    return liste;
  };
  $('blocage-debut').replaceChildren(...options(OUVERTURE, FERMETURE - PAS, 14 * 60));
  $('blocage-fin').replaceChildren(...options(OUVERTURE + PAS, FERMETURE, 16 * 60));

  $('blocage-journee').addEventListener('change', (e) => {
    $('blocage-horaires').hidden = e.target.checked;
  });

  $('form-blocage').addEventListener('submit', async (e) => {
    e.preventDefault();
    const bouton = e.submitter || $('form-blocage').querySelector('[type="submit"]');
    $('erreur-blocage').textContent = '';
    $('conflits').hidden = true;
    bouton.classList.add('est-chargement');
    try {
      const journee = $('blocage-journee').checked;
      const resultat = await api('POST', '/api/admin/blocages', {
        date: $('blocage-date').value,
        journee,
        debut: journee ? undefined : $('blocage-debut').value,
        fin: journee ? undefined : $('blocage-fin').value,
        motif: $('blocage-motif').value,
      });
      annoncer('Blocage enregistré.');
      await recharger();
      afficherConflits(resultat.conflits);
    } catch (err) {
      $('erreur-blocage').textContent = err.message;
    } finally {
      bouton.classList.remove('est-chargement');
    }
  });
}

/** Réservations déjà présentes sur la plage bloquée : la mairie décide quoi en faire. */
function afficherConflits(conflits) {
  const zone = $('conflits');
  if (!conflits?.length) { zone.hidden = true; return; }
  zone.replaceChildren(
    el('p', {}, el('strong', {}, `${conflits.length} réservation${conflits.length > 1 ? 's' : ''} déjà présente${conflits.length > 1 ? 's' : ''} sur cette plage.`),
      ' Elles restent valables tant que tu ne les supprimes pas :'),
    el('ul', { class: 'liste' }, conflits.map((r) => ligneReservation(r, etat.donnees.maintenant))),
  );
  zone.hidden = false;
}

// ---------------------------------------------------------------------------
// Divers
// ---------------------------------------------------------------------------
const majuscule = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const normaliser = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------
$('form-connexion').addEventListener('submit', async (e) => {
  e.preventDefault();
  const mdp = $('mot-de-passe').value;
  const bouton = e.submitter;
  $('erreur-connexion').textContent = '';
  if (!mdp) {
    $('erreur-connexion').textContent = 'Saisis le mot de passe.';
    return;
  }
  bouton?.classList.add('est-chargement');
  try {
    await connecter(mdp);
    $('contenu').focus();
  } catch (err) {
    etat.motDePasse = null;
    $('erreur-connexion').textContent = err.message;
    $('mot-de-passe').select();
  } finally {
    bouton?.classList.remove('est-chargement');
  }
});

$('deconnexion').addEventListener('click', deconnecter);
$('rafraichir').addEventListener('click', () => recharger().then(() => annoncer('Liste à jour.')).catch((e) => annoncer(e.message, 'erreur')));
for (const id of ['filtre-date', 'filtre-prenom', 'filtre-passees']) {
  $(id).addEventListener('input', () => etat.donnees && rendreReservations());
}

// Reconnexion automatique si une session est ouverte dans cet onglet
const session = lireSession();
if (session) {
  connecter(session).catch(() => {
    ecrireSession(null);
    afficherEcran(false);
  });
}
