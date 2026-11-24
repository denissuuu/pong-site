# 🏓 Ping-pong · Saulnières

Site de réservation de la table de ping-pong de la commune de Saulnières.

- **Rapide et léger** : HTML, CSS et JavaScript sans framework, illustrations en SVG.
- **Gratuit à héberger** : Netlify (site statique + Netlify Functions).
- **Sans base de données** : les réservations sont stockées en JSON dans **Netlify Blobs**.
- **Sans compte ni code** : on réserve avec son prénom ; l'annulation se fait depuis le même navigateur.

---

## Sommaire

1. [Fonctionnalités](#fonctionnalités)
2. [Structure du projet](#structure-du-projet)
3. [Installation](#installation)
4. [Lancement en local](#lancement-en-local)
5. [Tests](#tests)
6. [Déploiement sur Netlify, étape par étape](#déploiement-sur-netlify-étape-par-étape)
7. [Guide de la page admin (mairie)](#guide-de-la-page-admin-mairie)
8. [API](#api)
9. [Sécurité, limites connues et choix techniques](#sécurité-limites-connues-et-choix-techniques)
10. [Personnalisation](#personnalisation)

---

## Fonctionnalités

**Pour le public**
- Planning de la semaine : la grille des 7 jours sur ordinateur, un jour à la fois avec des onglets sur téléphone.
- Créneaux de 30 min, de 10h00 à 21h00, tous les jours (heure de Paris).
- Réservation de 30 min, 1h ou 1h30, jusqu'à 3 semaines à l'avance.
- Maximum 1h30 par prénom et par jour. La comparaison ignore les majuscules, les accents et les espaces.
- Annulation en un clic depuis le navigateur qui a fait la réservation (jeton secret).
- Mode sombre automatique, accessible au clavier et aux lecteurs d'écran, animations désactivées si le système le demande.

**Pour la mairie** (`/admin.html`)
- Voir toutes les réservations, filtrer par date ou par prénom, en supprimer.
- Bloquer un créneau ou une journée entière avec un motif (« Entretien de la table »…).
- Être prévenue si un blocage recouvre des réservations existantes.

**Automatique**
- Les réservations sont supprimées 7 jours après le créneau, chaque nuit, par une fonction planifiée.
- Un même navigateur ne peut pas créer plus de 10 réservations par minute.
- Le mot de passe admin est bloqué après 10 essais ratés par minute.

---

## Structure du projet

```
ping-pong/
├── netlify.toml                 # Configuration Netlify (dossier publié, fonctions, en-têtes de sécurité)
├── package.json                 # Une seule dépendance : @netlify/blobs
├── .env.example                 # Modèle pour ADMIN_PASSWORD en local
├── public/                      # Le site (servi tel quel, aucune étape de build)
│   ├── index.html               # Planning public
│   ├── admin.html               # Espace mairie
│   ├── css/  base.css · planning.css · admin.css
│   ├── js/   dates.js · api.js · dom.js · jetons.js · planning.js · admin.js
│   ├── favicon.svg · apple-touch-icon.png · og-image.png
├── netlify/
│   ├── lib/                     # Code partagé par les fonctions
│   │   ├── regles.js            # Règles métier (fonctions pures, testées)
│   │   ├── temps-paris.js       # Heure de Paris (le serveur tourne en UTC)
│   │   ├── stockage.js          # Netlify Blobs + écritures conditionnelles (ETag) avec retry
│   │   ├── securite.js          # Jetons, SHA-256, mot de passe admin
│   │   ├── limite-debit.js      # Anti-abus (compteurs par IP hachée)
│   │   └── reponses.js          # Réponses JSON et messages d'erreur
│   └── functions/
│       ├── reservations.mjs     # API publique
│       ├── admin.mjs            # API mairie
│       └── nettoyage.mjs        # Fonction planifiée (chaque nuit)
└── tests/                       # Tests (node:test, aucune dépendance)
```

---

## Installation

Prérequis :

- [Node.js](https://nodejs.org) **20 ou plus** : `node -v` pour vérifier.
- La CLI Netlify, installée une seule fois sur l'ordinateur :

```bash
npm install -g netlify-cli
```

Dans le dossier du projet :

```bash
npm install
cp .env.example .env      # puis ouvre .env et choisis un mot de passe admin
```

## Lancement en local

```bash
netlify dev
```

Ouvre ensuite <http://localhost:8888> (planning) et <http://localhost:8888/admin.html> (mairie, avec le mot de passe de ton fichier `.env`).

En local, les réservations sont stockées dans le dossier `.netlify/`, sur ton ordinateur, et non en ligne. Supprime ce dossier pour repartir de zéro.

Pour lancer la fonction de nettoyage à la main :

```bash
netlify functions:invoke nettoyage
```

## Tests

```bash
npm test
```

44 tests couvrent :

- chevauchements entre réservations et avec les blocages ;
- limites horaires (10h00–21h00, grille de 30 min, fin au plus tard à 21h00) et durées ;
- passé, et maximum 3 semaines à l'avance ;
- **1h30 maximum par prénom et par jour** (majuscules, accents, espaces) ;
- **fuseau horaire** : serveur en UTC, logique en heure de Paris, passages à l'heure d'été et d'hiver ;
- **jeton d'annulation** : bon jeton, mauvais jeton, absent, hash envoyé à la place du jeton ;
- **concurrence** : deux personnes réservent le même créneau au même instant, une seule réussit.

---

## Déploiement sur Netlify, étape par étape

### 1. Mettre le code sur GitHub

1. Crée un compte sur <https://github.com> si besoin, puis un **nouveau dépôt** (par exemple `ping-pong-saulnieres`), privé ou public.
2. Dans le dossier du projet :

   ```bash
   git init
   git add .
   git commit -m "Site de réservation de la table de ping-pong"
   git branch -M main
   git remote add origin https://github.com/TON-COMPTE/ping-pong-saulnieres.git
   git push -u origin main
   ```

   Le fichier `.env`, qui contient ton mot de passe, n'est **pas** envoyé : il est listé dans `.gitignore`.

### 2. Créer le site sur Netlify

1. Crée un compte gratuit sur <https://app.netlify.com>. Le plus simple est de se connecter **avec GitHub**.
2. Clique sur **Add new project → Import an existing project → GitHub**, autorise Netlify, puis choisis le dépôt.
3. Les réglages sont lus dans `netlify.toml`, il n'y a rien à changer :
   - *Build command* : vide
   - *Publish directory* : `public`
   - *Functions directory* : `netlify/functions`
4. Clique sur **Deploy**.

### 3. Définir le mot de passe admin

1. Dans le projet Netlify : **Project configuration → Environment variables → Add a variable**.
2. *Key* : `ADMIN_PASSWORD`. *Value* : un mot de passe **long et unique**, par exemple une phrase de 4 ou 5 mots.
3. Cette variable doit être disponible pour les **Functions**. C'est le cas par défaut avec « All scopes ».
4. Relance un déploiement : **Deploys → Trigger deploy → Deploy project**. Les variables ne sont prises en compte qu'au déploiement suivant.

Tant que `ADMIN_PASSWORD` n'est pas définie, la page admin affiche « L'administration n'est pas configurée ».

### 4. Vérifier

- Ouvre l'adresse donnée par Netlify (`https://xxxx.netlify.app`) et fais une réservation de test, puis annule-la.
- Ouvre `/admin.html` et connecte-toi.
- Dans **Logs → Functions**, la fonction `nettoyage` apparaît comme planifiée (`@daily`).
- Netlify Blobs est activé automatiquement, il n'y a rien à configurer. Le contenu est visible dans **Blobs**, store `reservations`.

### 5. (Facultatif) Nom de domaine et aperçu de partage

- **Domain management** permet de renommer le sous-domaine (par exemple `pingpong-saulnieres.netlify.app`) ou d'utiliser un domaine de la commune.
- Pour que l'aperçu s'affiche partout (Facebook, WhatsApp…), remplace dans `public/index.html` la balise `og:image` par l'adresse complète, par exemple `https://pingpong-saulnieres.netlify.app/og-image.png`. Certains réseaux n'acceptent pas les chemins relatifs.

Chaque `git push` sur `main` redéploie le site automatiquement.

---

## Guide de la page admin (mairie)

Adresse : **`https://<votre-site>/admin.html`**. Elle n'est pas indexée par les moteurs de recherche.

1. **Connexion** : saisis le mot de passe (`ADMIN_PASSWORD`). Il est retenu jusqu'à la fermeture de l'onglet, jamais au-delà. Le bouton « Se déconnecter » l'efface immédiatement.
2. **En bref** : nombre de réservations aujourd'hui, à venir, et nombre de blocages actifs.
3. **Réservations** :
   - liste groupée par jour, des plus proches aux plus lointaines ;
   - filtre par **date** ou par **prénom** ; la case « Afficher les réservations passées » montre aussi les 7 derniers jours ;
   - **Supprimer** demande une confirmation : clique une seconde fois sur « Confirmer ? » dans les 4 secondes.
4. **Bloquer la table** :
   - choisis la date, puis « Toute la journée » ou une plage horaire (de… à…) ;
   - indique un **motif**, affiché au public sur le planning : « Entretien de la table », « Événement municipal », « Intempéries »… ;
   - si des réservations existent déjà sur cette plage, elles sont listées : elles restent valables tant que tu ne les supprimes pas. Pense à prévenir les personnes si tu le peux.
   - Pour lever un blocage : **Supprimer** dans « Blocages à venir ».
5. **Quelqu'un a réservé depuis un autre appareil et veut annuler** : retrouve la réservation par date ou par prénom et supprime-la. Le site invite ces personnes à contacter la mairie.

**Changer le mot de passe** : modifie `ADMIN_PASSWORD` sur Netlify, puis redéploie (étape 3). Les sessions ouvertes sont déconnectées à la requête suivante.

---

## API

| Méthode | Route | Description |
|---|---|---|
| `GET` | `/api/reservations?semaine=YYYY-MM-DD` | Réservations et blocages de la semaine (lundi → dimanche) contenant la date. Sans paramètre : la semaine en cours. |
| `POST` | `/api/reservations` | Corps `{ prenom, date, debut: "HH:MM", duree: 30\|60\|90 }`. Renvoie `{ id, jeton, reservation }`. |
| `DELETE` | `/api/reservations/:id` | En-tête `X-Jeton-Annulation: <jeton>`. |
| `GET` | `/api/admin/reservations` | En-tête `Authorization: Bearer <ADMIN_PASSWORD>`. Tout voir. |
| `DELETE` | `/api/admin/reservations/:id` | Supprimer une réservation. |
| `POST` | `/api/admin/blocages` | `{ date, journee: true }` ou `{ date, debut, fin, motif }`. Renvoie le blocage et les réservations en conflit. |
| `DELETE` | `/api/admin/blocages/:id` | Supprimer un blocage. |

Les erreurs ont toujours la forme `{ "erreur": "message en français", "code": "…" }`, avec le statut HTTP adapté : 400, 401, 403, 404, 409, 429 ou 503.

---

## Sécurité, limites connues et choix techniques

**Le serveur revalide tout.** Format, horaires, durée, passé, horizon de 3 semaines, chevauchements, blocages et quota par prénom sont revérifiés côté serveur, dans `netlify/lib/regles.js`.

**Fuseau horaire.** Les fonctions Netlify tournent en UTC. « Maintenant » est converti explicitement en heure de Paris avec `Intl` (`Europe/Paris`), puis toute la logique travaille en heure locale parisienne. Les changements d'heure ont lieu entre 2h et 3h du matin, hors des horaires d'ouverture : aucun créneau n'est ambigu. Le navigateur utilise l'heure de Paris fournie par le serveur, pas celle de l'appareil.

**Stockage.** Il y a une clé par jour (`2026-11-23`) dans le store `reservations`, contenant `{ reservations, blocages }`. Les documents restent petits, et un seul document suffit pour vérifier puis écrire.

**Réservations simultanées.** Chaque écriture est **conditionnelle** :
1. on lit le jour et son ETag ;
2. on revalide toutes les règles ;
3. on écrit avec `onlyIfMatch: etag`, ou `onlyIfNew` si le jour n'existe pas encore ;
4. si quelqu'un a écrit entre-temps, on recommence, jusqu'à 5 fois.

Le second arrivant reçoit « Ce créneau vient d'être réservé par quelqu'un d'autre ». Les lectures utilisent la cohérence forte (`consistency: 'strong'`).

> **Limite connue (développement uniquement)** : le simulateur Blobs de `netlify dev` ne renvoie pas d'ETag en lecture. En local, les mises à jour d'un jour existant se font donc sans condition, et un avertissement s'affiche dans la console. En production, Netlify renvoie bien les ETag et la protection est complète.
>
> **Particularité de `netlify dev`** : quand une fonction répond 4xx, la CLI rejoue la requête sur des variantes d'URL (`.html`, `/index.html`). C'est pourquoi les fonctions lisent l'identifiant directement dans le chemin (`idDepuisChemin`), de façon tolérante.

**Annulation sans compte.**
- À la création, le serveur génère un jeton aléatoire de 256 bits et le renvoie une seule fois.
- Le serveur ne stocke que son **hash SHA-256**. La vérification se fait à temps constant.
- Le navigateur garde le jeton dans `localStorage` et l'efface quand la réservation est passée ou a disparu.
- Le hash n'est **jamais** renvoyé par l'API publique.

**Anti-abus.**
- Au plus 10 créations par minute et par IP, et au plus 10 mauvais mots de passe admin par minute et par IP.
- Les IP sont **hachées** avant stockage, dans le store `limites`, purgé chaque nuit.
- Le comptage est volontairement approximatif : il freine les abus, il ne remplace pas un pare-feu.

**Prénoms.**
- Le serveur retire le HTML et les caractères de contrôle, puis n'accepte que des lettres, espaces, tirets et apostrophes, sur 2 à 20 caractères.
- À l'affichage, le texte est toujours inséré via `textContent`, jamais via `innerHTML`.
- Une politique CSP stricte, définie dans `netlify.toml`, interdit les scripts en ligne et les ressources externes, à l'exception de Google Fonts.

**RGPD.** Seul le prénom est collecté, il est supprimé 7 jours après le créneau, et il n'y a ni cookie ni mesure d'audience. Le pied de page l'explique.

**Performances.** Mesurées avec Lighthouse 13 en local :

| Page | Performance | Accessibilité | Bonnes pratiques | SEO |
|---|---|---|---|---|
| Planning, mobile | 99 | 100 | 100 | 100 |
| Planning, ordinateur | 100 | 100 | 100 | 100 |

La page admin obtient 100 / 100 / 100 sur les trois premiers critères. Son score SEO est volontairement bas, car elle est marquée `noindex`.

---

## Personnalisation

- **Textes, nom de la commune** : `public/index.html` (en-tête, pied de page, balises de partage).
- **Couleurs et polices** : variables CSS en haut de `public/css/base.css` (`--table`, `--balle`, `--fond`…), avec la version sombre juste en dessous.
- **Règles** (horaires, durées, quota, horizon, conservation) : constantes en haut de `netlify/lib/regles.js`. Les constantes équivalentes côté navigateur sont dans `public/js/dates.js`.
- **Image de partage** : `public/og-image.png` (1200×630).
