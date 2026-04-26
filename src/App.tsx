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

const PIECE_SYMBOLS: Record<string, string> = {
  P: '♙', N: '♘', B: '♗', R: '♖', Q: '♕',
  p: '♟', n: '♞', b: '♝', r: '♜', q: '♛',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getCapturedPieces(fen: string): { whiteCaptured: string[]; blackCaptured: string[] } {
  const START: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };
  const onBoard: Record<string, number> = {};
  for (const ch of fen.split(' ')[0]) {
    if (/[pnbrqPNBRQ]/.test(ch)) {
      onBoard[ch] = (onBoard[ch] || 0) + 1;
    }
  }
  const whiteCaptured: string[] = [];
  const blackCaptured: string[] = [];
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

  const tickerRef = useRef<HTMLDivElement>(null);
  const bookmarkletAnchorRef = useRef<HTMLAnchorElement>(null);

  // ── Window name for bookmarklet targeting ─────────────────────────────────
  useEffect(() => {
    window.name = 'chess-mentor-ai';
    try {
      if (window.opener) {
        window.opener.postMessage({ type: 'chess-mentor-ready' }, '*');
      }
    } catch {
      // cross-origin opener access may be restricted
    }
  }, []);

  // ── FEN from URL (popup fallback) ─────────────────────────────────────────
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

  // ── Dark / light mode ─────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.classList.toggle('light', !dark);
  }, [dark]);

  // ── Auto-scroll ticker to active chip ────────────────────────────────────
  useEffect(() => {
    if (tickerRef.current) {
      const active = tickerRef.current.querySelector<HTMLElement>('[data-active="true"]');
      active?.scrollIntoView({ inline: 'nearest', behavior: 'smooth', block: 'nearest' });
    }
  }, [currentIndex]);

  // ── Navigate to a history index ───────────────────────────────────────────
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
          [entry.from]: { backgroundColor: 'rgba(0,229,255,0.35)' },
          [entry.to]: { backgroundColor: 'rgba(0,229,255,0.35)' },
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

  // ── Bookmarklet URL ───────────────────────────────────────────────────────
  const bookmarkletUrl = useMemo(() => {
    const targetUrl = window.location.href.split('?')[0].split('#')[0];
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
  var ss=['[data-ply]','vertical-move-list .move','.node-highlight-content','.move-text-component','.moves-list-row','.move'];
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

  // ── Bypass React's javascript: URL sanitization ───────────────────────────
  useEffect(() => {
    if (bookmarkletAnchorRef.current) {
      bookmarkletAnchorRef.current.setAttribute('href', bookmarkletUrl);
    }
  }, [bookmarkletUrl]);

  // ── Apply a chess.js move and update state ────────────────────────────────
  const applyMove = useCallback(
    (game: Chess, from: string, to: string) => {
      const pieceType = game.get(from as Parameters<typeof game.get>[0])?.type ?? '';
      const isPromotion =
        pieceType === 'p' &&
        ((game.turn() === 'w' && to[1] === '8') || (game.turn() === 'b' && to[1] === '1'));

      const move = game.move({ from, to, promotion: isPromotion ? 'q' : undefined });
      if (!move) return false;

      const chess2 = new Chess(currentFen);
      const newEntry: HistoryEntry = {
        fen: game.fen(),
        san: move.san,
        moveNumber: chess2.moveNumber(),
        color: move.color as 'w' | 'b',
        from: move.from,
        to: move.to,
      };

      const newHistory = [...history.slice(0, currentIndex + 1), newEntry];
      setHistory(newHistory);
      setSelectedSquare(null);
      setLegalMoveSquares({});
      setHighlightSquares({
        [move.from]: { backgroundColor: 'rgba(0,229,255,0.35)' },
        [move.to]: { backgroundColor: 'rgba(0,229,255,0.35)' },
      });
      goTo(newHistory.length - 1, newHistory);
      return true;
    },
    [currentFen, currentIndex, history, goTo],
  );

  // ── Live sync ─────────────────────────────────────────────────────────────
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
      setIsSyncConnected(true);
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = setTimeout(() => setIsSyncConnected(false), 3000);

      if (normalizeFen(incoming) === normalizeFen(currentFen)) return;

      const found = findMoveForFen(currentFen, incoming);
      if (found) {
        const game = new Chess(currentFen);
        applyMove(game, found.from, found.to);
        return;
      }

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

  // ── Drag-and-drop ─────────────────────────────────────────────────────────
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

      if (selectedSquare) {
        const legalTargets = game
          .moves({ square: selectedSquare as Parameters<typeof game.moves>[0]['square'], verbose: true })
          .map(m => m.to);

        if ((legalTargets as string[]).includes(square)) {
          applyMove(game, selectedSquare, square);
          return;
        }
      }

      const piece = game.get(square as Parameters<typeof game.get>[0]);
      if (piece && piece.color === game.turn()) {
        setSelectedSquare(square);
        const moves = game.moves({ square: square as Parameters<typeof game.moves>[0]['square'], verbose: true });
        const styles: SquareStyles = {
          [square]: { backgroundColor: 'rgba(0,229,255,0.28)' },
        };
        moves.forEach(m => {
          styles[m.to] = {
            background: game.get(m.to as Parameters<typeof game.get>[0])
              ? 'radial-gradient(circle, rgba(255,80,50,0.5) 60%, transparent 62%)'
              : 'radial-gradient(circle, rgba(0,229,255,0.3) 28%, transparent 30%)',
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
    if (game.isCheckmate()) return { label: 'מט!', color: '#f87171' };
    if (game.isStalemate()) return { label: 'פאט', color: '#eab308' };
    if (game.isDraw()) return { label: 'תיקו', color: '#eab308' };
    if (game.isCheck()) return { label: `שאח! תור ${game.turn() === 'w' ? 'לבן' : 'שחור'}`, color: '#ff6b35' };
    return {
      label: game.turn() === 'w' ? '♙ תור לבן' : '♟ תור שחור',
      color: 'var(--text-2)',
    };
  })();

  const pgn = buildPgn(history, startFen);
  const { whiteCaptured, blackCaptured } = getCapturedPieces(currentFen);
  const materialBalance = getMaterialBalance(currentFen);
  const combinedSquareStyles: SquareStyles = { ...highlightSquares, ...legalMoveSquares };

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="shell">

      {/* ══ HEADER ══════════════════════════════════════════════════════ */}
      <header className="hdr">
        <div className="hdr-logo">
          <span className="hdr-king">♚</span>
          <div>
            <span className="hdr-name">Chess Mentor</span>
            <span className="hdr-sub">ניתוח עמדה</span>
          </div>
        </div>
        <div className="hdr-right">
          {isSyncConnected && (
            <div className="live-pill">
              <div className="live-ring-wrap">
                <div className="live-ring" />
                <div className="live-core" />
              </div>
              LIVE
            </div>
          )}
          <button
            className="icon-btn"
            onClick={() => setDark(d => !d)}
            title={dark ? 'מצב בהיר' : 'מצב כהה'}
          >
            {dark ? <Sun size={13} /> : <Moon size={13} />}
          </button>
        </div>
      </header>

      {/* ══ MIDDLE ══════════════════════════════════════════════════════ */}
      <div className="mid">

        {/* ── Board zone ──────────────────────────────────────────────── */}
        <div className="board-zone">

          {/* Black player */}
          <div className={`player-bar${game.turn() === 'b' && !game.isGameOver() ? ' player-bar--active' : ''}`}>
            <div className="player-pip player-pip--black" />
            <span className="player-name">שחור</span>
            <div className="player-caps">
              {blackCaptured.map((p, i) => (
                <span key={i}>{PIECE_SYMBOLS[p] ?? p}</span>
              ))}
            </div>
            {materialBalance < 0 && (
              <span className="player-adv">+{Math.abs(materialBalance)}</span>
            )}
          </div>

          {/* Board */}
          <div className="board-wrap" dir="ltr">
            <Chessboard
              options={{
                position: currentFen,
                onPieceDrop: onDrop,
                onSquareClick: onSquareClick,
                boardOrientation: boardFlipped ? 'black' : 'white',
                squareStyles: combinedSquareStyles,
                boardStyle: { borderRadius: 0 },
                darkSquareStyle: { backgroundColor: '#5d8a68' },
                lightSquareStyle: { backgroundColor: '#e8ead6' },
                animationDurationInMs: 120,
              }}
            />
          </div>

          {/* White player */}
          <div className={`player-bar${game.turn() === 'w' && !game.isGameOver() ? ' player-bar--active' : ''}`}>
            <div className="player-pip player-pip--white" />
            <span className="player-name">לבן</span>
            <div className="player-caps">
              {whiteCaptured.map((p, i) => (
                <span key={i}>{PIECE_SYMBOLS[p] ?? p}</span>
              ))}
            </div>
            {materialBalance > 0 && (
              <span className="player-adv">+{materialBalance}</span>
            )}
          </div>

          {/* Status + board controls */}
          <div className="ctrl-row">
            <span
              className="status-pill"
              style={{
                color: gameStatus.color,
                background: `${gameStatus.color}18`,
                borderColor: `${gameStatus.color}30`,
                border: '1px solid',
              }}
            >
              {gameStatus.label}
            </span>
            <button className="icon-btn" title="סיבוב לוח" onClick={() => setBoardFlipped(f => !f)}>
              <FlipVertical2 size={13} />
            </button>
            <button className="icon-btn" title="איפוס" onClick={reset}>
              <RotateCcw size={13} />
            </button>
          </div>
        </div>

        {/* ── Side panel ──────────────────────────────────────────────── */}
        <aside className="side">

          {/* Sync section */}
          <section className="side-sec">
            <header className="sec-hdr">
              <Radio size={10} />
              עיקוב חי
              <span className={`sec-badge ${isSyncConnected ? 'sec-badge--on' : 'sec-badge--off'}`}>
                {isSyncConnected ? 'מחובר' : 'ממתין'}
              </span>
            </header>
            <ol className="steps">
              <li>השאר דף זה פתוח בטאב</li>
              <li>גרור את הכפתור לסרגל הסימניות</li>
              <li>פתח chess.com ולחץ על הסימנייה</li>
              <li>אם מופיע כפתור חיבור, לחץ עליו פעם אחת</li>
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
              className="bm-btn"
              title="גרור לסרגל הסימניות"
            >
              <span>⬆</span>
              <span>Chess Mentor — גרור לסרגל</span>
            </a>
            <button className="txt-btn" onClick={() => setSyncEnabled(v => !v)}>
              {syncEnabled ? 'השהה עיקוב' : 'חדש עיקוב'}
            </button>
          </section>

          {/* FEN / position section */}
          <section className="side-sec">
            <header className="sec-hdr">
              <Copy size={10} />
              עמדה
            </header>
            <div className="fen-row">
              <div className="fen-display" dir="ltr">{currentFen}</div>
              <button
                className="icon-btn-sm"
                onClick={() => copyWithFeedback(currentFen, 'fen')}
                title="העתק FEN"
              >
                {copied === 'fen'
                  ? <Check size={11} style={{ color: 'var(--green)' }} />
                  : <Copy size={11} />}
              </button>
            </div>
            <div className="fen-paste-row">
              <input
                value={fenInput}
                onChange={e => { setFenInput(e.target.value); setFenError(''); }}
                onKeyDown={e => e.key === 'Enter' && loadFen()}
                placeholder="הדבק FEN..."
                className={`fen-in${fenError ? ' fen-in--err' : ''}`}
                dir="ltr"
              />
              <button
                className="icon-btn-sm"
                onClick={async () => {
                  const text = await navigator.clipboard.readText();
                  setFenInput(text.trim());
                  setFenError('');
                }}
                title="הדבק מלוח"
              >
                <ClipboardPaste size={11} />
              </button>
            </div>
            {fenError && <p className="fen-err">{fenError}</p>}
            <button className="load-btn" onClick={loadFen} disabled={!fenInput.trim()}>
              טען עמדה
            </button>
          </section>

          {/* Keyboard shortcuts hint */}
          <div className="kbd-hint">
            <kbd>←</kbd> <kbd>→</kbd> ניווט מהלכים
            <br />
            <kbd>Home</kbd> <kbd>End</kbd> ראשון / אחרון
          </div>

        </aside>
      </div>

      {/* ══ TICKER BAR ══════════════════════════════════════════════════ */}
      <div className="ticker-bar">
        <button className="nav-btn" onClick={() => goTo(-1)} disabled={currentIndex === -1} title="ראשון">
          <ChevronsLeft size={14} />
        </button>
        <button className="nav-btn" onClick={() => goTo(currentIndex - 1)} disabled={currentIndex === -1} title="קודם">
          <ChevronLeft size={14} />
        </button>

        <div className="ticker-track" ref={tickerRef}>
          {history.length === 0 ? (
            <span className="ticker-empty">גרור כלי או לחץ עליו כדי להתחיל</span>
          ) : (
            history.map((entry, idx) => (
              <React.Fragment key={idx}>
                {/* Show move number label before each white move */}
                {entry.color === 'w' && (
                  <span className="t-num">{entry.moveNumber}.</span>
                )}
                <button
                  data-active={currentIndex === idx}
                  className={`t-chip${currentIndex === idx ? ' t-chip--active' : ''}`}
                  onClick={() => goTo(idx)}
                >
                  {entry.san}
                </button>
              </React.Fragment>
            ))
          )}
        </div>

        <button className="nav-btn" onClick={() => goTo(currentIndex + 1)} disabled={currentIndex === history.length - 1} title="הבא">
          <ChevronRight size={14} />
        </button>
        <button className="nav-btn" onClick={() => goTo(history.length - 1)} disabled={currentIndex === history.length - 1} title="אחרון">
          <ChevronsRight size={14} />
        </button>

        {history.length > 0 && (
          <button className="pgn-btn" onClick={() => copyWithFeedback(pgn, 'pgn')}>
            {copied === 'pgn' ? <Check size={11} /> : <FileText size={11} />}
            PGN
          </button>
        )}
      </div>

    </div>
  );
}
