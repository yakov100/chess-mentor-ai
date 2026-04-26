import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import {
  RotateCcw,
  FlipVertical2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Trash2,
  Copy,
  ClipboardPaste,
  Sun,
  Moon,
  FileText,
  Check,
  Radio,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface HistoryEntry {
  fen: string;
  san: string;
  moveNumber: number;
  color: 'w' | 'b';
  from: string;
  to: string;
}

type SquareStyles = Record<string, React.CSSProperties>;

// ─── Constants ────────────────────────────────────────────────────────────────

const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const PIECE_VALUES: Record<string, number> = {
  p: 1, n: 3, b: 3, r: 5, q: 9, k: 0,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

// whiteCaptured = black pieces that white has taken (shown next to white)
// blackCaptured = white pieces that black has taken (shown next to black)
function getCapturedPieces(fen: string): { whiteCaptured: string[]; blackCaptured: string[] } {
  const START: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };
  const onBoard: Record<string, number> = {};
  for (const ch of fen.split(' ')[0]) {
    if (/[pnbrqPNBRQ]/.test(ch)) {
      onBoard[ch] = (onBoard[ch] || 0) + 1;
    }
  }
  const whiteCaptured: string[] = []; // black pieces taken by white
  const blackCaptured: string[] = []; // white pieces taken by black
  for (const [p, start] of Object.entries(START)) {
    const blackMissing = start - (onBoard[p] || 0);
    const whiteMissing = start - (onBoard[p.toUpperCase()] || 0);
    for (let i = 0; i < blackMissing; i++) whiteCaptured.push(p);
    for (let i = 0; i < whiteMissing; i++) blackCaptured.push(p.toUpperCase());
  }
  return { whiteCaptured, blackCaptured };
}

function getMaterialBalance(fen: string): number {
  const piecePart = fen.split(' ')[0];
  let balance = 0;
  for (const ch of piecePart) {
    if (/[PNBRQ]/.test(ch)) balance += PIECE_VALUES[ch.toLowerCase()];
    else if (/[pnbrq]/.test(ch)) balance -= PIECE_VALUES[ch];
  }
  return balance;
}

function formatMoveList(
  history: HistoryEntry[],
): Array<{ number: number; white?: HistoryEntry & { idx: number }; black?: HistoryEntry & { idx: number } }> {
  const pairs: Array<{
    number: number;
    white?: HistoryEntry & { idx: number };
    black?: HistoryEntry & { idx: number };
  }> = [];

  history.forEach((entry, idx) => {
    if (entry.color === 'w') {
      pairs.push({ number: entry.moveNumber, white: { ...entry, idx } });
    } else {
      const last = pairs[pairs.length - 1];
      if (last && last.black === undefined) {
        last.black = { ...entry, idx };
      } else {
        pairs.push({ number: entry.moveNumber, black: { ...entry, idx } });
      }
    }
  });

  return pairs;
}

function buildPgn(history: HistoryEntry[], startFen: string): string {
  let pgn = '';
  if (startFen !== INITIAL_FEN) pgn += `[FEN "${startFen}"]\n\n`;
  history.forEach((entry, i) => {
    if (entry.color === 'w') pgn += `${entry.moveNumber}. `;
    pgn += entry.san + ' ';
    if (i === history.length - 1) {
      const game = new Chess(entry.fen);
      if (game.isCheckmate()) pgn += game.turn() === 'w' ? '0-1' : '1-0';
      else if (game.isDraw()) pgn += '1/2-1/2';
    }
  });
  return pgn.trim();
}

const PIECE_SYMBOLS: Record<string, string> = {
  P: '♙', N: '♘', B: '♗', R: '♖', Q: '♕',
  p: '♟', n: '♞', b: '♝', r: '♜', q: '♛',
};

// Compare FEN positions by board layout + active turn only.
// Ignores castling rights, en passant, and move counters so that the
// simplified FENs produced by the bookmarklet (which cannot infer these)
// still match the accurate FENs maintained by chess.js.
function normalizeFen(fen: string): string {
  return fen.split(' ').slice(0, 2).join(' ');
}

function getInitialFenFromUrl(): string {
  const url = new URL(window.location.href);
  const fenFromQuery = url.searchParams.get('fen');
  const fenFromHash = url.hash.startsWith('#fen=') ? decodeURIComponent(url.hash.slice(5)) : null;
  const incoming = fenFromQuery || fenFromHash;
  if (!incoming) return INITIAL_FEN;

  try {
    return new Chess(incoming).fen();
  } catch {
    return INITIAL_FEN;
  }
}

// If incomingFen is reachable from fromFen via exactly one legal move, return
// that move's from/to squares. Returns null otherwise.
function findMoveForFen(fromFen: string, incomingFen: string): { from: string; to: string } | null {
  const normalizedTarget = normalizeFen(incomingFen);
  try {
    const game = new Chess(fromFen);
    for (const move of game.moves({ verbose: true })) {
      const g = new Chess(fromFen);
      g.move(move);
      if (normalizeFen(g.fen()) === normalizedTarget) {
        return { from: move.from, to: move.to };
      }
    }
  } catch {
    // invalid FEN
  }
  return null;
}

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  const initialFen = useMemo(getInitialFenFromUrl, []);
  const [dark, setDark] = useState(false);
  const [boardFlipped, setBoardFlipped] = useState(false);

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [startFen, setStartFen] = useState(initialFen);
  const [currentFen, setCurrentFen] = useState(initialFen);

  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [legalMoveSquares, setLegalMoveSquares] = useState<SquareStyles>({});
  const [highlightSquares, setHighlightSquares] = useState<SquareStyles>({});

  const [fenInput, setFenInput] = useState('');
  const [fenError, setFenError] = useState('');
  const [copied, setCopied] = useState<'fen' | 'pgn' | null>(null);

  const [syncEnabled, setSyncEnabled] = useState(true);
  const [isSyncConnected, setIsSyncConnected] = useState(false);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const moveListRef = useRef<HTMLDivElement>(null);
  const bookmarkletAnchorRef = useRef<HTMLAnchorElement>(null);

  // ── Name this window so the bookmarklet can target the existing tab ───────
  useEffect(() => {
    window.name = 'chess-mentor-ai';
    // Signal to the bookmarklet (running on chess.com) that we're ready to receive
    try {
      if (window.opener) {
        window.opener.postMessage({ type: 'chess-mentor-ready' }, '*');
      }
    } catch {
      // cross-origin opener access may be restricted
    }
  }, []);

  // ── Allow blocked-popup fallback links to open a captured Chess.com FEN ───
  useEffect(() => {
    const url = new URL(window.location.href);
    const fenFromQuery = url.searchParams.get('fen');
    const fenFromHash = url.hash.startsWith('#fen=') ? decodeURIComponent(url.hash.slice(5)) : null;
    const incoming = fenFromQuery || fenFromHash;
    if (!incoming) return;

    try {
      const game = new Chess(incoming);
      const validated = game.fen();
      setHistory([]);
      setCurrentIndex(-1);
      setStartFen(validated);
      setCurrentFen(validated);
      setHighlightSquares({});
      setLegalMoveSquares({});
      setSelectedSquare(null);
      url.searchParams.delete('fen');
      if (url.hash.startsWith('#fen=')) url.hash = '';
      window.history.replaceState(null, '', url.toString());
    } catch {
      // Ignore invalid fallback URLs.
    }
  }, []);

  // ── Sync dark mode ────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  // ── Auto-scroll move list ─────────────────────────────────────────────────
  useEffect(() => {
    if (moveListRef.current) {
      const active = moveListRef.current.querySelector('[data-active="true"]');
      active?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [currentIndex]);

  // ── Navigate to a history index ───────────────────────────────────────────
  // Defined FIRST so keyboard handler can reference it safely
  const goTo = useCallback(
    (index: number, hist: HistoryEntry[] = history) => {
      const clamped = Math.max(-1, Math.min(hist.length - 1, index));
      setCurrentIndex(clamped);
      setSelectedSquare(null);
      setLegalMoveSquares({});
      if (clamped === -1) {
        setCurrentFen(startFen);
        setHighlightSquares({});
      } else {
        const entry = hist[clamped];
        setCurrentFen(entry.fen);
        setHighlightSquares({
          [entry.from]: { backgroundColor: 'rgba(255, 214, 0, 0.45)' },
          [entry.to]: { backgroundColor: 'rgba(255, 214, 0, 0.45)' },
        });
      }
    },
    [history, startFen],
  );

  // ── Keyboard navigation ───────────────────────────────────────────────────
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowLeft') goTo(currentIndex - 1);
      else if (e.key === 'ArrowRight') goTo(currentIndex + 1);
      else if (e.key === 'Home') goTo(-1);
      else if (e.key === 'End') goTo(history.length - 1);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [goTo, currentIndex, history.length]);

  // ── Bookmarklet URL (generated once from current page URL) ───────────────
  const bookmarkletUrl = useMemo(() => {
    const targetUrl = window.location.href.split('?')[0].split('#')[0];

    // Two-layer FEN extraction strategy:
    //  Layer 1 (dom): read piece positions from .piece.square-XY elements —
    //    this reflects the board the user is actually seeing on chess.com.
    //  Layer 2 (api): call chess.com's internal JS game object only if DOM
    //    extraction fails. Internal API state can be stale on some pages.
    const script = `(function(){
var u=${JSON.stringify(targetUrl)};
var w=null,last=null,timer=null;
function connect(){
  w=window.open(u,'chess-mentor-ai');
  if(!w)w=window.open(u,'_blank');
  return !!w;
}
function showBlocked(){
  var old=document.getElementById('chess-mentor-connect');
  if(old)old.remove();
  var box=document.createElement('div');
  box.id='chess-mentor-connect';
  box.style.cssText='position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:320px;padding:14px;border-radius:12px;background:#111827;color:white;font:14px Arial,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.35);direction:rtl;text-align:right';
  var title=document.createElement('div');
  title.textContent='Chess Mentor מוכן לעקוב אחרי הלוח';
  title.style.cssText='font-weight:700;margin-bottom:8px';
  var msg=document.createElement('div');
  msg.textContent='הדפדפן חסם פתיחה אוטומטית. לחץ כאן פעם אחת כדי לחבר את הטאב.';
  msg.style.cssText='font-size:12px;line-height:1.4;margin-bottom:10px;color:#d1d5db';
  var btn=document.createElement('button');
  btn.type='button';
  btn.textContent='התחבר ל-Chess Mentor';
  btn.style.cssText='width:100%;padding:8px 10px;border:0;border-radius:8px;background:#16a34a;color:white;font-weight:700;cursor:pointer';
  btn.onclick=function(){
    if(connect()){box.remove();start();}
    else msg.textContent='עדיין חסום. אפשר pop-ups מ-chess.com ואז לחץ שוב.';
  };
  var link=document.createElement('a');
  link.textContent='או פתח את העמדה הנוכחית ללא מעקב חי';
  link.target='chess-mentor-ai';
  link.style.cssText='display:block;margin-top:8px;color:#93c5fd;text-decoration:underline;font-size:12px;text-align:center';
  function refreshLink(){
    var f=dom()||api();
    link.href=f?u+(u.indexOf('?')===-1?'?':'&')+'fen='+encodeURIComponent(f):u;
  }
  refreshLink();
  var linkTimer=setInterval(refreshLink,500);
  var close=document.createElement('button');
  close.type='button';
  close.textContent='×';
  close.setAttribute('aria-label','סגור');
  close.style.cssText='position:absolute;left:8px;top:6px;border:0;background:transparent;color:#9ca3af;font-size:18px;cursor:pointer';
  close.onclick=function(){clearInterval(linkTimer);box.remove();};
  box.appendChild(close);box.appendChild(title);box.appendChild(msg);box.appendChild(btn);box.appendChild(link);
  document.body.appendChild(box);
}
var PM={'wp':'P','wn':'N','wb':'B','wr':'R','wq':'Q','wk':'K','bp':'p','bn':'n','bb':'b','br':'r','bq':'q','bk':'k'};
function board(){return document.querySelector('wc-chess-board')||document.querySelector('chess-board');}
function api(){
  var b=board();
  if(!b)return null;
  var ms=[
    function(){return b.game.getFen();},
    function(){var f=b.game.fen;return typeof f==='string'?f:null;},
    function(){return b.game.getFEN();},
    function(){return b._game.getFen();},
    function(){var c=b._controller;return c&&c.game&&c.game.getFen();},
    function(){return b.controller.getFen();},
    function(){return b.controller.game.getFen();},
    function(){var g=b.getAttribute('fen');return(g&&g.split(' ').length>=4)?g:null;},
    function(){var g=b.gameSetup;return g&&g.fen?g.fen:null;},
    function(){var v=b.__vue_app__;if(!v)return null;var inst=v._instance||v._container&&v._container.__vueParentComponent;if(inst&&inst.proxy&&inst.proxy.game)return inst.proxy.game.getFen();}
  ];
  for(var i=0;i<ms.length;i++){
    try{var f=ms[i]();if(f&&typeof f==='string'&&f.split(' ').length>=4)return f;}catch(e){}
  }
  return null;
}
function pieces(){
  var pp=document.querySelectorAll('.piece');
  if(pp&&pp.length)return pp;
  var boards=['wc-chess-board','chess-board'];
  for(var i=0;i<boards.length;i++){
    var b=document.querySelector(boards[i]);
    var sr=b&&b.shadowRoot;
    if(sr){var p=sr.querySelectorAll('.piece');if(p&&p.length)return p;}
  }
  return null;
}
function turn(){
  var ss=[
    '[data-ply]','vertical-move-list .move',
    '.node-highlight-content','.move-text-component',
    '.moves-list-row','.move'
  ];
  for(var i=0;i<ss.length;i++){
    var n=document.querySelectorAll(ss[i]);
    if(n&&n.length>0)return n.length%2===0?'w':'b';
  }
  var b=board();
  if(b){
    try{var t=b.game.getTurn?b.game.getTurn():b.game.turn;if(t==='white')return 'w';if(t==='black')return 'b';}catch(e){}
  }
  return 'w';
}
function dom(){
  var pp=pieces();
  if(!pp||!pp.length)return null;
  var bd={};
  [].forEach.call(pp,function(el){
    var cl=[].slice.call(el.classList),pc=null,sq=null;
    for(var i=0;i<cl.length;i++){
      if(PM[cl[i]])pc=cl[i];
      if(/^square-[1-8][1-8]$/.test(cl[i]))sq=cl[i];
    }
    if(pc&&sq)bd[String.fromCharCode(96+parseInt(sq[7]))+sq[8]]=PM[pc];
  });
  var wk=false,bk=false;
  for(var s in bd){if(bd[s]==='K')wk=true;if(bd[s]==='k')bk=true;}
  if(!wk||!bk)return null;
  var fen='';
  for(var r=8;r>=1;r--){
    if(r<8)fen+='/';
    var e=0;
    for(var f=1;f<=8;f++){
      var p=bd[String.fromCharCode(96+f)+r];
      if(p){if(e){fen+=e;e=0;}fen+=p;}else e++;
    }
    if(e)fen+=e;
  }
  return fen+' '+turn()+' - - 0 1';
}
function send(f){
  if(!w||w.closed)return;
  try{w.postMessage({type:'chess-sync',fen:f},'*');}catch(e){}
}
function tick(){
  var f=dom()||api();
  if(f){last=f;send(f);}
}
// Re-send immediately when chess-mentor-ai signals it's ready
window.addEventListener('message',function(e){
  if(e.data&&e.data.type==='chess-mentor-ready'){last=null;tick();}
});
function start(){
  if(timer)return;
  tick();
  timer=setInterval(tick,500);
}
if(connect())start();else showBlocked();
})()`;
    return `javascript:${encodeURIComponent(script)}`;
  }, []);

  // ── Bypass React's javascript: URL sanitization by setting href via DOM ref ─
  useEffect(() => {
    if (bookmarkletAnchorRef.current) {
      bookmarkletAnchorRef.current.setAttribute('href', bookmarkletUrl);
    }
  }, [bookmarkletUrl]);

  // ── Internal: apply a chess.js Move and update state ─────────────────────
  const applyMove = useCallback(
    (game: Chess, from: string, to: string) => {
      const pieceType = game.get(from as Parameters<typeof game.get>[0])?.type ?? '';
      const isPromotion =
        pieceType === 'p' &&
        ((game.turn() === 'w' && to[1] === '8') || (game.turn() === 'b' && to[1] === '1'));

      const move = game.move({ from, to, promotion: isPromotion ? 'q' : undefined });
      if (!move) return false;

      const newEntry: HistoryEntry = {
        fen: game.fen(),
        san: move.san,
        moveNumber: move.color === 'w' ? game.moveNumber() - 1 : game.moveNumber() - 1,
        color: move.color as 'w' | 'b',
        from: move.from,
        to: move.to,
      };

      // Fix move number: after white moves, fullMoveNumber incremented for black's turn,
      // we want the move number at time of move
      const chess2 = new Chess(currentFen);
      newEntry.moveNumber = chess2.moveNumber();

      const newHistory = [...history.slice(0, currentIndex + 1), newEntry];
      setHistory(newHistory);
      setSelectedSquare(null);
      setLegalMoveSquares({});
      setHighlightSquares({
        [move.from]: { backgroundColor: 'rgba(255, 214, 0, 0.45)' },
        [move.to]: { backgroundColor: 'rgba(255, 214, 0, 0.45)' },
      });
      goTo(newHistory.length - 1, newHistory);
      return true;
    },
    [currentFen, currentIndex, history, goTo],
  );

  // ── Live sync: postMessage listener + same-origin tab relay ───────────────
  useEffect(() => {
    if (!syncEnabled) {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      setIsSyncConnected(false);
      return;
    }

    const relay =
      typeof BroadcastChannel === 'undefined'
        ? null
        : new BroadcastChannel('chess-mentor-ai-sync');

    const applyIncomingFen = (incoming: string) => {
      // Mark as connected and reset the connection-lost timer
      setIsSyncConnected(true);
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = setTimeout(() => setIsSyncConnected(false), 3000);

      // Ignore if already at this position
      if (normalizeFen(incoming) === normalizeFen(currentFen)) return;

      // Case 1: incoming FEN is exactly one legal move ahead — apply it
      const found = findMoveForFen(currentFen, incoming);
      if (found) {
        const game = new Chess(currentFen);
        applyMove(game, found.from, found.to);
        return;
      }

      // Case 2: completely different position — load as fresh start FEN
      try {
        const g = new Chess(incoming);
        const validated = g.fen();
        setHistory([]);
        setCurrentIndex(-1);
        setStartFen(validated);
        setCurrentFen(validated);
        setHighlightSquares({});
        setLegalMoveSquares({});
        setSelectedSquare(null);
      } catch {
        // ignore invalid FEN
      }
    };

    const handler = (e: MessageEvent) => {
      if (e.data?.type !== 'chess-sync' || typeof e.data.fen !== 'string') return;
      applyIncomingFen(e.data.fen);
      relay?.postMessage(e.data);
    };

    const relayHandler = (e: MessageEvent) => {
      if (e.data?.type !== 'chess-sync' || typeof e.data.fen !== 'string') return;
      applyIncomingFen(e.data.fen);
    };

    window.addEventListener('message', handler);
    relay?.addEventListener('message', relayHandler);
    return () => {
      window.removeEventListener('message', handler);
      relay?.removeEventListener('message', relayHandler);
      relay?.close();
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    };
  }, [syncEnabled, currentFen, applyMove]);

  // ── Drag-and-drop handler ─────────────────────────────────────────────────
  const onDrop = useCallback(
    ({ sourceSquare, targetSquare }: { sourceSquare: string; targetSquare: string | null; piece: { pieceType: string } }): boolean => {
      if (!targetSquare) return false;
      const game = new Chess(currentFen);
      return applyMove(game, sourceSquare, targetSquare);
    },
    [currentFen, applyMove],
  );

  // ── Click-to-move ─────────────────────────────────────────────────────────
  const onSquareClick = useCallback(
    ({ square }: { square: string; piece: { pieceType: string } | null }) => {
      const game = new Chess(currentFen);

      // If a piece is already selected
      if (selectedSquare) {
        const legalTargets = game.moves({ square: selectedSquare as Parameters<typeof game.moves>[0]['square'], verbose: true })
          .map(m => m.to);

        if ((legalTargets as string[]).includes(square)) {
          applyMove(game, selectedSquare, square);
          return;
        }
      }

      // Select piece if it belongs to the current player
      const piece = game.get(square as Parameters<typeof game.get>[0]);
      if (piece && piece.color === game.turn()) {
        setSelectedSquare(square);
        const moves = game.moves({ square: square as Parameters<typeof game.moves>[0]['square'], verbose: true });
        const styles: SquareStyles = {
          [square]: { backgroundColor: 'rgba(99,132,255,0.35)' },
        };
        moves.forEach(m => {
          styles[m.to] = {
            background: game.get(m.to as Parameters<typeof game.get>[0])
              ? 'radial-gradient(circle, rgba(220,50,50,0.45) 60%, transparent 62%)'
              : 'radial-gradient(circle, rgba(0,0,0,0.25) 25%, transparent 27%)',
            borderRadius: '50%',
          };
        });
        setLegalMoveSquares(styles);
      } else {
        setSelectedSquare(null);
        setLegalMoveSquares({});
      }
    },
    [currentFen, selectedSquare, applyMove],
  );

  // ── Reset ─────────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    setHistory([]);
    setCurrentIndex(-1);
    setStartFen(INITIAL_FEN);
    setCurrentFen(INITIAL_FEN);
    setHighlightSquares({});
    setLegalMoveSquares({});
    setSelectedSquare(null);
    setFenInput('');
    setFenError('');
  }, []);

  // ── Load FEN ──────────────────────────────────────────────────────────────
  const loadFen = useCallback(() => {
    const fen = fenInput.trim();
    if (!fen) return;
    try {
      const game = new Chess(fen);
      const validated = game.fen();
      setHistory([]);
      setCurrentIndex(-1);
      setStartFen(validated);
      setCurrentFen(validated);
      setHighlightSquares({});
      setLegalMoveSquares({});
      setSelectedSquare(null);
      setFenError('');
      setFenInput('');
    } catch {
      setFenError('FEN לא תקין');
    }
  }, [fenInput]);

  // ── Copy helpers ──────────────────────────────────────────────────────────
  const copyWithFeedback = useCallback(async (text: string, type: 'fen' | 'pgn') => {
    await navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 1500);
  }, []);

  // ── Derived state ─────────────────────────────────────────────────────────
  const game = new Chess(currentFen);
  const gameStatus = (() => {
    if (game.isCheckmate()) return { label: 'מט!', color: '#ef4444' };
    if (game.isStalemate()) return { label: 'פאט', color: '#eab308' };
    if (game.isDraw()) return { label: 'תיקו', color: '#eab308' };
    if (game.isCheck()) return { label: `שאח! תור ${game.turn() === 'w' ? 'לבן' : 'שחור'}`, color: '#f97316' };
    return {
      label: game.turn() === 'w' ? '♙ תור לבן' : '♟ תור שחור',
      color: 'var(--color-text-muted)',
    };
  })();

  const movePairs = formatMoveList(history);
  const pgn = buildPgn(history, startFen);
  const { whiteCaptured, blackCaptured } = getCapturedPieces(currentFen);
  const materialBalance = getMaterialBalance(currentFen);

  const combinedSquareStyles: SquareStyles = { ...highlightSquares, ...legalMoveSquares };

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen flex flex-col items-center gap-4 p-3 md:p-5"
      style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
    >
      {/* Header */}
      <header className="w-full max-w-5xl flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">♟ לוח ניתוח שחמט</h1>
        <button
          onClick={() => setDark(d => !d)}
          className="p-2 rounded-lg hover:opacity-70 transition-opacity"
          style={{ backgroundColor: 'var(--color-surface-card)', border: '1px solid var(--color-border)' }}
          title={dark ? 'מצב בהיר' : 'מצב כהה'}
        >
          {dark ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </header>

      {/* Main layout */}
      <div className="w-full max-w-5xl flex flex-col lg:flex-row gap-4 items-start">

        {/* ── Left: Board ─────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-2 w-full lg:flex-1">

          {/* Black captured (white pieces taken by black, shown near black) */}
          <CapturedRow
            pieces={blackCaptured}
            advantage={materialBalance < 0 ? Math.abs(materialBalance) : 0}
            side="black"
          />

          {/* Status + action buttons */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold" style={{ color: gameStatus.color }}>
              {gameStatus.label}
            </span>
            <div className="flex gap-1">
              <IconBtn title="סיבוב לוח" onClick={() => setBoardFlipped(f => !f)}>
                <FlipVertical2 size={15} />
              </IconBtn>
              <IconBtn title="איפוס למיקום ראשוני" onClick={reset}>
                <RotateCcw size={15} />
              </IconBtn>
            </div>
          </div>

          {/* Board — dir ltr so RTL page doesn't mirror the squares */}
          <div dir="ltr" style={{ width: '100%', maxWidth: 520 }}>
            <Chessboard
              options={{
                position: currentFen,
                onPieceDrop: onDrop,
                onSquareClick: onSquareClick,
                boardOrientation: boardFlipped ? 'black' : 'white',
                squareStyles: combinedSquareStyles,
                boardStyle: {
                  borderRadius: '6px',
                  boxShadow: '0 4px 24px rgba(0,0,0,0.2)',
                },
                darkSquareStyle: { backgroundColor: '#769656' },
                lightSquareStyle: { backgroundColor: '#eeeed2' },
                animationDurationInMs: 120,
              }}
            />
          </div>

          {/* White captured (black pieces taken by white, shown near white) */}
          <CapturedRow
            pieces={whiteCaptured}
            advantage={materialBalance > 0 ? materialBalance : 0}
            side="white"
          />

          {/* Navigation controls */}
          <div className="flex items-center justify-center gap-2 mt-1">
            <NavBtn onClick={() => goTo(-1)} disabled={currentIndex === -1} title="התחלה">
              <ChevronsLeft size={17} />
            </NavBtn>
            <NavBtn onClick={() => goTo(currentIndex - 1)} disabled={currentIndex === -1} title="קודם (←)">
              <ChevronLeft size={17} />
            </NavBtn>
            <span className="text-xs tabular-nums px-2" style={{ color: 'var(--color-text-muted)' }}>
              {currentIndex + 1} / {history.length}
            </span>
            <NavBtn onClick={() => goTo(currentIndex + 1)} disabled={currentIndex === history.length - 1} title="הבא (→)">
              <ChevronRight size={17} />
            </NavBtn>
            <NavBtn onClick={() => goTo(history.length - 1)} disabled={currentIndex === history.length - 1} title="סוף">
              <ChevronsRight size={17} />
            </NavBtn>
          </div>
        </div>

        {/* ── Right: Side panel ────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 lg:w-64 w-full">

          {/* Move list */}
          <Panel>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-semibold">מהלכים</span>
              <button
                onClick={() => { setHistory([]); goTo(-1, []); }}
                title="נקה מהלכים"
                className="p-1 rounded hover:opacity-60 transition-opacity"
              >
                <Trash2 size={13} style={{ color: 'var(--color-text-muted)' }} />
              </button>
            </div>

            <div
              ref={moveListRef}
              className="overflow-y-auto flex flex-col gap-0.5"
              style={{ maxHeight: 260, minHeight: 64 }}
            >
              {movePairs.length === 0 ? (
                <p className="text-xs text-center py-5" style={{ color: 'var(--color-text-muted)' }}>
                  גרור כלי או לחץ עליו להתחיל
                </p>
              ) : (
                movePairs.map(pair => (
                  <div key={pair.number} className="flex items-center gap-0.5 text-sm font-mono">
                    <span className="w-7 text-xs shrink-0 text-right pr-1" style={{ color: 'var(--color-text-muted)' }}>
                      {pair.number}.
                    </span>
                    {pair.white && (
                      <MoveChip
                        san={pair.white.san}
                        active={currentIndex === pair.white.idx}
                        onClick={() => goTo(pair.white!.idx)}
                      />
                    )}
                    {pair.black ? (
                      <MoveChip
                        san={pair.black.san}
                        active={currentIndex === pair.black.idx}
                        onClick={() => goTo(pair.black!.idx)}
                      />
                    ) : (
                      <span className="flex-1" />
                    )}
                  </div>
                ))
              )}
            </div>

            {/* PGN copy */}
            {history.length > 0 && (
              <button
                onClick={() => copyWithFeedback(pgn, 'pgn')}
                className="mt-2 w-full flex items-center justify-center gap-1.5 text-xs py-1.5 rounded transition-opacity hover:opacity-70"
                style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
              >
                {copied === 'pgn' ? <Check size={12} className="text-green-500" /> : <FileText size={12} />}
                {copied === 'pgn' ? 'הועתק!' : 'העתק PGN'}
              </button>
            )}
          </Panel>

          {/* FEN panel */}
          <Panel>
            <span className="text-sm font-semibold block mb-2">עמדה (FEN)</span>

            {/* Current FEN */}
            <div className="flex items-center gap-1 mb-2">
              <input
                readOnly
                value={currentFen}
                className="flex-1 text-xs rounded px-2 py-1 font-mono truncate"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-muted)',
                }}
              />
              <button
                onClick={() => copyWithFeedback(currentFen, 'fen')}
                title="העתק FEN"
                className="p-1.5 rounded hover:opacity-60 transition-opacity shrink-0"
              >
                {copied === 'fen' ? <Check size={13} className="text-green-500" /> : <Copy size={13} style={{ color: 'var(--color-text-muted)' }} />}
              </button>
            </div>

            {/* Load FEN input */}
            <div className="flex gap-1 mb-1">
              <input
                value={fenInput}
                onChange={e => { setFenInput(e.target.value); setFenError(''); }}
                onKeyDown={e => e.key === 'Enter' && loadFen()}
                placeholder="הדבק FEN לטעינת עמדה"
                className="flex-1 text-xs rounded px-2 py-1 font-mono"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  border: `1px solid ${fenError ? '#ef4444' : 'var(--color-border)'}`,
                  color: 'var(--color-text)',
                }}
                dir="ltr"
              />
              <button
                onClick={async () => {
                  const text = await navigator.clipboard.readText();
                  setFenInput(text.trim());
                  setFenError('');
                }}
                title="הדבק מלוח"
                className="p-1.5 rounded hover:opacity-60 transition-opacity shrink-0"
              >
                <ClipboardPaste size={13} style={{ color: 'var(--color-text-muted)' }} />
              </button>
            </div>
            {fenError && <p className="text-xs text-red-500 mb-1">{fenError}</p>}
            <button
              onClick={loadFen}
              disabled={!fenInput.trim()}
              className="w-full text-xs py-1.5 rounded font-medium transition-opacity disabled:opacity-35 hover:opacity-80"
              style={{ backgroundColor: 'var(--color-blue-deep)', color: '#fff' }}
            >
              טען עמדה
            </button>
          </Panel>

          {/* Live sync panel */}
          <Panel>
            <div className="flex items-center justify-between mb-2">
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                <Radio size={13} style={{ color: isSyncConnected ? '#22c55e' : 'var(--color-text-muted)' }} />
                עיקוב משחק חי
              </span>
              <span
                className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{
                  backgroundColor: isSyncConnected ? 'rgba(34,197,94,0.15)' : 'var(--color-surface)',
                  color: isSyncConnected ? '#16a34a' : 'var(--color-text-muted)',
                  border: '1px solid var(--color-border)',
                }}
              >
                {isSyncConnected ? 'מחובר' : 'ממתין'}
              </span>
            </div>

            <ol className="text-xs space-y-1 mb-3" style={{ color: 'var(--color-text-muted)' }}>
              <li>1. השאר דף זה פתוח בטאב</li>
              <li>2. גרור את הכפתור הירוק לסרגל הסימניות</li>
              <li>3. פתח משחק ב-chess.com ולחץ על הסימנייה</li>
              <li>4. אם מופיע כפתור חיבור ב-chess.com, לחץ עליו פעם אחת</li>
            </ol>

            {/* Bookmarklet drag target — href set via ref to bypass React's javascript: sanitization */}
            <a
              ref={bookmarkletAnchorRef}
              onClick={e => e.preventDefault()}
              draggable
              onDragStart={e => {
                e.dataTransfer.setData('text/uri-list', bookmarkletUrl);
                e.dataTransfer.setData('text/plain', bookmarkletUrl);
                e.dataTransfer.effectAllowed = 'copyLink';
              }}
              className="flex items-center justify-center gap-1.5 w-full text-xs py-2 px-3 rounded-lg font-semibold mb-2 select-none"
              style={{
                backgroundColor: '#16a34a',
                color: '#fff',
                cursor: 'grab',
                border: '2px dashed rgba(255,255,255,0.35)',
                textDecoration: 'none',
              }}
              title="גרור לסרגל הסימניות"
            >
              ♟ Chess Mentor — גרור לסרגל
            </a>

            <button
              onClick={() => setSyncEnabled(v => !v)}
              className="w-full text-xs py-1.5 rounded-lg transition-opacity hover:opacity-70"
              style={{
                backgroundColor: syncEnabled ? 'var(--color-surface)' : 'var(--color-blue-deep)',
                color: syncEnabled ? 'var(--color-text-muted)' : '#fff',
                border: '1px solid var(--color-border)',
              }}
            >
              {syncEnabled ? 'השהה עיקוב' : 'חדש עיקוב'}
            </button>
          </Panel>

          {/* Tips */}
          <div
            className="p-3 rounded-xl text-xs"
            style={{ backgroundColor: 'var(--color-blue)', border: '1px solid var(--color-border)' }}
          >
            <p className="font-semibold mb-1.5" style={{ color: 'var(--color-blue-deep)' }}>קיצורי מקלדת:</p>
            <div className="space-y-0.5" style={{ color: 'var(--color-text)' }}>
              <p><kbd className="font-mono font-bold">←</kbd> / <kbd className="font-mono font-bold">→</kbd> — ניווט מהלכים</p>
              <p><kbd className="font-mono font-bold">Home</kbd> / <kbd className="font-mono font-bold">End</kbd> — ראשון / אחרון</p>
              <p>לחץ על כלי לראות מהלכים אפשריים</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="p-3 rounded-xl"
      style={{
        backgroundColor: 'var(--color-surface-card)',
        border: '1px solid var(--color-border)',
      }}
    >
      {children}
    </div>
  );
}

function IconBtn({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="p-2 rounded-lg hover:opacity-60 transition-opacity"
      style={{ backgroundColor: 'var(--color-surface-card)', border: '1px solid var(--color-border)' }}
    >
      {children}
    </button>
  );
}

function NavBtn({
  children, onClick, disabled, title,
}: { children: React.ReactNode; onClick: () => void; disabled: boolean; title?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="p-2 rounded-lg transition-opacity disabled:opacity-25 hover:opacity-60"
      style={{ backgroundColor: 'var(--color-surface-card)', border: '1px solid var(--color-border)' }}
    >
      {children}
    </button>
  );
}

function MoveChip({ san, active, onClick }: { san: string; active: boolean; onClick: () => void }) {
  return (
    <button
      data-active={active}
      onClick={onClick}
      className="flex-1 px-1.5 py-0.5 rounded text-xs font-mono text-left transition-colors"
      style={{
        backgroundColor: active ? 'var(--color-blue-deep)' : 'transparent',
        color: active ? '#fff' : 'var(--color-text)',
      }}
    >
      {san}
    </button>
  );
}

function CapturedRow({
  pieces = [], advantage, side,
}: { pieces?: string[]; advantage: number; side: 'white' | 'black' }) {
  if (!pieces || (pieces.length === 0 && advantage === 0)) return <div className="h-5" />;
  return (
    <div className="flex items-center gap-1 h-5 overflow-hidden">
      <span className="text-base leading-none">
        {pieces.map((p, i) => (
          <span key={i} style={{ opacity: side === 'white' ? 0.9 : 0.75 }}>
            {PIECE_SYMBOLS[p] ?? p}
          </span>
        ))}
      </span>
      {advantage > 0 && (
        <span className="text-xs font-bold" style={{ color: 'var(--color-text-muted)' }}>
          +{advantage}
        </span>
      )}
    </div>
  );
}
