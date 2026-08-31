// Official-style type colours (matches the in-game type icon colours)
const TYPE_COLORS = {
  normal: '#A8A878', fire: '#F08030', water: '#6890F0', electric: '#F8D030',
  grass: '#78C850', ice: '#98D8D8', fighting: '#C03028', poison: '#A040A0',
  ground: '#E0C068', flying: '#A890F0', psychic: '#F85888', bug: '#A8B820',
  rock: '#B8A038', ghost: '#705898', dragon: '#7038F8', dark: '#705848',
  steel: '#B8B8D0', fairy: '#EE99AC'
};

// attacker -> defender -> multiplier (only non-1 entries listed, default 1)
const TYPE_CHART = {
  normal:   { rock: 0.5, ghost: 0, steel: 0.5 },
  fire:     { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
  water:    { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
  electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
  grass:    { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 },
  ice:      { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
  fighting: { normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, rock: 2, ghost: 0, dark: 2, steel: 2, fairy: 0.5 },
  poison:   { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2 },
  ground:   { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
  flying:   { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
  psychic:  { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
  bug:      { fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2, ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5 },
  rock:     { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
  ghost:    { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
  dragon:   { dragon: 2, steel: 0.5, fairy: 0 },
  dark:     { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
  steel:    { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5, fairy: 2 },
  fairy:    { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 }
};

// Effectiveness of an attacking type-set against a defending type-set.
// Uses the best (STAB) type on the attacking side, multiplied across all defending types.
// Returns which attacking type produced that result, so the UI can explain *why*.
function typeEffectivenessDetailed(attackerTypes, defenderTypes) {
  let best = -1;
  let bestType = attackerTypes[0];
  for (const atk of attackerTypes) {
    let mult = 1;
    for (const def of defenderTypes) {
      const row = TYPE_CHART[atk];
      mult *= (row && def in row) ? row[def] : 1;
    }
    if (mult > best) {
      best = mult;
      bestType = atk;
    }
  }
  return { mult: best, attackType: bestType };
}

function typeEffectiveness(attackerTypes, defenderTypes) {
  return typeEffectivenessDetailed(attackerTypes, defenderTypes).mult;
}

function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// Human-readable explanation of why a stat got boosted/weakened, or null if neutral (×1).
function describeMultiplier(attackerTypes, defenderTypes) {
  const { mult, attackType } = typeEffectivenessDetailed(attackerTypes, defenderTypes);
  if (mult === 1) return null;
  const verb = mult === 0 ? 'has no effect on' : mult > 1 ? 'is super effective against' : 'is not very effective against';
  const defenderLabel = defenderTypes.map(capitalize).join('/');
  return `${capitalize(attackType)} ${verb} ${defenderLabel} (×${mult})`;
}
