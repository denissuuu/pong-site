/**
 * Tests des règles de réservation. Lancer avec : npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  validerReservation,
  validerBlocage,
  nettoyerPrenom,
  cleDePrenom,
  chevauche,
  ErreurMetier,
  jourExpire,
} from '../netlify/lib/regles.js';

// "Maintenant" fixe : samedi 21 novembre 2026, 12h00 à Paris.
const MAINTENANT = { date: '2026-11-21', minutes: 12 * 60 };
const vide = () => ({ reservations: [], blocages: [] });

/** Vérifie qu'une validation échoue avec le code attendu. */
function echoue(fn, code) {
  assert.throws(fn, (e) => e instanceof ErreurMetier && e.code === code, `code attendu : ${code}`);
}

const demande = (extra = {}) => ({ prenom: 'Léa', date: '2026-11-23', debut: '14:00', duree: 60, ...extra });
const resa = (prenom, debut, duree, date = '2026-11-23') => ({ id: `r_${prenom}${debut}`, prenom, date, debut, duree });

describe('Chevauchements', () => {
  test('intervalles qui se touchent ne se chevauchent pas', () => {
    assert.equal(chevauche(600, 660, 660, 720), false);
    assert.equal(chevauche(660, 720, 600, 660), false);
  });
  test('intervalles qui se recouvrent', () => {
    assert.equal(chevauche(600, 690, 660, 720), true);
    assert.equal(chevauche(600, 720, 630, 660), true); // inclus
  });
  test('refuse une réservation qui recouvre une autre', () => {
    const jour = { reservations: [resa('Tom', '14:30', 60)], blocages: [] };
    echoue(() => validerReservation(demande({ debut: '14:00', duree: 60 }), jour, MAINTENANT), 'pris');
    echoue(() => validerReservation(demande({ debut: '15:00', duree: 30 }), jour, MAINTENANT), 'pris');
  });
  test('accepte une réservation juste avant / juste après', () => {
    const jour = { reservations: [resa('Tom', '14:30', 60)], blocages: [] };
    assert.ok(validerReservation(demande({ debut: '14:00', duree: 30 }), jour, MAINTENANT));
    assert.ok(validerReservation(demande({ debut: '15:30', duree: 90 }), jour, MAINTENANT));
  });
  test('refuse un créneau bloqué par la mairie', () => {
    const jour = { reservations: [], blocages: [{ id: 'b', date: '2026-11-23', debut: '13:00', fin: '15:00', motif: 'Entretien de la table' }] };
    echoue(() => validerReservation(demande({ debut: '14:30', duree: 30 }), jour, MAINTENANT), 'bloque');
    assert.ok(validerReservation(demande({ debut: '15:00', duree: 30 }), jour, MAINTENANT));
  });
});

describe('Limites horaires et durées', () => {
  test('premier créneau 10h00, dernier début 20h30', () => {
    assert.ok(validerReservation(demande({ debut: '10:00', duree: 30 }), vide(), MAINTENANT));
    assert.ok(validerReservation(demande({ debut: '20:30', duree: 30 }), vide(), MAINTENANT));
  });
  test('refuse avant 10h et à partir de 21h', () => {
    echoue(() => validerReservation(demande({ debut: '09:30' }), vide(), MAINTENANT), 'debut');
    echoue(() => validerReservation(demande({ debut: '21:00', duree: 30 }), vide(), MAINTENANT), 'debut');
  });
  test('refuse un début hors grille de 30 minutes', () => {
    echoue(() => validerReservation(demande({ debut: '14:15' }), vide(), MAINTENANT), 'debut');
    echoue(() => validerReservation(demande({ debut: '14h00' }), vide(), MAINTENANT), 'debut');
  });
  test('refuse une fin après 21h00', () => {
    echoue(() => validerReservation(demande({ debut: '20:30', duree: 60 }), vide(), MAINTENANT), 'duree');
    echoue(() => validerReservation(demande({ debut: '20:00', duree: 90 }), vide(), MAINTENANT), 'duree');
    assert.ok(validerReservation(demande({ debut: '19:30', duree: 90 }), vide(), MAINTENANT));
  });
  test('refuse les durées non autorisées', () => {
    for (const duree of [0, 15, 45, 120, '60abc', null]) {
      echoue(() => validerReservation(demande({ duree }), vide(), MAINTENANT), 'duree');
    }
  });
});

describe('Passé et horizon de 3 semaines', () => {
  test('refuse un jour passé', () => {
    echoue(() => validerReservation(demande({ date: '2026-11-20' }), vide(), MAINTENANT), 'passe');
  });
  test("refuse un créneau d'aujourd'hui déjà commencé", () => {
    const aujourdhui = { date: '2026-11-21', minutes: 14 * 60 + 10 };
    echoue(() => validerReservation(demande({ date: '2026-11-21', debut: '14:00' }), vide(), aujourdhui), 'passe');
    assert.ok(validerReservation(demande({ date: '2026-11-21', debut: '14:30' }), vide(), aujourdhui));
  });
  test("accepte jusqu'à J+21, refuse J+22", () => {
    assert.ok(validerReservation(demande({ date: '2026-12-12' }), vide(), MAINTENANT));
    echoue(() => validerReservation(demande({ date: '2026-12-13' }), vide(), MAINTENANT), 'trop-loin');
  });
  test('refuse une date impossible', () => {
    echoue(() => validerReservation(demande({ date: '2026-02-30' }), vide(), MAINTENANT), 'date');
  });
});

describe('1h30 maximum par prénom et par jour', () => {
  test('refuse au-delà de 1h30 cumulées', () => {
    const jour = { reservations: [resa('Léa', '10:00', 60)], blocages: [] };
    assert.ok(validerReservation(demande({ debut: '16:00', duree: 30 }), jour, MAINTENANT));
    echoue(() => validerReservation(demande({ debut: '16:00', duree: 60 }), jour, MAINTENANT), 'quota');
  });
  test('comparaison insensible à la casse, aux accents et aux espaces', () => {
    const jour = { reservations: [resa('Léa Marie', '10:00', 90)], blocages: [] };
    for (const prenom of ['lea marie', 'LÉA MARIE', 'Leamarie', '  lea   MARIE ']) {
      echoue(() => validerReservation(demande({ prenom, duree: 30 }), jour, MAINTENANT), 'quota');
    }
  });
  test('un autre prénom ou un autre jour reste possible', () => {
    const jour = { reservations: [resa('Léa', '10:00', 90)], blocages: [] };
    assert.ok(validerReservation(demande({ prenom: 'Tom' }), jour, MAINTENANT));
    assert.ok(validerReservation(demande({ date: '2026-11-24' }), vide(), MAINTENANT));
  });
});

describe('Prénom', () => {
  test('nettoyage : HTML retiré, espaces compactés', () => {
    assert.equal(nettoyerPrenom('  <b>Jean</b>   Marc '), 'Jean Marc');
    assert.equal(nettoyerPrenom('D’Artagnan'), "D'Artagnan");
  });
  test('clé de comparaison', () => {
    assert.equal(cleDePrenom('Éloïse'), cleDePrenom('eloise'));
    assert.equal(cleDePrenom('Jean Marc'), 'jeanmarc');
  });
  test('accepte lettres, accents, tirets, apostrophes', () => {
    for (const prenom of ['Zoé', 'Jean-Marc', "N'Golo", 'Anne Sophie', 'Ål']) {
      assert.equal(validerReservation(demande({ prenom }), vide(), MAINTENANT).prenom, prenom);
    }
  });
  test('refuse trop court, trop long, chiffres, symboles, script', () => {
    for (const prenom of ['A', 'Abcdefghijklmnopqrstu', 'Léa2', 'Léa!', '<script>x</script>', '-Léa', '', 42]) {
      echoue(() => validerReservation(demande({ prenom }), vide(), MAINTENANT), 'prenom');
    }
  });
});

describe('Blocages (admin)', () => {
  test('journée entière', () => {
    const b = validerBlocage({ date: '2026-11-25', journee: true, motif: 'Entretien de la table' }, MAINTENANT);
    assert.deepEqual([b.debut, b.fin, b.journee], ['10:00', '21:00', true]);
  });
  test('plage invalide refusée', () => {
    echoue(() => validerBlocage({ date: '2026-11-25', debut: '15:00', fin: '14:00', motif: 'x y' }, MAINTENANT), 'horaire');
    echoue(() => validerBlocage({ date: '2026-11-25', debut: '09:00', fin: '11:00', motif: 'x y' }, MAINTENANT), 'horaire');
  });
  test('motif obligatoire et nettoyé', () => {
    echoue(() => validerBlocage({ date: '2026-11-25', journee: true, motif: ' ' }, MAINTENANT), 'motif');
    const b = validerBlocage({ date: '2026-11-25', journee: true, motif: '<i>Tournoi</i> du club' }, MAINTENANT);
    assert.equal(b.motif, 'Tournoi du club');
  });
});

describe('Conservation 7 jours', () => {
  test('un jour est supprimé après 7 jours', () => {
    assert.equal(jourExpire('2026-11-14', '2026-11-21'), false);
    assert.equal(jourExpire('2026-11-13', '2026-11-21'), true);
  });
});
