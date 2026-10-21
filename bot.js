// ─────────────────────────────────────────
// CHESS ENGINE (chess.js)
// ─────────────────────────────────────────
let game = new Chess();
let selectedSq = null;
let legalMoves = [];
let boardFlipped = false;
let difficulty = 1;
let thinking = false;
let moveHistory = [];
let historyIndex = -1;
let pendingPromotion = null;
let evalScore = 0;
let statsGood = 0, statsMistakes = 0, statsMoves = 0;
let analysisOn = true;
let bestMoveHint = null;

const PIECE_UNICODE = {
  'wK':'♔','wQ':'♕','wR':'♖','wB':'♗','wN':'♘','wP':'♙',
  'bK':'♚','bQ':'♛','bR':'♜','bB':'♝','bN':'♞','bP':'♟'
};
const ELO_MAP = { 1:800, 4:1400, 8:2200 };

// ─────────────────────────────────────────
// STOCKFISH WEB WORKER (CDN)
// ─────────────────────────────────────────
let sf = null;
let sfReady = false;
let sfCallbacks = [];

function initStockfish() {
  try {
    // Use a blob worker to load stockfish from CDN
    const workerCode = `
      importScripts('https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js');
      var sf = Stockfish();
      sf.onmessage = function(line) { postMessage(line); };
      onmessage = function(e) { sf.postMessage(e.data); };
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    sf = new Worker(URL.createObjectURL(blob));
    sf.onmessage = handleSFMessage;
    sf.postMessage('uci');
  } catch(e) {
    // Fallback: simple random move engine
    sf = null;
    addMessage('ai', "I'm running in basic mode today — I'll still teach you, but my analysis is simplified!");
  }
}

let sfBuffer = [];
let evalCallback = null;
let bestMoveCallback = null;

function handleSFMessage(e) {
  const line = e.data;
  if (line === 'uciok') { sf.postMessage('isready'); }
  if (line === 'readyok') { sfReady = true; drainCallbacks(); }

  // Parse info lines
  if (line.startsWith('info') && line.includes('score cp')) {
    const m = line.match(/score cp ([-\d]+)/);
    if (m) {
      let cp = parseInt(m[1]);
      // Flip for black
      if (game.turn() === 'b') cp = -cp;
      evalScore = cp / 100;
      updateEvalDisplay();
    }
  }
  if (line.startsWith('info') && line.includes('score mate')) {
    const m = line.match(/score mate ([-\d]+)/);
    if (m) { evalScore = parseInt(m[1]) > 0 ? 99 : -99; updateEvalDisplay(); }
  }
  if (line.startsWith('bestmove')) {
    const parts = line.split(' ');
    const bm = parts[1];
    if (bestMoveCallback) { bestMoveCallback(bm); bestMoveCallback = null; }
  }

  // Check depth
  if (line.startsWith('info depth')) {
    const dm = line.match(/depth (\d+)/);
    if (dm) document.getElementById('depth-display').textContent = 'depth ' + dm[1];
  }
}

function drainCallbacks() {
  sfCallbacks.forEach(fn => fn());
  sfCallbacks = [];
}

function sfSend(cmd) {
  if (sf && sfReady) { sf.postMessage(cmd); }
}

function askSFForMove(depth, callback) {
  if (!sf || !sfReady) { callback(getRandomMove()); return; }
  bestMoveCallback = callback;
  sfSend('position fen ' + game.fen());
  sfSend('go depth ' + depth);
}

function askSFForEval() {
  if (!sf || !sfReady) return;
  sfSend('position fen ' + game.fen());
  sfSend('go depth 8');
}

function getRandomMove() {
  const moves = game.moves();
  return moves.length ? moves[Math.floor(Math.random() * moves.length)] : null;
}

// ─────────────────────────────────────────
// BOARD RENDERING
// ─────────────────────────────────────────
function renderBoard() {
  const board = document.getElementById('board');
  board.innerHTML = '';
  const pos = game.board();

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const row = boardFlipped ? 7 - r : r;
      const col = boardFlipped ? 7 - c : c;
      const file = col;
      const rank = 7 - row;
      const sqName = 'abcdefgh'[file] + (rank + 1);
      const piece = pos[row][col];

      const sq = document.createElement('div');
      sq.className = 'square ' + ((file + rank) % 2 === 0 ? 'dark' : 'light');
      sq.dataset.sq = sqName;

      // Last move highlight
      if (game.history({verbose:true}).length > 0) {
        const lastMove = game.history({verbose:true}).slice(-1)[0];
        if (sqName === lastMove.from || sqName === lastMove.to) sq.classList.add('last-move');
      }

      // Selection
      if (sqName === selectedSq) sq.classList.add('selected');

      // Legal move hints
      const hint = legalMoves.find(m => m.to === sqName);
      if (hint) {
        sq.classList.add('hint');
        if (piece) sq.classList.add('has-piece');
      }

      // Check highlight
      if (game.in_check() && piece && piece.type === 'k' && piece.color === game.turn()) {
        sq.classList.add('check');
      }

      // Coords
      if ((boardFlipped ? col === 7 : col === 0)) {
        const rc = document.createElement('span');
        rc.className = 'coord rank ' + ((file + rank) % 2 === 0 ? 'on-dark' : 'on-light');
        rc.textContent = rank + 1;
        sq.appendChild(rc);
      }
      if ((boardFlipped ? row === 0 : row === 7)) {
        const fc = document.createElement('span');
        fc.className = 'coord file ' + ((file + rank) % 2 === 0 ? 'on-dark' : 'on-light');
        fc.textContent = 'abcdefgh'[file];
        sq.appendChild(fc);
      }

      // Piece
      if (piece) {
        const p = document.createElement('span');
        const key = piece.color + piece.type.toUpperCase();
        p.className = 'piece piece-' + piece.color;
        p.textContent = PIECE_UNICODE[key] || piece.type;
        sq.appendChild(p);
      }

      sq.addEventListener('click', () => handleSquareClick(sqName));
      board.appendChild(sq);
    }
  }

  updateTurnIndicators();
}

function updateTurnIndicators() {
  const humanTurn = game.turn() === 'w';
  document.getElementById('dot-human').classList.toggle('hidden', !humanTurn || thinking);
  document.getElementById('dot-ai').classList.toggle('hidden', humanTurn || thinking);
}

function updateEvalDisplay() {
  const bar = document.getElementById('eval-bar');
  const disp = document.getElementById('eval-display');
  const pct = Math.max(5, Math.min(95, 50 + evalScore * 8));
  bar.style.height = pct + '%';
  const val = evalScore > 99 ? 'M' : evalScore < -99 ? '-M' : (evalScore >= 0 ? '+' : '') + evalScore.toFixed(2);
  disp.textContent = val;
  disp.className = 'eval-num ' + (evalScore >= 0 ? 'positive' : 'negative');
}

function updateMoveHistory() {
  const grid = document.getElementById('moves-grid');
  grid.innerHTML = '';
  const hist = game.history();
  hist.forEach((san, i) => {
    if (i % 2 === 0) {
      const num = document.createElement('span');
      num.className = 'move-num';
      num.textContent = (i/2 + 1) + '.';
      grid.appendChild(num);
    }
    const ms = document.createElement('span');
    ms.className = 'move-san' + (i === hist.length - 1 ? ' current' : '');
    ms.textContent = san;
    ms.onclick = () => {};
    grid.appendChild(ms);
  });
  grid.scrollLeft = grid.scrollWidth;
}

function updateCapturedPieces() {
  const hist = game.history({verbose:true});
  const capByWhite = [], capByBlack = [];
  hist.forEach(m => {
    if (m.captured) {
      const icon = PIECE_UNICODE[(m.color === 'w' ? 'b' : 'w') + m.captured.toUpperCase()];
      if (m.color === 'w') capByWhite.push(icon);
      else capByBlack.push(icon);
    }
  });
  document.getElementById('cap-white').innerHTML = capByWhite.map(p => `<span class="cap-piece">${p}</span>`).join('');
  document.getElementById('cap-black').innerHTML = capByBlack.map(p => `<span class="cap-piece">${p}</span>`).join('');
}

// ─────────────────────────────────────────
// INTERACTION
// ─────────────────────────────────────────
function handleSquareClick(sq) {
  if (thinking || game.turn() !== 'w') return; // Human plays white

  if (selectedSq === null) {
    const piece = game.get(sq);
    if (!piece || piece.color !== 'w') return;
    selectedSq = sq;
    legalMoves = game.moves({square: sq, verbose: true});
    renderBoard();
  } else {
    const mv = legalMoves.find(m => m.to === sq);
    if (mv) {
      // Promotion check
      if (mv.flags.includes('p')) {
        pendingPromotion = mv;
        document.getElementById('promo-overlay').classList.remove('hidden');
        return;
      }
      executeMove(mv.from, mv.to, mv.promotion);
    } else if (sq === selectedSq) {
      deselect();
    } else {
      const piece = game.get(sq);
      if (piece && piece.color === 'w') {
        selectedSq = sq;
        legalMoves = game.moves({square: sq, verbose: true});
        renderBoard();
      } else {
        deselect();
      }
    }
  }
}

function deselect() {
  selectedSq = null;
  legalMoves = [];
  renderBoard();
}

function promote(piece) {
  document.getElementById('promo-overlay').classList.add('hidden');
  if (pendingPromotion) {
    executeMove(pendingPromotion.from, pendingPromotion.to, piece);
    pendingPromotion = null;
  }
}

function executeMove(from, to, promo) {
  const evalBefore = evalScore;
  const result = game.move({ from, to, promotion: promo || 'q' });
  if (!result) return;
  selectedSq = null; legalMoves = [];

  statsMoves++;
  updateStats(evalBefore, evalScore);
  updateMoveHistory();
  updateCapturedPieces();
  renderBoard();

  if (checkGameOver()) return;

  // Dr. Fox comment on move
  commentOnMove(result);

  // AI responds
  setTimeout(() => doAIMove(), 600);
}

function doAIMove() {
  if (game.game_over() || game.turn() !== 'b') return;
  thinking = true;
  updateTurnIndicators();

  const depth = difficulty <= 1 ? 2 : difficulty <= 4 ? 5 : 10;

  askSFForMove(depth, (bestMove) => {
    thinking = false;
    if (!bestMove || bestMove === '(none)') return;

    // Parse bestmove (e.g., "e2e4" or SAN)
    let result;
    if (bestMove.length >= 4) {
      const from = bestMove.slice(0, 2);
      const to = bestMove.slice(2, 4);
      const promo = bestMove[4] || undefined;
      result = game.move({ from, to, promotion: promo });
    } else {
      result = game.move(bestMove);
    }

    if (!result) return;
    updateMoveHistory();
    updateCapturedPieces();
    renderBoard();
    askSFForEval();
    if (!checkGameOver()) {
      commentOnAIMove(result);
    }
  });
}

function checkGameOver() {
  if (!game.game_over()) return false;
  let icon = '🤝', title = 'Draw!', msg = '';
  if (game.in_checkmate()) {
    if (game.turn() === 'b') {
      icon = '🏆'; title = 'You Win!';
      msg = "Excellent play! You checkmated the AI. You're improving fast!";
    } else {
      icon = '♟'; title = 'AI Wins';
      msg = "Good game! Don't be discouraged — every loss is a lesson. Want to review what happened?";
    }
  } else if (game.in_stalemate()) {
    msg = "Stalemate! The game is drawn because the player to move has no legal moves.";
  } else if (game.in_draw()) {
    msg = "The game ended in a draw — well fought!";
  }
  document.getElementById('overlay-icon').textContent = icon;
  document.getElementById('overlay-title').textContent = title;
  document.getElementById('overlay-msg').textContent = msg;
  document.getElementById('overlay').classList.remove('hidden');
  addMessage('ai', "Game over! " + msg);
  return true;
}

// ─────────────────────────────────────────
// DR. FOX TUTOR MESSAGES
// ─────────────────────────────────────────
const GREETINGS = [
  "Welcome back! I'm Dr. Fox, your chess tutor. Make your first move — I'll guide you every step of the way! 🦊",
  "Hello! Ready to learn chess? I'll explain the ideas behind each move. You play White — move a pawn to the center!",
];

const OPENING_TIPS = [
  "Great start! In chess openings, we have three golden rules: Control the center, develop your pieces, and castle for king safety.",
  "Nice move! Try to develop your knights and bishops quickly — pieces that stay on the back rank can't help you!",
  "Good thinking! Remember: the center squares (e4, d4, e5, d5) are the most important on the board.",
  "Excellent! Early in the game, try not to move the same piece twice unless you absolutely must.",
];

const TACTICAL_TIPS = [
  "Look for tactics! A fork attacks two pieces at once with a single move — very powerful!",
  "Watch for pins! A pin is when an attacking piece stops a defender from moving without exposing a more valuable piece.",
  "Can you find a skewer? A skewer attacks a valuable piece that must move, exposing a less valuable one behind it.",
  "Discovered attacks can be devastating — moving one piece reveals an attack from another!",
];

const MISTAKE_TIPS = [
  "Hmm, that move leaves a piece unprotected. Always count attackers and defenders before you move!",
  "Consider your opponent's threats first. After every move they make, ask: what are they threatening?",
  "A useful habit: before moving, ask yourself — can my opponent capture anything after this move?",
];

const AI_MOVE_COMMENTS = [
  "My move! Notice how I'm developing pieces toward the center.",
  "I'm castling to keep my king safe — always a good idea in the opening!",
  "I'm contesting the center. Can you see why controlling d4/d5/e4/e5 matters?",
  "Watch my bishop's diagonal — it controls many squares from this position.",
  "I'm building up pressure. Try to find the best response!",
];

let msgCount = 0;
function addMessage(who, text, delay = 0) {
  setTimeout(() => {
  const chat = document.getElementById('chat-messages');

  const msg = document.createElement('div');
  msg.className = 'msg ' + who;

  const time = new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});

  msg.innerHTML = `
    <div class="msg-avatar ${who}">${who === 'ai' ? '♟️' : '🧑'}</div>
    <div>
      <div class="msg-bubble">${text}</div>
      <div class="msg-time">${time}</div>
    </div>
  `;

  chat.appendChild(msg);

  // WhatsApp style scroll
  chat.scrollTop = chat.scrollHeight;

}, delay);
}

function showTyping() {
  const chat = document.getElementById('chat-messages');
  if (document.getElementById('typing-indicator')) return;
  const div = document.createElement('div');
  div.id = 'typing-indicator';
  div.className = 'msg ai';
  div.innerHTML = `<div class="msg-avatar ai">♟️</div><div class="thinking-dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>`;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function commentOnMove(move) {
  const hist = game.history();
  const moveNum = hist.length;

  showTyping();
  setTimeout(() => {
    let comment = '';
    if (moveNum <= 4) {
      comment = OPENING_TIPS[Math.floor(Math.random() * OPENING_TIPS.length)];
    } else if (moveNum <= 10) {
      comment = Math.random() > 0.5 ? OPENING_TIPS[moveNum % OPENING_TIPS.length] : TACTICAL_TIPS[moveNum % TACTICAL_TIPS.length];
    } else {
      comment = TACTICAL_TIPS[Math.floor(Math.random() * TACTICAL_TIPS.length)];
    }

    // Special move comments
    if (move.flags.includes('k') || move.flags.includes('q')) {
      comment = "You castled! ♜ Great — your king is now safer and your rook joins the action. Castling is one of the most important moves in chess.";
    } else if (move.flags.includes('e')) {
      comment = "En passant! 🎉 Excellent — that's a special pawn capture that catches many beginners off guard. Well played!";
    } else if (move.flags.includes('p')) {
      comment = "Pawn promotion! Your pawn reached the last rank and became a queen. This is usually the most powerful promotion choice!";
    } else if (move.san.includes('+')) {
      comment = "Check! ✅ You're putting the enemy king under attack. The opponent must now get out of check — it limits their options!";
    } else if (move.san.includes('x')) {
      comment = `Nice capture! You took the ${move.captured === 'p' ? 'pawn' : move.captured === 'n' ? 'knight' : move.captured === 'b' ? 'bishop' : move.captured === 'r' ? 'rook' : 'queen'}. Always make sure the exchange is worth it!`;
    }

    addMessage('ai', comment);
  }, 600);
}

function commentOnAIMove(move) {
  showTyping();
  setTimeout(() => {
    let comment = AI_MOVE_COMMENTS[Math.floor(Math.random() * AI_MOVE_COMMENTS.length)];
    if (move.flags.includes('k') || move.flags.includes('q')) {
      comment = "I'm castling too! Safety first — the king should be sheltered behind pawns. Your turn!";
    } else if (move.san.includes('+')) {
      comment = "Check! ♟ I'm attacking your king. You must escape — by moving the king, blocking, or capturing the attacker.";
    } else if (move.san.includes('x')) {
      comment = "I made a capture. Ask yourself: was it a fair trade? Count material — pawns are worth 1, knights/bishops 3, rooks 5, queens 9!";
    }
    addMessage('ai', comment);
  }, 800);
}

function updateStats(evalBefore, evalAfter) {
  const delta = Math.abs(evalBefore - evalAfter);
  if (delta < 0.5) statsGood++;
  else if (delta > 1.5) statsMistakes++;
  document.getElementById('stat-moves').textContent = statsMoves;
  document.getElementById('stat-good').textContent = statsGood;
  document.getElementById('stat-mistakes').textContent = statsMistakes;
  const acc = statsMoves > 0 ? Math.round((statsGood / statsMoves) * 100) : 0;
  document.getElementById('stat-acc').textContent = statsMoves > 0 ? acc + '%' : '—';
}

// ─────────────────────────────────────────
// CHAT WITH CLAUDE API
// ─────────────────────────────────────────
const SYSTEM_PROMPT = `You are Dr. Build, a friendly and encouraging chess tutor AI — like Dr. Wolf from Chess.com but warmer and more engaging. 

You help beginners learn chess. Your style:
- Encouraging, patient, and enthusiastic
- Use chess terminology but always explain it simply
- Give concrete advice about the current position
- Keep replies concise (2-4 sentences max)
- Use chess emojis occasionally ♟♛♚
- Reference the current position (FEN) when giving advice
- End with a question or challenge to keep the student engaged

Current game FEN: GAME_FEN
Move history: MOVE_HISTORY`;

let chatHistory = [];

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  addMessage('user', text);
  showTyping();

  chatHistory.push({ role: 'user', content: text });

  const systemMsg = SYSTEM_PROMPT
    .replace('GAME_FEN', game.fen())
    .replace('MOVE_HISTORY', game.history().join(' ') || 'Game just started');

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: systemMsg,
        messages: chatHistory
      })
    });
    const data = await response.json();
    const reply = data.content?.[0]?.text || "I'm thinking... try asking again!";
    chatHistory.push({ role: 'assistant', content: reply });
    const typing = document.getElementById('typing-indicator');
    if (typing) typing.remove();
    addMessage('ai', reply);
  } catch (e) {
    const typing = document.getElementById('typing-indicator');
    if (typing) typing.remove();
    addMessage('ai', "Connection hiccup! But I'm still here — just ask me again and I'll help you with your position. ♟");
  }
}

function handleChatKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
}

// ─────────────────────────────────────────
// CONTROLS
// ─────────────────────────────────────────
function newGame() {
  game.reset();
  selectedSq = null; legalMoves = [];
  thinking = false;
  statsMoves = 0; statsGood = 0; statsMistakes = 0;
  chatHistory = [];
  document.getElementById('overlay').classList.add('hidden');
  document.getElementById('moves-grid').innerHTML = '';
  document.getElementById('cap-white').innerHTML = '';
  document.getElementById('cap-black').innerHTML = '';
  document.getElementById('eval-display').textContent = '+0.00';
  document.getElementById('eval-bar').style.height = '50%';
  renderBoard();
  askSFForEval();

  // Reset stats display
  ['stat-moves','stat-good','stat-mistakes'].forEach(id => document.getElementById(id).textContent = '0');
  document.getElementById('stat-acc').textContent = '—';

  // Welcome message
  const chat = document.getElementById('chat-messages');
  chat.innerHTML = '';
  addMessage('ai', GREETINGS[Math.floor(Math.random() * GREETINGS.length)]);
  setTimeout(() => {
    addMessage('ai', "Tip: You play as White ♙. Click a piece to see where it can move, then click the destination. The green dots show legal moves!", 1200);
  }, 500);
}

function flipBoard() {
  boardFlipped = !boardFlipped;
  renderBoard();
}

function setDifficulty(level) {
  difficulty = level;
  document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`[data-level="${level}"]`).classList.add('active');
  document.getElementById('ai-elo').textContent = ELO_MAP[level];
  const names = { 1:'Beginner (Elo 800)', 4:'Club Player (Elo 1400)', 8:'Master (Elo 2200)' };
  addMessage('ai', `Difficulty set to ${names[level]}. ${level === 1 ? "I'll take it easy and explain everything!" : level === 4 ? "I'll play solidly and point out key ideas." : "Brace yourself — I'll play at master strength, but I'll still explain my moves!"}`);
}

function requestHint() {
  if (game.turn() !== 'w') { addMessage('ai', "Wait for your turn first! ♟"); return; }
  addMessage('ai', "Let me calculate the best move for you... 🤔");
  askSFForMove(6, (bm) => {
    if (!bm || bm === '(none)') { addMessage('ai', "Any legal move is fine here — just try something!"); return; }
    const from = bm.slice(0,2).toUpperCase();
    const to = bm.slice(2,4).toUpperCase();
    addMessage('ai', `Hint: Consider moving from ${from} to ${to}. This is the strongest move in this position! Remember, try to understand *why* before you make it. 💡`);
  });
}

function toggleAnalysis() {
  analysisOn = !analysisOn;
  document.getElementById('analysis-bar').style.display = analysisOn ? 'flex' : 'none';
  document.getElementById('analysis-btn').textContent = analysisOn ? '📊 Analysis' : '📊 Analysis Off';
}

function goBack() { /* simplified — could implement full history */ addMessage('ai', "Use 'New Game' to start fresh!"); }
function goForward() {}
function goToStart() {}
function goToEnd() {}
function hideOverlay() { document.getElementById('overlay').classList.add('hidden'); }

function startLesson(type) {
  document.querySelectorAll('.lesson-item').forEach(el => el.classList.remove('active'));
  event.currentTarget.classList.add('active');

  const lessons = {
    basics: "Let's learn piece movement! Each piece moves differently: ♙Pawns move forward one square (two from start), ♘Knights jump in an L-shape, ♗Bishops move diagonally, ♖Rooks move in straight lines, ♛Queens move any direction, ♔Kings move one square. Try clicking your pieces to see their moves!",
    checkmate: "Checkmate patterns! The goal of chess is to trap the enemy king. The Scholar's Mate wins in 4 moves — but only works against beginners! More important: watch for your own king's safety at all times. 👑",
    openings: "Opening principles! Remember the 3 rules: 1) Control the center with pawns (e4 or d4), 2) Develop knights and bishops to active squares, 3) Castle early to protect your king. These principles apply to every opening!",
    tactics: "Tactical motifs! A fork attacks two pieces at once. A pin stops a piece from moving. A skewer pushes a piece away. A discovered attack reveals a hidden attacker. These patterns win material and games!",
    endgame: "Endgame basics! When most pieces are gone, the king becomes powerful — activate it! In king+pawn endings, the opposition (kings facing each other with one square between) decides who wins. Passed pawns are your best friends in the endgame!"
  };
  game.reset(); renderBoard();
  addMessage('ai', lessons[type]);
}

// ─────────────────────────────────────────
// INIT
// ─────────────────────────────────────────
window.onload = () => {
  initStockfish();
  newGame();
};