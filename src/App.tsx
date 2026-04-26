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
  const [dark, setDark] = useState(true);
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

  // ── Sync dark/light mode ──────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.classList.toggle('light', !dark);
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
    <div className="app-root">

      {/* ── Header ────────────────────────────────────────────────────── */}
      <header className="app-header">
        <div className="app-logo">
          <span className="logo-king">♚</span>
          <div className="logo-wordmark">
            <span className="logo-title">Chess Mentor</span>
            <span className="logo-sub">ניתוח עמדה</span>
          </div>
        </div>
        <div className="header-right">
          {isSyncConnected && (
            <div className="live-badge">
              <div className="live-dot">
                <div className="live-dot-core" />
              </div>
              LIVE
            </div>
          )}
          <button className="theme-btn" onClick={() => setDark(d => !d)} title={dark ? 'מצב בהיר' : 'מצב כהה'}>
            {dark ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </header>

      {/* ── Body ──────────────────────────────────────────────────────── */}
      <div className="app-body">

        {/* ── Board column ─────────────────────────────────────────────── */}
        <section className="board-col">

          {/* Black player strip */}
          <PlayerStrip
            colorSide="black"
            captured={blackCaptured}
            advantage={materialBalance < 0 ? Math.abs(materialBalance) : 0}
            isActive={game.turn() === 'b' && !game.isGameOver()}
          />

          {/* Status + action buttons */}
          <div className="status-bar">
            <span
              className="status-chip"
              style={{
                color: gameStatus.color,
                background: `${gameStatus.color}18`,
                borderColor: `${gameStatus.color}30`,
              }}
            >
              {gameStatus.label}
            </span>
            <div className="board-btn-group">
              <button className="board-btn" title="סיבוב לוח" onClick={() => setBoardFlipped(f => !f)}>
                <FlipVertical2 size={14} />
              </button>
              <button className="board-btn" title="איפוס" onClick={reset}>
                <RotateCcw size={14} />
              </button>
            </div>
          </div>

          {/* Board */}
          <div className="board-frame" dir="ltr">
            <Chessboard
              options={{
                position: currentFen,
                onPieceDrop: onDrop,
                onSquareClick: onSquareClick,
                boardOrientation: boardFlipped ? 'black' : 'white',
                squareStyles: combinedSquareStyles,
                boardStyle: { borderRadius: 0 },
                darkSquareStyle: { backgroundColor: '#769656' },
                lightSquareStyle: { backgroundColor: '#eeeed2' },
                animationDurationInMs: 140,
              }}
            />
          </div>

          {/* White player strip */}
          <PlayerStrip
            colorSide="white"
            captured={whiteCaptured}
            advantage={materialBalance > 0 ? materialBalance : 0}
            isActive={game.turn() === 'w' && !game.isGameOver()}
          />

          {/* Navigation */}
          <div className="nav-bar">
            <button className="nav-btn" onClick={() => goTo(-1)} disabled={currentIndex === -1} title="ראשון">
              <ChevronsLeft size={16} />
            </button>
            <button className="nav-btn" onClick={() => goTo(currentIndex - 1)} disabled={currentIndex === -1} title="קודם ←">
              <ChevronLeft size={16} />
            </button>
            <span className="nav-counter">{currentIndex + 1} / {history.length}</span>
            <button className="nav-btn" onClick={() => goTo(currentIndex + 1)} disabled={currentIndex === history.length - 1} title="הבא →">
              <ChevronRight size={16} />
            </button>
            <button className="nav-btn" onClick={() => goTo(history.length - 1)} disabled={currentIndex === history.length - 1} title="אחרון">
              <ChevronsRight size={16} />
            </button>
          </div>
        </section>

        {/* ── Side column ──────────────────────────────────────────────── */}
        <aside className="side-col">

          {/* Move log */}
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">
                <FileText size={11} />
                מהלכים
              </span>
              <button className="panel-icon-btn" onClick={() => { setHistory([]); goTo(-1, []); }} title="נקה מהלכים">
                <Trash2 size={12} />
              </button>
            </div>
            <div className="move-log" ref={moveListRef}>
              {movePairs.length === 0 ? (
                <div className="move-log-empty">גרור כלי או לחץ עליו להתחיל</div>
              ) : (
                movePairs.map(pair => (
                  <div key={pair.number} className="move-row">
                    <span className="move-num">{pair.number}.</span>
                    {pair.white && (
                      <button
                        data-active={currentIndex === pair.white.idx}
                        className={`move-chip${currentIndex === pair.white.idx ? ' active' : ''}`}
                        onClick={() => goTo(pair.white!.idx)}
                      >
                        {pair.white.san}
                      </button>
                    )}
                    {pair.black ? (
                      <button
                        data-active={currentIndex === pair.black.idx}
                        className={`move-chip${currentIndex === pair.black.idx ? ' active' : ''}`}
                        onClick={() => goTo(pair.black!.idx)}
                      >
                        {pair.black.san}
                      </button>
                    ) : (
                      <span style={{ flex: 1 }} />
                    )}
                  </div>
                ))
              )}
            </div>
            {history.length > 0 && (
              <button className="pgn-btn" onClick={() => copyWithFeedback(pgn, 'pgn')}>
                {copied === 'pgn' ? <Check size={11} /> : <FileText size={11} />}
                {copied === 'pgn' ? 'הועתק!' : 'העתק PGN'}
              </button>
            )}
          </div>

          {/* Live sync */}
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">
                <Radio size={11} />
                עיקוב חי
              </span>
              <span className={`sync-status-badge ${isSyncConnected ? 'connected' : 'waiting'}`}>
                {isSyncConnected ? 'מחובר' : 'ממתין'}
              </span>
            </div>
            <ol className="sync-steps">
              <li>השאר דף זה פתוח בטאב</li>
              <li>גרור את הכפתור לסרגל הסימניות</li>
              <li>פתח chess.com ולחץ על הסימנייה</li>
              <li>אם מופיע כפתור חיבור ב-chess.com, לחץ עליו פעם אחת</li>
            </ol>
            <a
              ref={bookmarkletAnchorRef}
              onClick={e => e.preventDefault()}
              draggable
              onDragStart={e => {
                e.dataTransfer.setData('text/uri-list', bookmarkletUrl);
                e.dataTransfer.setData('text/plain', bookmarkletUrl);
                e.dataTransfer.effectAllowed = 'copyLink';
              }}
              className="bookmarklet-btn"
              title="גרור לסרגל הסימניות"
            >
              <span>⬆</span>
              <span>Chess Mentor — גרור לסרגל</span>
            </a>
            <button className="sync-toggle-btn" onClick={() => setSyncEnabled(v => !v)}>
              {syncEnabled ? 'השהה עיקוב' : 'חדש עיקוב'}
            </button>
          </div>

          {/* Position (FEN) */}
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">
                <Copy size={11} />
                עמדה
              </span>
            </div>
            <div className="fen-row">
              <div className="fen-display" dir="ltr">{currentFen}</div>
              <button
                className="fen-icon-btn"
                onClick={() => copyWithFeedback(currentFen, 'fen')}
                title="העתק FEN"
              >
                {copied === 'fen' ? <Check size={12} style={{ color: 'var(--green)' }} /> : <Copy size={12} />}
              </button>
            </div>
            <div className="fen-paste-area">
              <input
                value={fenInput}
                onChange={e => { setFenInput(e.target.value); setFenError(''); }}
                onKeyDown={e => e.key === 'Enter' && loadFen()}
                placeholder="הדבק FEN..."
                className={`fen-input${fenError ? ' error' : ''}`}
                dir="ltr"
              />
              <button
                className="fen-icon-btn"
                onClick={async () => {
                  const text = await navigator.clipboard.readText();
                  setFenInput(text.trim());
                  setFenError('');
                }}
                title="הדבק מלוח"
              >
                <ClipboardPaste size={12} />
              </button>
            </div>
            {fenError && <p className="fen-error">{fenError}</p>}
            <button className="load-btn" onClick={loadFen} disabled={!fenInput.trim()}>
              טען עמדה
            </button>
          </div>

          {/* Shortcuts */}
          <div className="shortcuts-hint">
            <kbd>←</kbd> <kbd>→</kbd> ניווט מהלכים
            <br />
            <kbd>Home</kbd> <kbd>End</kbd> ראשון / אחרון
          </div>

        </aside>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PlayerStrip({
  colorSide, captured, advantage, isActive,
}: {
  colorSide: 'white' | 'black';
  captured: string[];
  advantage: number;
  isActive: boolean;
}) {
  return (
    <div className={`player-strip${isActive ? ' active-turn' : ''}`}>
      <div className={`player-color-dot ${colorSide}`} />
      <span className="player-label">{colorSide === 'white' ? 'לבן' : 'שחור'}</span>
      <div className="player-captured">
        {captured.map((p, i) => (
          <span key={i} style={{ opacity: 0.8 }}>{PIECE_SYMBOLS[p] ?? p}</span>
        ))}
      </div>
      {advantage > 0 && <span className="player-advantage">+{advantage}</span>}
    </div>
  );
}

function MoveChip({ san, active, onClick }: { san: string; active: boolean; onClick: () => void }) {
  return (
    <button
      data-active={active}
      onClick={onClick}
      className={`move-chip${active ? ' active' : ''}`}
    >
      {san}
    </button>
  );
}

function CapturedRow({
  pieces = [], advantage, side,
}: { pieces?: string[]; advantage: number; side: 'white' | 'black' }) {
  if (!pieces || (pieces.length === 0 && advantage === 0)) return <div style={{ height: 20 }} />;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: 20, overflow: 'hidden' }}>
      <span style={{ fontSize: 14, lineHeight: 1 }}>
        {pieces.map((p, i) => (
          <span key={i} style={{ opacity: side === 'white' ? 0.9 : 0.75 }}>
            {PIECE_SYMBOLS[p] ?? p}
          </span>
        ))}
      </span>
      {advantage > 0 && (
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--gold)' }}>+{advantage}</span>
      )}
    </div>
  );
}
