
import './index.css'
import React, { useState, useEffect, useRef } from 'react';

// --- GAME CONFIGURATION ---
const DEFAULT_COLS = 9;
const DEFAULT_ROWS = 9;
const MAX_ITERATIONS = 200;

const DEFAULT_CAMPAIGN_FALLBACK = [
  {
    cols: 5, rows: 5,
    dialogs: [
      { name: "Commander", text: "Welcome to Tic-Tac-Toe: Evolved." },
      { name: "System", text: "Let's start simple." },
      { name: "Commander", text: "Get a combo of 1 extra turn (score a line of 4) to pass this test." }
    ],
    goal: { type: 'min_combo', target: 1 },
    board: Array(5).fill(null).map(() => Array(5).fill(null).map(() => ({ type: 'empty', walls: {r:false, b:false, br:false, bl:false}, dead: false, lineId: null, isTarget: false, mechanicalLock: false })))
  }
];

// --- ICON COMPONENTS (Unselectable) ---
const IconZapspace = ({ dead }) => (
  <svg viewBox="0 0 24 24" className={`w-full h-full transition-all pointer-events-none select-none ${dead ? 'text-green-900/20 grayscale' : 'text-green-500/40'}`} stroke="currentColor" strokeWidth="2.5">
    <line x1="4" y1="20" x2="20" y2="4" />
    <line x1="12" y1="24" x2="24" y2="12" />
    <line x1="0" y1="12" x2="12" y2="0" />
  </svg>
);
const IconDup = ({ dir }) => {
  const rots = { r: 0, d: 90, l: 180, u: -90 };
  return (
    <svg viewBox="0 0 24 24" className="w-2/3 h-2/3 text-indigo-400/70 pointer-events-none select-none" fill="none" stroke="currentColor" strokeWidth="3" style={{ transform: `rotate(${rots[dir]}deg)` }}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
};
const IconZap = ({ dir }) => {
  const rots = { r: 0, d: 90, l: 180, u: -90 };
  return (
    <svg viewBox="0 0 24 24" className="w-2/3 h-2/3 text-yellow-400/70 pointer-events-none select-none" fill="none" stroke="currentColor" strokeWidth="3" style={{ transform: `rotate(${rots[dir]}deg)` }}>
      <polyline points="13 17 18 12 13 7" />
      <polyline points="6 17 11 12 6 7" />
    </svg>
  );
};
const IconMov = ({ dir }) => {
  const rots = { r: 0, d: 90, l: 180, u: -90 };
  return (
    <svg viewBox="0 0 24 24" className="w-2/3 h-2/3 text-blue-400/70 pointer-events-none select-none" fill="none" stroke="currentColor" strokeWidth="3" style={{ transform: `rotate(${rots[dir]}deg)` }}>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
};
const IconRot = ({ cw }) => (
  <svg viewBox="0 0 24 24" className="w-2/3 h-2/3 text-purple-400/70 pointer-events-none select-none" fill="none" stroke="currentColor" strokeWidth="3" style={{ transform: cw ? 'scaleX(1)' : 'scaleX(-1)' }}>
    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
    <polyline points="21 3 21 8 16 8" />
  </svg>
);
const IconFlip = () => (
  <svg viewBox="0 0 24 24" className="w-2/3 h-2/3 text-pink-400/70 pointer-events-none select-none" fill="none" stroke="currentColor" strokeWidth="3">
    <polyline points="17 1 21 5 17 9" />
    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <polyline points="7 23 3 19 7 15" />
    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </svg>
);
const IconLockedMech = () => (
  <svg viewBox="0 0 32 32" className="w-2/3 h-2/3 text-slate-500/70 pointer-events-none select-none" fill="currentColor">
    <circle cx="6" cy="6" r="2.5" />
    <circle cx="26" cy="6" r="2.5" />
    <circle cx="6" cy="26" r="2.5" />
    <circle cx="26" cy="26" r="2.5" />
  </svg>
);

// --- UTILS ---
const generateId = () => Math.random().toString(36).substr(2, 9);
const downloadJSON = (data, filename) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
const createEmptyBoard = (c, r) => Array(r).fill(null).map(() => 
  Array(c).fill(null).map(() => ({ type: 'empty', walls: {r:false, b:false, br:false, bl:false}, dead: false, lineId: null, isTarget: false, mechanicalLock: false }))
);

export default function App() {
  // App Navigation State
  const [appMode, setAppMode] = useState('title'); // title, local_setup, local, solo_setup, solo, campaign_select, campaign, editor
  const [isPlaytesting, setIsPlaytesting] = useState(false);
  const [backupState, setBackupState] = useState(null);
  
  const isBuildMode = appMode === 'editor' && !isPlaytesting;
  
  // Grid & Board State
  const [cols, setCols] = useState(DEFAULT_COLS);
  const [rows, setRows] = useState(DEFAULT_ROWS);
  const [board, setBoard] = useState(createEmptyBoard(DEFAULT_COLS, DEFAULT_ROWS));
  
  // Game State
  const [currentPlayer, setCurrentPlayer] = useState('X');
  const [scores, setScores] = useState({ X: 0, O: 0 });
  const [drawnLines, setDrawnLines] = useState([]);
  const [extraTurns, setExtraTurns] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [winMessage, setWinMessage] = useState('');
  
  // Campaign & Goals
  const [campaign, setCampaign] = useState([]);
  const [campaignIndex, setCampaignIndex] = useState(-1);
  const [currentGoal, setCurrentGoal] = useState({ type: 'standard', target: 0 });
  
  // Visual Novel Dialog
  const [dialogs, setDialogs] = useState([]);
  const [showDialog, setShowDialog] = useState(false);
  const [dialogIndex, setDialogIndex] = useState(0);

  // Editor State
  const [editorTab, setEditorTab] = useState('tools'); 
  const [editorTool, setEditorTool] = useState('empty');
  const [editorDir, setEditorDir] = useState('r');
  const [editorLetter, setEditorLetter] = useState('A');

  // Figma Canvas State
  const [pan, setPan] = useState({ x: 50, y: 50 });
  const [zoom, setZoom] = useState(1);
  const [isSpaceHeld, setIsSpaceHeld] = useState(false);
  const isDragging = useRef(false);
  const lastMouseDir = useRef('r'); // Tracks raw mouse movement direction
  const lastMouse = useRef({ x: 0, y: 0 });
  const canvasRef = useRef(null); // Missing ref restored

  useEffect(() => {
    fetch('./default.json')
      .then(res => res.json())
      .then(data => setCampaign(data))
      .catch(() => setCampaign(DEFAULT_CAMPAIGN_FALLBACK));
  }, []);

  // --- KEYBOARD & MOUSE TRACKING ---
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      
      const PAN_SPEED = 40;
      if (e.key === 'ArrowUp') setPan(p => ({...p, y: p.y + PAN_SPEED}));
      if (e.key === 'ArrowDown') setPan(p => ({...p, y: p.y - PAN_SPEED}));
      if (e.key === 'ArrowLeft') setPan(p => ({...p, x: p.x + PAN_SPEED}));
      if (e.key === 'ArrowRight') setPan(p => ({...p, x: p.x - PAN_SPEED}));
      
      if (e.code === 'Space') {
        setIsSpaceHeld(true);
        e.preventDefault(); // Prevents page scrolling down
      }
    };

    const handleKeyUp = (e) => {
      if (e.code === 'Space') {
        setIsSpaceHeld(false);
        isDragging.current = false; // Immediately stop panning
      }
    };

    const handleGlobalPointerMove = (e) => {
      // Dynamic Direction Tracking for Painter Tool
      if (Math.abs(e.movementX) > 2 || Math.abs(e.movementY) > 2) {
          if (Math.abs(e.movementX) > Math.abs(e.movementY)) {
              lastMouseDir.current = e.movementX > 0 ? 'r' : 'l';
          } else {
              lastMouseDir.current = e.movementY > 0 ? 'd' : 'u';
          }
      }
    };

    const handleBlur = () => {
      setIsSpaceHeld(false);
      isDragging.current = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    document.addEventListener('pointermove', handleGlobalPointerMove);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      document.removeEventListener('pointermove', handleGlobalPointerMove);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  const resetToTitle = () => {
    setCols(DEFAULT_COLS);
    setRows(DEFAULT_ROWS);
    setBoard(createEmptyBoard(DEFAULT_COLS, DEFAULT_ROWS));
    setDialogs([]);
    setScores({X:0, O:0});
    setDrawnLines([]);
    setExtraTurns(0);
    setCurrentPlayer('X');
    setGameOver(false);
    setIsPlaytesting(false);
    setBackupState(null);
    setPan({ x: 50, y: 50 }); // Reset Camera
    setZoom(1);
    setAppMode('title');
  };

  const initDebugLevel = () => {
    const size = 15;
    let b = createEmptyBoard(size, size);
    const elements = [
        {t: 'zapspace'},
        {t: 'dup', d: 'r'}, {t: 'dup', d: 'd'}, {t: 'dup', d: 'l'}, {t: 'dup', d: 'u'},
        {t: 'zap', d: 'r'}, {t: 'zap', d: 'd'}, {t: 'zap', d: 'l'}, {t: 'zap', d: 'u'},
        {t: 'mov', d: 'r'}, {t: 'mov', d: 'd'}, {t: 'mov', d: 'l'}, {t: 'mov', d: 'u'},
        {t: 'rot_cw'}, {t: 'rot_ccw'}, {t: 'flip'},
        {t: 'locked_mech'}, {t: 'locked_letter', l: 'A'}, {t: 'switch', l: 'A'},
        {t: 'target'}
    ];
    elements.forEach((el, i) => {
        let x = (i % 5) * 3 + 1;
        let y = Math.floor(i / 5) * 3 + 1;
        if (x < size && y < size) {
           b[y][x] = { ...b[y][x], type: el.t !== 'target' ? el.t : 'empty', dir: el.d, letter: el.l, isTarget: el.t === 'target' };
           // Surround walls for visual test
           b[y][x].walls = {r: true, b: true, bl: true, br: true};
        }
    });
    setCols(size); setRows(size); setBoard(b); setPan({x:50, y:50}); setZoom(1); setAppMode('local');
  };

  // --- FIGMA CANVAS LOGIC ---
  const handleWheel = (e) => {
    if (appMode.includes('setup') || appMode === 'title' || appMode === 'campaign_select') return;
    e.preventDefault();
    const zoomSensitivity = 0.0015;
    const delta = -e.deltaY * zoomSensitivity;
    setZoom(z => Math.max(0.2, Math.min(z + delta, 3)));
  };

 const handlePointerDown = (r, c) => {
  setIsPainting(true);
  const cell = grid[r][c];
  
  let action = true; // default add
  if (editorTool === 'target') {
    action = !cell.isTarget;
  } else if (editorTool === 'dot_locker') {
    action = !cell.isDotLocker;
  } else if (editorTool === 'zapspace') {
    action = cell.type !== 'zapspace';
  }
  
  setPaintAction(action);
  applyTool(r, c, action, editorTool); // Apply immediately to the first cell
};

  const handlePointerMove = (e) => {
    if (isDragging.current) {
      setPan(p => ({
        x: p.x + (e.clientX - lastMouse.current.x),
        y: p.y + (e.clientY - lastMouse.current.y)
      }));
      lastMouse.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handlePointerUp = (e) => { 
    if (isDragging.current) {
      isDragging.current = false; 
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // --- CORE LOGIC ENGINE ---
  const resolveTurn = (startX, startY) => {
    let b = JSON.parse(JSON.stringify(board));
    let q = [{ x: startX, y: startY, piece: currentPlayer, overwrite: false }];
    let linesToErase = new Set();
    let maxComboThisTurn = 0;
    
    const processReactions = (queue) => {
      let iters = 0;
      while (queue.length > 0 && iters < MAX_ITERATIONS) {
        iters++;
        let { x, y, piece, overwrite } = queue.shift();
        if (y < 0 || y >= rows || x < 0 || x >= cols) continue;
        if (b[y][x].type === 'void') continue;

        let cx = x, cy = y;
        
        if (b[cy][cx].type === 'zap') {
          while (true) {
            let dir = b[cy][cx].dir;
            let nx = cx + (dir === 'r' ? 1 : dir === 'l' ? -1 : 0);
            let ny = cy + (dir === 'd' ? 1 : dir === 'u' ? -1 : 0);
            if (ny < 0 || ny >= rows || nx < 0 || nx >= cols) break;
            if (b[ny][nx].type === 'void') break;
            
            let blocked = false;
            if (dir === 'r' && b[cy][cx].walls.r) blocked = true;
            if (dir === 'l' && b[ny][nx].walls.r) blocked = true;
            if (dir === 'd' && b[cy][cx].walls.b) blocked = true;
            if (dir === 'u' && b[ny][nx].walls.b) blocked = true;
            
            let nextCell = b[ny][nx];
            if (blocked || (nextCell.type === 'locked_letter' && !nextCell.unlocked) || nextCell.piece) break;
            
            cx = nx; cy = ny;
            if (nextCell.type !== 'zap') break; 
          }
        }

        let cell = b[cy][cx];
        if (cell.type === 'locked_letter' && !cell.unlocked) continue;
        if (cell.type === 'dup' || cell.type === 'zapspace' || cell.type === 'void') continue;
        if (cell.piece && !overwrite) continue;

        if (cell.piece && cell.dead && overwrite && cell.lineId) {
          linesToErase.add(cell.lineId);
        }

        if (cell.type === 'flip') piece = (piece === 'X' ? 'O' : 'X');

        cell.piece = piece;
        cell.dead = false;
        cell.lineId = null;

        if (cell.type === 'switch') {
          b.forEach(r => r.forEach(c => {
            if (c.type === 'locked_letter' && c.letter === cell.letter) c.unlocked = true;
          }));
        }

        const checkDup = (dx, dy, targetDir, pushX, pushY) => {
          let neighbor = b[cy + dy]?.[cx + dx];
          if (neighbor?.type === 'dup' && neighbor.dir === targetDir) {
            queue.push({ x: cx + pushX, y: cy + pushY, piece, overwrite: true });
          }
        };
        checkDup(1, 0, 'r', 2, 0);   
        checkDup(-1, 0, 'l', -2, 0);
        checkDup(0, 1, 'd', 0, 2);
        checkDup(0, -1, 'u', 0, -2);
      }
    };

    processReactions(q);

    let moverQueue = [];
    b.forEach((row, y) => {
      row.forEach((cell, x) => {
        if (cell.type === 'mov' && cell.piece && !cell.dead) {
          let nx = x + (cell.dir === 'r' ? 1 : cell.dir === 'l' ? -1 : 0);
          let ny = y + (cell.dir === 'd' ? 1 : cell.dir === 'u' ? -1 : 0);
          let blocked = false;
          if (cell.dir === 'r' && cell.walls.r) blocked = true;
          if (cell.dir === 'l' && nx >= 0 && b[ny][nx].walls.r) blocked = true;
          if (cell.dir === 'd' && cell.walls.b) blocked = true;
          if (cell.dir === 'u' && ny >= 0 && b[ny][nx].walls.b) blocked = true;
          
          if (!blocked && nx >= 0 && nx < cols && ny >= 0 && ny < rows && b[ny][nx].type !== 'void') {
            moverQueue.push({from: {x,y}, to: {x:nx, y:ny}, piece: cell.piece, rotation: cell.rotation || 0, isRot: false});
          }
        }
        if ((cell.type === 'rot_cw' || cell.type === 'rot_ccw') && !cell.dead) {
          let isCW = cell.type === 'rot_cw';
          const orthogonalDirs = [[0,-1], [1,0], [0,1], [-1,0]]; 
          
          orthogonalDirs.forEach(([dx, dy]) => {
             let px = x + dx, py = y + dy;
             if (px>=0 && px<cols && py>=0 && py<rows && b[py][px].type !== 'void') {
                 let pCell = b[py][px];
                 if (pCell.piece && !pCell.dead) {
                    let nx = x + (isCW ? -dy : dy);
                    let ny = y + (isCW ? dx : -dx);
                    if (nx>=0 && nx<cols && ny>=0 && ny<rows && b[ny][nx].type !== 'void') {
                       moverQueue.push({from: {x:px, y:py}, to: {x:nx, y:ny}, piece: pCell.piece, rotation: pCell.rotation || 0, isRot: true, isCW});
                    }
                 }
             }
          });
        }
      });
    });

    moverQueue.forEach(m => b[m.from.y][m.from.x].piece = null); 
    
    let newQueue = [];
    moverQueue.forEach(m => {
      let target = b[m.to.y][m.to.x];
      if (!target.piece && !target.type.startsWith('locked') && target.type !== 'dup' && target.type !== 'zapspace' && target.type !== 'void') {
         target.piece = m.piece;
         target.rotation = m.isRot ? m.rotation + (m.isCW ? 90 : -90) : m.rotation;
         newQueue.push({x: m.to.x, y: m.to.y, piece: m.piece, overwrite: false});
      } else {
         b[m.from.y][m.from.x].piece = m.piece; 
         b[m.from.y][m.from.x].rotation = m.rotation;
      }
    });

    if (newQueue.length > 0) processReactions(newQueue);

    let tempScores = { ...scores };
    let tempDrawnLines = [...drawnLines];
    
    if (linesToErase.size > 0) {
       linesToErase.forEach(id => {
          let owner = null;
          b.forEach(row => row.forEach(c => {
             if (c.lineId === id) {
                 owner = c.piece;
                 c.dead = false;
                 c.lineId = null;
             }
          }));
          if (owner) tempScores[owner]--;
          tempDrawnLines = tempDrawnLines.filter(d => d.id !== id);
       });
    }

    let earnedExtraTurns = 0;
    let linesFound = [];

    const checkLine = (startX, startY, dx, dy) => {
      let run = [];
      let cx = startX, cy = startY;
      
      const scoreRun = () => {
        ['X', 'O'].forEach(player => {
           let currentSeq = [];
           run.forEach(item => {
              let p = item.cell.piece;
              let isDead = item.cell.dead;
              let isWild = item.cell.type === 'zapspace';
              if (!isDead && (p === player || isWild)) {
                 currentSeq.push(item);
              } else {
                 evalSeq(currentSeq, player);
                 currentSeq = [];
              }
           });
           evalSeq(currentSeq, player);
        });
      };

      const evalSeq = (seq, player) => {
         let firstIdx = seq.findIndex(i => i.cell.piece === player);
         let lastIdx = seq.findLastIndex(i => i.cell.piece === player);
         if (firstIdx !== -1 && lastIdx !== -1 && (lastIdx - firstIdx + 1) >= 3) {
             linesFound.push({ player, seq: seq.slice(firstIdx, lastIdx + 1) });
         }
      };

      while (cx >= 0 && cx < cols && cy >= 0 && cy < rows) {
        let cell = b[cy][cx];
        if (cell.type === 'void') { scoreRun(); run = []; cx += dx; cy += dy; continue; }

        let nextX = cx + dx, nextY = cy + dy;
        let blocked = false;
        
        if (nextX >= 0 && nextX < cols && nextY >= 0 && nextY < rows) {
           if (dx===1 && dy===0 && cell.walls.r) blocked = true;
           if (dx===0 && dy===1 && cell.walls.b) blocked = true;
           
           if (dx===1 && dy===1 && b[cy]?.[nextX]?.walls?.bl) blocked = true; 
           if (dx===-1 && dy===1 && b[cy]?.[nextX]?.walls?.br) blocked = true; 
        } else { blocked = true; }

        run.push({x: cx, y: cy, cell});
        if (blocked) { scoreRun(); run = []; }
        cx = nextX; cy = nextY;
      }
      if (run.length > 0) scoreRun();
    };

    for(let y=0; y<rows; y++) checkLine(0, y, 1, 0); 
    for(let x=0; x<cols; x++) checkLine(x, 0, 0, 1); 
    for(let y=0; y<rows; y++) checkLine(0, y, 1, 1); 
    for(let x=1; x<cols; x++) checkLine(x, 0, 1, 1); 
    for(let y=0; y<rows; y++) checkLine(cols-1, y, -1, 1); 
    for(let x=0; x<cols-1; x++) checkLine(x, 0, -1, 1); 

    let pointsScoredThisTurn = 0;

    linesFound.forEach(line => {
      const lId = generateId();
      tempScores[line.player]++;
      
      if (line.player === currentPlayer) {
          pointsScoredThisTurn++;
          let longLineBonus = Math.max(0, line.seq.length - 3);
          earnedExtraTurns += longLineBonus;
          maxComboThisTurn = Math.max(maxComboThisTurn, longLineBonus);
      }
      
      line.seq.forEach(item => { 
         if (b[item.y][item.x].type !== 'zapspace') b[item.y][item.x].dead = true; 
         b[item.y][item.x].lineId = lId;
      });
      
      tempDrawnLines.push({
         id: lId,
         x1: line.seq[0].x, y1: line.seq[0].y,
         x2: line.seq[line.seq.length-1].x, y2: line.seq[line.seq.length-1].y,
         color: line.player === 'X' ? '#22d3ee' : '#fb7185'
      });
    });

    if (pointsScoredThisTurn > 1) {
       earnedExtraTurns += (pointsScoredThisTurn - 1);
    }

    let isFull = true;
    let targetsTotal = 0;
    let targetsFilled = 0;

    for (let r of b) {
      for (let c of r) {
        if (c.type === 'void') continue;
        if (!c.piece && ['empty', 'zap', 'mov', 'rot_cw', 'rot_ccw', 'flip', 'switch'].includes(c.type)) isFull = false;
        if (c.type === 'locked_letter' && c.unlocked && !c.piece) isFull = false;
        
        if (c.isTarget) {
           targetsTotal++;
           if (c.piece === 'X') targetsFilled++; 
        }
      }
    }

    setBoard(b);
    setScores(tempScores);
    setDrawnLines(tempDrawnLines);

    let matchOver = isFull;
    let wMsg = '';

    if (appMode === 'local' || isPlaytesting) {
       if (isFull) wMsg = tempScores.X > tempScores.O ? 'Player X Wins!' : tempScores.O > tempScores.X ? 'Player O Wins!' : 'Tie!';
    } else if (appMode === 'solo' || appMode === 'campaign') {
       const g = currentGoal;
       if (g.type === 'fill_targets' && targetsTotal > 0 && targetsFilled === targetsTotal) {
           matchOver = true; wMsg = 'Target Areas Filled! You Win!';
       } else if (g.type === 'min_combo' && maxComboThisTurn >= g.target) {
           matchOver = true; wMsg = `Combo of ${g.target} Reached! You Win!`;
       } else if (isFull) {
           if (g.type === 'standard') wMsg = tempScores.X > tempScores.O ? 'Victory!' : 'Defeat!';
           else if (g.type === 'exact_score') wMsg = tempScores.X === g.target ? 'Exact Score Reached! You Win!' : `Failed. Scored ${tempScores.X}, needed ${g.target}.`;
           else if (g.type === 'min_score') wMsg = tempScores.X >= g.target ? 'Score Goal Reached! You Win!' : `Failed. Scored ${tempScores.X}, needed ${g.target}.`;
           else if (g.type === 'max_score') wMsg = tempScores.X <= g.target ? 'Score Kept Low! You Win!' : `Failed. Scored ${tempScores.X}, needed under ${g.target}.`;
           else wMsg = 'Game Over';
       }
    }

    setGameOver(matchOver);
    if (matchOver) setWinMessage(wMsg);

    let totalExtra = extraTurns + earnedExtraTurns;
    if (totalExtra > 0) {
      setExtraTurns(totalExtra - 1);
    } else {
      setCurrentPlayer(p => (appMode === 'solo' || appMode === 'campaign') ? 'X' : (p === 'X' ? 'O' : 'X'));
    }
  };

  const handleCellInteract = (x, y, e) => {
    if (isDragging.current || isSpaceHeld) return; // Prevent painting while panning
    if (e.type === 'pointerenter' && (e.buttons !== 1 || !isBuildMode)) return; 
    if (gameOver && !isBuildMode) return;
    
    if (isBuildMode) {
      let b = [...board];
      b[y] = [...b[y]];

      if (editorTool === 'target_toggle') {
         if (e.type === 'pointerdown') b[y][x].isTarget = !b[y][x].isTarget;
         else if (e.type === 'pointerenter' && e.buttons === 1) b[y][x].isTarget = !b[y][x].isTarget; // Drag to toggle targets
      } else if (editorTool === 'place_x') {
         if (e.type === 'pointerdown' || (e.type === 'pointerenter' && e.buttons === 1)) {
            b[y][x] = { ...b[y][x], piece: 'X' };
         }
      } else if (editorTool === 'place_o') {
         if (e.type === 'pointerdown' || (e.type === 'pointerenter' && e.buttons === 1)) {
            b[y][x] = { ...b[y][x], piece: 'O' };
         }
      } else if (editorTool === 'locked_mech') {
         if (e.type === 'pointerdown' || (e.type === 'pointerenter' && e.buttons === 1)) {
            // Can be placed on any element except duplicator, rotate, void, and zapspace
            const forbiddenTypes = ['dup', 'rot_cw', 'rot_ccw', 'void', 'zapspace'];
            if (!forbiddenTypes.includes(b[y][x].type)) {
               b[y][x] = { ...b[y][x], mechanicalLock: !b[y][x].mechanicalLock };
            }
         }
      } else if (editorTool !== 'wall') {
         const finalDir = ['dup', 'zap', 'mov'].includes(editorTool) ? lastMouseDir.current : editorDir;
         b[y][x] = { ...b[y][x], type: editorTool, dir: finalDir, letter: editorLetter };
         if (editorTool === 'empty' || editorTool === 'void') {
            b[y][x].piece = null;
            b[y][x].mechanicalLock = false;
         }
      }
      setBoard(b);
      return;
    }

    let target = board[y][x];
    if (target.type === 'void') return;
    if (target.type === 'locked_letter' && !target.unlocked) return;
    if (target.type === 'locked_mech' || target.mechanicalLock || target.type === 'dup' || target.type === 'zapspace') return; 
    if (target.piece) return; 

    resolveTurn(x, y);
  };

  const toggleWall = (x, y, edge) => {
    let b = [...board];
    b[y] = [...b[y]];
    // Orthogonal
    if (edge === 'r') b[y][x].walls.r = !b[y][x].walls.r;
    if (edge === 'b') b[y][x].walls.b = !b[y][x].walls.b;
    if (edge === 'l' && x > 0) b[y][x-1] = {...b[y][x-1], walls: {...b[y][x-1].walls, r: !b[y][x-1].walls.r}};
    if (edge === 't' && y > 0) b[y-1][x] = {...b[y-1][x], walls: {...b[y-1][x].walls, b: !b[y-1][x].walls.b}};
    // Diagonal Corners
    if (edge === 'tl' && y > 0 && x > 0) b[y-1][x-1] = {...b[y-1][x-1], walls: {...b[y-1][x-1].walls, br: !b[y-1][x-1].walls.br}};
    if (edge === 'tr' && y > 0 && x < cols - 1) b[y-1][x+1] = {...b[y-1][x+1], walls: {...b[y-1][x+1].walls, bl: !b[y-1][x+1].walls.bl}};
    if (edge === 'bl') b[y][x].walls.bl = !b[y][x].walls.bl;
    if (edge === 'br') b[y][x].walls.br = !b[y][x].walls.br;
    
    setBoard(b);
  };

  // --- DATA MANAGEMENT ---
  const loadLevel = (levelData) => {
    setCols(levelData.cols || levelData.gridSize || 9);
    setRows(levelData.rows || levelData.gridSize || 9);
    setBoard(JSON.parse(JSON.stringify(levelData.board))); 
    setCurrentGoal(levelData.goal || { type: 'standard', target: 0 });
    
    let d = levelData.dialogs || [];
    if (levelData.preLevelDialog && d.length === 0) {
        d = levelData.preLevelDialog.split('\n').filter(l => l.trim()).map(line => {
           let s = line.indexOf(':');
           if (s > -1) return { name: line.slice(0, s).trim(), text: line.slice(s + 1).trim() };
           return { name: 'System', text: line.trim() };
        });
    }
    setDialogs(d);

    setScores({X:0, O:0});
    setDrawnLines([]);
    setExtraTurns(0);
    setCurrentPlayer('X');
    setGameOver(false);
    setWinMessage('');
    setPan({ x: 50, y: 50 }); // Reset Camera
    setZoom(1);

    if (d.length > 0 && appMode !== 'editor') {
       setDialogIndex(0);
       setShowDialog(true);
    }
  };

  const handleLevelImport = (e, callback) => {
    const file = e.target.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = (ev) => {
      try {
        const d = JSON.parse(ev.target.result);
        callback(d);
      } catch (err) { alert("Invalid JSON"); }
    };
    r.readAsText(file);
  };

  // --- RENDERERS ---
  if (appMode === 'title') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 selection:bg-cyan-500/30">
        <h1 className="text-5xl md:text-7xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-indigo-400 to-rose-400 mb-2 drop-shadow-[0_0_15px_rgba(56,189,248,0.4)]">
          TIC-TAC-TOE: EVOLVED
        </h1>
        <p className="text-slate-400 font-mono mb-12">The Ultimate Chain-Reaction Grid Engine</p>
        
        <div className="flex flex-col gap-4 w-full max-w-sm">
          <button onClick={() => setAppMode('local_setup')} className="p-4 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl border border-slate-700 transition-all hover:scale-105">
            PLAY LOCALLY (Hotseat)
          </button>
          <button onClick={() => setAppMode('campaign_select')} className="p-4 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 font-bold rounded-xl border border-indigo-500/50 transition-all hover:scale-105">
            PLAY CAMPAIGN
          </button>
          <button onClick={() => setAppMode('solo_setup')} className="p-4 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 font-bold rounded-xl border border-emerald-500/50 transition-all hover:scale-105">
            PLAY SOLO (Puzzle Mode)
          </button>
          <button onClick={() => { setAppMode('editor'); setBoard(createEmptyBoard(DEFAULT_COLS, DEFAULT_ROWS)); }} className="p-4 bg-amber-600/20 hover:bg-amber-600/40 text-amber-300 font-bold rounded-xl border border-amber-500/50 transition-all hover:scale-105">
            LEVEL / CAMPAIGN EDITOR
          </button>
          <button onClick={() => alert('Network functionality coming soon!')} className="p-4 bg-slate-900 text-slate-600 font-bold rounded-xl border border-slate-800 cursor-not-allowed">
            PLAY ONLINE (Soon)
          </button>
          <button onClick={initDebugLevel} className="mt-4 p-2 bg-rose-900/20 text-rose-500 font-bold rounded-xl border border-rose-900/50 transition-all hover:bg-rose-900/40 text-sm">
            [DEV] SPAWN DEBUG LEVEL
          </button>
        </div>
      </div>
    );
  }

  // --- SETUP MENUS ---
  if (appMode === 'local_setup' || appMode === 'solo_setup') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
         <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl max-w-md w-full shadow-2xl flex flex-col gap-6">
            <h2 className="text-2xl font-black text-white">{appMode === 'local_setup' ? 'LOCAL MATCH CONFIG' : 'SOLO PUZZLE CONFIG'}</h2>
            
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="text-xs text-slate-400 font-bold block mb-1">GRID WIDTH</label>
                <input type="number" min="1" max="30" value={cols} onChange={(e) => setCols(Math.max(1, parseInt(e.target.value) || 1))} className="w-full bg-slate-800 text-white p-2 rounded outline-none border border-slate-700" />
              </div>
              <div className="flex-1">
                <label className="text-xs text-slate-400 font-bold block mb-1">GRID HEIGHT</label>
                <input type="number" min="1" max="30" value={rows} onChange={(e) => setRows(Math.max(1, parseInt(e.target.value) || 1))} className="w-full bg-slate-800 text-white p-2 rounded outline-none border border-slate-700" />
              </div>
            </div>

            <div className="relative">
               <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-800"></div></div>
               <div className="relative flex justify-center"><span className="bg-slate-900 px-2 text-xs text-slate-500 font-bold">OR</span></div>
            </div>

            <div>
               <label className="w-full py-3 bg-slate-800 text-slate-300 rounded font-bold cursor-pointer text-center block hover:bg-slate-700 border border-slate-700">
                  IMPORT LEVEL JSON
                  <input type="file" accept=".json" className="hidden" onChange={(e) => handleLevelImport(e, (d) => {
                     setCols(d.cols || d.gridSize || 9);
                     setRows(d.rows || d.gridSize || 9);
                     setBoard(JSON.parse(JSON.stringify(d.board)));
                     setCurrentGoal(d.goal || { type: 'standard', target: 0 });
                     alert("Level Loaded!");
                  })} />
               </label>
            </div>

            <div className="flex gap-2 mt-4">
               <button onClick={resetToTitle} className="px-4 py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded">CANCEL</button>
               <button onClick={() => {
                  if (!board || board.length !== rows || board[0].length !== cols) setBoard(createEmptyBoard(cols, rows));
                  setScores({X:0,O:0}); setDrawnLines([]); setExtraTurns(0); setCurrentPlayer('X'); setGameOver(false);
                  setAppMode(appMode === 'local_setup' ? 'local' : 'solo');
               }} className="flex-1 py-3 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded">START MATCH</button>
            </div>
         </div>
      </div>
    );
  }

  if (appMode === 'campaign_select') {
     return (
        <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
           <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl max-w-lg w-full shadow-2xl flex flex-col gap-6">
              <h2 className="text-2xl font-black text-white">CAMPAIGN SELECT</h2>
              
              <div className="max-h-64 overflow-y-auto space-y-2 bg-slate-950 p-3 rounded-lg border border-slate-800">
                 {campaign.map((lvl, i) => (
                    <button key={i} onClick={() => {
                       setCampaignIndex(i);
                       loadLevel(lvl);
                       setAppMode('campaign');
                    }} className="w-full flex justify-between items-center bg-slate-800 hover:bg-indigo-600/30 p-3 rounded text-sm transition-colors border border-slate-700">
                       <span className="font-bold text-slate-200">Level {i+1}</span>
                       <span className="text-slate-500 text-xs">{lvl.cols}x{lvl.rows}</span>
                    </button>
                 ))}
                 {campaign.length === 0 && <p className="text-slate-500 text-center text-sm py-4">No campaign loaded.</p>}
              </div>

              <div>
                 <label className="w-full py-3 bg-slate-800 text-slate-300 rounded font-bold cursor-pointer text-center block hover:bg-slate-700 border border-slate-700">
                    IMPORT CAMPAIGN JSON
                    <input type="file" accept=".json" className="hidden" onChange={(e) => handleLevelImport(e, (d) => {
                       if(Array.isArray(d)) { setCampaign(d); alert("Campaign Loaded!"); }
                       else alert("Invalid Campaign JSON");
                    })} />
                 </label>
              </div>

              <div className="flex gap-2">
                 <button onClick={resetToTitle} className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded">BACK TO TITLE</button>
              </div>
           </div>
        </div>
     );
  }

  // --- MAIN GAME UI ---
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-cyan-500/30 flex flex-col h-screen overflow-hidden select-none">
      
      {/* DIALOG OVERLAY (Visual Novel Style) */}
      {showDialog && dialogs.length > 0 && (
        <div className="absolute inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-end justify-center pb-8 p-4 pointer-events-auto">
           <div className="bg-slate-900 border border-slate-700 p-6 rounded-2xl max-w-3xl w-full shadow-2xl flex flex-col gap-3 transition-all transform translate-y-0 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1.5 h-full bg-cyan-500"></div>
              <h2 className="text-xl font-black text-cyan-400 tracking-wider pl-2">{dialogs[dialogIndex].name}</h2>
              <p className="text-slate-200 whitespace-pre-wrap text-lg leading-relaxed pl-2 pb-6">{dialogs[dialogIndex].text}</p>
              
              <div className="flex justify-end mt-2">
                 <button onClick={() => {
                     if (dialogIndex < dialogs.length - 1) setDialogIndex(d => d + 1);
                     else setShowDialog(false);
                 }} className="px-8 py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-lg transition-colors flex items-center gap-2 border border-slate-700">
                   {dialogIndex < dialogs.length - 1 ? 'NEXT ▶' : 'START MATCH'}
                 </button>
              </div>
           </div>
        </div>
      )}

      {/* HEADER */}
      <div className="w-full flex flex-wrap justify-between items-center p-4 border-b border-slate-800 bg-slate-900/50 z-10 shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={resetToTitle} className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-xs font-bold rounded text-slate-400 transition-colors">&larr; BACK</button>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-white leading-none">TTT: EVOLVED</h1>
            <p className="text-indigo-400 text-[10px] sm:text-xs font-mono uppercase font-bold">
              {appMode === 'campaign' ? `Campaign Level ${campaignIndex + 1}/${campaign.length}` : isPlaytesting ? 'PLAYTEST MODE' : `${appMode} Mode`}
            </p>
          </div>
        </div>

        {appMode === 'campaign' && (
           <select 
             value={campaignIndex} 
             onChange={(e) => { setCampaignIndex(Number(e.target.value)); loadLevel(campaign[Number(e.target.value)]); }}
             className="bg-slate-800 text-white text-xs font-bold p-2 rounded border border-slate-700 outline-none"
           >
             {campaign.map((_, i) => <option key={i} value={i}>Level {i + 1}</option>)}
           </select>
        )}

        <div className="flex gap-4 sm:gap-6 font-mono bg-slate-950 p-2 rounded-lg border border-slate-800">
          <div className={`flex items-center gap-2 ${currentPlayer === 'X' ? 'text-cyan-400' : 'text-slate-500'}`}>
            <span className="text-xl font-black">X</span>
            <span className="text-xs">{(appMode === 'solo' || appMode === 'campaign') ? 'YOU' : 'P1'}: <strong className="text-white text-base">{scores.X}</strong></span>
          </div>
          {(appMode === 'local' || appMode === 'editor') && (
            <div className={`flex items-center gap-2 ${currentPlayer === 'O' ? 'text-rose-400' : 'text-slate-500'}`}>
              <span className="text-xl font-black">O</span>
              <span className="text-xs">P2: <strong className="text-white text-base">{scores.O}</strong></span>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        
        {/* SIDEBAR */}
        <div className="w-64 sm:w-72 bg-slate-900/90 border-r border-slate-800 p-4 flex flex-col gap-4 overflow-y-auto z-10 shrink-0 shadow-xl">
          {appMode === 'editor' && !isPlaytesting ? (
            <div className="flex flex-col gap-4">
              <div className="flex gap-1 border-b border-slate-800 pb-2">
                 <button onClick={()=>setEditorTab('tools')} className={`flex-1 text-[10px] font-bold py-1.5 rounded ${editorTab==='tools' ? 'bg-indigo-600 text-white':'text-slate-400 hover:bg-slate-800'}`}>TOOLS</button>
                 <button onClick={()=>setEditorTab('settings')} className={`flex-1 text-[10px] font-bold py-1.5 rounded ${editorTab==='settings' ? 'bg-indigo-600 text-white':'text-slate-400 hover:bg-slate-800'}`}>MAP</button>
                 <button onClick={()=>setEditorTab('dialog')} className={`flex-1 text-[10px] font-bold py-1.5 rounded ${editorTab==='dialog' ? 'bg-indigo-600 text-white':'text-slate-400 hover:bg-slate-800'}`}>DIALOG</button>
                 <button onClick={()=>setEditorTab('campaign')} className={`flex-1 text-[10px] font-bold py-1.5 rounded ${editorTab==='campaign' ? 'bg-indigo-600 text-white':'text-slate-400 hover:bg-slate-800'}`}>CAMP.</button>
              </div>

              {editorTab === 'tools' && (
                <>
                  <button onClick={() => {
                     setBackupState({
                        board: JSON.parse(JSON.stringify(board)),
                        scores: {...scores}, drawnLines: [...drawnLines], extraTurns, currentPlayer, gameOver
                     });
                     setScores({X:0,O:0}); setDrawnLines([]); setExtraTurns(0); setCurrentPlayer('X'); setGameOver(false);
                     setIsPlaytesting(true);
                  }} className="w-full py-2 bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 hover:bg-emerald-500/30 font-bold rounded text-xs tracking-wider mb-2">
                     ▶ TEST LEVEL
                  </button>

                  <div className="grid grid-cols-3 gap-1.5">
                    {['empty', 'void', 'wall'].map(t => (
                      <button key={t} onClick={() => setEditorTool(t)} className={`p-1.5 rounded border text-[10px] uppercase font-bold ${editorTool === t ? 'bg-indigo-500/30 border-indigo-400 text-indigo-200' : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'}`}>
                        {t}
                      </button>
                    ))}
                  </div>

                  <label className="text-[10px] text-slate-500 font-bold uppercase mt-2 block">Pieces</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {['place_x', 'place_o'].map(t => (
                      <button key={t} onClick={() => setEditorTool(t)} className={`p-1.5 rounded border text-[10px] uppercase font-bold ${editorTool === t ? 'bg-green-500/30 border-green-400 text-green-200' : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'}`}>
                        {t === 'place_x' ? 'PLACE X' : 'PLACE O'}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {['zapspace', 'flip', 'switch'].map(t => (
                      <button key={t} onClick={() => setEditorTool(t)} className={`p-1.5 rounded border text-[10px] uppercase font-bold ${editorTool === t ? 'bg-indigo-500/30 border-indigo-400 text-indigo-200' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
                        {t}
                      </button>
                    ))}
                    {['locked_letter', 'locked_mech', 'target_toggle'].map(t => (
                      <button key={t} onClick={() => setEditorTool(t)} className={`p-1.5 rounded border text-[10px] uppercase font-bold ${editorTool === t ? 'bg-amber-500/30 border-amber-400 text-amber-200' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
                        {t === 'locked_letter' ? 'Lock Ltr' : t === 'locked_mech' ? 'Lock Dot' : 'Target'}
                      </button>
                    ))}
                  </div>
                  
                  {['switch', 'locked_letter'].includes(editorTool) && (
                    <div className="flex justify-between mt-1 gap-1">
                      {['A', 'B', 'C', 'D'].map(l => (
                         <button key={l} onClick={() => setEditorLetter(l)} className={`flex-1 p-1 rounded border text-xs font-bold ${editorLetter === l ? 'bg-amber-500/30 border-amber-400 text-amber-200' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
                           {l}
                         </button>
                      ))}
                    </div>
                  )}

                  <label className="text-[10px] text-slate-500 font-bold uppercase mt-2 block">Entities</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {['dup', 'zap', 'mov', 'rot_cw', 'rot_ccw'].map(t => (
                      <button key={t} onClick={() => setEditorTool(t)} className={`p-1.5 rounded border text-[10px] uppercase font-bold ${editorTool === t ? 'bg-indigo-500/30 border-indigo-400 text-indigo-200' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
                        {t.replace('_', ' ')}
                      </button>
                    ))}
                  </div>
                  
                  <div className="text-[10px] text-slate-400 mt-2 p-2 bg-slate-950 rounded leading-relaxed border border-slate-800">
                    <p><strong>Brush:</strong> Drag mouse across tiles to paint. Entities will face your drag direction!</p>
                    <p><strong>Walls:</strong> Click Edges for orthogonal walls. Click Corners for diagonal blocks.</p>
                    <p><strong>Pieces:</strong> Place predefined X and O pieces for puzzle setups.</p>
                    <p><strong>Lock Dot:</strong> Toggle mechanical locks as overlays on most cell types.</p>
                  </div>
                </>
              )}

              {editorTab === 'settings' && (
                <div className="flex flex-col gap-3">
                  <div className="p-3 bg-slate-950 rounded border border-slate-800 flex flex-col gap-2">
                    <label className="text-[10px] text-slate-500 font-bold uppercase">Dimensions</label>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <span className="text-xs text-slate-400 mb-1 block">Width (X)</span>
                        <input type="number" min="1" max="30" value={cols} onChange={(e) => {
                          let v = parseInt(e.target.value) || 1;
                          setCols(v); setBoard(createEmptyBoard(v, rows));
                        }} className="w-full bg-slate-800 text-white p-1 rounded border border-slate-700 text-sm outline-none" />
                      </div>
                      <div className="flex-1">
                        <span className="text-xs text-slate-400 mb-1 block">Height (Y)</span>
                        <input type="number" min="1" max="30" value={rows} onChange={(e) => {
                          let v = parseInt(e.target.value) || 1;
                          setRows(v); setBoard(createEmptyBoard(cols, v));
                        }} className="w-full bg-slate-800 text-white p-1 rounded border border-slate-700 text-sm outline-none" />
                      </div>
                    </div>
                    <button onClick={() => setBoard(createEmptyBoard(cols, rows))} className="mt-2 w-full py-1.5 bg-rose-500/20 text-rose-400 rounded border border-rose-500/30 text-[10px] font-bold">CLEAR BOARD</button>
                  </div>
                  
                  <div className="p-3 bg-slate-950 rounded border border-slate-800">
                     <label className="text-[10px] text-slate-500 font-bold uppercase mb-2 block">Level Goal</label>
                     <select value={currentGoal.type} onChange={(e) => setCurrentGoal({...currentGoal, type: e.target.value})} className="w-full bg-slate-800 text-white text-xs p-1.5 rounded mb-2 border border-slate-700 outline-none">
                        <option value="standard">Standard (Highest Score)</option>
                        <option value="exact_score">Exact Score</option>
                        <option value="min_score">Minimum Score</option>
                        <option value="max_score">Maximum Score</option>
                        <option value="fill_targets">Fill Target Spaces</option>
                        <option value="min_combo">Minimum Combo</option>
                     </select>
                     {currentGoal.type !== 'standard' && currentGoal.type !== 'fill_targets' && (
                        <input type="number" value={currentGoal.target} onChange={(e) => setCurrentGoal({...currentGoal, target: Number(e.target.value)})} className="w-full bg-slate-800 text-white p-1.5 text-xs rounded border border-slate-700 outline-none" placeholder="Target Value" />
                     )}
                  </div>
                </div>
              )}

              {editorTab === 'dialog' && (
                 <div className="flex flex-col gap-3">
                    <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
                       {dialogs.map((d, i) => (
                          <div key={i} className="bg-slate-950 p-2 rounded border border-slate-800 flex flex-col gap-1.5">
                             <div className="flex justify-between items-center gap-2">
                                <input value={d.name} onChange={e => { let nd=[...dialogs]; nd[i].name=e.target.value; setDialogs(nd); }} className="bg-slate-800 text-cyan-400 font-bold p-1 text-xs w-2/3 outline-none rounded border border-slate-700" placeholder="Character Name" />
                                <button onClick={() => setDialogs(dialogs.filter((_, idx)=>idx!==i))} className="text-rose-500 hover:text-rose-400 font-black px-2">X</button>
                             </div>
                             <textarea value={d.text} onChange={e => { let nd=[...dialogs]; nd[i].text=e.target.value; setDialogs(nd); }} className="bg-slate-800 text-white p-1.5 text-xs outline-none rounded border border-slate-700 resize-none" rows="3" placeholder="Dialogue text..."></textarea>
                          </div>
                       ))}
                    </div>
                    <button onClick={() => setDialogs([...dialogs, {name:'System', text:''}])} className="w-full py-2 bg-indigo-500/20 text-indigo-300 rounded text-[10px] font-bold border border-indigo-500/50 hover:bg-indigo-500/40">
                      + ADD DIALOG LINE
                    </button>
                 </div>
              )}

              {editorTab === 'campaign' && (
                <div className="flex flex-col gap-3 flex-1 h-full">
                  <button onClick={() => setCampaign([...campaign, {cols, rows, board, dialogs, goal: currentGoal}])} className="w-full py-2 bg-indigo-500/20 text-indigo-300 rounded text-[10px] font-bold border border-indigo-500/50 hover:bg-indigo-500/40">
                    + APPEND BOARD TO CAMPAIGN
                  </button>
                  
                  <div className="flex-1 overflow-y-auto space-y-1.5 bg-slate-950 p-2 rounded border border-slate-800 min-h-[100px]">
                     {campaign.map((lvl, i) => (
                       <div key={i} className="flex justify-between items-center bg-slate-900 p-1.5 rounded text-xs border border-slate-800">
                         <span className="font-bold text-slate-300">Lvl {i+1} <span className="text-slate-500 text-[10px]">({lvl.cols}x{lvl.rows})</span></span>
                         <button onClick={() => setCampaign(campaign.filter((_, idx) => idx !== i))} className="text-rose-500 hover:text-rose-400 font-black px-2">X</button>
                       </div>
                     ))}
                     {campaign.length === 0 && <p className="text-[10px] text-slate-600 text-center py-4">Campaign Empty</p>}
                  </div>

                  <div className="flex flex-col gap-2 mt-auto">
                     <button onClick={() => downloadJSON(campaign, 'campaign.json')} disabled={!campaign.length} className="w-full py-1.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded text-[10px] font-bold disabled:opacity-50">EXPORT CAMPAIGN (.JSON)</button>
                     <button onClick={() => downloadJSON({cols, rows, board, dialogs, goal: currentGoal}, 'level.json')} className="w-full py-1.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded text-[10px] font-bold">EXPORT LEVEL (.JSON)</button>
                     
                     <label className="w-full py-1.5 bg-slate-800 text-slate-300 border border-slate-700 rounded text-[10px] font-bold cursor-pointer text-center block hover:bg-slate-700">
                        IMPORT LEVEL / CAMPAIGN
                        <input type="file" accept=".json" className="hidden" onChange={(e) => handleLevelImport(e, (d) => {
                           if (Array.isArray(d)) setCampaign(d);
                           else loadLevel(d);
                        })} />
                     </label>
                  </div>
                </div>
              )}

            </div>
          ) : (
            <div className="flex flex-col gap-4">
               {isPlaytesting && (
                  <button onClick={() => {
                     setBoard(backupState.board);
                     setScores(backupState.scores);
                     setDrawnLines(backupState.drawnLines);
                     setExtraTurns(backupState.extraTurns);
                     setCurrentPlayer(backupState.currentPlayer);
                     setGameOver(backupState.gameOver);
                     setIsPlaytesting(false);
                  }} className="w-full py-3 bg-rose-600 hover:bg-rose-500 text-white rounded text-sm font-bold shadow-lg flex justify-center items-center gap-2 border border-rose-400">
                     ⏹ STOP PLAYTEST
                  </button>
               )}
               {gameOver ? (
                  <div className="text-center p-4 bg-slate-950 rounded-xl border border-slate-800 shadow-xl">
                    <h2 className="text-xl font-black text-white mb-2">{appMode === 'campaign' ? 'LEVEL COMPLETE' : 'MATCH OVER'}</h2>
                    <p className="text-slate-300 text-sm mb-4 font-bold text-amber-400">{winMessage}</p>
                    
                    {appMode === 'campaign' && campaignIndex < campaign.length - 1 ? (
                       <button onClick={() => { setCampaignIndex(campaignIndex + 1); loadLevel(campaign[campaignIndex + 1]); }} className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-bold">
                         NEXT LEVEL &rarr;
                       </button>
                    ) : (
                       <button onClick={() => {
                          if (appMode === 'campaign') { setCampaignIndex(0); loadLevel(campaign[0]); }
                          else if (isPlaytesting) {} // do nothing, handled by stop button
                          else { 
                              setBoard(createEmptyBoard(cols, rows)); setScores({X:0,O:0}); setDrawnLines([]); setGameOver(false); 
                              setPan({ x: 50, y: 50 }); setZoom(1); 
                          }
                       }} className="w-full py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-sm font-bold" disabled={isPlaytesting}>
                         {isPlaytesting ? "USE STOP BUTTON" : "PLAY AGAIN"}
                       </button>
                    )}
                  </div>
               ) : (
                 <>
                   <div className="text-center p-4 bg-slate-950 rounded-xl border border-slate-800 shadow-xl relative overflow-hidden">
                     <p className="text-[10px] text-slate-500 font-bold tracking-widest uppercase mb-1">Turn</p>
                     <div className={`text-6xl font-black transition-colors ${currentPlayer === 'X' ? 'text-cyan-400' : 'text-rose-400'} drop-shadow-md`}>
                       {currentPlayer}
                     </div>
                     {extraTurns > 0 && (
                       <div className="mt-3 inline-block px-3 py-1 bg-emerald-500/20 text-emerald-400 rounded-full text-xs font-bold border border-emerald-500/30 animate-pulse">
                         + {extraTurns} EXTRA TURN{extraTurns > 1 ? 'S' : ''}
                       </div>
                     )}
                   </div>

                   <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex flex-col gap-2">
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Active Goal</p>
                      <p className="text-sm font-bold text-indigo-300">
                         {currentGoal.type === 'standard' && 'Score the most lines to win!'}
                         {currentGoal.type === 'exact_score' && `Get exactly ${currentGoal.target} points.`}
                         {currentGoal.type === 'min_score' && `Get at least ${currentGoal.target} points.`}
                         {currentGoal.type === 'max_score' && `Stay under ${currentGoal.target} points.`}
                         {currentGoal.type === 'fill_targets' && 'Place pieces on all Target zones.'}
                         {currentGoal.type === 'min_combo' && `Score an extra-turn combo of ${currentGoal.target}.`}
                      </p>
                   </div>

                   <div className="text-[10px] sm:text-xs text-slate-400 space-y-2 bg-slate-950 p-4 rounded-xl border border-slate-800 mt-auto">
                     <p><strong className="text-white text-[10px] uppercase block mb-0.5">Navigation</strong>Space+Drag, Middle-Click, or Arrow Keys to Pan. Scroll to Zoom.</p>
                     <div className="w-full h-px bg-slate-800 my-2"></div>
                     <p><strong className="text-white">&gt; 3 Rule:</strong> Lines &gt;3 grant <code className="text-amber-400 bg-slate-900 px-1 rounded">L-3</code> extra turns!</p>
                     <p><strong className="text-white">Multi-Points:</strong> Scoring multiple independent lines at once grants <code className="text-amber-400 bg-slate-900 px-1 rounded">+1</code> turn per extra line!</p>
                     <p><strong className="text-white">Line Break:</strong> Duping onto a dead piece breaks the old line, revives its pieces, and steals a point.</p>
                   </div>
                 </>
               )}
            </div>
          )}
        </div>

        {/* FIGMA CANVAS AREA */}
        <div 
           className={`flex-1 overflow-hidden bg-[#0f172a] relative transition-cursor ${isDragging.current ? 'cursor-grabbing' : (isSpaceHeld ? 'cursor-grab' : 'cursor-crosshair')}`}
           style={{ backgroundImage: 'radial-gradient(#334155 1px, transparent 1px)', backgroundSize: '40px 40px', backgroundPosition: `${pan.x}px ${pan.y}px` }}
           onWheel={handleWheel}
           onPointerDown={handlePointerDown}
           onPointerMove={handlePointerMove}
           onPointerUp={handlePointerUp}
           onPointerLeave={handlePointerUp}
           ref={canvasRef}
        >
          {/* Zoom & Pan Container */}
          <div 
             className="absolute"
             style={{ 
               transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, 
               transformOrigin: '0 0',
               width: `${cols * 60}px`, 
               height: `${rows * 60}px` 
             }}
          >
            <div 
              className="w-full h-full grid relative shadow-2xl shadow-black/80 bg-slate-900 border border-slate-800"
              style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
            >
              
              {/* SVG OVERLAY (Lines & Walls) */}
              <svg className="absolute top-0 left-0 w-full h-full pointer-events-none z-30" style={{ overflow: 'visible' }}>
                {board.map((row, y) => row.map((cell, x) => (
                  <React.Fragment key={`wall-${x}-${y}`}>
                    {/* Orthogonal Walls */}
                    {cell.walls.r && <line x1={`${(x+1)*100/cols}%`} y1={`${y*100/rows}%`} x2={`${(x+1)*100/cols}%`} y2={`${(y+1)*100/rows}%`} stroke="#94a3b8" strokeWidth="4" strokeLinecap="round" className="drop-shadow-[0_0_3px_rgba(0,0,0,0.8)]" />}
                    {cell.walls.b && <line x1={`${x*100/cols}%`} y1={`${(y+1)*100/rows}%`} x2={`${(x+1)*100/cols}%`} y2={`${(y+1)*100/rows}%`} stroke="#94a3b8" strokeWidth="4" strokeLinecap="round" className="drop-shadow-[0_0_3px_rgba(0,0,0,0.8)]" />}
                    
                    {/* Corner Diagonal Walls (Intersecting precisely at vertices) */}
                    {cell.walls.br && <line x1={`${(x+0.8)*100/cols}%`} y1={`${(y+0.8)*100/rows}%`} x2={`${(x+1.2)*100/cols}%`} y2={`${(y+1.2)*100/rows}%`} stroke="#94a3b8" strokeWidth="6" strokeLinecap="round" className="drop-shadow-[0_0_3px_rgba(0,0,0,0.8)]" />}
                    {cell.walls.bl && <line x1={`${(x+0.2)*100/cols}%`} y1={`${(y+0.8)*100/rows}%`} x2={`${(x-0.2)*100/cols}%`} y2={`${(y+1.2)*100/rows}%`} stroke="#94a3b8" strokeWidth="6" strokeLinecap="round" className="drop-shadow-[0_0_3px_rgba(0,0,0,0.8)]" />}
                  </React.Fragment>
                )))}

                {/* Score Lines */}
                {drawnLines.map((line) => (
                  <line 
                    key={line.id} 
                    x1={`${(line.x1 + 0.5) * 100 / cols}%`} 
                    y1={`${(line.y1 + 0.5) * 100 / rows}%`} 
                    x2={`${(line.x2 + 0.5) * 100 / cols}%`} 
                    y2={`${(line.y2 + 0.5) * 100 / rows}%`} 
                    stroke={line.color} 
                    strokeWidth="6" 
                    strokeLinecap="round" 
                    className="opacity-90 drop-shadow-[0_0_8px_rgba(255,255,255,0.7)]" 
                  />
                ))}
              </svg>

              {/* RENDER CELLS */}
              {board.map((row, y) => 
                row.map((cell, x) => {
                  const isVoid = cell.type === 'void';
                  return (
                    <div 
                      key={`${y}-${x}`}
                      onPointerDown={(e) => handleCellInteract(x, y, e)}
                      onPointerEnter={(e) => handleCellInteract(x, y, e)}
                      onPointerMove={(e) => {
                          if (isBuildMode && e.buttons === 1 && !isDragging.current && !isSpaceHeld) {
                              if (['dup', 'zap', 'mov'].includes(editorTool) && board[y][x].type === editorTool) {
                                  if (board[y][x].dir !== lastMouseDir.current) {
                                      let b = [...board];
                                      b[y] = [...b[y]];
                                      b[y][x] = { ...b[y][x], dir: lastMouseDir.current };
                                      setBoard(b);
                                  }
                              }
                          }
                      }}
                      className={`
                        relative w-full h-full transition-colors duration-200 box-border
                        ${isVoid ? 'bg-transparent' : 'border border-slate-950/80 bg-slate-800/60'}
                        ${!isVoid && cell.isTarget ? 'bg-indigo-900/40 shadow-[inset_0_0_15px_rgba(99,102,241,0.3)]' : ''}
                        ${!isVoid && isBuildMode && !editorTool.startsWith('wall') ? 'hover:bg-slate-700' : ''}
                        ${!isVoid && !isBuildMode && !cell.piece && !cell.type.startsWith('locked') ? 'hover:bg-slate-700 cursor-pointer' : ''}
                        ${!isBuildMode && (cell.piece || cell.type.startsWith('locked')) ? 'cursor-default' : ''}
                      `}
                    >
                      {/* WALL EDITOR OVERLAYS */}
                      {!isVoid && isBuildMode && editorTool === 'wall' && (
                        <>
                          <div className="absolute top-0 left-1/4 w-1/2 h-1/4 hover:bg-emerald-400/50 z-40 cursor-crosshair" onPointerDown={(e) => { e.stopPropagation(); toggleWall(x, y, 't'); }} />
                          <div className="absolute bottom-0 left-1/4 w-1/2 h-1/4 hover:bg-emerald-400/50 z-40 cursor-crosshair" onPointerDown={(e) => { e.stopPropagation(); toggleWall(x, y, 'b'); }} />
                          <div className="absolute top-1/4 left-0 w-1/4 h-1/2 hover:bg-emerald-400/50 z-40 cursor-crosshair" onPointerDown={(e) => { e.stopPropagation(); toggleWall(x, y, 'l'); }} />
                          <div className="absolute top-1/4 right-0 w-1/4 h-1/2 hover:bg-emerald-400/50 z-40 cursor-crosshair" onPointerDown={(e) => { e.stopPropagation(); toggleWall(x, y, 'r'); }} />
                          
                          <div className="absolute top-0 left-0 w-1/4 h-1/4 hover:bg-amber-400/50 z-40 cursor-crosshair" onPointerDown={(e) => { e.stopPropagation(); toggleWall(x, y, 'tl'); }} />
                          <div className="absolute top-0 right-0 w-1/4 h-1/4 hover:bg-amber-400/50 z-40 cursor-crosshair" onPointerDown={(e) => { e.stopPropagation(); toggleWall(x, y, 'tr'); }} />
                          <div className="absolute bottom-0 left-0 w-1/4 h-1/4 hover:bg-amber-400/50 z-40 cursor-crosshair" onPointerDown={(e) => { e.stopPropagation(); toggleWall(x, y, 'bl'); }} />
                          <div className="absolute bottom-0 right-0 w-1/4 h-1/4 hover:bg-amber-400/50 z-40 cursor-crosshair" onPointerDown={(e) => { e.stopPropagation(); toggleWall(x, y, 'br'); }} />
                        </>
                      )}

                      {!isVoid && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-1.5 select-none">
                          {cell.type === 'zapspace' && <IconZapspace dead={cell.dead} />}
                          {cell.type === 'dup' && <IconDup dir={cell.dir} />}
                          {cell.type === 'zap' && <IconZap dir={cell.dir} />}
                          {cell.type === 'mov' && <IconMov dir={cell.dir} />}
                          {cell.type === 'rot_cw' && <IconRot cw={true} />}
                          {cell.type === 'rot_ccw' && <IconRot cw={false} />}
                          {cell.type === 'flip' && <IconFlip />}
                          {cell.type === 'locked_mech' && <IconLockedMech />}
                          
                          {cell.type === 'switch' && (
                             <span className="font-mono text-xs font-bold text-amber-400 select-none">[{cell.letter}]</span>
                          )}
                          
                          {cell.type === 'locked_letter' && (
                             <div className={`border-2 rounded font-mono text-xs font-black flex items-center justify-center w-2/3 h-2/3 select-none
                               ${cell.unlocked ? 'border-slate-700 text-slate-700' : 'border-slate-500 text-slate-400'}`}>
                               {cell.letter}
                             </div>
                          )}

                          {cell.mechanicalLock && (
                            <div className="absolute z-5 inset-0 flex items-center justify-center pointer-events-none">
                              <IconLockedMech />
                            </div>
                          )}

                          {cell.piece && (
                            <div 
                              className={`absolute z-10 font-black transition-all duration-300 text-3xl select-none
                                ${cell.piece === 'X' ? 'text-cyan-400' : 'text-rose-400'}
                                ${cell.dead && cell.type !== 'zapspace' ? 'opacity-30 grayscale blur-[0.5px]' : 'drop-shadow-[0_0_8px_rgba(255,255,255,0.6)]'}`}
                              style={{ transform: `rotate(${cell.rotation || 0}deg)` }}
                            >
                              {cell.piece}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}



