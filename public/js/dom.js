/**
 * Outils DOM partagés (planning + admin).
 * Règle de sécurité : tout texte venant des données (prénoms, motifs) passe par textContent,
 * jamais par innerHTML. Seules les icônes SVG ci-dessous — des constantes — sont injectées en HTML.
 */

const ICONES = {
  // Raquette : palette pleine + manche épais (lisible, ne ressemble pas à une loupe) + balle
  raquette:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13.6 15.4 2.1-2.1 5.6 5.6a1.5 1.5 0 0 1-2.1 2.1z" fill="currentColor"/><circle cx="9.5" cy="9.5" r="7" fill="currentColor"/><circle cx="20" cy="4.2" r="2.2" fill="currentColor" opacity=".55"/></svg>',
  cadenas:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>',
  croix:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  chevron:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
  coche:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  alerte:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/></svg>',
  poubelle:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/></svg>',
};

/** Crée un élément SVG d'icône. */
export function icone(nom) {
  const t = document.createElement('template');
  t.innerHTML = ICONES[nom];
  return t.content.firstElementChild;
}

/**
 * Fabrique un élément : el('button', { class: 'btn', onclick: fn, 'aria-label': '…' }, 'texte', autreNoeud)
 * Les chaînes enfants deviennent des nœuds texte (donc échappées automatiquement).
 */
export function el(balise, attributs = {}, ...enfants) {
  const noeud = document.createElement(balise);
  for (const [cle, valeur] of Object.entries(attributs)) {
    if (valeur === false || valeur == null) continue;
    if (cle.startsWith('on') && typeof valeur === 'function') noeud.addEventListener(cle.slice(2), valeur);
    else if (cle === 'class') noeud.className = valeur;
    else if (cle === 'dataset') Object.assign(noeud.dataset, valeur);
    else if (cle === 'style') Object.assign(noeud.style, valeur);
    else noeud.setAttribute(cle, valeur === true ? '' : String(valeur));
  }
  for (const enfant of enfants.flat()) {
    if (enfant == null || enfant === false) continue;
    noeud.append(enfant instanceof Node ? enfant : document.createTextNode(String(enfant)));
  }
  return noeud;
}

/** Message éphémère, lu par les lecteurs d'écran (zone aria-live #annonces). */
export function annoncer(message, type = 'info') {
  const zone = document.getElementById('annonces');
  if (!zone) return;
  const a = el('div', { class: `annonce${type === 'erreur' ? ' est-erreur' : ''}` },
    icone(type === 'erreur' ? 'alerte' : 'coche'),
    el('span', {}, message),
  );
  zone.append(a);
  setTimeout(() => {
    a.classList.add('est-sortie');
    a.addEventListener('animationend', () => a.remove(), { once: true });
    setTimeout(() => a.remove(), 400);
  }, type === 'erreur' ? 6500 : 4500);
}

/** Ouvre un <dialog> en modale, avec fermeture animée (Échap, clic sur le fond, boutons [data-fermer]). */
export function preparerFenetre(fenetre) {
  fenetre.addEventListener('cancel', (e) => {
    e.preventDefault();
    fermerFenetre(fenetre);
  });
  fenetre.addEventListener('click', (e) => {
    if (e.target === fenetre) fermerFenetre(fenetre); // clic sur le fond
    if (e.target.closest('[data-fermer]')) fermerFenetre(fenetre);
  });
}

export function ouvrirFenetre(fenetre) {
  fenetre.classList.remove('est-fermeture');
  fenetre.showModal();
}

export function fermerFenetre(fenetre) {
  if (!fenetre.open || fenetre.classList.contains('est-fermeture')) return;
  fenetre.classList.add('est-fermeture');
  const fin = () => {
    fenetre.classList.remove('est-fermeture');
    fenetre.close();
  };
  const minuteur = setTimeout(fin, 260); // filet de sécurité si l'animation ne se déclenche pas
  fenetre.addEventListener('animationend', () => { clearTimeout(minuteur); fin(); }, { once: true });
}
