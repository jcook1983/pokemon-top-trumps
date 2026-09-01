const POOL_MAX_ID = 386;      // gen 1-3, includes plenty of evolution lines
const MIN_HAND_SIZE = 10;
const MAX_HAND_SIZE = 50;
const CACHE_KEY = 'ptt_pokemon_cache_v1';

const STATS = [
  { key: 'hp', label: 'HP' },
  { key: 'attack', label: 'Attack' },
  { key: 'defense', label: 'Defense' },
  { key: 'special-attack', label: 'Sp. Atk' },
  { key: 'special-defense', label: 'Sp. Def' },
  { key: 'speed', label: 'Speed' }
];

const els = {
  setupScreen: document.getElementById('setup-screen'),
  difficultyOptions: document.getElementById('difficulty-options'),
  cardRuleOptions: document.getElementById('card-rule-options'),
  handSizeInput: document.getElementById('hand-size-input'),
  handSizeValue: document.getElementById('hand-size-value'),
  startGameBtn: document.getElementById('start-game-btn'),
  loading: document.getElementById('loading'),
  board: document.getElementById('game-board'),
  playerCard: document.getElementById('player-card'),
  cpuCard: document.getElementById('cpu-card'),
  playerCount: document.getElementById('player-count'),
  cpuCount: document.getElementById('cpu-count'),
  roundCount: document.getElementById('round-count'),
  log: document.getElementById('log-panel'),
  newGameBtn: document.getElementById('new-game-btn'),
  winnerBanner: document.getElementById('winner-banner'),
  potColumn: document.getElementById('pot-column'),
  potCard: document.getElementById('pot-card'),
  potCount: document.querySelector('#pot-card .pot-count')
};

let selectedDifficulty = 'medium';
let selectedCardRule = 'classic';

let state = {
  playerDeck: [],
  cpuDeck: [],
  pot: { player: [], cpu: [] }, // cards held in limbo through a chain of tied draws, kept split by which side drew them
  round: 0,
  turn: 'player', // who calls the next stat
  difficulty: 'medium',
  cardRule: 'classic', // 'classic' = winner keeps the loser's card, 'elimination' = loser's card is removed
  busy: false
};

function loadCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; }
  catch { return {}; }
}
function saveCache(cache) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {}
}

function pickRandomIds(count, max) {
  const ids = new Set();
  while (ids.size < count) {
    ids.add(1 + Math.floor(Math.random() * max));
  }
  return [...ids];
}

async function fetchPokemon(id, cache) {
  if (cache[id]) return cache[id];
  const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${id}`);
  if (!res.ok) throw new Error(`Failed to fetch pokemon ${id}`);
  const data = await res.json();
  const card = {
    id: data.id,
    name: data.name,
    sprite: data.sprites.front_default || data.sprites.other?.['official-artwork']?.front_default || '',
    types: data.types.map(t => t.type.name),
    stats: Object.fromEntries(data.stats.map(s => [s.stat.name, s.base_stat]))
  };
  cache[id] = card;
  return card;
}

async function buildRoster(totalNeeded) {
  const cache = loadCache();
  const ids = pickRandomIds(totalNeeded, POOL_MAX_ID);
  const cards = [];
  const batchSize = 12;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(id => fetchPokemon(id, cache)));
    cards.push(...results);
    els.loading.textContent = `Loading Pokémon roster from PokéAPI… (${cards.length}/${totalNeeded})`;
  }
  saveCache(cache);
  return cards;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function logMsg(text, cls) {
  const p = document.createElement('p');
  p.textContent = text;
  if (cls) p.className = cls;
  els.log.prepend(p);
}

function typeBadges(types) {
  return types.map(t =>
    `<span class="type-badge" style="background:${TYPE_COLORS[t] || '#777'}">${t}</span>`
  ).join('');
}

function renderCard(el, card, opts) {
  const { faceDown, interactive, onStatClick, revealStat } = opts || {};
  el.classList.toggle('face-down', !!faceDown);
  el.style.setProperty('--type-color', card ? TYPE_COLORS[card.types[0]] : '#555');

  if (faceDown || !card) {
    el.innerHTML = '<div class="back-logo">?</div>';
    return;
  }

  const statsHtml = STATS.map(s => {
    const base = card.stats[s.key];
    let displayVal = base;
    let extra = '';
    let rowCls = '';

    if (revealStat && revealStat.key === s.key) {
      // Modifiers stay hidden while the stat is only "called" — they appear once
      // the card is actually being compared (phase progresses past 'calling').
      if (revealStat.phase !== 'calling') {
        const mult = typeEffectiveness(card.types, revealStat.opponentTypes);
        displayVal = Math.round(base * mult);
        if (mult !== 1) {
          extra = ` <span class="mult-badge ${mult > 1 ? 'super' : 'weak'}">×${mult}</span>`;
        }
      }
      rowCls = ` ${revealStat.phase === 'modifier' ? 'calling' : revealStat.phase}`;
    }

    const tag = interactive ? 'button' : 'div';
    const extraAttrs = interactive ? `class="stat-row stat-btn${rowCls}" data-stat="${s.key}"` : `class="stat-row${rowCls}"`;
    return `<${tag} ${extraAttrs}>
        <span class="stat-name">${s.label}</span>
        <span class="stat-value">${displayVal}${extra}</span>
      </${tag}>`;
  }).join('');

  el.innerHTML = `
    <div class="sprite-wrap"><img class="sprite" src="${card.sprite}" alt="${card.name}"></div>
    <div class="name">${card.name}</div>
    <div class="type-badges">${typeBadges(card.types)}</div>
    <ul class="stats-list">${statsHtml}</ul>
  `;

  if (interactive && onStatClick) {
    el.querySelectorAll('.stat-btn').forEach(btn => {
      btn.addEventListener('click', () => onStatClick(btn.dataset.stat));
    });
  }
}

function updateStatusBar() {
  els.playerCount.textContent = state.playerDeck.length;
  els.cpuCount.textContent = state.cpuDeck.length;
  els.roundCount.textContent = state.round;
}

function pulseCount(el) {
  el.classList.remove('count-pulse');
  void el.offsetWidth; // restart animation
  el.classList.add('count-pulse');
}

function clearRoundAnimations() {
  [els.playerCard, els.cpuCard].forEach(el => {
    el.classList.remove('fly-to-left', 'fly-to-right', 'fly-to-pot', 'winner-glow', 'shake', 'reveal');
  });
}

function updatePotIndicator() {
  const total = state.pot.player.length + state.pot.cpu.length;
  els.potColumn.classList.toggle('visible', total > 0);
  els.potCount.textContent = total;
}

// ---- Sound (synthesized, no external assets) ----
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function tone(freq, start, duration, opts = {}) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = opts.type || 'sine';
  osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
  gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  gain.gain.linearRampToValueAtTime(opts.volume ?? 0.15, ctx.currentTime + start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + duration + 0.05);
}

function playSound(name) {
  try {
    switch (name) {
      case 'flip':
        tone(300, 0, 0.1, { type: 'triangle', volume: 0.08 });
        break;
      case 'superEffective':
        tone(660, 0, 0.09, { type: 'square', volume: 0.1 });
        tone(880, 0.09, 0.14, { type: 'square', volume: 0.1 });
        break;
      case 'notVeryEffective':
        tone(220, 0, 0.18, { type: 'sawtooth', volume: 0.08 });
        break;
      case 'win':
        tone(523.25, 0, 0.14, { type: 'triangle', volume: 0.16 });
        tone(659.25, 0.13, 0.14, { type: 'triangle', volume: 0.16 });
        tone(783.99, 0.26, 0.28, { type: 'triangle', volume: 0.18 });
        break;
      case 'lose':
        tone(311.13, 0, 0.16, { type: 'sawtooth', volume: 0.12 });
        tone(220, 0.15, 0.32, { type: 'sawtooth', volume: 0.12 });
        break;
      case 'tie':
        tone(392, 0, 0.22, { type: 'sine', volume: 0.1 });
        break;
    }
  } catch { /* audio unavailable, fail silently */ }
}

function checkGameOver() {
  if (state.playerDeck.length === 0 || state.cpuDeck.length === 0) {
    const won = state.playerDeck.length > 0;
    els.winnerBanner.style.display = 'block';
    els.winnerBanner.textContent = won ? 'You win! CPU is out of cards.' : 'CPU wins! You are out of cards.';
    els.playerCard.querySelectorAll('button').forEach(b => b.disabled = true);
    state.busy = true;
    return true;
  }
  return false;
}

// potCounts = { player: n, cpu: n } — how many pot cards each side contributed
// through the tie chain so far (always equal, since each tie adds one from each side).
function buildResultText(callerLabel, statLabel, playerCard, cpuCard, playerVal, cpuVal, outcome, cardRule, potCounts) {
  const pName = capitalize(playerCard.name);
  const cName = capitalize(cpuCard.name);
  const playerReason = describeMultiplier(playerCard.types, cpuCard.types);
  const cpuReason = describeMultiplier(cpuCard.types, playerCard.types);

  let text = `${callerLabel} ${statLabel}: ${pName} ${playerVal} vs ${cName} ${cpuVal}.`;
  if (playerReason) text += ` ${pName} — ${playerReason}.`;
  if (cpuReason) text += ` ${cName} — ${cpuReason}.`;

  if (outcome === 'tie') {
    text += ' Draw — both cards go to the pot!';
    return text;
  }

  const winnerIsPlayer = outcome === 'player';
  const loserName = winnerIsPlayer ? cName : pName;

  if (cardRule === 'elimination') {
    const winnerPotCount = winnerIsPlayer ? potCounts.player : potCounts.cpu;
    const loserPotCount = winnerIsPlayer ? potCounts.cpu : potCounts.player;

    text += winnerIsPlayer ? ' You win the round!' : ' CPU wins the round!';
    text += ` ${loserName}${loserPotCount > 0 ? ` and their ${loserPotCount} pot card${loserPotCount === 1 ? '' : 's'}` : ''} eliminated from the game.`;
    if (winnerPotCount > 0) {
      text += winnerIsPlayer
        ? ` You reclaim your ${winnerPotCount} pot card${winnerPotCount === 1 ? '' : 's'}.`
        : ` CPU reclaims its ${winnerPotCount} pot card${winnerPotCount === 1 ? '' : 's'}.`;
    }
  } else {
    const potTotal = potCounts.player + potCounts.cpu;
    const potNote = potTotal > 0 ? ` plus ${potTotal} pot card${potTotal === 1 ? '' : 's'}` : '';
    text += winnerIsPlayer
      ? ` You win the round and claim ${loserName}${potNote}!`
      : ` CPU wins the round and claims ${loserName}${potNote}!`;
  }
  return text;
}

function playRound(statKey) {
  if (state.busy) return;
  if (state.playerDeck.length === 0 || state.cpuDeck.length === 0) return;
  state.busy = true;
  resolveStat(statKey, false);
}

// Resolves one stat comparison. On a tie the cards go into the draw pot and this
// calls itself again with the SAME stat and the next two top-of-deck cards, until
// someone actually wins — at which point they claim both current cards plus the pot.
function resolveStat(statKey, isChainedDraw) {
  const playerCard = state.playerDeck[0];
  const cpuCard = state.cpuDeck[0];
  const callerLabel = state.turn === 'player' ? 'You call' : 'CPU calls';
  const statLabel = STATS.find(s => s.key === statKey).label;

  const playerMult = typeEffectiveness(playerCard.types, cpuCard.types);
  const cpuMult = typeEffectiveness(cpuCard.types, playerCard.types);
  const playerVal = Math.round(playerCard.stats[statKey] * playerMult);
  const cpuVal = Math.round(cpuCard.stats[statKey] * cpuMult);

  let outcome, playerPhase, cpuPhase;
  if (playerVal > cpuVal) { outcome = 'player'; playerPhase = 'winner'; cpuPhase = 'loser'; }
  else if (cpuVal > playerVal) { outcome = 'cpu'; playerPhase = 'loser'; cpuPhase = 'winner'; }
  else { outcome = 'tie'; playerPhase = 'tie'; cpuPhase = 'tie'; }

  clearRoundAnimations();

  // Stage 1 (t=0): flip the CPU card face up. Called stat is highlighted neutrally —
  // base values only, no type modifier shown yet.
  renderCard(els.cpuCard, cpuCard, {
    revealStat: { key: statKey, phase: 'calling', opponentTypes: playerCard.types }
  });
  void els.cpuCard.offsetWidth; // restart the flip animation even on back-to-back draws
  els.cpuCard.classList.add('reveal');
  renderCard(els.playerCard, playerCard, {
    revealStat: { key: statKey, phase: 'calling', opponentTypes: cpuCard.types }
  });
  playSound('flip');
  if (isChainedDraw) {
    const potTotal = state.pot.player.length + state.pot.cpu.length;
    logMsg(`Drawing again on ${statLabel} (pot: ${potTotal} cards) — ${capitalize(playerCard.name)} vs ${capitalize(cpuCard.name)}…`, state.turn === 'player' ? 'you' : 'cpu');
  }

  // Stage 2 (t=900ms): reveal the type-effectiveness modifier on the called stat.
  setTimeout(() => {
    renderCard(els.cpuCard, cpuCard, {
      revealStat: { key: statKey, phase: 'modifier', opponentTypes: playerCard.types }
    });
    renderCard(els.playerCard, playerCard, {
      revealStat: { key: statKey, phase: 'modifier', opponentTypes: cpuCard.types }
    });
    if (playerMult > 1 || cpuMult > 1) playSound('superEffective');
    else if (playerMult < 1 || cpuMult < 1) playSound('notVeryEffective');
  }, 900);

  // Stage 3 (t=2000ms): announce the result — explain the multipliers, highlight
  // winner/loser, and play the outcome sound.
  setTimeout(() => {
    logMsg(
      buildResultText(callerLabel, statLabel, playerCard, cpuCard, playerVal, cpuVal, outcome, state.cardRule, {
        player: state.pot.player.length,
        cpu: state.pot.cpu.length
      }),
      state.turn === 'player' ? 'you' : 'cpu'
    );

    renderCard(els.cpuCard, cpuCard, {
      revealStat: { key: statKey, phase: cpuPhase, opponentTypes: playerCard.types }
    });
    renderCard(els.playerCard, playerCard, {
      revealStat: { key: statKey, phase: playerPhase, opponentTypes: cpuCard.types }
    });

    playSound(outcome === 'player' ? 'win' : outcome === 'cpu' ? 'lose' : 'tie');
  }, 2000);

  // Stage 4 (t=2900ms): animate the outcome. Classic: loser flies to the winner's side
  // (captured). Elimination: loser just drops away (removed, not captured). Tie: both drop into the pot.
  setTimeout(() => {
    if (outcome === 'tie') {
      els.playerCard.classList.add('fly-to-pot');
      els.cpuCard.classList.add('fly-to-pot');
    } else if (outcome === 'player') {
      els.playerCard.classList.add('winner-glow');
      els.cpuCard.classList.add(state.cardRule === 'elimination' ? 'fly-to-pot' : 'fly-to-left');
    } else {
      els.cpuCard.classList.add('winner-glow');
      els.playerCard.classList.add(state.cardRule === 'elimination' ? 'fly-to-pot' : 'fly-to-right');
    }
  }, 2900);

  // Stage 5 (t=3700ms): commit state. On a tie, stash both cards in the pot and
  // redraw on the same stat; otherwise the winner claims both cards plus the pot.
  setTimeout(() => {
    clearRoundAnimations();

    state.playerDeck.shift();
    state.cpuDeck.shift();
    state.round++;

    if (outcome === 'tie') {
      state.pot.player.push(playerCard);
      state.pot.cpu.push(cpuCard);
      updateStatusBar();
      updatePotIndicator();

      if (state.playerDeck.length === 0 || state.cpuDeck.length === 0) {
        // Nobody has a card left to keep drawing with — game ends on the empty deck.
        state.busy = false;
        checkGameOver();
        return;
      }

      setTimeout(() => resolveStat(statKey, true), 500);
      return;
    }

    const potCards = state.pot;
    state.pot = { player: [], cpu: [] };
    updatePotIndicator();

    if (state.cardRule === 'elimination') {
      // Only the LOSING side's card and pot cards are removed from the game.
      // The winner keeps their own card plus any pot cards their own side drew —
      // those were never actually lost, since this side just won the stat.
      if (outcome === 'player') {
        state.playerDeck.push(playerCard, ...potCards.player);
        state.turn = 'player';
      } else {
        state.cpuDeck.push(cpuCard, ...potCards.cpu);
        state.turn = 'cpu';
      }
    } else if (outcome === 'player') {
      state.playerDeck.push(playerCard, cpuCard, ...potCards.player, ...potCards.cpu);
      state.turn = 'player';
    } else {
      state.cpuDeck.push(cpuCard, playerCard, ...potCards.player, ...potCards.cpu);
      state.turn = 'cpu';
    }

    updateStatusBar();
    pulseCount(els.playerCount);
    pulseCount(els.cpuCount);
    state.busy = false;

    if (checkGameOver()) return;
    nextTurn();
  }, 3700);
}

function cpuChooseStat() {
  const card = state.cpuDeck[0];
  const opponentCard = state.playerDeck[0];

  if (state.difficulty === 'easy') {
    // Calls a stat at random, no strategy at all.
    return STATS[Math.floor(Math.random() * STATS.length)].key;
  }

  if (state.difficulty === 'hard') {
    // Sees its own card and the player's visible top card (same info a human has)
    // and picks the stat with the best type-adjusted margin over the opponent.
    const cpuMult = typeEffectiveness(card.types, opponentCard.types);
    const playerMult = typeEffectiveness(opponentCard.types, card.types);
    let best = STATS[0].key;
    let bestMargin = -Infinity;
    for (const s of STATS) {
      const margin = card.stats[s.key] * cpuMult - opponentCard.stats[s.key] * playerMult;
      if (margin > bestMargin) {
        bestMargin = margin;
        best = s.key;
      }
    }
    return best;
  }

  // medium (default): picks its own highest base stat, no type awareness.
  let best = STATS[0].key;
  let bestVal = -1;
  for (const s of STATS) {
    if (card.stats[s.key] > bestVal) {
      bestVal = card.stats[s.key];
      best = s.key;
    }
  }
  return best;
}

function nextTurn() {
  if (checkGameOver()) return;
  const playerCard = state.playerDeck[0];
  const cpuCard = state.cpuDeck[0];

  if (state.turn === 'player') {
    renderCard(els.cpuCard, cpuCard, { faceDown: true });
    renderCard(els.playerCard, playerCard, {
      interactive: true,
      onStatClick: (statKey) => playRound(statKey)
    });
  } else {
    renderCard(els.playerCard, playerCard, { interactive: false });
    renderCard(els.cpuCard, cpuCard, { faceDown: true });
    setTimeout(() => {
      const statKey = cpuChooseStat();
      playRound(statKey);
    }, 1200);
  }
}

async function startGame(handSize, difficulty, cardRule) {
  els.setupScreen.style.display = 'none';
  els.loading.style.display = 'block';
  els.board.style.display = 'none';
  els.winnerBanner.style.display = 'none';
  els.log.innerHTML = '';

  const roster = shuffle(await buildRoster(handSize * 2));
  state = {
    playerDeck: roster.slice(0, handSize),
    cpuDeck: roster.slice(handSize, handSize * 2),
    pot: { player: [], cpu: [] },
    round: 0,
    turn: 'player',
    difficulty,
    cardRule,
    busy: false
  };

  els.loading.style.display = 'none';
  els.board.style.display = 'block';
  updateStatusBar();
  updatePotIndicator();
  const ruleNote = cardRule === 'elimination' ? 'Elimination (defeated cards are removed)' : 'Classic (winner keeps defeated cards)';
  logMsg(`New game! Difficulty: ${capitalize(difficulty)}. Rule: ${ruleNote}. ${handSize} cards each. You deal first.`, 'you');
  nextTurn();
}

function showSetupScreen() {
  els.board.style.display = 'none';
  els.loading.style.display = 'none';
  els.setupScreen.style.display = 'block';
}

els.difficultyOptions.addEventListener('click', (e) => {
  const btn = e.target.closest('.option-btn');
  if (!btn) return;
  selectedDifficulty = btn.dataset.difficulty;
  els.difficultyOptions.querySelectorAll('.option-btn').forEach(b => {
    b.classList.toggle('active', b === btn);
  });
});

els.cardRuleOptions.addEventListener('click', (e) => {
  const btn = e.target.closest('.option-btn');
  if (!btn) return;
  selectedCardRule = btn.dataset.cardRule;
  els.cardRuleOptions.querySelectorAll('.option-btn').forEach(b => {
    b.classList.toggle('active', b === btn);
  });
});

els.handSizeInput.addEventListener('input', () => {
  els.handSizeValue.textContent = els.handSizeInput.value;
});

els.startGameBtn.addEventListener('click', () => {
  const handSize = Math.min(MAX_HAND_SIZE, Math.max(MIN_HAND_SIZE, parseInt(els.handSizeInput.value, 10) || 30));
  startGame(handSize, selectedDifficulty, selectedCardRule);
});

els.newGameBtn.addEventListener('click', showSetupScreen);

showSetupScreen();
