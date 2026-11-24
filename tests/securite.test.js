/**
 * Tests du jeton d'annulation, de l'authentification admin et de la gestion de la concurrence.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  genererJeton,
  hacher,
  verifierJeton,
  verifierAdmin,
  genererId,
  dateDepuisId,
} from '../netlify/lib/securite.js';
import { modifierJour } from '../netlify/lib/stockage.js';
import { validerReservation, ErreurMetier } from '../netlify/lib/regles.js';

describe("Jeton d'annulation", () => {
  test('long, aléatoire et unique', () => {
    const a = genererJeton();
    const b = genererJeton();
    assert.ok(a.length >= 43);
    assert.notEqual(a, b);
  });
  test('seul le hash est stocké : il ne contient pas le jeton', () => {
    const jeton = genererJeton();
    const hash = hacher(jeton);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.ok(!hash.includes(jeton));
  });
  test('le bon jeton est accepté', () => {
    const jeton = genererJeton();
    assert.equal(verifierJeton(jeton, hacher(jeton)), true);
  });
  test('un mauvais jeton, absent ou malformé est refusé', () => {
    const hash = hacher(genererJeton());
    assert.equal(verifierJeton(genererJeton(), hash), false);
    assert.equal(verifierJeton('', hash), false);
    assert.equal(verifierJeton(undefined, hash), false);
    assert.equal(verifierJeton(hash, hash), false); // envoyer le hash ne suffit pas
    assert.equal(verifierJeton(genererJeton(), undefined), false);
  });
});

describe('Identifiants', () => {
  test("la date est retrouvée depuis l'id", () => {
    const id = genererId('r', '2026-11-23');
    assert.equal(dateDepuisId(id, 'r'), '2026-11-23');
    assert.equal(dateDepuisId(id, 'b'), null);
    assert.equal(dateDepuisId('r_../../x_aaaaaaaaaaaa', 'r'), null);
  });
});

describe('Mot de passe admin', () => {
  const req = (h) => ({ headers: new Headers(h) });
  test('accepte le bon mot de passe', () => {
    assert.equal(verifierAdmin(req({ authorization: 'Bearer s3cret!' }), 's3cret!'), 'ok');
  });
  test('refuse un mauvais ou un absent', () => {
    assert.equal(verifierAdmin(req({ authorization: 'Bearer nope' }), 's3cret!'), 'refuse');
    assert.equal(verifierAdmin(req({}), 's3cret!'), 'absent');
  });
  test('désactivé si ADMIN_PASSWORD absent', () => {
    assert.equal(verifierAdmin(req({ authorization: 'Bearer x' }), ''), 'non-configure');
  });
});

describe('Concurrence : deux réservations simultanées du même créneau', () => {
  /** Faux store en mémoire qui imite les écritures conditionnelles de Netlify Blobs. */
  function fauxStore() {
    const donnees = new Map();
    let version = 0;
    return {
      async getWithMetadata(cle) {
        const e = donnees.get(cle);
        return e ? { data: structuredClone(e.valeur), etag: e.etag } : null;
      },
      async setJSON(cle, valeur, { onlyIfMatch, onlyIfNew } = {}) {
        // Laisse l'autre requête s'intercaler entre la lecture et l'écriture.
        await new Promise((r) => setTimeout(r, 5));
        const e = donnees.get(cle);
        if (onlyIfNew && e) return { modified: false };
        if (onlyIfMatch && (!e || e.etag !== onlyIfMatch)) return { modified: false };
        const etag = `"v${++version}"`;
        donnees.set(cle, { valeur: structuredClone(valeur), etag });
        return { modified: true, etag };
      },
      lire: (cle) => donnees.get(cle)?.valeur,
    };
  }

  const MAINTENANT = { date: '2026-11-21', minutes: 600 };
  const reserver = (store, prenom) =>
    modifierJour(
      '2026-11-23',
      (jour) => {
        const v = validerReservation({ prenom, date: '2026-11-23', debut: '14:00', duree: 60 }, jour, MAINTENANT);
        jour.reservations.push({ id: prenom, ...v });
        return v;
      },
      store,
    );

  test('une seule réussit, l’autre reçoit « vient d’être réservé »', async () => {
    const store = fauxStore();
    const resultats = await Promise.allSettled([reserver(store, 'Léa'), reserver(store, 'Tom')]);
    const ok = resultats.filter((r) => r.status === 'fulfilled');
    const ko = resultats.filter((r) => r.status === 'rejected');
    assert.equal(ok.length, 1);
    assert.equal(ko.length, 1);
    assert.ok(ko[0].reason instanceof ErreurMetier);
    assert.equal(ko[0].reason.code, 'pris');
    assert.equal(store.lire('2026-11-23').reservations.length, 1);
  });

  test('deux créneaux différents en même temps : les deux réussissent (retry)', async () => {
    const store = fauxStore();
    const autre = modifierJour(
      '2026-11-23',
      (jour) => {
        const v = validerReservation({ prenom: 'Tom', date: '2026-11-23', debut: '16:00', duree: 30 }, jour, MAINTENANT);
        jour.reservations.push({ id: 'Tom', ...v });
        return v;
      },
      store,
    );
    await Promise.all([reserver(store, 'Léa'), autre]);
    assert.equal(store.lire('2026-11-23').reservations.length, 2);
  });
});
