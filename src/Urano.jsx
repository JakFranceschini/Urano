import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { createPortal } from "react-dom";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area } from "recharts";

// ── Constantes ────────────────────────────────────────────────────────────────

const SHEET_BASE =
  "https://docs.google.com/spreadsheets/d/1sSujoT_tUBA0bHWRpn0aDf59cGpU0tTg3AVzBnFgbUo/export?format=csv&gid=";

const SHEET_GIDS = {
  ativos:    "0",
  evolucao:  "321025695",
  totais:    "1590878666",
  reservas:  "1376608033",
  alocacao:  "947935505",
  proventos: "1266693739",
};

const CLASSES_ATIVOS = [
  { classe: "stock",   titulo: "Stocks",   sufixo: "stocks"   },
  { classe: "reit",    titulo: "Reits",    sufixo: "reits"    },
  { classe: "acao",    titulo: "Ações",    sufixo: "acoes"    },
  { classe: "fii",     titulo: "Fiis",     sufixo: "fiis"     },
  { classe: "bitcoin", titulo: "Bitcoins", sufixo: "bitcoins" },
];

// ALOCACAO_CLASSES = todas as classes de ativos + reservas (usada nos cards de Alocação e Aporte)
const ALOCACAO_CLASSES = [
  ...CLASSES_ATIVOS.map(({ sufixo, titulo }) => ({ sufixo, titulo })),
  { sufixo: "reservas", titulo: "Reservas" },
];

// Páginas do app (abas do navbar)
const PAGINAS = [
  { id: "patrimonio",     titulo: "Patrimônio"    },
  { id: "investimentos",  titulo: "Investimentos" },
  { id: "financas",       titulo: "Finanças"       },
];

const FILTROS = [
  { texto: "Nome",       key: "nome"                },
  { texto: "Total Atual",key: "total_atual"         },
  { texto: "Variação",   key: "variacao_total"      },
  { texto: "Variação %", key: "variacao_percentual" },
  { texto: "% Atual",    key: "porcentagem_atual"   },
];

const COR_ALTA        = "#0a5550"; // Verde escuro — lucro
const COR_BAIXA       = "#8a3535"; // Vermelho — prejuízo
const PALETA_ALOCACAO = ["#0a5550","#0c6560","#0e7971","#10908a","#13a097","#16b8ae"];

// Espessura/altura padrão de TODAS as barras de progresso/composição do app
// → definida no token CSS --bar-altura (ver :root), não como constante JS.

// ── Funções Auxiliares ────────────────────────────────────────────────────────

function toFloat(v) {
  const s = String(v ?? "0").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function fmtBRL(v) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

function fmtUSD(v) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);
}

function sinal(v) { return v > 0 ? "+" : ""; }

function corVar(v) {
  if (v > 0) return COR_ALTA;
  if (v < 0) return COR_BAIXA;
  return "var(--color-neutral)";
}

function corHeatmap(pct) {
  // Verde: quanto mais lucro, mais escuro
  if (pct >= 100) return "#063d3a"; // > 100%      → mais escuro
  if (pct >= 50)  return "#0a5550"; // 50–100%     → escuro médio
  if (pct >= 20)  return "#0e7971"; // 20–50%      → médio
  if (pct >= 0)   return "#16b8ae"; // 0–20%       → mais claro
  // Vermelho: quanto mais prejuízo, mais escuro
  if (pct >= -20) return "#c0504a"; // 0 a -20%    → mais claro
  if (pct >= -50) return "#8a3535"; // -20 a -50%  → médio
  return "#4f1f1f";                 // -50 a -100% → mais escuro
}

// ── Funções de Parse ──────────────────────────────────────────────────────────

function parseCSV(text) {
  const lines = text.trim().split("\n");
  if (lines.length < 1) return [];
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map(line => {
    const vals = [];
    let cur = "", inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === "," && !inQ) { vals.push(cur); cur = ""; }
      else cur += ch;
    }
    vals.push(cur);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] ?? "").trim().replace(/^"|"$/g, ""); });
    return obj;
  });
}

async function fetchSheet(gid) {
  const r = await fetch(SHEET_BASE + gid);
  const t = await r.text();
  return parseCSV(t);
}

// ── Componentes Base ──────────────────────────────────────────────────────────

function Card({ children, className = "", style = {} }) {
  return (
    <div className={`card ${className}`} style={style}>
      {children}
    </div>
  );
}

// IconeCard — ícone exibido ao lado do título de cada card, no mesmo estilo
// (stroke fino, currentColor) dos demais ícones do app.
function IconeCard({ nome, size = 21 }) {
  const p = {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round",
  };
  switch (nome) {
    case "patrimonio": // cifrão em círculo
      return (
        <svg {...p} className="card-titulo-icone">
          <circle cx="12" cy="12" r="9" />
          <text x="12" y="16" textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor" stroke="none">
            $
          </text>
        </svg>
      );
    case "reserva": // escudo
      return (
        <svg {...p} className="card-titulo-icone">
          <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z" />
        </svg>
      );
    case "investimentos": // gráfico de linha ascendente em moldura
      return (
        <svg {...p} className="card-titulo-icone">
          <rect x="3" y="3" width="18" height="18" rx="2.5" />
          <path d="M6.5 15l4-4 3 3 4.5-5.5" />
        </svg>
      );
    case "alocacao": // gráfico de pizza
      return (
        <svg {...p} className="card-titulo-icone">
          <path d="M21.5 12A9.5 9.5 0 1 1 9 2.6" />
          <path d="M21.5 12A9.5 9.5 0 0 0 12 2.5V12Z" />
        </svg>
      );
    case "aporte": // seta de crescimento
      return (
        <svg {...p} className="card-titulo-icone">
          <path d="M3 17l6-6 4 4 7-8" />
          <path d="M14 6h6v6" />
        </svg>
      );
    case "proventos": // moedas
      return (
        <svg {...p} className="card-titulo-icone">
          <circle cx="9" cy="9" r="5.5" />
          <circle cx="15.5" cy="15.5" r="5.5" />
        </svg>
      );
    case "heatmap": // grade
      return (
        <svg {...p} className="card-titulo-icone">
          <rect x="3" y="3" width="7.5" height="7.5" rx="1.2" />
          <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.2" />
          <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.2" />
          <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.2" />
        </svg>
      );
    case "stock": // ações internacionais — barras
      return (
        <svg {...p} className="card-titulo-icone">
          <path d="M3 3v18h18" />
          <rect x="7" y="12" width="3" height="6" />
          <rect x="12" y="8" width="3" height="10" />
          <rect x="17" y="5" width="3" height="13" />
        </svg>
      );
    case "reit": // reits — prédio
      return (
        <svg {...p} className="card-titulo-icone">
          <rect x="4" y="3" width="16" height="18" rx="1" />
          <path d="M9 21v-4h6v4" />
          <path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2" />
        </svg>
      );
    case "acao": // ações br — candlestick
      return (
        <svg {...p} className="card-titulo-icone">
          <path d="M6 3v4M6 13v8" />
          <rect x="3.5" y="7" width="5" height="6" rx="0.5" />
          <path d="M12 3v2M12 13v8" />
          <rect x="9.5" y="5" width="5" height="8" rx="0.5" />
          <path d="M18 3v6M18 16v5" />
          <rect x="15.5" y="9" width="5" height="7" rx="0.5" />
        </svg>
      );
    case "fii": // fiis — casa
      return (
        <svg {...p} className="card-titulo-icone">
          <path d="M3 11l9-8 9 8" />
          <path d="M5 10v10h14V10" />
          <path d="M9 20v-6h6v6" />
        </svg>
      );
    case "bitcoin": // bitcoin
      return (
        <svg {...p} className="card-titulo-icone">
          <circle cx="12" cy="12" r="9" />
          <text x="12" y="16" textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor" stroke="none">
            ₿
          </text>
        </svg>
      );
    case "financas": // carteira
      return (
        <svg {...p} className="card-titulo-icone">
          <path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v3" />
          <path d="M3 7v10a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-3" />
          <path d="M16 12h4v4h-4a2 2 0 0 1 0-4Z" />
        </svg>
      );
    case "comparativo": // duas barras
      return (
        <svg {...p} className="card-titulo-icone">
          <path d="M3 3v18h18" />
          <rect x="7" y="10" width="4" height="8" />
          <rect x="14" y="6" width="4" height="12" />
        </svg>
      );
    case "meta": // alvo
      return (
        <svg {...p} className="card-titulo-icone">
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "seta-cima": // seta para cima
      return (
        <svg {...p} className="card-titulo-icone">
          <path d="M12 19V5" />
          <path d="M5 12l7-7 7 7" />
        </svg>
      );
    case "seta-baixo": // seta para baixo
      return (
        <svg {...p} className="card-titulo-icone">
          <path d="M12 5v14" />
          <path d="M5 12l7 7 7-7" />
        </svg>
      );
    case "lancamentos": // lista
      return (
        <svg {...p} className="card-titulo-icone">
          <path d="M8 6h13M8 12h13M8 18h13" />
          <path d="M3 6h.01M3 12h.01M3 18h.01" />
        </svg>
      );
    default:
      return null;
  }
}

// Mapa sufixo → ícone, usado pelos cards de classe de ativo (Stocks, Reits, etc.)
const ICONE_POR_SUFIXO = {
  stocks: "stock", reits: "reit", acoes: "acao", fiis: "fii", bitcoins: "bitcoin",
};

// ── Outros Componentes Menores ────────────────────────────────────────────────

function SubCard({ children, className = "", style = {}, id }) {
  return (
    <div id={id} className={`subcard ${className}`} style={style}>
      {children}
    </div>
  );
}

// HeroValor — bloco "título pequeno + valor grande em destaque" usado em todos
// os cards com número principal (Patrimônio, Patrimônio USD, Classe Prioritária, etc.)
function HeroValor({ titulo, valor, cor, visible = true, className = "" }) {
  return (
    <div className={`hero-valor ${className}`}>
      <span className="campo-titulo hero-valor-titulo">{titulo}</span>
      <span
        className="campo-valor hero-valor-valor animated-value"
        style={{
          ...(cor ? { color: cor } : {}),
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(10px)",
          transition: "opacity 0.55s cubic-bezier(0.22,1,0.36,1), transform 0.55s cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        {valor}
      </span>
    </div>
  );
}

// BarraSimples — barra de progresso de um único segmento (0 a 100%)
function BarraSimples({ pct, cor, style = {} }) {
  return (
    <div className="barra-track" style={style}>
      <div className="barra-fill full" style={{ width: `${Math.max(Math.min(pct, 100), 0)}%`, background: cor }} />
    </div>
  );
}

// Tile — mini card de legenda/estatística padronizado (grade de alocação, listas de métricas, etc.)
function Tile({ cor, titulo, valor, diff, metaPct, metaLabel, isHover, onHoverStart, onHoverEnd, onClick }) {
  return (
    <div
      className={`tile${isHover ? " is-hover" : ""}${onClick ? " tile-clicavel" : ""}`}
      style={{ borderColor: isHover ? `${cor}55` : undefined }}
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      onClick={onClick}
      title={titulo}
    >
      <div className="tile-header">
        <div className="tile-dot" style={{ background: cor }} />
        <span className="tile-titulo">{titulo}</span>
      </div>
      <span className="tile-valor">{valor}</span>
      {diff != null && (
        <span className="tile-diff" style={{ color: corVar(diff) }}>
          {sinal(diff)}{diff.toFixed(2)}%
        </span>
      )}
      {metaLabel != null && (
        <span className="tile-mini-label">{metaLabel}</span>
      )}
    </div>
  );
}

function ListRow({ label, tag, value, valueColor, sub, subColor, onClick, chevron = false, plain = false, highlight = false }) {
  return (
    <div className={`list-row${plain ? " list-row-plain" : ""}${onClick ? " list-row-clickable" : ""}${highlight ? " list-row-filtrado" : ""}`} onClick={onClick}>
      <div className="list-row-left">
        <span className="list-row-label">{label}</span>
        {tag && <span className="list-row-tag">{tag}</span>}
      </div>
      <div className="list-row-right">
        <div className="list-row-values">
          <span className="list-row-value" style={valueColor ? { color: valueColor } : {}}>{value}</span>
          {sub && <span className="list-row-sub" style={subColor ? { color: subColor } : {}}>{sub}</span>}
        </div>
        {chevron && (
          <svg className="list-row-chevron" width="7" height="12" viewBox="0 0 7 12" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M1 1l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
    </div>
  );
}

// criarBrilho — efeito de "brilho" ao clicar, usado nos botões de filtro e "Ver Mais"
function criarBrilho(e, btn) {
  if (!btn) return;
  btn.classList.remove("click-glow");
  // Força reflow para permitir reiniciar a animação em cliques consecutivos
  void btn.offsetWidth;
  btn.classList.add("click-glow");
  const onEnd = () => {
    btn.classList.remove("click-glow");
    btn.removeEventListener("animationend", onEnd);
  };
  btn.addEventListener("animationend", onEnd);
}

function BotaoFiltro({ children, onClick, ativo, seta, open }) {
  const btnRef = useRef(null);

  const handleClick = (e) => {
    criarBrilho(e, btnRef.current);
    onClick?.(e);
  };

  return (
    <button
      className={`btn-filtro-simples${ativo ? " btn-filtro-simples-ativo" : ""}`}
      onClick={handleClick}
    >
      <span ref={btnRef} className="btn-texto">{children}</span>
      {seta && (
        <svg className={`btn-ver-icon ${open ? "is-open" : ""}`} width="12" height="7" viewBox="0 0 12 7" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 1L6 6L11 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </button>
  );
}

function BotaoFiltroTrigger({ children, onClick, ativo, open }) {
  const btnRef = useRef(null);

  const handleClick = (e) => {
    criarBrilho(e, btnRef.current);
    onClick?.(e);
  };

  return (
    <button
      className={`btn-filtro-simples dropdown-trigger${ativo ? " btn-filtro-simples-ativo" : ""}`}
      onClick={handleClick}
      aria-expanded={open}
    >
      <span ref={btnRef} className="btn-texto">{children}</span>
      <svg className={`btn-ver-icon ${open ? "is-open" : ""}`} width="12" height="7" viewBox="0 0 12 7" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M1 1L6 6L11 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  );
}

function BotaoVer({ children, onClick, open }) {
  const btnRef = useRef(null);

  const handleClick = (e) => {
    criarBrilho(e, btnRef.current);
    onClick?.(e);
  };

  return (
    <button className="btn-ver" onClick={handleClick}>
      <span ref={btnRef} className="btn-texto">{children}</span>
      <svg className={`btn-ver-icon ${open ? "is-open" : ""}`} width="12" height="7" viewBox="0 0 12 7" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M1 1L6 6L11 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  );
}

function Expandable({ open, children }) {
  const wrapRef = useRef(null);

  // O container (.card/.subcard) usa `gap` no flexbox. Um wrapper com height:0
  // ainda soma esse gap ANTES e DEPOIS dele, dobrando o espaço vazio no lugar
  // onde ele está — por isso cards com Expandable no fim pareciam ter mais
  // padding no final do que cards sem Expandable. Neutralizamos isso aplicando
  // uma margem negativa igual ao gap do pai sempre que o conteúdo está fechado.
  const getParentGap = (el) => {
    const parent = el?.parentElement;
    if (!parent) return 0;
    const g = getComputedStyle(parent).rowGap || getComputedStyle(parent).gap;
    const n = parseFloat(g);
    return isNaN(n) ? 0 : n;
  };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    if (open) {
      el.style.marginTop = "0px";
      el.style.marginBottom = "0px";
      el.style.height = "0px";
      el.style.opacity = "0";
      void el.offsetHeight;
      const target = el.scrollHeight;
      el.style.transition = "height 0.42s cubic-bezier(0.4,0,0.2,1), opacity 0.32s cubic-bezier(0.4,0,0.2,1) 0.06s, margin 0.42s cubic-bezier(0.4,0,0.2,1)";
      el.style.height = target + "px";
      el.style.opacity = "1";
      const t = setTimeout(() => {
        if (el) el.style.height = "auto";
      }, 440);
      return () => clearTimeout(t);
    } else {
      const current = el.scrollHeight;
      el.style.height = current + "px";
      el.style.opacity = "1";
      void el.offsetHeight;
      el.style.transition = "height 0.38s cubic-bezier(0.4,0,0.2,1), opacity 0.22s cubic-bezier(0.4,0,0.2,1), margin 0.38s cubic-bezier(0.4,0,0.2,1)";
      el.style.height = "0px";
      el.style.opacity = "0";
      const gap = getParentGap(el);
      el.style.marginTop = `-${gap / 2}px`;
      el.style.marginBottom = `-${gap / 2}px`;
    }
  }, [open]);

  return (
    <div
      ref={wrapRef}
      style={{
        height: 0,
        overflow: "hidden",
        opacity: 0,
        willChange: "height, opacity, margin",
      }}
    >
      {children}
    </div>
  );
}

// ── Spinner / Loading / Logo ──────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="spinner-wrap">
      <div className="spinner" />
    </div>
  );
}

function Loading() {
  const [logoErr, setLogoErr] = useState(false);

  return (
    <div className="loading-page">
      <div className="loading-box">
        {logoErr ? (
          <div className="loading-logo loading-logo-breathe">L</div>
        ) : (
          <img
            src="/assets/logo.png"
            alt="Urano Logo"
            width={80}
            height={80}
            onError={() => setLogoErr(true)}
            className="loading-logo-breathe"
            style={{ borderRadius: 20, objectFit: "contain" }}
          />
        )}
        <Spinner />
        <p className="loading-texto">Carregando Dados...</p>
      </div>
    </div>
  );
}

function LogoAtivo({ ticker, size = 72, offsetX = 0, className = "" }) {
  const [err, setErr] = useState(false);
  const src = `/img_ativos/${String(ticker).toUpperCase()}.png`;
  if (err) {
    return (
      <div className={className} style={{
        width: size, height: size, background: "var(--accent)",
        borderRadius: 14, display: "flex", alignItems: "center",
        justifyContent: "center", fontSize: size * 0.42,
        fontWeight: 500, color: "var(--color-title)", flexShrink: 0,
        marginLeft: offsetX,
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif'
      }}>
        {String(ticker)[0]}
      </div>
    );
  }
  return (
    <img
      className={className}
      src={src}
      alt={ticker}
      width={size} height={size}
      onError={() => setErr(true)}
      style={{ borderRadius: 12, objectFit: "contain", flexShrink: 0, marginLeft: offsetX }}
    />
  );
}

function Navbar({ scrolled, ativos, onSelectTicker, pagina, onNavigate, onNovoLancamento }) {
  const [logoErr, setLogoErr]       = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery]           = useState("");
  const [isMobile, setIsMobile]     = useState(() => typeof window !== "undefined" && window.innerWidth < 1024);
  const [menuAberto, setMenuAberto] = useState(false);
  const searchRef                   = useRef(null);
  const inputRef                    = useRef(null);
  const menuRef                     = useRef(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Fecha busca ao clicar fora
  useEffect(() => {
    if (!searchOpen) return;
    const handler = (e) => {
      if (!e.target.closest(".navbar") && !e.target.closest(".navbar-search-results")) {
        setSearchOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [searchOpen]);

  // Trava o scroll do fundo e permite fechar com Esc enquanto o menu overlay está aberto
  useEffect(() => {
    if (!menuAberto) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handler = (e) => { if (e.key === "Escape") setMenuAberto(false); };
    document.addEventListener("keydown", handler);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", handler);
    };
  }, [menuAberto]);

  // Foca input ao abrir busca
  useEffect(() => {
    if (searchOpen) setTimeout(() => inputRef.current?.focus(), 50);
  }, [searchOpen]);

  // Resultados de busca
  const resultados = query.trim().length >= 1
    ? (ativos ?? []).filter(a =>
        String(a.ticker ?? "").toLowerCase().includes(query.toLowerCase()) ||
        String(a.nome   ?? "").toLowerCase().includes(query.toLowerCase())
      ).slice(0, 6)
    : [];

  return (
    <nav className={`navbar ${scrolled ? "navbar-scrolled" : ""}`}>
      <div className="navbar-inner">

        <div className="navbar-left">
          {/* Logo + título */}
          {logoErr ? (
            <span className="navbar-logo">L</span>
          ) : (
            <img src="/assets/logo.png" alt="Logo" width={45} height={45}
              onError={() => setLogoErr(true)}
              style={{ borderRadius: 8, objectFit: "contain", flexShrink: 0 }} />
          )}
          <span className="navbar-titulo">Urano</span>
        </div>

        <div className="navbar-nav">
          <div className="navbar-tabs">
            {PAGINAS.map(p => (
              <button
                key={p.id}
                className={`navbar-tab${pagina === p.id ? " navbar-tab-ativo" : ""}`}
                onClick={() => onNavigate(p.id)}
              >
                {p.titulo}
              </button>
            ))}
          </div>
        </div>

        <div className="navbar-right">

        {/* Menu hambúrguer — substitui as abas de navegação em telas pequenas, alinhado à direita */}
        <div className="navbar-hamburger-wrap" ref={menuRef}>
          <button
            className="btn-tema navbar-hamburger"
            onClick={() => setMenuAberto(o => !o)}
            aria-label="Menu de navegação"
            title="Navegação"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>

          {menuAberto && createPortal(
            <div
              className="navbar-menu-overlay"
              onClick={(e) => e.target === e.currentTarget && setMenuAberto(false)}
            >
              <div className="navbar-menu-overlay-header">
                <div className="navbar-left">
                  {logoErr ? (
                    <span className="navbar-logo">L</span>
                  ) : (
                    <img src="/assets/logo.png" alt="Logo" width={45} height={45}
                      onError={() => setLogoErr(true)}
                      style={{ borderRadius: 8, objectFit: "contain", flexShrink: 0 }} />
                  )}
                  <span className="navbar-titulo">Urano</span>
                </div>
                <button className="btn-tema" onClick={() => setMenuAberto(false)} aria-label="Fechar menu">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <line x1="5" y1="5" x2="19" y2="19" />
                    <line x1="19" y1="5" x2="5" y2="19" />
                  </svg>
                </button>
              </div>

              <div className="navbar-menu-overlay-list">
                {PAGINAS.map(p => (
                  <button
                    key={p.id}
                    className={`navbar-menu-overlay-item${pagina === p.id ? " is-ativo" : ""}`}
                    onClick={() => { onNavigate(p.id); setMenuAberto(false); }}
                  >
                    {p.titulo}
                  </button>
                ))}
              </div>
            </div>,
            document.body
          )}
        </div>

        {/* Botão de novo lançamento — exibido apenas na página de Finanças */}
        {pagina === "financas" && (
          <button
            className="btn-tema"
            title="Novo lançamento"
            onClick={onNovoLancamento}
            aria-label="Novo lançamento"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        )}

        {/* Busca — inline no desktop, botão no mobile (exibida apenas na página de Investimentos) */}
        {pagina === "investimentos" && (
        <div style={{ position: "relative" }} ref={searchRef}>
          {isMobile ? (
            <button
              className="btn-tema"
              title="Buscar ativo"
              onClick={() => { setSearchOpen(o => !o); setQuery(""); }}
              aria-label="Buscar ativo"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
                <line x1="10" y1="10" x2="14" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          ) : (
            <div className="navbar-search-inline">
              <span className="navbar-search-icon">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
                  <line x1="10" y1="10" x2="14" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </span>
              <input
                ref={inputRef}
                className="navbar-search-inline-input"
                placeholder="Buscar ativo..."
                value={query}
                onChange={e => { setQuery(e.target.value); setSearchOpen(true); }}
                onFocus={() => setSearchOpen(true)}
              />
            </div>
          )}

          {((isMobile && searchOpen) ||
            (!isMobile && query.trim().length >= 1)) && (
            <div
              className={
                isMobile
                  ? "navbar-search-box"
                  : "navbar-search-box navbar-search-box-desktop"
              }
            >
              {isMobile && (
                <input
                  ref={inputRef}
                  className="navbar-search-input"
                  placeholder="Buscar ativo..."
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                />
              )}

              {resultados.length > 0 && (
                <div className="navbar-search-results">
                  {resultados.map((a, i) => (
                    <button
                      key={i}
                      className="navbar-search-item"
                      onClick={() => {
                        const sufixo = CLASSES_ATIVOS.find(
                          c => String(a.classe).toLowerCase().trim() === c.classe
                        )?.sufixo;

                        if (sufixo) onSelectTicker(a.ticker);

                        setSearchOpen(false);
                        setQuery("");
                      }}
                    >
                      <LogoAtivo ticker={a.ticker} size={28} />

                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 1,
                          textAlign: "left"
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: "var(--color-value)"
                          }}
                        >
                          {a.ticker}
                        </span>

                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--color-label)"
                          }}
                        >
                          {a.nome}
                        </span>
                      </div>

                      <span
                        style={{
                          marginLeft: "auto",
                          fontSize: 11,
                          color: "var(--color-label)"
                        }}
                      >
                        {String(a.classe ?? "")}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {query.trim().length >= 1 && resultados.length === 0 && (
                <div className="navbar-search-results">
                  <div
                    style={{
                      padding: "var(--space-3) var(--space-4)",
                      color: "var(--color-label)",
                      fontSize: 13
                    }}
                  >
                    Nenhum ativo encontrado
                  </div>
                </div>
              )}
            </div>
          )}

          </div>
        )}

        </div>

      </div>

    </nav>
  );
}

// ── Botão Flutuante Voltar ao Topo ────────────────────────────────────────────

function BotaoTopoFlutuante({ scrolled, onTop }) {
  return (
    <button
      className={`btn-topo-flutuante ${scrolled ? "btn-topo-flutuante-visible" : ""}`}
      onClick={onTop}
      title="Voltar ao Topo"
      aria-label="Voltar ao Topo"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 19V5" />
        <path d="M5 12l7-7 7 7" />
      </svg>
    </button>
  );
}

// ── Seletor de Ano (filtro dos gráficos de evolução) ──────────────────────────
// Mostra os dados "a partir do ano X até agora". Padrão: últimos 8 anos.

const ANOS_PADRAO_HISTORICO = 8;

function SeletorAno({ anos, anoInicio, onChange }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const atualizarPos = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Mesmo comportamento do menu "Filtros": começa na borda esquerda do
    // botão e se estende para a direita.
    setPos({ top: rect.bottom + 8, left: rect.left });
  }, []);

  useEffect(() => {
    if (!open) return;
    atualizarPos();
    const handleClickFora = (e) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target) &&
        menuRef.current && !menuRef.current.contains(e.target)
      ) setOpen(false);
    };
    window.addEventListener("scroll", atualizarPos, true);
    window.addEventListener("resize", atualizarPos);
    document.addEventListener("mousedown", handleClickFora);
    return () => {
      window.removeEventListener("scroll", atualizarPos, true);
      window.removeEventListener("resize", atualizarPos);
      document.removeEventListener("mousedown", handleClickFora);
    };
  }, [open, atualizarPos]);

  if (!anos?.length) return null;

  return (
    <div className="dropdown-wrap" ref={triggerRef} style={{ marginLeft: "-6px" }}>
      <BotaoFiltroTrigger open={open} onClick={() => setOpen(o => !o)}>
        Filtrar
        <span className="dropdown-trigger-sub">· Desde {anoInicio}</span>
      </BotaoFiltroTrigger>
      {open && createPortal(
        <div
          ref={menuRef}
          className="dropdown-menu dropdown-menu-flutuante"
          style={{ top: pos.top, left: pos.left }}
        >
          {anos.map(ano => (
            <button
              key={ano}
              className={`dropdown-item${ano === anoInicio ? " is-ativo" : ""}`}
              onClick={() => { onChange(ano); setOpen(false); }}
            >
              {ano}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

// ── Card Patrimônio ───────────────────────────────────────────────────────────

function CardPatrimonio({ totais, proventos, evolucao }) {
  // ── Evolução (gráfico incorporado ao card de Patrimônio) ──
  const temEvolucao = !!evolucao?.length;
  const anos    = temEvolucao ? Object.keys(evolucao[0]).filter(k => /^\d{4}$/.test(k)) : [];
  const anosNumEvolucao = anos.map(a => parseInt(a, 10)).filter(n => !isNaN(n)).sort((a, b) => a - b);
  const anoAtualNum = new Date().getFullYear();
  const [anoInicioEvolucao, setAnoInicioEvolucao] = useState(anoAtualNum - (ANOS_PADRAO_HISTORICO - 1));

  if (!totais?.length || !proventos?.length) return null;
  const t = totais[0];
  const total    = toFloat(t.total_patrimonio);
  const aportado = toFloat(t.total_aportado);
  const diff     = toFloat(t.total_diferenca_patrimonio);

  const corDiff = corVar(diff);
  // barra: variação como % do aportado (base = 100% aportado)
  const pctVariacao  = aportado > 0 ? Math.abs(diff) / aportado * 100 : 0;
  const pctAportado  = Math.max(100 - pctVariacao, 0);

  const rowDiff = evolucao?.[1] ?? {};
  const dataEvolucaoCompleta = anos.map(ano => ({
    ano,
    valor: toFloat(evolucao[0][ano]),
    diff:  toFloat(rowDiff[ano] ?? 0),
  }));
  const dataEvolucao = dataEvolucaoCompleta.filter(d => parseInt(d.ano, 10) >= anoInicioEvolucao);

  return (
    <Card>
      <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
        <div className="card-header">
          <h2 className="card-titulo"><IconeCard nome="patrimonio" />Patrimônio</h2>
        </div>
      </SubCard>

      <SubCard>
        <div className="list-row list-row-plain" style={{ marginTop: "calc(var(--space-4) * -1)" }}>
          <div className="list-row-left">
            <span className="list-row-label">Patrimônio Atual</span>
          </div>
          <div className="list-row-right">
            <span className="list-row-value">{fmtBRL(total)}</span>
          </div>
        </div>

        {/* Legenda no estilo de lista, sem card ao redor */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <div style={{ marginBottom: "calc(var(--space-4) * -1)" }}>
            <ListRow
              label={`Variação (${pctVariacao.toFixed(1)}%)`}
              value={`${sinal(diff)}${fmtBRL(diff)}`}
              valueColor={corDiff}
              plain
            />
            <ListRow
              label={`Aportado (${pctAportado.toFixed(1)}%)`}
              value={fmtBRL(aportado)}
              plain
            />
          </div>
        </div>
      </SubCard>

      {temEvolucao && (
        <SubCard style={{ overflow: "hidden" }}>
          <HeroValor titulo="Patrimônio Atual" valor={fmtBRL(total)} visible={!!total} />
          <div className="card-header" style={{ margin: "var(--space-2) 0" }}>
            <SeletorAno anos={anosNumEvolucao} anoInicio={anoInicioEvolucao} onChange={setAnoInicioEvolucao} />
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={dataEvolucao} margin={{ top: 12, right: 12, left: 12, bottom: 4 }}>
              <defs>
                <linearGradient id="gradEv" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={COR_ALTA} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={COR_ALTA} stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="ano" tick={<EvolucaoXTick />} axisLine={false} tickLine={false} interval={0} />
              <YAxis hide />
              <Tooltip content={<CustomTooltipEvolucao />} />
              <Area type="monotone" dataKey="valor" stroke={COR_ALTA} strokeWidth={2.5}
                fill="url(#gradEv)" dot={{ fill: COR_ALTA, r: 4 }}
                activeDot={{ r: 6, fill: COR_ALTA }}
              />
              <Area type="monotone" dataKey="diff" stroke="none" fill="none" dot={false} activeDot={false} legendType="none" />
            </AreaChart>
          </ResponsiveContainer>
        </SubCard>
      )}
    </Card>
  );
}

// ── Tooltip Personalizado para Gráficos ───────────────────────────────────────

function CustomTooltipEvolucao({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif' }}>
      <div className="tooltip-label">{label}</div>
      <div className="tooltip-val" style={{ color: "#ffffff" }}>{fmtBRL(payload[0].value)}</div>
      {payload[1] && (
        <div className="tooltip-sub" style={{ color: corVar(payload[1].value) }}>
          {sinal(payload[1].value)}{fmtBRL(payload[1].value)}
        </div>
      )}
    </div>
  );
}

function EvolucaoXTick({ x, y, payload }) {
  const isMobile = typeof window !== "undefined" && window.innerWidth <= 640;
  const fontSize = isMobile ? "clamp(8px, 1.8vw, 10px)" : 10;
  return (
    <text x={x} y={y + 10} textAnchor="middle" fill="#909090" fontSize={fontSize} fontFamily='-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif'>
      {payload.value}
    </text>
  );
}

// ── Card Reserva ──────────────────────────────────────────────────────────────

function CardReserva({ reservas, alocacao, totais }) {
  if (!reservas?.length || !alocacao?.length) return null;
  const r = reservas[0], a = alocacao[0];
  const aktual   = toFloat(r.reserva_atual);
  const pctIdeal = toFloat(a.alocacao_ideal_reservas);

  const totalPatrimonio = toFloat(totais?.[0]?.total_patrimonio);
  const valorIdeal       = totalPatrimonio * pctIdeal / 100;
  const valorDiferenca   = aktual - valorIdeal;
  const tituloValorD     = valorDiferenca > 0 ? "Sobrando" : valorDiferenca < 0 ? "Faltando" : "Equilibrada";
  const valorD           = Math.abs(valorDiferenca);
  const corDiferenca     = valorDiferenca > 0 ? COR_ALTA : valorDiferenca < 0 ? COR_BAIXA : "var(--color-neutral)";

  // barra: diferença como % do valor ideal (base = 100% ideal)
  const pctVariacao = valorIdeal > 0 ? Math.abs(valorDiferenca) / valorIdeal * 100 : 0;
  const pctBase     = Math.max(100 - pctVariacao, 0);

  return (
    <Card>
      <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
        <div className="card-header">
          <h2 className="card-titulo"><IconeCard nome="reserva" />Reserva</h2>
        </div>
      </SubCard>

      <SubCard>
        <div className="list-row list-row-plain" style={{ marginTop: "calc(var(--space-4) * -1)" }}>
          <div className="list-row-left">
            <span className="list-row-label">Atual</span>
          </div>
          <div className="list-row-right">
            <span className="list-row-value">{fmtBRL(aktual)}</span>
          </div>
        </div>

        {valorIdeal > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <div style={{ marginBottom: "calc(var(--space-4) * -1)" }}>
              <ListRow
                label={`${tituloValorD} (${pctVariacao.toFixed(1)}%)`}
                value={fmtBRL(valorD)}
                valueColor={corDiferenca}
                plain
              />
              <ListRow
                label={`Ideal (${pctBase.toFixed(1)}%)`}
                value={fmtBRL(valorIdeal)}
                plain
              />
            </div>
          </div>
        )}
      </SubCard>
    </Card>
  );
}

// ── Card Resumo de Investimentos ──────────────────────────────────────────────
// Soma total_atual / total_aportado / variação de todas as classes de ativos
// (stocks, reits, ações, fiis, bitcoins) — não inclui reservas.

function CardResumoInvestimentos({ totais }) {
  if (!totais?.length) return null;
  const t = totais[0];

  const total    = CLASSES_ATIVOS.reduce((acc, c) => acc + toFloat(t[`total_${c.sufixo}`]), 0);
  const aportado = CLASSES_ATIVOS.reduce((acc, c) => acc + toFloat(t[`total_aportado_${c.sufixo}`]), 0);
  const diff     = CLASSES_ATIVOS.reduce((acc, c) => acc + toFloat(t[`diferenca_${c.sufixo}`]), 0);

  const corDiff = corVar(diff);
  // barra: variação como % do aportado (base = 100% aportado)
  const pctVariacao = aportado > 0 ? Math.abs(diff) / aportado * 100 : 0;
  const pctAportado = Math.max(100 - pctVariacao, 0);

  return (
    <Card>
      <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
        <div className="card-header">
          <h2 className="card-titulo"><IconeCard nome="investimentos" />Investimentos</h2>
        </div>
      </SubCard>

      <SubCard>
        <div className="list-row list-row-plain" style={{ marginTop: "calc(var(--space-4) * -1)" }}>
          <div className="list-row-left">
            <span className="list-row-label">Total Atual</span>
          </div>
          <div className="list-row-right">
            <span className="list-row-value">{fmtBRL(total)}</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <div style={{ marginBottom: "calc(var(--space-4) * -1)" }}>
            <ListRow
              label={`Variação (${pctVariacao.toFixed(1)}%)`}
              value={`${sinal(diff)}${fmtBRL(diff)}`}
              valueColor={corDiff}
              plain
            />
            <ListRow
              label={`Aportado (${pctAportado.toFixed(1)}%)`}
              value={fmtBRL(aportado)}
              plain
            />
          </div>
        </div>
      </SubCard>
    </Card>
  );
}

// ── Card Alocação ─────────────────────────────────────────────────────────────

function BarraAlocacao({ dados, onHoverItem, hoveredIdx }) {
  const total = dados.reduce((s, d) => s + d.pct, 0) || 1;

  return (
    <SubCard>
      {/* Barra principal */}
      <div style={{ display: "flex", height: 36, borderRadius: "var(--radius-md)", overflow: "hidden", gap: 2 }}>
        {dados.map((d, i) => {
          const isHov = hoveredIdx === i;
          const cor = PALETA_ALOCACAO[i % PALETA_ALOCACAO.length];
          return (
            <div
              key={d.titulo}
              onMouseEnter={() => onHoverItem(i)}
              onMouseLeave={() => onHoverItem(null)}
              style={{
                flex: d.pct / total,
                background: cor,
                position: "relative",
                transition: "flex 0.45s ease, filter 0.2s, transform 0.2s",
                cursor: "default",
                filter: hoveredIdx !== null && !isHov ? "brightness(0.45) saturate(0.5)" : "brightness(1)",
                transform: isHov ? "scaleY(1.06)" : "scaleY(1)",
                minWidth: d.pct < 2 ? 4 : 0,
                overflow: "hidden",
              }}
              title={`${d.titulo}: ${d.pct.toFixed(1)}%`}
            />
          );
        })}
      </div>

      {/* Cards de legenda — grid único, responsividade tratada via CSS (.tiles-grid) */}
      <div className="tiles-grid">
        {dados.map((d, i) => {
          const cor = PALETA_ALOCACAO[i % PALETA_ALOCACAO.length];
          return (
            <Tile
              key={d.titulo}
              cor={cor}
              titulo={d.titulo}
              valor={`${d.pct.toFixed(1)}%`}
              diff={d.diff}
              metaPct={d.ideal > 0 ? Math.min(d.pct / d.ideal, 1) * 100 : null}
              metaLabel={`Meta ${d.ideal.toFixed(1)}%`}
              isHover={hoveredIdx === i}
              onHoverStart={() => onHoverItem(i)}
              onHoverEnd={() => onHoverItem(null)}
            />
          );
        })}
      </div>
    </SubCard>
  );
}

function CardAlocacao({ alocacao }) {
  const [hoveredIdx, setHoveredIdx] = useState(null);
  if (!alocacao?.length) return null;
  const a = alocacao[0];

  const dados = ALOCACAO_CLASSES.map((c, i) => ({
    ...c,
    pct:   toFloat(a[`alocacao_atual_${c.sufixo}`]),
    ideal: toFloat(a[`alocacao_ideal_${c.sufixo}`]),
    diff:  toFloat(a[`alocacao_diferenca_${c.sufixo}`]),
    cor:   PALETA_ALOCACAO[i % PALETA_ALOCACAO.length],
  }));

  return (
    <Card>
      <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
        <div className="card-header">
          <h2 className="card-titulo"><IconeCard nome="alocacao" />Alocação</h2>
        </div>
      </SubCard>

      <BarraAlocacao dados={dados} onHoverItem={setHoveredIdx} hoveredIdx={hoveredIdx} />
    </Card>
  );
}

// ── Card Aporte ───────────────────────────────────────────────────────────────

function CardAporte({ ativos, alocacao }) {
  if (!ativos?.length || !alocacao?.length) return null;
  const a = alocacao[0];

  const APORTE_MAP = {
    stock:   ["alocacao_ideal_stocks",   "alocacao_atual_stocks"  ],
    reit:    ["alocacao_ideal_reits",    "alocacao_atual_reits"   ],
    acao:    ["alocacao_ideal_acoes",    "alocacao_atual_acoes"   ],
    fii:     ["alocacao_ideal_fiis",     "alocacao_atual_fiis"    ],
    bitcoin: ["alocacao_ideal_bitcoins", "alocacao_atual_bitcoins"],
    reserva: ["alocacao_ideal_reservas", "alocacao_atual_reservas"],
  };

  const ORDEM = [
    { classe: "stock",   nome: "Stocks"   },
    { classe: "reit",    nome: "Reits"    },
    { classe: "acao",    nome: "Ações"    },
    { classe: "fii",     nome: "Fiis"     },
    { classe: "bitcoin", nome: "Bitcoins" },
    { classe: "reserva", nome: "Reservas" },
  ];

  const deficits = ORDEM.map(({ classe, nome }) => {
    const [ki, ka] = APORTE_MAP[classe];
    const ideal  = toFloat(a[ki]);
    const aktual = toFloat(a[ka]);
    const diff   = ideal - aktual;
    return { classe, nome, ideal, atual: aktual, diff };
  }).filter(d => d.ideal > 0 && d.diff > 0).sort((a, b) => b.diff - a.diff);

  const classePrio = deficits[0] ?? null;

  const ativosPrioClasse = classePrio
    ? ativos
        .filter(at => String(at.classe ?? "").toLowerCase().trim() === classePrio.classe)
        .sort((a, b) => toFloat(a.porcentagem_sobrando_faltando) - toFloat(b.porcentagem_sobrando_faltando))
    : [];

  const ativo1Obj = ativosPrioClasse[0] ?? null;
  const ativo2Obj = ativosPrioClasse[1] ?? null;

  return (
    <Card>
      <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
        <div className="card-header">
          <h2 className="card-titulo"><IconeCard nome="aporte" />Aporte</h2>
        </div>
      </SubCard>

      {classePrio && (() => {
        const pctAtual  = classePrio.ideal > 0 ? Math.min(classePrio.atual / classePrio.ideal, 1) * 100 : 0;
        const pctFalta  = classePrio.ideal > 0 ? Math.min(classePrio.diff  / classePrio.ideal, 1) * 100 : 0;
        return (
          <SubCard>
            <div className="list-row list-row-plain" style={{ marginTop: "calc(var(--space-4) * -1)" }}>
              <div className="list-row-left">
                <span className="list-row-label">Classe Prioritária</span>
              </div>
              <div className="list-row-right">
                <span className="list-row-value">{classePrio.nome}</span>
              </div>
            </div>

            {/* Legenda em linha única, igual ao card Reserva de Emergência */}
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              <div style={{ marginBottom: "calc(var(--space-4) * -1)" }}>
                <ListRow label="Atual" value={`${classePrio.atual.toFixed(1)}%`} plain />
                <ListRow label="Meta" value={`${classePrio.ideal.toFixed(1)}%`} plain />
                <ListRow
                  label="Faltando"
                  value={`${classePrio.diff.toFixed(1)}%`}
                  valueColor={COR_BAIXA}
                  plain
                />
              </div>
            </div>
          </SubCard>
        );
      })()}

      {ativo1Obj && (
        <CardAtivo ativo={ativo1Obj} soMeta titulo="Ativo Prioritário 1" />
      )}

      {ativo2Obj && (
        <CardAtivo ativo={ativo2Obj} soMeta titulo="Ativo Prioritário 2" />
      )}
    </Card>
  );
}

// ── Card Proventos ────────────────────────────────────────────────────────────

function GraficoProventos({ porAno }) {
  const [hovIdx, setHovIdx] = useState(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const containerRef = useRef(null);
  const vMax     = Math.max(...porAno.map(r => r.valor), 1);
  const anoAtual = String(new Date().getFullYear());
  const CHART_H  = 220;
  const BAR_GAP  = 10;

  const [containerW, setContainerW] = useState(0);
  const handleMouseMove = (e) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setContainerW(rect.width);
    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      style={{ position: "relative", width: "100%", boxSizing: "border-box" }}
    >
      {hovIdx !== null && (() => {
        const d        = porAno[hovIdx];
        const anterior = hovIdx > 0 ? porAno[hovIdx - 1].valor : null;
        const diff     = anterior !== null ? d.valor - anterior : null;
        const isRightSide = mousePos.x > containerW / 2;
        return (
          <div className="chart-tooltip" style={{
            position: "absolute",
            left: mousePos.x,
            top: mousePos.y,
            transform: isRightSide
              ? "translate(calc(-100% - 14px), calc(-100% - 14px))"
              : "translate(14px, calc(-100% - 14px))",
            pointerEvents: "none",
            whiteSpace: "nowrap",
            zIndex: 10,
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif',
          }}>
            <div className="tooltip-label">{d.ano}</div>
            <div className="tooltip-val" style={{ color: "#ffffff" }}>{fmtBRL(d.valor)}</div>
            {diff !== null && (
              <div className="tooltip-sub" style={{ color: corVar(diff) }}>
                {sinal(diff)}{fmtBRL(diff)}
              </div>
            )}
          </div>
        );
      })()}

      <div style={{
        display: "flex",
        alignItems: "flex-end",
        gap: BAR_GAP,
        height: CHART_H,
        overflow: "visible",
      }}>
        {porAno.map((d, i) => {
          const heightPct = (d.valor / vMax) * 100;
          const isHov     = hovIdx === i;
          const isCurrent = d.ano === anoAtual;
          const barColor  = isCurrent ? "#1acfc4" : "#13a097";

          return (
            <div
              key={d.ano}
              onMouseEnter={() => setHovIdx(i)}
              onMouseLeave={() => setHovIdx(null)}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                height: "100%",
                justifyContent: "flex-end",
                cursor: "default",
                position: "relative",
              }}
            >
              <div className="barra-proventos" style={{
                width: "100%",
                height: `${heightPct}%`,
                minHeight: d.valor > 0 ? 4 : 0,
                background: isHov ? "#13a097" : isCurrent ? "#13a097" : "#0a5550",
                transition: "height 0.6s cubic-bezier(0.4,0,0.2,1), background 0.15s",
                position: "relative",
                overflow: "hidden",
              }}>
                {isHov && (
                  <div className="barra-proventos-glow" style={{
                    position: "absolute", inset: 0,
                    background: "linear-gradient(180deg, rgba(255,255,255,0.15) 0%, transparent 60%)",
                  }} />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: BAR_GAP, marginTop: "var(--space-2)" }}>
        {porAno.map((d, i) => (
          <div key={d.ano} style={{
            flex: 1,
            textAlign: "center",
            fontSize: "clamp(8px, 1.8vw, 11px)",
            fontWeight: 500,
            color: d.ano === anoAtual ? "#13a097" : hovIdx === i ? "var(--color-value)" : "var(--color-label)",
            transition: "color 0.15s",
            minWidth: 0,
            whiteSpace: "nowrap",
          }}>
            {d.ano}
          </div>
        ))}
      </div>
    </div>
  );
}

function CardProventos({ proventos }) {
  const anosNumProventos = (proventos ?? [])
    .map(row => parseInt(row.ano, 10))
    .filter(n => !isNaN(n))
    .sort((a, b) => a - b);
  const anoAtualNum = new Date().getFullYear();
  const [anoInicioProventos, setAnoInicioProventos] = useState(anoAtualNum - (ANOS_PADRAO_HISTORICO - 1));

  if (!proventos?.length) return null;

  const totalRecebido = toFloat(proventos[0]?.total_recebido ?? 0);
  const porAnoCompleto = proventos.map(row => ({
    ano:   String(row.ano ?? ""),
    valor: toFloat(row.total_ano),
  })).filter(r => r.ano);
  const porAno = porAnoCompleto.filter(d => parseInt(d.ano, 10) >= anoInicioProventos);

  return (
    <Card>
      <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
        <div className="card-header">
          <h2 className="card-titulo"><IconeCard nome="proventos" />Proventos</h2>
        </div>
      </SubCard>

      <SubCard style={{ overflow: "hidden" }}>
        <HeroValor titulo="Total Recebido" valor={fmtBRL(totalRecebido)} visible={!!totalRecebido} />
        <div className="card-header" style={{ margin: "var(--space-2) 0" }}>
          <SeletorAno anos={anosNumProventos} anoInicio={anoInicioProventos} onChange={setAnoInicioProventos} />
        </div>
        <GraficoProventos porAno={porAno} />
      </SubCard>
    </Card>
  );
}

// ── Heatmap de Ativos ─────────────────────────────────────────────────────────

function HeatmapCell({ ativo }) {
  const [imgErr, setImgErr] = useState(false);
  const [hovered, setHovered] = useState(false);
  const pct    = toFloat(ativo.variacao_percentual);
  const varBRL = toFloat(ativo.variacao_total);
  const cor    = corHeatmap(pct);
  const s      = pct > 0 ? "+" : "";
  const sb     = varBRL > 0 ? "+" : "";
  const ticker = String(ativo.ticker).toUpperCase();

  return (
    <div
      className="heatmap-cell"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: cor,
        boxShadow: hovered ? `0 6px 24px ${cor}99, 0 2px 8px ${cor}55` : "none",
      }}
    >
      {!imgErr ? (
        <img src={`/img_ativos/${ticker}.png`} alt={ticker}
          width={40} height={40}
          onError={() => setImgErr(true)}
          style={{ objectFit: "contain", borderRadius: 6 }} />
      ) : null}
      <span className="hm-ticker">{ticker}</span>
      <span className="hm-pct">{s}{pct.toFixed(2)}%</span>
      <span className="hm-brl">{sb}{fmtBRL(varBRL)}</span>
    </div>
  );
}

// ── Card Heatmap ──────────────────────────────────────────────────────────────

function CardHeatmap({ ativos }) {
  const [open, setOpen] = useState(false);
  if (!ativos?.length) return null;

  const df = ativos
    .filter(a => toFloat(a.total_atual) > 0)
    .sort((a, b) => toFloat(b.variacao_percentual) - toFloat(a.variacao_percentual));

  const LIMITE = 12;
  const temMais = df.length > LIMITE;

  return (
    <Card>
      <div className="card-header">
        <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
          <h2 className="card-titulo"><IconeCard nome="heatmap" />Mapa de Ativos</h2>
        </SubCard>
        {temMais && (
          <BotaoVer onClick={() => setOpen(o => !o)} open={open}>
            {open ? "Ocultar" : "Ver Mais"}
          </BotaoVer>
        )}
      </div>
      <SubCard>
        <div className="heatmap-grid">
          {df.slice(0, LIMITE).map((at, i) => <HeatmapCell key={i} ativo={at} />)}
        </div>
        {temMais && (
          <Expandable open={open}>
            <div className="heatmap-grid" style={{ marginTop: "var(--space-3)" }}>
              {df.slice(LIMITE).map((at, i) => <HeatmapCell key={i} ativo={at} />)}
            </div>
          </Expandable>
        )}
      </SubCard>
    </Card>
  );
}

// ── Card Individual de Ativo ──────────────────────────────────────────────────

function CardAtivo({ ativo, highlight, soMeta = false, titulo = null, sortBy = null }) {
  const ehUSD = ["stock", "reit"].includes(String(ativo.classe).toLowerCase().trim());
  const cot   = toFloat(ativo.cotacao);
  const qtd   = toFloat(ativo.quantidade);
  const pm    = toFloat(ativo.preco_medio);
  const ti    = toFloat(ativo.total_investido);
  const ta    = toFloat(ativo.total_atual);
  const vt    = toFloat(ativo.variacao_total);
  const vpct  = toFloat(ativo.variacao_percentual);
  const pmeta = toFloat(ativo.porcentagem_meta);
  const pat   = toFloat(ativo.porcentagem_atual);
  const psf   = toFloat(ativo.porcentagem_sobrando_faltando);

  const textoSF = psf > 0 ? "Sobrando" : psf < 0 ? "Faltando" : "Ok";
  const s   = sinal(vt);
  const ssf = sinal(psf);

  const metricas = soMeta
    ? [
        { titulo: "Atual", chave: "porcentagem_atual", valor: `${pat.toFixed(2)}%`,                  cor: null        },
        { titulo: "Meta",  chave: null,                 valor: `${pmeta.toFixed(2)}%`,               cor: null        },
        { titulo: textoSF, chave: null,                 valor: `${ssf}${Math.abs(psf).toFixed(2)}%`, cor: corVar(psf) },
      ]
    : [
        { titulo: "Cotação",         chave: null,                    valor: ehUSD ? fmtUSD(cot) : fmtBRL(cot), cor: null        },
        { titulo: "Quantidade",      chave: null,                    valor: String(qtd),                         cor: null        },
        { titulo: "Preço Médio",     chave: null,                    valor: ehUSD ? fmtUSD(pm) : fmtBRL(pm),   cor: null        },
        { titulo: "Total Investido", chave: null,                    valor: fmtBRL(ti),                          cor: null        },
        { titulo: "Total Atual",     chave: "total_atual",           valor: fmtBRL(ta),                          cor: null        },
        { titulo: "Variação",        chave: "variacao_total",        valor: `${s}${fmtBRL(vt)}`,                cor: corVar(vt)  },
        { titulo: "Variação %",      chave: "variacao_percentual",   valor: `${s}${vpct.toFixed(2)}%`,          cor: corVar(vt)  },
        { titulo: "% Meta",          chave: null,                    valor: `${pmeta.toFixed(2)}%`,             cor: null        },
        { titulo: "% Atual",         chave: "porcentagem_atual",     valor: `${pat.toFixed(2)}%`,               cor: null        },
        { titulo: textoSF,           chave: null,                    valor: `${ssf}${Math.abs(psf).toFixed(2)}%`, cor: corVar(psf) },
      ];

  return (
    <SubCard id={`ativo-${ativo.ticker}`} style={{
      overflow: "hidden",
      transition: "box-shadow 0.4s ease, border-color 0.4s ease",
      ...(highlight ? {
        boxShadow: "0 0 0 1px #13a097, 0 0 12px rgba(19,160,151,0.2)",
        borderColor: "#13a097",
      } : {}),
    }}>
      {titulo ? (
        <div className="list-row list-row-plain" style={{ marginTop: "calc(var(--space-4) * -1)" }}>
          <div className="list-row-left">
            <span className="list-row-label">{titulo}</span>
          </div>
          <div className="list-row-right">
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, minWidth: 0 }}>
              <span className="list-row-value">{String(ativo.ticker).toUpperCase()}</span>
              <span className="list-row-sub">{ativo.nome}</span>
            </div>
            <LogoAtivo ticker={ativo.ticker} size={36} />
          </div>
        </div>
      ) : (
        <>
          <div className={`ativo-cabecalho${sortBy === "nome" ? " ativo-cabecalho-filtrado" : ""}`} style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-4)",
          }}>
            <LogoAtivo ticker={ativo.ticker} size={72} offsetX={-6} className="logo-ativo-principal" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="ativo-nome-ticker">
                {String(ativo.ticker).toUpperCase()}
              </div>
              <div className="ativo-nome-texto">{ativo.nome}</div>
            </div>
          </div>

          <div className="divisor" />
        </>
      )}

      <div style={{ marginBottom: "calc(var(--space-4) * -1)" }}>
        {metricas.map((m) => (
          <ListRow key={m.titulo} label={m.titulo} value={m.valor} valueColor={m.cor} plain highlight={!!m.chave && m.chave === sortBy} />
        ))}
      </div>
    </SubCard>
  );
}

// ── Card de Classe (Stocks, Reits, etc.) ──────────────────────────────────────

function CardClasse({ titulo, sufixo, classe, totais, ativos, selectedTicker, searchVersion, scrollRef }) {
  const [open, setOpen]               = useState(false);
  const [sortBy, setSortBy]           = useState(null);
  const [sortDir, setSortDir]         = useState("asc");
  const [filtrosOpen, setFiltrosOpen] = useState(false);
  const [highlightTicker, setHighlightTicker] = useState(null);

  // Quando um ticker é selecionado pela busca
  useEffect(() => {
    if (!selectedTicker || !searchVersion) return;
    const pertenceAessa = (ativos ?? []).some(a =>
      String(a.ticker) === selectedTicker &&
      String(a.classe).toLowerCase().trim() === classe
    );
    if (!pertenceAessa) return;

    const jaAberto = open;
    setOpen(true);
    setHighlightTicker(selectedTicker);

    const scrollToAtivo = () => {
      const el = document.getElementById(`ativo-${selectedTicker}`);
      const container = scrollRef?.current;
      if (el && container) {
        const containerRect = container.getBoundingClientRect();
        const elRect        = el.getBoundingClientRect();
        const offset        = container.scrollTop + elRect.top - containerRect.top - 110;
        container.scrollTo({ top: offset, behavior: "smooth" });
      }
      setTimeout(() => setHighlightTicker(null), 2000);
    };

    let t;
    if (jaAberto) {
      scrollToAtivo();
    } else {
      const secEl = document.getElementById(`sec-${sufixo}`);
      const container = scrollRef?.current;
      if (secEl && container) {
        const containerRect = container.getBoundingClientRect();
        const secRect       = secEl.getBoundingClientRect();
        container.scrollTo({ top: container.scrollTop + secRect.top - containerRect.top - 110, behavior: "smooth" });
      }
      t = setTimeout(scrollToAtivo, 550);
    }

    return () => clearTimeout(t);
  }, [searchVersion]);

  const handleSort = (key) => {
    if (sortBy === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortBy(key);
      setSortDir(key === "nome" ? "asc" : "desc");
    }
  };

  if (!totais?.length) return null;
  const t = totais[0];

  const total    = toFloat(t[`total_${sufixo}`]);
  const aportado = toFloat(t[`total_aportado_${sufixo}`]);
  const diff     = toFloat(t[`diferenca_${sufixo}`]);

  let df = (ativos ?? []).filter(a => String(a.classe).toLowerCase().trim() === classe);
  if (sortBy) {
    df = [...df].sort((a, b) => {
      const va = sortBy === "nome" ? String(a[sortBy]) : toFloat(a[sortBy]);
      const vb = sortBy === "nome" ? String(b[sortBy]) : toFloat(b[sortBy]);
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }

  const corDiff = corVar(diff);
  const pctVariacao = aportado > 0 ? Math.abs(diff) / aportado * 100 : 0;
  const pctAportado = Math.max(100 - pctVariacao, 0);

  return (
    <Card>
      <div className="card-header">
        <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
          <h2 className="card-titulo"><IconeCard nome={ICONE_POR_SUFIXO[sufixo]} />{titulo}</h2>
        </SubCard>
        <BotaoVer onClick={() => setOpen(o => !o)} open={open}>{open ? "Ocultar" : "Ver Mais"}</BotaoVer>
      </div>

      <SubCard>
        {/* Total à esq, variação à dir — sem bloco */}
        <div className="list-row list-row-plain" style={{ marginTop: "calc(var(--space-4) * -1)" }}>
          <div className="list-row-left">
            <span className="list-row-label">Total Em {titulo}</span>
          </div>
          <div className="list-row-right">
            <span className="list-row-value">{fmtBRL(total)}</span>
          </div>
        </div>

        {/* Legenda simples */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <div style={{ marginBottom: "calc(var(--space-4) * -1)" }}>
            <ListRow
              label={`Variação (${pctVariacao.toFixed(1)}%)`}
              value={`${sinal(diff)}${fmtBRL(Math.abs(diff))}`}
              valueColor={corDiff}
              plain
            />
            <ListRow
              label={`Aportado (${pctAportado.toFixed(1)}%)`}
              value={fmtBRL(aportado)}
              plain
            />
          </div>
        </div>
      </SubCard>

      <Expandable open={open}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          {/* Dropdown "Filtros" — usado em qualquer tamanho de tela ── */}
          <div className="dropdown-wrap">
            <BotaoFiltroTrigger
              open={filtrosOpen}
              onClick={() => setFiltrosOpen(o => !o)}
            >
              Filtrar
              {sortBy && (
                <span className="dropdown-trigger-sub">
                  · {FILTROS.find(f => f.key === sortBy)?.texto}
                </span>
              )}
            </BotaoFiltroTrigger>

            {filtrosOpen && (
              <div className="dropdown-menu">
                {FILTROS.map(f => {
                  const ativo = sortBy === f.key;
                  return (
                    <button
                      key={f.key}
                      className={`dropdown-item${ativo ? " is-ativo" : ""}`}
                      onClick={() => { handleSort(f.key); setFiltrosOpen(false); }}
                    >
                      {f.texto}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="ativos-lista">
            {df.map((at, i) => <CardAtivo key={i} ativo={at} highlight={at.ticker === highlightTicker} sortBy={sortBy} />)}
          </div>
        </div>
      </Expandable>
    </Card>
  );
}

// ── Página de Finanças (ex-Netuno) ────────────────────────────────────────────

const FINANCAS_API_URL = "https://script.google.com/macros/s/AKfycbwJsa0yUSpzKtQ-LRWrI9LnppE5U-4ZpFlphaf_Kd-ze8gbqdoiJnkhuSibS6OgIG8dPA/exec";

const FINANCAS_FILTROS = [
  { texto: "Todas",    key: "all"     },
  { texto: "Receitas", key: "income"  },
  { texto: "Despesas", key: "expense" },
];

async function carregarLancamentos() {
  try {
    const res = await fetch(FINANCAS_API_URL);
    const data = await res.json();
    // Formato novo: { transactions, metaDespesa }. Mantém compatibilidade com formato antigo (array puro).
    if (Array.isArray(data)) return { transactions: data, metaDespesa: 0 };
    return {
      transactions: Array.isArray(data.transactions) ? data.transactions : [],
      metaDespesa: Number(data.metaDespesa) || 0,
    };
  } catch {
    return { transactions: [], metaDespesa: 0 };
  }
}

async function salvarLancamentos(transactions, metaDespesa) {
  try {
    await fetch(FINANCAS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // evita preflight CORS
      body: JSON.stringify({ transactions, metaDespesa }),
    });
  } catch (err) {
    console.error("Erro ao salvar lançamentos:", err);
  }
}

// ── Card Resumo (Total Líquido + Receitas/Despesas) ──

function CardFinancasResumo({ totais }) {
  const corNet = corVar(totais.net);

  return (
    <Card>
      <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
        <div className="card-header">
          <h2 className="card-titulo"><IconeCard nome="financas" />Finanças</h2>
        </div>
      </SubCard>

      <SubCard>
        <div className="list-row list-row-plain" style={{ marginTop: "calc(var(--space-4) * -1)" }}>
          <div className="list-row-left">
            <span className="list-row-label">Total Líquido</span>
          </div>
          <div className="list-row-right">
            <span className="list-row-value" style={{ color: corNet }}>{fmtBRL(totais.net)}</span>
          </div>
        </div>

        <div style={{ marginBottom: "calc(var(--space-4) * -1)" }}>
          <ListRow
            label="Receitas Totais"
            value={fmtBRL(totais.income)}
            valueColor={COR_ALTA}
            plain
          />
          <ListRow
            label="Despesas Totais"
            value={fmtBRL(totais.expense)}
            valueColor={COR_BAIXA}
            plain
          />
        </div>
      </SubCard>
    </Card>
  );
}

// ── Card Comparativo (Receitas vs Despesas) ──

function CardFinancasComparativo({ totais, lancamentos, onEditar }) {
  const compareTotal = totais.income + totais.expense || 1;
  const pctIncome  = (totais.income  / compareTotal) * 100;
  const pctExpense = (totais.expense / compareTotal) * 100;
  const savingsRate = totais.income > 0 ? ((totais.income - totais.expense) / totais.income) * 100 : 0;
  const temDados = totais.income > 0 || totais.expense > 0;

  if (!temDados) return null;

  const receitas = lancamentos.filter(t => t.type === "income");

  return (
    <Card>
      <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
        <div className="card-header">
          <h2 className="card-titulo"><IconeCard nome="seta-cima" />Receitas</h2>
        </div>
      </SubCard>

      <SubCard>
        <div className="card-header" style={{ marginBottom: "var(--space-2)" }}>
          <span className="campo-titulo">Receita vs Despesa</span>
        </div>

        <div className="barra-track">
          <div className="barra-fill left"  style={{ width: `${pctIncome}%`,  background: COR_ALTA  }} title={`Receitas: ${pctIncome.toFixed(1)}%`} />
          <div className="barra-fill right" style={{ width: `${pctExpense}%`, background: COR_BAIXA }} title={`Despesas: ${pctExpense.toFixed(1)}%`} />
        </div>

        <div style={{ marginTop: "var(--space-3)", marginBottom: "calc(var(--space-4) * -1)" }}>
          <ListRow label={`Receitas (${pctIncome.toFixed(1)}%)`}  value={fmtBRL(totais.income)}  valueColor={COR_ALTA}  plain />
          <ListRow label={`Despesas (${pctExpense.toFixed(1)}%)`} value={fmtBRL(totais.expense)} valueColor={COR_BAIXA} plain />
          <ListRow
            label={savingsRate > 0 ? "Está Sobrando" : savingsRate < 0 ? "Está Faltando" : "Está Ok"}
            value={`${sinal(savingsRate)}${savingsRate.toFixed(0)}%`}
            valueColor={corVar(savingsRate)}
            plain
          />
        </div>
      </SubCard>

      {receitas.length > 0 && (
        <SubCard>
          <div style={{ marginTop: "calc(var(--space-4) * -1)", marginBottom: "calc(var(--space-4) * -1)" }}>
            {receitas.map(tx => (
              <div key={tx.id} className="list-row list-row-plain">
                <div className="list-row-left">
                  <span className="list-row-label">{tx.name}</span>
                </div>
                <div className="list-row-right">
                  <span className="list-row-value" style={{ color: COR_ALTA }}>
                    +{fmtBRL(tx.value)}
                  </span>
                  <button className="btn-ver" onClick={() => onEditar(tx)}>
                    Editar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </SubCard>
      )}
    </Card>
  );
}

// ── Card Meta de Gastos ──

function CardFinancasMeta({ meta, gasto, onEditar, lancamentos, onEditarLancamento }) {
  const restante  = meta - gasto;
  const excedeu   = meta > 0 && gasto > meta;
  const pct       = meta > 0 ? Math.min((gasto / meta) * 100, 100) : 0;
  const despesas  = lancamentos.filter(t => t.type === "expense");

  return (
    <Card>
      <SubCard className="subcard-titulo" style={{ width: "fit-content" }}>
        <div className="card-header">
          <h2 className="card-titulo"><IconeCard nome="seta-baixo" />Despesas</h2>
        </div>
      </SubCard>

      <SubCard>
        <div className="card-header" style={{ marginBottom: meta > 0 ? "var(--space-2)" : 0 }}>
          <span className="campo-titulo">{meta > 0 ? "Progresso do mês" : "Nenhuma meta definida"}</span>
          <button className="btn-ver" onClick={onEditar}>{meta > 0 ? "Editar" : "Definir meta"}</button>
        </div>

        {meta > 0 ? (
          <>
            <BarraSimples pct={pct} cor={excedeu ? COR_BAIXA : "var(--accent-p)"} />
            <div style={{ marginTop: "var(--space-3)", marginBottom: excedeu ? 0 : "calc(var(--space-4) * -1)" }}>
              <ListRow label="Meta definida" value={fmtBRL(meta)} plain />
              <ListRow label="Já gasto" value={fmtBRL(gasto)} valueColor={excedeu ? COR_BAIXA : undefined} plain />
              <ListRow
                label={excedeu ? "Ultrapassou em" : "Ainda pode gastar"}
                value={fmtBRL(Math.abs(restante))}
                valueColor={excedeu ? COR_BAIXA : COR_ALTA}
                plain
              />
            </div>
            {excedeu && (
              <div className="campo-titulo" style={{ color: COR_BAIXA, marginTop: "var(--space-2)" }}>
                ⚠ Você ultrapassou a meta de gastos
              </div>
            )}
          </>
        ) : (
          <div className="campo-titulo">Defina um limite mensal para acompanhar seus gastos.</div>
        )}
      </SubCard>

      {despesas.length > 0 && (
        <SubCard>
          <div style={{ marginTop: "calc(var(--space-4) * -1)", marginBottom: "calc(var(--space-4) * -1)" }}>
            {despesas.map(tx => (
              <div key={tx.id} className="list-row list-row-plain">
                <div className="list-row-left">
                  <span className="list-row-label">{tx.name}</span>
                </div>
                <div className="list-row-right">
                  <span className="list-row-value" style={{ color: COR_BAIXA }}>
                    −{fmtBRL(tx.value)}
                  </span>
                  <button className="btn-ver" onClick={() => onEditarLancamento(tx)}>
                    Editar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </SubCard>
      )}
    </Card>
  );
}

// ── Modal genérico (adicionar/editar lançamento, definir meta) ──

function ModalFinancas({ titulo, onFechar, children }) {
  return createPortal(
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onFechar()}>
      <div className="modal-sheet">
        <div className="modal-header">
          <h3 className="modal-titulo">{titulo}</h3>
          <button className="modal-fechar" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

function ModalLancamento({ form, editando, onChange, onSalvar, onExcluir, onFechar }) {
  return (
    <ModalFinancas titulo={editando ? "Editar Lançamento" : "Novo Lançamento"} onFechar={onFechar}>
      <div className="tipo-toggle">
        <button
          className={`tipo-opcao${form.type === "income" ? " tipo-opcao-ativa income" : ""}`}
          onClick={() => onChange({ ...form, type: "income" })}
        >
          ↑ Receita
        </button>
        <button
          className={`tipo-opcao${form.type === "expense" ? " tipo-opcao-ativa expense" : ""}`}
          onClick={() => onChange({ ...form, type: "expense" })}
        >
          ↓ Despesa
        </button>
      </div>

      <div className="form-grupo">
        <label className="campo-titulo">Descrição</label>
        <input
          className="form-input"
          placeholder="Ex: Salário, Aluguel..."
          value={form.name}
          onChange={e => onChange({ ...form, name: e.target.value })}
        />
      </div>

      <div className="form-grupo">
        <label className="campo-titulo">Valor (R$)</label>
        <input
          className="form-input"
          type="text"
          inputMode="numeric"
          placeholder="0,00"
          value={form.value}
          onChange={e => onChange({ ...form, value: e.target.value })}
        />
      </div>

      <button className="form-botao" onClick={onSalvar}>
        {editando ? "Salvar Alterações" : "Adicionar Lançamento"}
      </button>

      {editando && (
        <button className="form-botao form-botao-perigo" onClick={onExcluir}>
          Excluir Lançamento
        </button>
      )}
    </ModalFinancas>
  );
}

function ModalMeta({ valor, onChange, onSalvar, onLimpar, temMeta, onFechar }) {
  return (
    <ModalFinancas titulo="Meta de Gastos" onFechar={onFechar}>
      <div className="form-grupo">
        <label className="campo-titulo">Valor da meta (R$)</label>
        <input
          className="form-input"
          type="text"
          inputMode="numeric"
          placeholder="0,00"
          value={valor}
          onChange={e => onChange(e.target.value)}
        />
      </div>

      <button className="form-botao" onClick={onSalvar}>Salvar Meta</button>

      {temMeta && (
        <button className="form-botao form-botao-secundario" onClick={onLimpar}>
          Remover Meta
        </button>
      )}
    </ModalFinancas>
  );
}

// ── Página de Finanças — componente principal ──

function PaginaFinancas({ lancamentos, setLancamentos, metaDespesa, setMetaDespesa }, ref) {
  const [modalAberto, setModalAberto] = useState(false);
  const [editandoId, setEditandoId]   = useState(null);
  const [form, setForm]               = useState({ name: "", value: "", type: "income" });

  const [modalMetaAberto, setModalMetaAberto] = useState(false);
  const [metaInput, setMetaInput]             = useState("");

  const totais = {
    income:  lancamentos.filter(t => t.type === "income" ).reduce((s, t) => s + t.value, 0),
    expense: lancamentos.filter(t => t.type === "expense").reduce((s, t) => s + t.value, 0),
  };
  totais.net = totais.income - totais.expense;

  function formatarBRL(raw) {
    const digitos = raw.replace(/\D/g, "");
    if (!digitos) return "";
    const centavos = parseInt(digitos, 10);
    return (centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function parseBRL(formatado) {
    return parseFloat(formatado.replace(/\./g, "").replace(",", ".")) || 0;
  }

  function abrirNovoLancamento() {
    setEditandoId(null);
    setForm({ name: "", value: "", type: "income" });
    setModalAberto(true);
  }

  useImperativeHandle(ref, () => ({
    abrirNovoLancamento,
  }));

  function abrirEdicaoLancamento(tx) {
    setEditandoId(tx.id);
    const formatado = tx.value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    setForm({ name: tx.name, value: formatado, type: tx.type });
    setModalAberto(true);
  }

  function salvarLancamento() {
    const valor = parseBRL(form.value);
    if (!form.name.trim() || isNaN(valor) || valor <= 0) return;

    if (editandoId !== null) {
      setLancamentos(prev => prev.map(t =>
        t.id === editandoId ? { ...t, name: form.name.trim(), value: valor, type: form.type } : t
      ));
    } else {
      setLancamentos(prev => [{ id: Date.now(), name: form.name.trim(), value: valor, type: form.type }, ...prev]);
    }
    setModalAberto(false);
  }

  function excluirLancamento() {
    if (editandoId == null) return;
    setLancamentos(prev => prev.filter(t => t.id !== editandoId));
    setModalAberto(false);
  }

  function abrirModalMeta() {
    setMetaInput(metaDespesa > 0 ? metaDespesa.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");
    setModalMetaAberto(true);
  }

  function salvarMeta() {
    const valor = parseBRL(metaInput);
    setMetaDespesa(isNaN(valor) || valor < 0 ? 0 : valor);
    setModalMetaAberto(false);
  }

  function limparMeta() {
    setMetaDespesa(0);
    setModalMetaAberto(false);
  }

  return (
    <>
      <div id="sec-financas-resumo"><CardFinancasResumo totais={totais} /></div>
      <div id="sec-financas-comparativo">
        <CardFinancasComparativo totais={totais} lancamentos={lancamentos} onEditar={abrirEdicaoLancamento} />
      </div>
      <div id="sec-financas-meta">
        <CardFinancasMeta
          meta={metaDespesa}
          gasto={totais.expense}
          onEditar={abrirModalMeta}
          lancamentos={lancamentos}
          onEditarLancamento={abrirEdicaoLancamento}
        />
      </div>

      {modalAberto && (
        <ModalLancamento
          form={form}
          editando={editandoId !== null}
          onChange={setForm}
          onSalvar={salvarLancamento}
          onExcluir={excluirLancamento}
          onFechar={() => setModalAberto(false)}
        />
      )}

      {modalMetaAberto && (
        <ModalMeta
          valor={metaInput}
          onChange={v => setMetaInput(formatarBRL(v))}
          onSalvar={salvarMeta}
          onLimpar={limparMeta}
          temMeta={metaDespesa > 0}
          onFechar={() => setModalMetaAberto(false)}
        />
      )}
    </>
  );
}

PaginaFinancas = forwardRef(PaginaFinancas);

// ── App Principal ─────────────────────────────────────────────────────────────

export default function App() {
  const [dados, setDados]           = useState(null);
  const [loading, setLoading]       = useState(true);
  const [erro, setErro]             = useState(null);
  const [scrolled, setScrolled]     = useState(false);
  const [searchCmd, setSearchCmd] = useState(null);
  const [pagina, setPagina]         = useState("patrimonio");
  const [lancamentos, setLancamentos] = useState([]);
  const [metaDespesa, setMetaDespesa] = useState(0);
  const scrollRef = useRef(null);
  const financasRef = useRef(null);

  // Ao trocar de página, volta o scroll para o topo
  const irParaPagina = useCallback((p) => {
    setPagina(p);
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  // Carrega TODOS os dados do programa (patrimônio/investimentos + finanças) de uma vez só na inicialização
  useEffect(() => {
    async function load() {
      try {
        const [entries, financas] = await Promise.all([
          Promise.all(Object.entries(SHEET_GIDS).map(async ([k, gid]) => [k, await fetchSheet(gid)])),
          carregarLancamentos(),
        ]);
        setDados(Object.fromEntries(entries));
        setLancamentos(financas.transactions);
        setMetaDespesa(financas.metaDespesa);
      } catch (e) {
        setErro(String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Persiste alterações de finanças (não roda no carregamento inicial)
  useEffect(() => {
    if (loading) return;
    salvarLancamentos(lancamentos, metaDespesa);
  }, [lancamentos, metaDespesa, loading]);

  const handleScroll = useCallback(() => {
    const scrollTop = scrollRef.current?.scrollTop || 0;
    setScrolled(scrollTop > 10);
  }, []);

  const scrollToTop = () => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (loading) return (
    <>
      <Style />
      <Loading />
    </>
  );

  if (erro) return (
    <>
      <Style />
      <div className="loading-page">
        <div className="loading-box card">
          <div style={{ color: COR_BAIXA, fontSize: 18, textAlign: "center" }}>
            Erro ao Carregar Dados:<br /><small>{erro}</small>
          </div>
        </div>
      </div>
    </>
  );

  const { ativos, evolucao, totais, reservas, alocacao, proventos } = dados;

  return (
    <>
      <Style />
      <div className="root" ref={scrollRef} onScroll={handleScroll}>
        <Navbar
          scrolled={scrolled}
          ativos={ativos}
          onSelectTicker={(ticker) => {
            if (pagina !== "investimentos") irParaPagina("investimentos");
            setSearchCmd({ ticker, v: Date.now() });
          }}
          pagina={pagina}
          onNavigate={irParaPagina}
          onNovoLancamento={() => financasRef.current?.abrirNovoLancamento()}
        />
        <BotaoTopoFlutuante scrolled={scrolled} onTop={scrollToTop} />
        <main className="main">

          {pagina === "patrimonio" && (
            <>
              <div id="sec-patrimonio"><CardPatrimonio totais={totais} proventos={proventos} evolucao={evolucao} /></div>
              <div id="sec-reserva"><CardReserva reservas={reservas} alocacao={alocacao} totais={totais} /></div>
              <div id="sec-resumo-investimentos-patrimonio"><CardResumoInvestimentos totais={totais} /></div>
            </>
          )}

          {pagina === "investimentos" && (
            <>
              <div id="sec-resumo-investimentos"><CardResumoInvestimentos totais={totais} /></div>
              <div id="sec-alocacao"><CardAlocacao alocacao={alocacao} /></div>
              <div id="sec-aporte"><CardAporte ativos={ativos} alocacao={alocacao} /></div>
              <div id="sec-proventos"><CardProventos proventos={proventos} /></div>
              <div id="sec-heatmap"><CardHeatmap ativos={ativos} /></div>
              {CLASSES_ATIVOS.map(c => (
                <div id={`sec-${c.sufixo}`} key={c.classe}>
                  <CardClasse
                    titulo={c.titulo}
                    sufixo={c.sufixo}
                    classe={c.classe}
                    totais={totais}
                    ativos={ativos}
                    selectedTicker={searchCmd?.ticker}
                    searchVersion={searchCmd?.v}
                    scrollRef={scrollRef}
                  />
                </div>
              ))}
            </>
          )}

          {pagina === "financas" && (
            <PaginaFinancas
              ref={financasRef}
              lancamentos={lancamentos}
              setLancamentos={setLancamentos}
              metaDespesa={metaDespesa}
              setMetaDespesa={setMetaDespesa}
            />
          )}

          <footer className="app-footer">
            <span className="app-footer-linha">Meu programa de acompanhamento de patrimônio, investimentos e finanças</span>
            <span className="app-footer-linha">Por Jakson Franceschini</span>
          </footer>
        </main>
      </div>
    </>
  );
}

// ── Estilos ───────────────────────────────────────────────────────────────────

function Style() {
  return (
    <style>{`
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

      svg, svg *, .recharts-wrapper, .recharts-surface { outline: none !important; }
      svg:focus, svg *:focus { outline: none !important; }

      /* ── Tema ── */
      :root {
        --bg:             #0f1010;
        --bg2:            #141515;
        --bg3:            #1a1c1c;
        --bg4:            #242626;
        --border:         #1c1e1e;
        --border2:        #242626;
        --text:           #f5f5f7;
        --muted:          #909090;
        --accent:         #0a5550;
        --accent-h:       #0d6e68;
        --accent-p:       #13a097;
        --sub:            #c2eeeb;
        --color-title:    #f5f5f7;
        --color-subtitle: #9e9e9e;
        --color-label:    #8e8e93;
        --color-value:    #f5f5f7;
        --color-profit:   #0a5550;
        --color-loss:     #8a3535;
        --color-neutral:  #f5f5f7;
        --navbar-bg:      rgba(24, 28, 28, 0.4);
        --navbar-border:  rgba(255, 255, 255, 0.03);
        --spinner-track:  rgba(10, 85, 80, 0.2);

        --radius-card:    28px;

        /* Grade de espaçamento (múltiplos de 4px) — usar sempre estes tokens,
           nunca valores arbitrários, em margin/padding/gap de qualquer componente. */
        --space-1:  4px;
        --space-2:  8px;
        --space-3:  12px;
        --space-4:  16px;
        --space-5:  20px;
        --space-6:  24px;
        --space-7:  28px;
        --space-8:  32px;

        /* Escala de border-radius */
        --radius-sm:   10px;
        --radius-md:   14px;
        --radius-lg:   20px;
        --radius-pill: 99px;

        /* Barras de progresso/composição — trilho e altura padrão */
        --bar-track:  rgba(255, 255, 255, 0.05);
        --bar-altura: 10px;
      }

      html, body, #root {
        height: 100%;
        background: var(--bg);
        color: var(--text);
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        text-rendering: optimizeLegibility;
      }

      /* Container real de scroll da aplicação — sem isso, scrollRef.current.scrollTo()
         (busca e botões de seção) e o scrollTop usado pelo handleScroll não fazem nada,
         pois a rolagem cairia no documento (html/body) em vez deste elemento. */
      .root {
        height: 100vh;
        overflow-y: auto;
        overflow-x: hidden;
        position: relative;
        scrollbar-gutter: stable both-edges;
      }

      * {
        -webkit-tap-highlight-color: transparent;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif !important;
      }

      /* ── Navbar ── */
      .navbar {
        position: fixed;
        top: 6px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 100;
        width: calc(100% - 40px);
        max-width: 1160px;
        box-sizing: border-box;
        border-radius: 26px;
        padding: var(--space-5) var(--space-6);
        display: flex;
        flex-direction: column;
        background: var(--navbar-bg);
        border: 1px solid var(--navbar-border);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
        transition: all 0.5s ease;
      }
      .navbar-inner {
        display: grid;
        grid-template-columns: 1fr minmax(0, auto) 1fr;
        align-items: center;
        gap: var(--space-2);
        width: 100%;
      }
      .navbar-left { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
      .navbar-right { display: flex; align-items: center; gap: var(--space-2); justify-self: end; min-width: 0; position: relative; }

      /* ── Botão Tema ── */
      .btn-tema {
        background: var(--bg3);
        border: 1px solid var(--border2);
        border-radius: 10px;
        width: 38px;
        height: 38px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 17px;
        cursor: pointer;
        flex-shrink: 0;
        transition: background 0.2s ease, box-shadow 0.2s ease;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      }
      .btn-tema:hover {
        background: var(--bg4);
        box-shadow: 0 4px 16px rgba(10,85,80,0.25);
      }
      .btn-tema:active { }

      /* ── Busca inline desktop ── */
      .navbar-search-inline {
        width: 240px;
        min-width: 240px;
        max-width: 240px;
        display: flex;
        align-items: center;
        gap: var(--space-2);
        background: var(--bg3);
        border: 1px solid var(--border2);
        border-radius: 14px;
        padding: 10px var(--space-3);
        transition: border-color 0.15s, box-shadow 0.15s;
      }
      .navbar-search-inline:focus-within {
        border-color: #0a5550;
        box-shadow: 0 0 0 2px rgba(10,85,80,0.15);
      }
      .navbar-search-icon { display: flex; align-items: center; opacity: 0.5; flex-shrink: 0; color: var(--color-value); }
      .navbar-search-inline-input {
        background: transparent;
        border: none;
        outline: none;
        color: var(--color-value);
        font-size: 13px;
        font-family: inherit;
        width: 160px;
        transition: width 0.2s ease;
      }
      .navbar-search-inline-input:focus { width: 200px; }
      .navbar-search-inline-input::placeholder { color: var(--color-label); }

      /* ── Busca dropdown ── */
      .navbar-search-box {
        position: absolute;
        top: calc(100% + 10px);
        right: 0;

        width: min(320px, calc(100vw - 24px));
        max-width: calc(100vw - 24px);

        background: var(--bg2);
        border: 1px solid var(--border2);
        border-radius: 14px;
        overflow: hidden;
        box-shadow: 0 8px 32px rgba(0,0,0,0.3);
        z-index: 200;
      }
      .navbar-search-box-desktop {
        left: 0;
        right: auto;
        width: 240px;
        min-width: 240px;
        max-width: 240px;
      }
      .navbar-search-input {
        width: 100%;
        background: transparent;
        border: none;
        color: var(--color-value);
        font-size: 14px;
        padding: var(--space-3) var(--space-4);
        outline: none;
        font-family: inherit;
      }
      .navbar-search-input::placeholder { color: var(--color-label); }
      .navbar-search-box-desktop {
        right: auto;
        left: 0;
        width: 100%;
        min-width: 240px;
      }
      .navbar-search-results {
        display: flex;
        flex-direction: column;
        max-height: 240px;
        overflow-y: auto;
        border-top: none !important;
      }
      .navbar-search-results::before,
      .navbar-search-results::after {
        display: none !important;
      }
      .navbar-search-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        background: transparent;
        border: none;
        cursor: pointer;
        transition: background 0.15s;
        font-family: inherit;
        text-align: left;
      }
      .navbar-search-item:hover { background: var(--bg3); }
      .btn-tema svg,
      .navbar-search-icon {
        color: #ffffff;
      }

      .navbar-logo {
        width: 36px; height: 36px;
        background: var(--accent);
        border-radius: 10px;
        display: flex; align-items: center; justify-content: center;
        font-weight: 800; font-size: 18px; color: #f5f5f7; flex-shrink: 0;
      }
      .navbar-titulo { font-size: 26px; font-weight: 700; color: var(--text); white-space: nowrap; }

      /* ── Navbar Tabs (navegação entre páginas) ── */
      .navbar-nav { display: flex; align-items: center; min-width: 0; }
      .navbar-tabs {
        display: flex;
        align-items: center;
        gap: 2px;
        min-width: 0;
        background: var(--bg3);
        border: 1px solid var(--border2);
        border-radius: var(--radius-pill);
        padding: 4px;
        overflow-x: auto;
        scrollbar-width: none;
      }
      .navbar-tabs::-webkit-scrollbar { display: none; }
      .navbar-tab {
        background: transparent;
        border: none;
        color: var(--color-label);
        font-size: 14px;
        font-weight: 600;
        font-family: inherit;
        white-space: nowrap;
        cursor: pointer;
        padding: 9px 18px;
        border-radius: var(--radius-pill);
        transition: color 0.2s ease, background 0.2s ease;
      }
      .navbar-tab:hover { color: var(--color-value); }
      .navbar-tab-ativo {
        background: var(--accent);
        color: #f5f5f7;
      }
      .navbar-tab-ativo:hover { color: #f5f5f7; }

      /* Menu hambúrguer (substitui as abas em telas pequenas) */
      .navbar-hamburger-wrap { display: none; }

      /* Overlay em tela cheia do menu hambúrguer (mobile), com efeito glass */
      .navbar-menu-overlay {
        position: fixed;
        inset: 0;
        z-index: 500;
        background: rgba(10, 14, 14, 0.55);
        backdrop-filter: blur(28px);
        -webkit-backdrop-filter: blur(28px);
        display: flex;
        flex-direction: column;
        padding: var(--space-5) var(--space-5) var(--space-6);
        box-sizing: border-box;
        overflow-y: auto;
        animation: navbarMenuFade 0.2s ease;
      }
      @keyframes navbarMenuFade {
        from { opacity: 0; }
        to   { opacity: 1; }
      }
      .navbar-menu-overlay-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3);
      }
      .navbar-menu-overlay-list {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
        margin-top: var(--space-7);
      }
      .navbar-menu-overlay-item {
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid var(--border2);
        color: var(--color-label);
        font-family: inherit;
        font-size: 19px;
        font-weight: 600;
        text-align: center;
        padding: var(--space-4) var(--space-5);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
      }
      .navbar-menu-overlay-item:hover {
        background: rgba(255, 255, 255, 0.07);
        color: var(--color-value);
      }
      .navbar-menu-overlay-item.is-ativo {
        background: var(--accent);
        border-color: transparent;
        color: #f5f5f7;
      }

      @media (max-width: 1024px) {
        .navbar-tab { padding: 8px 14px; font-size: 13px; }
      }
      @media (max-width: 640px) {
        .navbar-tabs { display: none; }
        .navbar-hamburger-wrap { display: block; }
      }

      /* ── Botão Flutuante Voltar ao Topo ── */
      .btn-topo-flutuante {
        position: fixed;
        bottom: 30px;
        right: 30px;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: #0a5550;
        color: #f5f5f7;
        border: 1px solid rgba(5, 120, 112, 0.3);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        opacity: 0;
        pointer-events: none;
        z-index: 99;
      }
      .btn-topo-flutuante-visible {
        opacity: 1;
        pointer-events: auto;
      }
      .btn-topo-flutuante:hover {
        background: #0d6e68;
        box-shadow: 0 6px 24px rgba(20, 168, 159, 0.55), inset 0 1px 0 rgba(255,255,255,0.2);
        transform: translateY(-2px);
      }
      .btn-topo-flutuante:active {
        transform: scale(0.96);
        box-shadow: 0 2px 8px rgba(20, 168, 159, 0.3);
      }

      .btn-topo {
        background: rgba(255,255,255,0.07);
        color: var(--text);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 10px;
        padding: 13px var(--space-4);
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        backdrop-filter: blur(10px);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.08);
        transition: background 0.2s ease, box-shadow 0.2s ease, transform 0.2s cubic-bezier(0.34,1.56,0.64,1);
      }
      .btn-topo:hover {
        background: rgba(255,255,255,0.12);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.12), 0 4px 12px rgba(0,0,0,0.2);
        transform: translateY(-1px);
      }
      .btn-topo:active {
        transform: scale(0.96);
        background: rgba(255,255,255,0.06);
      }

      /* ── Main ── */
      .main {
        max-width: 1200px;
        margin: 0 auto;
        padding: 120px var(--space-5) 20px;
        display: flex;
        flex-direction: column;
        gap: var(--space-8);
      }

      /* ── Footer ── */
      .app-footer {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        text-align: center;
        padding: var(--space-4) 0 0;
        color: var(--color-label);
      }
      .app-footer-linha { font-size: 13px; }
      .app-footer-linha:first-child { opacity: 0.8; }
      .app-footer-linha:last-child { opacity: 0.55; font-size: 12px; }

      /* ── Card ──
         padding/gap usam !important de propósito: nenhum componente deve poder
         sobrescrever o espaçamento do sistema de design passando style inline. */
      .card {
        background: var(--bg2);
        border-radius: var(--radius-card);
        border: 1px solid var(--border);
        padding: var(--space-5) !important;
        display: flex;
        flex-direction: column;
        gap: var(--space-4) !important;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        backface-visibility: hidden;
        perspective: 1000px;
        transform: translate3d(0,0,0);
        will-change: transform;
        transition: background 0.3s ease, border-color 0.3s ease;
      }
      .card-titulo {
        font-size: 20px;
        font-weight: 500;
        color: var(--color-title);
        display: flex;
        align-items: center;
        gap: var(--space-2);
      }
      .card-titulo-icone {
        flex-shrink: 0;
        color: var(--accent, currentColor);
        opacity: 0.9;
        margin-left: -3px;
      }
      .card-header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; }

      /* ── SubCard ── */
      .subcard {
        background: var(--bg3);
        border-radius: var(--radius-card);
        border: 1px solid var(--border2);
        padding: var(--space-5) !important;
        display: flex;
        flex-direction: column;
        gap: var(--space-1) !important;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
        transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease, background 0.3s ease;
        position: relative;
        overflow: hidden;
      }
      .subcard-titulo {
        padding: var(--space-2) var(--space-4) !important;
        border-radius: var(--radius-card) !important;
      }

      /* ── Campo ── */
      .campo { display: flex; flex-direction: column; gap: var(--space-1); }
      .campo-titulo {
        font-size: 14px;
        font-weight: 500;
        color: var(--color-label);
        text-rendering: optimizeLegibility;
        -webkit-font-smoothing: antialiased;
      }
      .campo-valor {
        font-size: 31px;
        font-weight: 400;
        line-height: 1.05;
        color: var(--color-value);
        text-rendering: optimizeLegibility;
        -webkit-font-smoothing: antialiased;
        font-variant-numeric: tabular-nums;
      }

      /* ── Divisor ── */
      .divisor { margin-top: 15px; height: 1px; background: var(--border2); border: none; }

      /* ── Hero Valor (bloco título + valor grande em destaque, usado em vários cards) ── */
      .hero-valor { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
      .hero-valor-titulo { font-size: 14px; letter-spacing: 0.05em; }
      .hero-valor-valor { line-height: 1; }

      /* ── Barra de progresso/composição (design único para todas as barras do app) ── */
      .barra-track {
        position: relative;
        height: var(--bar-altura);
        border-radius: var(--radius-pill);
        overflow: hidden;
        background: var(--bar-track);
      }
      .barra-fill {
        position: absolute;
        top: 0;
        height: 100%;
        transition: width 1.1s cubic-bezier(0.4,0,0.2,1);
      }
      .barra-fill.full  { left: 0; width: 100%; border-radius: var(--radius-pill); }
      .barra-fill.left  { left: 0;  border-radius: var(--radius-pill) 0 0 var(--radius-pill); transition-delay: 0.1s; }
      .barra-fill.right { right: 0; border-radius: 0 var(--radius-pill) var(--radius-pill) 0; }
      .barra-marcador {
        position: absolute;
        top: -2px; bottom: -2px;
        width: 2.5px;
        border-radius: 2px;
        background: rgba(255,255,255,0.5);
        transform: translateX(-50%);
      }

      /* ── Tile (card pequeno de legenda/estatística, único padrão para todos os "mini cards") ──
         Segue a mesma hierarquia de camadas do resto do app (bg2 → bg3 → bg4), já que o Tile
         vive dentro de um SubCard (bg3) — por isso usa --bg4/--border2 em vez de overlays
         translúcidos avulsos, igual ao padrão já usado em .navbar-search-inline. */
      .tile {
        background: var(--bg4);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: var(--radius-lg);
        padding: var(--space-4);
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
        cursor: default;
        transition: filter 0.18s ease, transform 0.18s cubic-bezier(0.34,1.56,0.64,1), border-color 0.18s ease;
      }
      .tile.is-hover { filter: brightness(1.15); transform: scale(1.02); }
      .tile-header { display: flex; align-items: center; gap: var(--space-2); }
      .tile-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
      .tile-titulo {
        font-size: 11px;
        font-weight: 500;
        color: var(--color-label);
        letter-spacing: 0.03em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .tile-valor {
        font-size: 20px;
        font-weight: 600;
        color: var(--color-value);
        line-height: 1.05;
        font-variant-numeric: tabular-nums;
      }
      .tile-mini-label { font-size: 11px; color: var(--color-label); font-weight: 500; }
      .tile-diff { font-size: 11px; font-weight: 500; line-height: 1; font-variant-numeric: tabular-nums; }

      .tiles-grid {
        display: grid;
        grid-template-columns: repeat(6, 1fr);
        gap: 12px;
        width: 100%;
        margin-top: 12px;
      }
      @media (max-width: 640px) {
        .tiles-grid { grid-template-columns: repeat(2, 1fr); gap: var(--space-3); }
        .tile-titulo { font-size: 10px; }
        .tile-valor  { font-size: 15px; }
      }
      .tile-clicavel { cursor: pointer; }
      .tile-clicavel:active { transform: scale(0.98); }

      /* ── Dropdown (menu suspenso — filtros mobile e qualquer outro dropdown do app) ── */
      .dropdown-wrap { position: relative; }
      .dropdown-trigger {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        color: var(--text);
      }
      .dropdown-trigger-sub { font-size: 14px; opacity: 0.8; color: var(--text); }
      .dropdown-menu {
        position: absolute;
        top: calc(100% + var(--space-2));
        left: 0;
        z-index: 50;
        background: var(--bg3);
        border: 1px solid var(--border2);
        border-radius: var(--radius-md);
        padding: var(--space-2);
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
        min-width: 130px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      }
      .dropdown-item {
        background: transparent;
        color: var(--text);
        border: 1px solid transparent;
        border-radius: var(--radius-sm);
        padding: var(--space-3) var(--space-3);
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        text-align: left;
        display: flex;
        align-items: center;
        justify-content: space-between;
        transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
        font-family: inherit;
      }
      .dropdown-item:hover { background: var(--bg4); }
      .dropdown-item:focus-visible {
        outline: 2px solid var(--accent-p);
        outline-offset: 1px;
      }
      .dropdown-item.is-ativo {
        background: var(--accent);
        color: var(--text);
        border-color: rgba(5, 120, 112, 0.4);
        font-weight: 600;
      }

      /* Variante flutuante (renderizada via portal em document.body), usada
         para dropdowns dentro de cards com overflow:hidden — assim o menu
         nunca fica cortado pelo card e sempre fica por cima de tudo. */
      .dropdown-menu-flutuante {
        position: fixed !important;
        z-index: 9999;
      }

      /* ── Cabeçalho de Ativo (ticker + nome — padrão único, usado em
         qualquer lugar que mostre um ativo: card individual, resumo de
         aporte, etc.) ── */
      .ativo-nome-ticker {
        font-size: 20px;
        font-weight: 500;
        color: var(--color-value);
        letter-spacing: 0.05em;
        line-height: 1.1;
      }
      .ativo-nome-texto {
        font-size: 13px;
        color: var(--color-label);
        margin-top: var(--space-1);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      @media (max-width: 640px) {
        .ativo-nome-ticker { font-size: 17px; }
        .ativo-nome-texto  { font-size: 12px; }
      }

      .list-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3);
        --row-pad-x: var(--space-5);
        padding: var(--space-4) var(--row-pad-x);
        position: relative;
        transition: background 0.15s ease;
      }
      .list-row:not(:last-child)::after {
        content: "";
        position: absolute;
        left: var(--row-pad-x);
        right: var(--row-pad-x);
        bottom: 0;
        height: 1px;
        background: var(--border2);
        transition: opacity 0.15s ease;
      }
      .list-row-clickable {
        cursor: pointer;
        margin: 0 -10px;
        padding-left: calc(var(--row-pad-x) + 10px);
        padding-right: calc(var(--row-pad-x) + 10px);
        border-radius: var(--radius-md);
        border: 1px solid transparent;
        transition: background 0.15s ease, border-color 0.15s ease;
      }
      .list-row-clickable:hover {
        background: rgba(255,255,255,0.045);
        border-color: rgba(255,255,255,0.08);
      }
      .list-row-clickable:hover::after { opacity: 0; }
      .list-row-left { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
      .list-row-label {
        font-size: 15px;
        font-weight: 500;
        color: var(--color-value);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .list-row-tag {
        font-size: 10px;
        font-weight: 500;
        color: var(--color-label);
        letter-spacing: 0.03em;
      }
      .list-row-right { display: flex; align-items: center; gap: var(--space-2); flex-shrink: 0; }
      .list-row-values { display: flex; flex-direction: column; align-items: flex-end; gap: var(--space-1); }
      .list-row-value {
        font-size: 15px;
        font-weight: 600;
        color: var(--color-value);
        text-align: right;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      .list-row-sub {
        font-size: 11px;
        font-weight: 500;
        color: var(--color-label);
        text-align: right;
        white-space: nowrap;
      }
      .list-row-plain {
        --row-pad-x: 0px;
      }
      /* Destaque do campo pelo qual a lista está sendo filtrada
         (ex.: filtrar por "Total Atual" marca essa linha em todos os ativos) */
      .list-row-filtrado {
        margin: 0 -10px;
        padding-left: 10px;
        padding-right: 10px;
        border-radius: var(--radius-md);
        background: rgba(19, 160, 151, 0.08);
        box-shadow: inset 0 0 0 1px rgba(19, 160, 151, 0.5);
      }
      .list-row-filtrado::after {
        display: none !important;
      }
      .ativo-cabecalho-filtrado {
        position: relative;
        margin: -10px;
        padding: 10px;
        border-radius: var(--radius-md);
        background: rgba(19, 160, 151, 0.08);
        box-shadow: inset 0 0 0 1px rgba(19, 160, 151, 0.5);
      }
      .list-row-chevron {
        color: var(--color-label);
        opacity: 0.55;
        flex-shrink: 0;
      }
      @media (max-width: 640px) {
        /* --row-pad-x controla o padding E o traço divisório juntos —
           nunca mais dessincronizados entre si. */
        .list-row { gap: var(--space-2); --row-pad-x: var(--space-4); }
        .list-row-plain { --row-pad-x: 0px; }
        .list-row-label { font-size: 13px; }
        .list-row-value { font-size: 13px; }
        .list-row-sub { font-size: 10px; }
      }

      /* ── Botões ── */
      .btn-ver,
      .btn-filtro-simples {
        background: transparent;
        color: #ffffff;
        border: none;
        padding: var(--space-1) 6px;
        font-size: 14px;
        cursor: pointer;
        font-weight: 600;
        white-space: nowrap;
        display: inline-flex;
        align-items: center;
        position: relative;
        border-radius: 6px;
        transition: color 0.2s ease;
        gap: var(--space-2);
        -webkit-tap-highlight-color: transparent;
      }
      .btn-ver {
        text-align: right;
        justify-content: flex-end;
        margin-right: -6px;
        margin-left: auto;
      }
      .btn-filtro-simples {
        text-align: center;
        justify-content: center;
        min-width: auto;
        width: auto;
      }
      .btn-texto {
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }
      .click-glow {
        animation: glowPulseTexto 0.55s ease-out;
      }
      @keyframes glowPulseTexto {
        0% {
          text-shadow: 0 0 0 rgba(10, 85, 80, 0);
          filter: brightness(1);
        }
        40% {
          text-shadow: 0 0 10px rgba(10, 85, 80, 0.85);
          filter: brightness(1.3);
        }
        100% {
          text-shadow: 0 0 0 rgba(10, 85, 80, 0);
          filter: brightness(1);
        }
      }
      .btn-ver-icon {
        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        transform: rotate(0deg);
      }
      .btn-ver-icon.is-open {
        transform: rotate(180deg);
      }
      .btn-ver:hover,
      .btn-filtro-simples:hover {
        color: #0a5550;
      }
      .btn-ver:active,
      .btn-filtro-simples:active {
        color: #0a5550;
      }
      .btn-filtro-simples-ativo {
        color: #0a5550;
      }

      @media (max-width: 640px) {
        .navbar-search-box {
          position: fixed !important;
          top: 90px;
          left: 50%;
          transform: translateX(-50%);
          width: calc(100vw - 24px);
          max-width: none;
          margin: 0;
          box-sizing: border-box;
          z-index: 9999;
          border-color: #0a5550;
        }
        .navbar-search-input {
          width: 100%;
          box-sizing: border-box;
        }
        .btn-ver { padding: var(--space-1) 6px; margin-right: -6px; min-width: auto; width: auto; }
      }
      .filtros-row {
        display: flex;
        gap: var(--space-4);
        flex-wrap: wrap;
        padding-top: var(--space-1);
      }

      /* ── Ativos Lista ── */
      .ativos-lista { display: flex; flex-direction: column; gap: var(--space-4); }

      /* ── Heatmap ── */
      .heatmap-grid {
        display: grid;
        grid-template-columns: repeat(6, 1fr);
        gap: var(--space-3);
      }
      @media (max-width: 1024px) { .heatmap-grid { grid-template-columns: repeat(4, 1fr); } }
      @media (max-width: 640px)  { .heatmap-grid { grid-template-columns: repeat(3, 1fr); } }
      @media (max-width: 380px)  { .heatmap-grid { grid-template-columns: repeat(2, 1fr); } }

      .heatmap-cell {
        border-radius: 20px;
        padding: var(--space-3) var(--space-2);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--space-2);
        cursor: default;
        transition: filter 0.2s ease, transform 0.2s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.2s ease;
        min-height: 90px;
      }
      .heatmap-cell:hover { filter: brightness(1.15); transform: scale(1.03); }
      .hm-ticker { color: #f5f5f7; font-size: 14px; font-weight: 700; }
      .hm-pct    { color: #f5f5f7; font-size: 12px; font-weight: 600; }
      .hm-brl    { color: rgba(255,255,255,0.8); font-size: 14px; }

      @media (min-width: 1024px) {
        .hm-pct {font-size: 14px !important;}
        .hm-brl {font-size: 16px !important;}
      }

      /* ── Barras do Gráfico de Proventos ── */
      .barra-proventos { border-radius: 10px 10px 4px 4px; }
      .barra-proventos-glow { border-radius: 10px 10px 0 0; }

      @media (min-width: 1024px) {
        .barra-proventos { border-radius: 14px 14px 5px 5px; }
        .barra-proventos-glow { border-radius: 14px 14px 0 0; }
      }

      @media (min-width: 1440px) {
        .barra-proventos { border-radius: 18px 18px 6px 6px; }
        .barra-proventos-glow { border-radius: 18px 18px 0 0; }
      }

      /* ── Tooltip do Gráfico ── */
      .chart-tooltip {
        background: var(--bg3);
        border: 1px solid var(--border2);
        border-radius: 12px;
        padding: 10px 14px;
        font-size: 13px;
      }
      .tooltip-label { color: var(--muted); margin-bottom: var(--space-1); }
      .tooltip-val   { font-size: 16px; font-weight: 700; }
      .tooltip-sub   { font-size: 13px; margin-top: 2px; }

      /* ── Finanças — Botão Flutuante Adicionar ── */
      .fab-adicionar {
        position: fixed;
        bottom: 30px;
        left: 30px;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: #0a5550;
        border: 1px solid rgba(5, 120, 112, 0.3);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 99;
        box-shadow: 0 6px 20px rgba(0,0,0,0.35);
        transition: background 0.2s ease, box-shadow 0.2s ease, transform 0.2s cubic-bezier(0.34,1.56,0.64,1);
      }
      .fab-adicionar:hover {
        background: #0d6e68;
        box-shadow: 0 6px 24px rgba(20, 168, 159, 0.55), inset 0 1px 0 rgba(255,255,255,0.2);
        transform: translateY(-2px);
      }
      .fab-adicionar:active { transform: scale(0.96); }
      @media (max-width: 640px) {
        .fab-adicionar { bottom: 18px; left: 14px; width: 50px; height: 50px; }
      }

      /* ── Finanças — Modal (adicionar/editar lançamento, definir meta) ── */
      .modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.55);
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
        display: flex;
        align-items: flex-end;
        justify-content: center;
        z-index: 1000;
        animation: modalFadeIn 0.2s ease;
      }
      @media (min-width: 640px) {
        .modal-overlay { align-items: center; }
      }
      @keyframes modalFadeIn { from { opacity: 0; } to { opacity: 1; } }
      .modal-sheet {
        width: 100%;
        max-width: 420px;
        background: var(--bg2);
        border: 1px solid var(--border2);
        border-radius: var(--radius-card) var(--radius-card) 0 0;
        padding: var(--space-6);
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
        box-shadow: 0 -10px 40px rgba(0,0,0,0.4);
        animation: modalSlideUp 0.28s cubic-bezier(0.22,1,0.36,1);
      }
      @media (min-width: 640px) {
        .modal-sheet { border-radius: var(--radius-card); }
      }
      @keyframes modalSlideUp { from { transform: translateY(24px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      .modal-header { display: flex; align-items: center; justify-content: space-between; }
      .modal-titulo { font-size: 18px; font-weight: 600; color: var(--color-title); }
      .modal-fechar {
        background: var(--bg4);
        border: 1px solid var(--border2);
        color: var(--color-label);
        width: 30px; height: 30px;
        border-radius: 50%;
        cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        font-size: 13px;
      }
      .modal-fechar:hover { color: var(--color-value); background: var(--bg3); }

      .tipo-toggle { display: flex; gap: var(--space-2); }
      .tipo-opcao {
        flex: 1;
        background: var(--bg3);
        border: 1px solid var(--border2);
        color: var(--color-label);
        font-weight: 600;
        font-size: 14px;
        font-family: inherit;
        padding: var(--space-3);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
      }
      .tipo-opcao-ativa.income { background: rgba(10,85,80,0.2); border-color: #0a5550; color: #f5f5f7; }
      .tipo-opcao-ativa.expense { background: rgba(138,53,53,0.2); border-color: #8a3535; color: #f5f5f7; }

      .form-grupo { display: flex; flex-direction: column; gap: var(--space-2); }
      .form-input {
        background: var(--bg3);
        border: 1px solid var(--border2);
        border-radius: var(--radius-md);
        padding: var(--space-3) var(--space-4);
        font-size: 15px;
        color: var(--color-value);
        font-family: inherit;
        outline: none;
        transition: border-color 0.15s, box-shadow 0.15s;
      }
      .form-input:focus { border-color: #0a5550; box-shadow: 0 0 0 2px rgba(10,85,80,0.15); }
      .form-input::placeholder { color: var(--color-label); }

      .form-botao {
        background: var(--accent);
        color: #f5f5f7;
        border: none;
        border-radius: var(--radius-md);
        padding: var(--space-4);
        font-size: 15px;
        font-weight: 600;
        font-family: inherit;
        cursor: pointer;
        transition: background 0.2s ease, transform 0.15s ease;
      }
      .form-botao:hover { background: var(--accent-h); }
      .form-botao:active { transform: scale(0.98); }
      .form-botao-perigo { background: transparent; border: 1px solid rgba(138,53,53,0.4); color: #c0504a; }
      .form-botao-perigo:hover { background: rgba(138,53,53,0.12); }
      .form-botao-secundario { background: transparent; border: 1px solid var(--border2); color: var(--color-label); }
      .form-botao-secundario:hover { background: var(--bg3); color: var(--color-value); }

      /* ── Loading ── */
      .loading-page {
        height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--bg);
      }
      .loading-box {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 36px;
        width: 300px;
      }
      .loading-box.card {
        background: var(--bg2);
        border: 1px solid var(--border2);
        border-radius: 24px;
        padding: var(--space-8);
      }
      .loading-logo {
        width: 72px; height: 72px;
        background: var(--accent);
        border-radius: 20px;
        display: flex; align-items: center; justify-content: center;
        font-size: 38px; font-weight: 900; color: var(--color-title);
      }
      .loading-logo-breathe {
        animation: logoBreathe 2.6s ease-in-out infinite;
      }
      @keyframes logoBreathe {
        0%, 100% { transform: scale(1);    filter: brightness(1)    drop-shadow(0 0 0px rgba(10,85,80,0)); }
        50%      { transform: scale(1.07); filter: brightness(1.08) drop-shadow(0 0 16px rgba(10,85,80,0.5)); }
      }
      .loading-texto { font-size: 16px; color: var(--color-subtitle); }

      /* ── Spinner ── */
      .spinner-wrap { display: flex; justify-content: center; }
      .spinner {
        width: 34px; height: 34px;
        border: 3px solid var(--spinner-track);
        border-top-color: #0a5550;
        border-radius: 50%;
        animation: spin 0.8s linear infinite, spinnerGlow 1.6s ease-in-out infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes spinnerGlow {
        0%, 100% { box-shadow: 0 0 0px rgba(10,85,80,0); }
        50%       { box-shadow: 0 0 18px 6px rgba(10,85,80,0.55); }
      }

      /* ── Scrollbar ── */
      .root::-webkit-scrollbar { width: 6px; }
      .root::-webkit-scrollbar-track { background: transparent; }
      .root::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 3px; }

      /* ── Responsivo ── */

      /* lg — Landscape tablets e laptops pequenos (≤ 1024px) */
      @media (max-width: 1024px) {
        :root { --radius-card: 24px; }
        .main { padding: 106px 18px 52px; gap: 22px; }
        .navbar { width: calc(100% - 36px); max-width: none; }
        .card { padding: var(--space-5) !important; gap: 14px; }
        .subcard { padding: 18px !important; gap: var(--space-3); }
        .card-titulo { font-size: 18px; }
        .campo-valor { font-size: 28px; }
        .campo-titulo { font-size: 13px; }
      }

      /* sm — Smartphones grandes e tablets pequenos (≤ 640px) */
      @media (max-width: 640px) {
        :root { --radius-card: 22px; }
        .main { padding: 96px var(--space-3) 40px; gap: var(--space-4); }

        /* Navbar */
        .navbar {
          transform: translateX(-50%);
          width: calc(100% - 24px);
          padding: 18px 14px;
          box-sizing: border-box;
          border-radius: 16px;
        }
        .navbar-titulo { font-size: 17px; }

        /* Botão topo */
        .btn-topo-flutuante { bottom: 18px; right: 14px; width: 50px; height: 50px; }
        .btn-topo { font-size: 12px; padding: 5px 10px; }

        /* Cards */
        .card        { padding: 18px !important; gap: var(--space-3); }
        .card-titulo { font-size: 16px; }
        .card-header { gap: var(--space-2); }

        /* SubCard */
        .subcard { padding: var(--space-4) !important; gap: 10px; }
        .subcard-titulo { padding: var(--space-2) var(--space-3) !important; }

        /* Campos */
        .campo       { gap: var(--space-1); }
        .campo-valor { font-size: 22px; }
        .campo-titulo { font-size: 12px; }

        /* Botões */
        .btn-ver    { font-size: 14px; padding: var(--space-1) 6px; margin-right: -6px; min-width: auto; width: auto; }
        .btn-filtro-simples { font-size: 13px; }
        .filtros-row { gap: var(--space-3); }

        /* Ativos individuais */
        .logo-ativo-principal { width: 52px !important; height: 52px !important; }
        .chart-tooltip { padding: var(--space-2) 10px; font-size: 11px; }
        .tooltip-val   { font-size: 13px; }
        .tooltip-sub   { font-size: 11px; }

        /* Heatmap */
        .heatmap-cell { min-height: 66px; padding: var(--space-2) var(--space-1); border-radius: 20px; }
        .hm-ticker { font-size: 12px; }
        .hm-pct    { font-size: 11px; }
        .hm-brl    { font-size: 14px; }
      }

      /* Mobile pequeno (≤ 400px) */
      @media (max-width: 400px) {
        :root { --radius-card: 20px; }
        .main { padding: 105px 10px 34px; gap: var(--space-4); }
        .card        { padding: var(--space-4) !important; gap: var(--space-4); }
        .subcard     { padding: 14px !important; gap: var(--space-2); }
        .subcard-titulo { padding: var(--space-1) var(--space-3) !important; }
        .campo-valor  { font-size: 19px; }
        .campo-titulo { font-size: 11px; }
        .campo        { gap: var(--space-1); }
        .card-titulo  { font-size: 15px; }
        .btn-ver      { font-size: 14px; padding: var(--space-1) 6px; margin-right: -6px; min-width: auto; width: auto; }
        .btn-filtro-simples { font-size: 12px; }
        .heatmap-cell { min-height: 58px; padding: 6px 3px; }
        .logo-ativo-principal { width: 46px !important; height: 46px !important; }
        .chart-tooltip { padding: 6px var(--space-2); font-size: 10px; }
        .tooltip-val   { font-size: 12px; }
        .tooltip-sub   { font-size: 10px; }
      }

      /* Mobile muito pequeno (≤ 340px) */
      @media (max-width: 340px) {
        .main    { padding: 78px var(--space-2) var(--space-7); gap: 10px; }
        .card    { padding: 14px !important; gap: var(--space-2); }
        .subcard { padding: var(--space-3) !important; gap: 6px; }
        .subcard-titulo { padding: var(--space-1) var(--space-2) !important; }
        .campo-valor  { font-size: 17px; }
        .card-titulo  { font-size: 14px; }
      }
    `}</style>
  );
}