// ── BOARD BUILDER ──
function makeBoard(containerId, pieceRow, pieceCol, moveFn, pieceSym) {
  const el = document.getElementById(containerId);
  if (!el) return;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = document.createElement('div');
      const isLight = (r + c) % 2 === 0;
      sq.className = 'msq ' + (isLight ? 'ml' : 'md');
      if (r === pieceRow && c === pieceCol) {
        sq.classList.add('piece-here');
        sq.textContent = pieceSym;
        sq.style.fontSize = '28px';
        sq.style.color = '#1a1a1a';
      } else {
        const result = moveFn(pieceRow, pieceCol, r, c);
        if (result === 'move') sq.classList.add('can-move');
        else if (result === 'capture') sq.classList.add('can-capture');
      }
      el.appendChild(sq);
    }
  }
}

function withEnemies(baseFn, enemies) {
  return function (pr, pc, r, c) {
    const isEnemy = enemies.some(([er, ec]) => er === r && ec === c);
    const base = baseFn(pr, pc, r, c);
    if (isEnemy && base === 'move') return 'capture';
    return base;
  };
}

// Movement functions
function kingMoves(pr, pc, r, c) {
  if (Math.abs(r - pr) <= 1 && Math.abs(c - pc) <= 1) return 'move';
}
function queenMoves(pr, pc, r, c) {
  if (r === pr || c === pc || Math.abs(r - pr) === Math.abs(c - pc)) return 'move';
}
function rookMoves(pr, pc, r, c) {
  if (r === pr || c === pc) return 'move';
}
function bishopMoves(pr, pc, r, c) {
  if (Math.abs(r - pr) === Math.abs(c - pc)) return 'move';
}
function knightMoves(pr, pc, r, c) {
  const dr = Math.abs(r - pr), dc = Math.abs(c - pc);
  if ((dr === 2 && dc === 1) || (dr === 1 && dc === 2)) return 'move';
}
function pawnMoves(pr, pc, r, c) {
  if (c === pc && r === pr - 1) return 'move';
  if (c === pc && r === pr - 2 && pr === 6) return 'move';
  if (Math.abs(c - pc) === 1 && r === pr - 1) return 'capture';
}