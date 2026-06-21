import { useState, useEffect, useRef, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, AreaChart, Area,
} from "recharts";

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
const BARRA_ALTURA = 10;

// ── Hook: contagem animada ────────────────────────────────────────────────────

function AnimatedValue({ rawValue, formatter, cor, titulo }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (rawValue === 0) return;
    setVisible(false);
    const t = setTimeout(() => setVisible(true), 60);
    return () => clearTimeout(t);
  }, [rawValue]);

  return (
    <div className="campo">
      <span className="campo-titulo">{titulo}</span>
      <span
        className="campo-valor animated-value"
        style={{
          ...(cor ? { color: cor } : {}),
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(10px)",
          transition: "opacity 0.55s cubic-bezier(0.22,1,0.36,1), transform 0.55s cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        {formatter(rawValue)}
      </span>
    </div>
  );
}

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

const cardIndexCounter = { value: 0 };
const cardsAnimated = { done: false };

function Card({ children, className = "", style = {} }) {
  const ref    = useRef(null);
  const idxRef = useRef(null);

  if (idxRef.current === null) {
    idxRef.current = cardIndexCounter.value++;
  }

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (cardsAnimated.done) {
      el.classList.add("card-visible");
      return;
    }

    const delay = Math.min(idxRef.current * 90, 600);
    const timer = setTimeout(() => {
      el.classList.add("card-visible");
      cardsAnimated.done = true;
    }, delay + 600);

    return () => clearTimeout(timer);
  }, []);

  return (
    <div ref={ref} className={`card card-enter ${className}`} style={style}>
      {children}
    </div>
  );
}

// ── Outros Componentes Menores ────────────────────────────────────────────────

function SubCard({ children, className = "", style = {}, id }) {
  return (
    <div id={id} className={`subcard ${className}`} style={style}>
      {children}
    </div>
  );
}

function Campo({ titulo, valor, cor }) {
  return (
    <div className="campo">
      <span className="campo-titulo">{titulo}</span>
      <span className="campo-valor" style={cor ? { color: cor } : {}}>{valor}</span>
    </div>
  );
}

function BotaoFiltro({ children, onClick, ativo }) {
  return (
    <button
      className={`btn-filtro${ativo ? " btn-filtro-ativo" : ""}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function BotaoVer({ children, onClick, altText }) {
  return (
    <button className="btn-ver" onClick={onClick} style={{ position: "relative" }}>
      <span style={{ visibility: "hidden", display: "block", height: 0, overflow: "hidden", whiteSpace: "nowrap" }}>
        {altText || children}
      </span>
      <span style={{ position: "absolute", left: 0, right: 0, textAlign: "center" }}>
        {children}
      </span>
    </button>
  );
}

function Expandable({ open, children }) {
  const wrapRef = useRef(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    if (open) {
      el.style.height = "0px";
      el.style.opacity = "0";
      void el.offsetHeight;
      const target = el.scrollHeight;
      el.style.transition = "height 0.42s cubic-bezier(0.4,0,0.2,1), opacity 0.32s cubic-bezier(0.4,0,0.2,1) 0.06s";
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
      el.style.transition = "height 0.38s cubic-bezier(0.4,0,0.2,1), opacity 0.22s cubic-bezier(0.4,0,0.2,1)";
      el.style.height = "0px";
      el.style.opacity = "0";
    }
  }, [open]);

  return (
    <div
      ref={wrapRef}
      style={{
        height: 0,
        overflow: "hidden",
        opacity: 0,
        willChange: "height, opacity",
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

function LogoAtivo({ ticker, size = 72 }) {
  const [err, setErr] = useState(false);
  const src = `/img_ativos/${String(ticker).toUpperCase()}.png`;
  if (err) {
    return (
      <div style={{
        width: size, height: size, background: "var(--accent)",
        borderRadius: 14, display: "flex", alignItems: "center",
        justifyContent: "center", fontSize: size * 0.42,
        fontWeight: 500, color: "var(--color-title)", flexShrink: 0,
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif'
      }}>
        {String(ticker)[0]}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={ticker}
      width={size} height={size}
      onError={() => setErr(true)}
      style={{ borderRadius: 12, objectFit: "contain", flexShrink: 0 }}
    />
  );
}

function Navbar({ scrolled, ativos, scrollRef, onSelectTicker }) {
  const [logoErr, setLogoErr]       = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery]           = useState("");
  const [isMobile, setIsMobile]     = useState(() => typeof window !== "undefined" && window.innerWidth < 1024);
  const searchRef                   = useRef(null);
  const inputRef                    = useRef(null);

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

        {/* Logo + título */}
        {logoErr ? (
          <span className="navbar-logo">L</span>
        ) : (
          <img src="/assets/logo.png" alt="Logo" width={45} height={45}
            onError={() => setLogoErr(true)}
            style={{ borderRadius: 8, objectFit: "contain", flexShrink: 0 }} />
        )}
        <span className="navbar-titulo">Urano</span>

        <div className="navbar-spacer" />

        {/* Busca — inline no desktop, botão no mobile */}
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
                      padding: "12px 16px",
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

// ── Card Patrimônio ───────────────────────────────────────────────────────────

function CardPatrimonio({ totais, proventos, reservas, ativos }) {
  const [open, setOpen] = useState(false);
  if (!totais?.length || !proventos?.length) return null;
  const t = totais[0], p = proventos[0];
  const total    = toFloat(t.total_patrimonio);
  const aportado = toFloat(t.total_aportado);
  const diff     = toFloat(t.total_diferenca_patrimonio);
  const divid    = toFloat(p.total_recebido);
  const perc     = aportado ? (diff / aportado * 100) : 0;
  const diffDiv  = diff + divid;
  const percDiv  = aportado ? (diffDiv / aportado * 100) : 0;

  const corDiff = corVar(diff);
  // barra: variação como % do aportado (base = 100% aportado)
  const pctVariacao  = aportado > 0 ? Math.abs(diff) / aportado * 100 : 0;
  const pctAportado  = Math.max(100 - pctVariacao, 0);

  // ── Patrimônio em Dólar (segunda linha da aba totais) ──
  const temDolar  = totais.length > 1;
  const td        = temDolar ? totais[1] : null;
  const totalUSD    = temDolar ? toFloat(td.total_patrimonio) : 0;
  const stocksUSD    = temDolar ? toFloat(td.total_stocks)   : 0;
  const reitsUSD     = temDolar ? toFloat(td.total_reits)    : 0;
  const acoesUSD     = temDolar ? toFloat(td.total_acoes)    : 0;
  const fiisUSD      = temDolar ? toFloat(td.total_fiis)     : 0;
  const bitcoinsUSD  = temDolar ? toFloat(td.total_bitcoins) : 0;
  const reservaUSD   = reservas?.length > 1 ? toFloat(reservas[1].reserva_atual) : 0;

  const moeda      = (ativos ?? []).find(a => String(a.classe).toLowerCase().trim() === "moeda");
  const cotacaoUSD = moeda ? toFloat(moeda.cotacao) : 0;

  return (
    <Card>
      <div className="card-header">
        <h2 className="card-titulo">Patrimônio</h2>
        {temDolar && (
          <BotaoVer onClick={() => setOpen(o => !o)} altText="Ver Mais">
            {open ? "Ocultar" : "Ver Mais"}
          </BotaoVer>
        )}
      </div>

      <SubCard className="subcard-hero">
        {/* Topo: valor principal à esq, variação à dir — sem bloco/box */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <span className="campo-titulo" style={{ fontSize: 14, letterSpacing: "0.05em" }}>Patrimônio Atual</span>
            <span
              className="campo-valor animated-value"
              style={{
                opacity: total ? 1 : 0,
                transform: total ? "translateY(0)" : "translateY(10px)",
                transition: "opacity 0.55s cubic-bezier(0.22,1,0.36,1), transform 0.55s cubic-bezier(0.22,1,0.36,1)",
                lineHeight: 1,
              }}
            >
              {fmtBRL(total)}
            </span>
          </div>


        </div>

        {/* Barra de composição */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 6 }}>
          {/* Barra: variação à esq → aportado à dir */}
          <div style={{ position: "relative", height: BARRA_ALTURA, borderRadius: 99, overflow: "hidden", background: "rgba(255, 255, 255, 0.05)" }}>
            <div style={{
              position: "absolute", left: 0, top: 0, height: "100%",
              width: `${pctVariacao}%`,
              background: `linear-gradient(90deg, ${corDiff}bb, ${corDiff})`,
              borderRadius: "99px 0 0 99px",
              transition: "width 1.1s cubic-bezier(0.4,0,0.2,1) 0.1s",
              boxShadow: `0 0 8px ${corDiff}55`,
            }} />
            <div style={{
              position: "absolute", right: 0, top: 0, height: "100%",
              width: `${pctAportado}%`,
              background: "rgba(255, 255, 255, 0.05)",
              borderRadius: "0 99px 99px 0",
              transition: "width 1.1s cubic-bezier(0.4,0,0.2,1)",
            }} />
          </div>

          {/* Legenda em duas colunas, cada coluna com label em cima e valor embaixo */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {/* ADICIONE A CLASSE AQUI: */}
              <span className="titulo-variacao-patrimonio" style={{ fontSize: 10, color: "var(--color-label)", fontWeight: 500 }}>Variação ({pctVariacao.toFixed(1)}%)</span>
              <span className="texto-variacao-patrimonio" style={{ fontSize: 15, color: corDiff, fontWeight: 500 }}>{sinal(diff)}{fmtBRL(diff)}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-end" }}>
              {/* ADICIONE A CLASSE AQUI: */}
              <span className="titulo-aporte-patrimonio" style={{ fontSize: 10, color: "var(--color-label)", fontWeight: 500 }}>Aportado ({pctAportado.toFixed(1)}%)</span>
              <span className="texto-aporte-patrimonio" style={{ fontSize: 15, color: "#707070", fontWeight: 500 }}>{fmtBRL(aportado)}</span>
            </div>
          </div>
        </div>
      </SubCard>

      <div className="grid3">
        <SubCard><AnimatedValue titulo="Total Aportado"            rawValue={aportado} formatter={fmtBRL} /></SubCard>
        <SubCard><AnimatedValue titulo="Variação Com Dividendos"   rawValue={diffDiv}  formatter={v => `${sinal(v)}${fmtBRL(v)}`}    cor={corVar(diffDiv)} /></SubCard>
        <SubCard><AnimatedValue titulo="Variação % Com Dividendos" rawValue={percDiv}  formatter={v => `${sinal(v)}${v.toFixed(2)}%`} cor={corVar(percDiv)} /></SubCard>
      </div>

      {temDolar && (
        <Expandable open={open}>
          <SubCard className="subcard-hero">
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <span className="campo-titulo" style={{ fontSize: 14, letterSpacing: "0.05em" }}>Patrimônio Atual (USD)</span>
              <span
                className="campo-valor animated-value"
                style={{
                  opacity: totalUSD ? 1 : 0,
                  transform: totalUSD ? "translateY(0)" : "translateY(10px)",
                  transition: "opacity 0.55s cubic-bezier(0.22,1,0.36,1), transform 0.55s cubic-bezier(0.22,1,0.36,1)",
                  lineHeight: 1,
                }}
              >
                {fmtUSD(totalUSD)}
              </span>

              {cotacaoUSD > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                  <span className="campo-titulo" style={{ fontSize: 12, letterSpacing: "0.05em" }}>Cotação USD</span>
                  <span style={{ fontSize: 14, fontWeight: 500, color: "var(--color-value)" }}>
                    {fmtBRL(cotacaoUSD)}
                  </span>
                </div>
              )}
            </div>

            <div className="usd-grid" style={{ marginTop: 16 }}>
              {[
                { titulo: "Stocks",   valor: stocksUSD },
                { titulo: "Reits",    valor: reitsUSD },
                { titulo: "Ações",    valor: acoesUSD },
                { titulo: "Fiis",     valor: fiisUSD },
                { titulo: "Bitcoins", valor: bitcoinsUSD },
                { titulo: "Reserva",  valor: reservaUSD },
              ]
                .sort((a, b) => b.valor - a.valor)
                .map((item) => {
                  const pct = totalUSD > 0 ? (item.valor / totalUSD * 100) : 0;
                  return (
                    <div key={item.titulo} className="usd-item">
                      <div className="usd-item-top">
                        <span className="usd-item-titulo">{item.titulo}</span>
                        <span className="usd-item-pct">{pct.toFixed(1)}%</span>
                      </div>
                      <span className="usd-item-valor">{fmtUSD(item.valor)}</span>
                    </div>
                  );
                })}
            </div>
          </SubCard>
        </Expandable>
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
      <div className="tooltip-val" style={{ color: "#0a5550" }}>{fmtBRL(payload[0].value)}</div>
      {payload[1] && (
        <div className="tooltip-sub" style={{ color: corVar(payload[1].value) }}>
          {sinal(payload[1].value)}{fmtBRL(payload[1].value)}
        </div>
      )}
    </div>
  );
}

// ── Card Evolução ─────────────────────────────────────────────────────────────

function EvolucaoXTick({ x, y, payload }) {
  const isMobile = typeof window !== "undefined" && window.innerWidth <= 640;
  const fontSize = isMobile ? "clamp(8px, 1.8vw, 10px)" : 10;
  return (
    <text x={x} y={y + 10} textAnchor="middle" fill="#909090" fontSize={fontSize} fontFamily='-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif'>
      {payload.value}
    </text>
  );
}

function CardEvolucao({ evolucao }) {
  const [open, setOpen] = useState(false);
  if (!evolucao?.length) return null;

  const row = evolucao[0];
  const anos = Object.keys(row).filter(k => /^\d{4}$/.test(k));
  const rowDiff = evolucao[1] ?? {};

  const data = anos.map(ano => ({
    ano,
    valor: toFloat(row[ano]),
    diff:  toFloat(rowDiff[ano] ?? 0),
  }));

  return (
    <Card>
      <div className="card-header">
        <h2 className="card-titulo">Evolução</h2>
        <BotaoVer onClick={() => setOpen(o => !o)} altText="Ver Mais">{open ? "Ocultar" : "Ver Mais"}</BotaoVer>
      </div>

      <SubCard style={{ overflow: "hidden" }}>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data} margin={{ top: 12, right: 12, left: 12, bottom: 4 }}>
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
          </AreaChart>
        </ResponsiveContainer>
      </SubCard>

      <Expandable open={open}>
        <div className="grid3">
          {data.map(({ ano, valor, diff }) => (
            <SubCard key={ano}>
              <Campo titulo={ano} valor={fmtBRL(valor)} />
              <span style={{ color: corVar(diff), fontSize: 14 }}>
                {sinal(diff)}{fmtBRL(diff)}
              </span>
            </SubCard>
          ))}
        </div>
      </Expandable>
    </Card>
  );
}

// ── Card Reserva ──────────────────────────────────────────────────────────────

function CardReserva({ reservas, alocacao, totais }) {
  const [open, setOpen] = useState(false);
  if (!reservas?.length || !alocacao?.length) return null;
  const r = reservas[0], a = alocacao[0];
  const aktual   = toFloat(r.reserva_atual);
  const pctAtual = toFloat(a.alocacao_atual_reservas);
  const pctIdeal = toFloat(a.alocacao_ideal_reservas);
  const diff     = toFloat(a.alocacao_diferenca_reservas);
  const tituloD  = diff > 0 ? "Porcentagem Sobrando" : diff < 0 ? "Porcentagem Faltando" : "Porcentagem Equilibrada";
  const s        = diff > 0 ? "+" : diff < 0 ? "-" : "";

  const progresso = pctIdeal > 0 ? Math.min(pctAtual / pctIdeal, 1) : 0;
  const corBarra  = progresso >= 1 ? COR_ALTA : progresso >= 0.75 ? COR_BAIXA : "#8a3535";

  const totalPatrimonio = toFloat(totais?.[0]?.total_patrimonio);
  const valorIdeal       = totalPatrimonio * pctIdeal / 100;
  const valorFaltando    = Math.max(valorIdeal - aktual, 0);

  return (
    <Card>
      <div className="card-header">
        <h2 className="card-titulo">Reserva de Emergência</h2>
        <BotaoVer onClick={() => setOpen(o => !o)} altText="Ver Mais">
          {open ? "Ocultar" : "Ver Mais"}
        </BotaoVer>
      </div>
      <div className="grid3">
        <SubCard><AnimatedValue titulo="Reserva Atual"   rawValue={aktual}     formatter={fmtBRL} /></SubCard>
        {valorIdeal > 0 && (
          <>
            <SubCard><AnimatedValue titulo="Reserva Ideal"    rawValue={valorIdeal}    formatter={fmtBRL} /></SubCard>
            <SubCard><AnimatedValue titulo="Reserva Faltando" rawValue={valorFaltando} formatter={fmtBRL} cor={valorFaltando > 0 ? COR_BAIXA : COR_ALTA} /></SubCard>
          </>
        )}
      </div>

      <Expandable open={open}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="grid3">
            <SubCard><AnimatedValue titulo="Porcentagem Atual no Patrimônio" rawValue={pctAtual} formatter={v => `${v.toFixed(2)}%`} /></SubCard>
            <SubCard><AnimatedValue titulo="Porcentagem Ideal no Patrimônio" rawValue={pctIdeal} formatter={v => `${v.toFixed(2)}%`} /></SubCard>
            <SubCard><AnimatedValue titulo={tituloD} rawValue={Math.abs(diff)} formatter={v => `${s}${v.toFixed(2)}%`} cor={corVar(diff)} /></SubCard>
          </div>

          {pctIdeal > 0 && (
            <SubCard style={{ gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 14, fontWeight: 500, color: "var(--color-label)" }}>Progresso em Relação à Meta</span>
                <span style={{ fontSize: 14, fontWeight: 500, color: corBarra }}>
                  {Math.round(progresso * 100)}%
                </span>
              </div>

              <div style={{ position: "relative", height: BARRA_ALTURA, background: "rgba(255,255,255,0.05)", borderRadius: 99, overflow: "hidden" }}>
                <div style={{
                  height: "100%",
                  width: `${progresso * 100}%`,
                  background: corBarra,
                  borderRadius: 99,
                  transition: "width 1s cubic-bezier(0.4,0,0.2,1)",
                }} />
              </div>

              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, color: "var(--color-label)" }}>
                  Atual <span style={{ color: "var(--color-label)", fontWeight: 500 }}>{pctAtual.toFixed(1)}%</span>
                </span>
                <span style={{ fontSize: 12, color: "var(--color-label)" }}>
                  Meta <span style={{ color: "var(--color-label)", fontWeight: 500 }}>{pctIdeal.toFixed(1)}%</span>
                </span>
              </div>
            </SubCard>
          )}
        </div>
      </Expandable>
    </Card>
  );
}

// ── Card Alocação ─────────────────────────────────────────────────────────────

function BarraAlocacao({ dados, onHoverItem, hoveredIdx }) {
  const total = dados.reduce((s, d) => s + d.pct, 0) || 1;
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth <= 640);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return (
    <SubCard style={{ padding: "20px", gap: 20 }}>
      {/* Barra principal */}
      <div style={{ display: "flex", height: 36, borderRadius: 14, overflow: "hidden", gap: 2 }}>
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
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
              }}
              title={`${d.titulo}: ${d.pct.toFixed(1)}%`}
            >
            </div>
          );
        })}
      </div>

      {/* Cards de legenda */}
      <div style={{
          display: "grid",
          // Ajustado para 2 colunas perfeitamente iguais no mobile e 6 no desktop
          gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(6, 1fr)", 
          gap: isMobile ? "10px" : "8px", // Espaçamento levemente maior e mais respirável no mobile
          width: "100%",
        }}>
        {dados.map((d, i) => {
          const cor = PALETA_ALOCACAO[i % PALETA_ALOCACAO.length];
          const isHov = hoveredIdx === i;
          return (
            <div
              key={d.titulo}
              onMouseEnter={() => onHoverItem(i)}
              onMouseLeave={() => onHoverItem(null)}
              style={{
                background: isHov ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${isHov ? cor + "55" : "rgba(255,255,255,0.06)"}`,
                borderRadius: 12,
                padding: "10px 12px",
                display: "flex",
                flexDirection: "column",
                gap: 6,
                cursor: "default",
                transition: "background 0.18s, border-color 0.18s",
              }}
            >
              {/* Título + dot */}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: cor, flexShrink: 0,
                }} />
                <span style={{
                  fontSize: isMobile ? 10 : 11,
                  fontWeight: 500,
                  color: "var(--color-label)",
                  letterSpacing: "0.05em",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}>
                  {d.titulo}
                </span>
              </div>
              {/* Valor atual grande */}
              <span style={{
                fontSize: isMobile ? 15 : 18,
                fontWeight: 500,
                color: "var(--color-value)",
                letterSpacing: "0.05em",
                lineHeight: 1,
              }}>
                {d.pct.toFixed(1)}%
              </span>
              {/* Mini linha atual vs ideal */}
              {d.ideal > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ height: BARRA_ALTURA, background: "rgba(255,255,255,0.05)", borderRadius: 99, overflow: "hidden" }}>
                    <div style={{
                      height: "100%",
                      width: `${Math.min(d.pct / d.ideal, 1) * 100}%`,
                      background: cor,
                      borderRadius: 99,
                      opacity: 0.7,
                      transition: "width 0.8s ease",
                    }} />
                  </div>
                  <span style={{ fontSize: 10, color: "var(--color-label)", fontWeight: 500 }}>
                    Meta {d.ideal.toFixed(1)}%
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </SubCard>
  );
}

function CardAlocacao({ alocacao }) {
  const [open, setOpen] = useState(false);
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
      <div className="card-header">
        <h2 className="card-titulo">Alocação</h2>
        <BotaoVer onClick={() => setOpen(o => !o)} altText="Ver Mais">{open ? "Ocultar" : "Ver Mais"}</BotaoVer>
      </div>

      <BarraAlocacao dados={dados} onHoverItem={setHoveredIdx} hoveredIdx={hoveredIdx} />

      <Expandable open={open}>
        <div className="grid3">
          {dados.map(d => (
            <SubCard key={d.sufixo}>
              <Campo titulo={d.titulo} valor={`${d.pct}%`} />
              <span style={{ color: "var(--color-subtitle)", fontSize: 13 }}>Meta: {d.ideal}%</span>
              <span style={{ color: corVar(d.diff), fontSize: 13 }}>
                Diferença: {sinal(d.diff)}{d.diff}%
              </span>
            </SubCard>
          ))}
        </div>
      </Expandable>
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

  const todasClasses = ORDEM.map(({ classe, nome }) => {
    const [ki, ka] = APORTE_MAP[classe];
    const ideal  = toFloat(a[ki]);
    const aktual = toFloat(a[ka]);
    const diff   = ideal - aktual;
    return { classe, nome, ideal, updated: aktual, diff };
  }).filter(d => d.ideal > 0);

  // Calculado uma vez fora do map para evitar recomputação a cada item
  const maxScale = Math.max(...todasClasses.map(x => x.updated), ...todasClasses.map(x => x.ideal)) * 1.15;

  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth <= 640);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const RenderResumoAtivo = ({ ativo, titulo }) => {
    if (!ativo) return null;
    const psf   = toFloat(ativo.porcentagem_sobrando_faltando);
    const pmeta = toFloat(ativo.porcentagem_meta);
    const corPsf = corVar(psf);

    return (
      <SubCard style={{ padding: "20px", gap: "14px" }}>

        {/* Título do card */}
        {titulo && (
          <span className="campo-titulo" style={{ display: "block" }}>{titulo}</span>
        )}

        {/* Logo + Ticker + Nome + badge de meta */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <LogoAtivo ticker={ativo.ticker} size={44} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: "20px",
              fontWeight: "500",
              color: "var(--color-value)",
              letterSpacing: "0.05em",
              lineHeight: 1.1,
            }}>
              {String(ativo.ticker).toUpperCase()}
            </div>
            <div style={{
              fontSize: "12px",
              color: "var(--color-label)",
              marginTop: "3px",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}>
              {ativo.nome}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", flexShrink: 0 }}>
            <span style={{
              background: "rgba(10,85,80,0.15)",
              border: "1px solid rgba(10,85,80,0.35)",
              borderRadius: "20px",
              padding: "3px 10px",
              fontSize: "11px",
              fontWeight: "500",
              color: "#0a5550",
              whiteSpace: "nowrap",
              letterSpacing: "0.05em",
            }}>
              Meta {pmeta.toFixed(2)}%
            </span>
            <span style={{
              background: `${corPsf}15`,
              border: `1px solid ${corPsf}30`,
              borderRadius: "20px",
              padding: "3px 10px",
              fontSize: "11px",
              fontWeight: "500",
              color: corPsf,
              whiteSpace: "nowrap",
              letterSpacing: "0.05em",
            }}>
              {psf > 0 ? "+" : ""}{psf.toFixed(2)}% meta
            </span>
          </div>
        </div>

      </SubCard>
    );
  };

  return (
    <Card>
      <div className="card-header">
        <h2 className="card-titulo">Aporte</h2>
        <BotaoVer onClick={() => setOpen(o => !o)} altText="Ver Mais">{open ? "Ocultar" : "Ver Mais"}</BotaoVer>
      </div>

      {classePrio && (() => {
        const pctAtual  = classePrio.ideal > 0 ? Math.min(classePrio.atual / classePrio.ideal, 1) * 100 : 0;
        const pctFalta  = classePrio.ideal > 0 ? Math.min(classePrio.diff  / classePrio.ideal, 1) * 100 : 0;
        return (
          <SubCard style={{ padding: "20px" }}>
            {/* Cabeçalho: nome da classe */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="campo-titulo">
                Classe Prioritária
              </span>
              <span style={{ fontSize: 28, fontWeight: 500, color: "#f5f5f7", letterSpacing: "0.05em", lineHeight: 1 }}>
                {classePrio.nome}
              </span>
            </div>

            {/* Métricas alinhadas à esquerda, sem separadores */}
            <div style={{ display: "flex", gap: 28, marginTop: 10, flexWrap: "wrap" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span className="campo-titulo">Atual</span>
                <span style={{ fontSize: 18, fontWeight: 500, color: "var(--color-value)" }}>{classePrio.atual.toFixed(2)}%</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span className="campo-titulo">Meta</span>
                <span style={{ fontSize: 18, fontWeight: 500, color: "var(--color-value)" }}>{classePrio.ideal.toFixed(2)}%</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span className="campo-titulo">Faltando</span>
                <span style={{ fontSize: 18, fontWeight: 500, color: COR_BAIXA }}>+{classePrio.diff.toFixed(2)}%</span>
              </div>
            </div>

            {/* Barra estilo Patrimônio: atual (roxo) + faltando (cinza) */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
              <div style={{ position: "relative", height: BARRA_ALTURA, borderRadius: 99, overflow: "hidden", background: "rgba(255,255,255,0.05)" }}>
                <div style={{
                  position: "absolute", left: 0, top: 0, height: "100%",
                  width: `${pctAtual}%`,
                  background: COR_BAIXA,
                  borderRadius: "99px 0 0 99px",
                  transition: "width 1.1s cubic-bezier(0.4,0,0.2,1) 0.1s",
                  boxShadow: `0 0 8px ${COR_BAIXA}55`,
                }} />
                <div style={{
                  position: "absolute", right: 0, top: 0, height: "100%",
                  width: `${pctFalta}%`,
                  background: "rgba(255, 255, 255, 0.05)",
                  borderRadius: "0 99px 99px 0",
                  transition: "width 1.1s cubic-bezier(0.4,0,0.2,1)",
                }} />
              </div>

              {/* Legenda em duas colunas com label acima do valor */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 10, color: "var(--color-label)", fontWeight: 500 }}>Atual ({pctAtual.toFixed(1)}%)</span>
                  <span style={{ fontSize: 12, color: COR_BAIXA, fontWeight: 500 }}>{classePrio.atual.toFixed(2)}%</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-end" }}>
                  <span style={{ fontSize: 10, color: "var(--color-label)", fontWeight: 500 }}>Faltando ({pctFalta.toFixed(1)}%)</span>
                  <span style={{ fontSize: 12, color: "var(--color-label)", fontWeight: 500 }}>+{classePrio.diff.toFixed(2)}%</span>
                </div>
              </div>
            </div>
          </SubCard>
        );
      })()}

      {(ativo1Obj || ativo2Obj) && (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "16px" }}>
          <RenderResumoAtivo ativo={ativo1Obj} titulo="Ativo Prioritário 1" />
          <RenderResumoAtivo ativo={ativo2Obj} titulo="Ativo Prioritário 2" />
        </div>
      )}

      <Expandable open={open}>
        <SubCard style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {todasClasses.map((d) => {
            const progAtual = Math.min(d.updated / maxScale, 1);
            const progIdeal = Math.min(d.ideal   / maxScale, 1);
            const sobra     = d.diff <= 0;
            const corBarra  = sobra ? COR_ALTA : COR_BAIXA;
            const diffFmt   = sobra
              ? `+${Math.abs(d.diff).toFixed(1)}%`
              : `−${Math.abs(d.diff).toFixed(1)}%`;

            return (
              <div key={d.nome}>
                {isMobile ? (
                  <div style={{ display: "flex", alignItems: "center", marginBottom: 10, gap: 6 }}>
                    <span style={{ color: "var(--color-value)", fontSize: 12, fontWeight: 500, minWidth: 56, flexShrink: 0 }}>
                      {d.nome}
                    </span>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", flex: 1 }}>
                      <span style={{ color: "var(--color-value)", fontSize: 15, fontWeight: 500, letterSpacing: "0.05em", lineHeight: 1.1 }}>
                        {d.updated.toFixed(1)}%
                      </span>
                      <span style={{ color: "var(--color-label)", fontSize: 10, fontWeight: 500 }}>
                        Meta {d.ideal.toFixed(1)}%
                      </span>
                    </div>
                    <span style={{
                      color: corBarra, fontSize: 12, fontWeight: 500,
                      minWidth: 44, textAlign: "right",
                      background: `${corBarra}18`,
                      borderRadius: 8,
                      padding: "2px 6px",
                      flexShrink: 0,
                    }}>
                      {diffFmt}
                    </span>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
                    <span style={{ color: "var(--color-value)", fontSize: 14, fontWeight: 500, minWidth: 72, flexShrink: 0 }}>
                      {d.nome}
                    </span>
                    <span style={{ color: "var(--color-value)", fontSize: 22, fontWeight: 500, letterSpacing: "0.05em", flex: 1 }}>
                      {d.updated.toFixed(1)}%
                    </span>
                    <span style={{ color: "var(--color-label)", fontSize: 12, fontWeight: 500, marginRight: 12 }}>
                      Meta {d.ideal.toFixed(1)}%
                    </span>
                    <span style={{
                      color: corBarra, fontSize: 14, fontWeight: 500,
                      minWidth: 60, textAlign: "right",
                      background: `${corBarra}18`,
                      borderRadius: 8,
                      padding: "2px 8px",
                    }}>
                      {diffFmt}
                    </span>
                  </div>
                )}

                <div style={{ position: "relative", height: BARRA_ALTURA, borderRadius: 99, background: "rgba(255, 255, 255, 0.05)" }}>
                  <div style={{
                    position: "absolute", top: 0, left: 0, bottom: 0,
                    width: `${progIdeal * 100}%`,
                    background: `${corBarra}22`,
                    borderRadius: 99,
                  }} />
                  <div style={{
                    position: "absolute", top: 0, left: 0, bottom: 0,
                    width: `${progAtual * 100}%`,
                    background: corBarra,
                    borderRadius: 99,
                    transition: "width 0.75s cubic-bezier(0.4,0,0.2,1)",
                    display: "flex", alignItems: "center", justifyContent: "flex-end",
                    overflow: "hidden",
                  }}>
                  </div>
                  <div style={{
                    position: "absolute",
                    top: -2, bottom: -2,
                    left: `${progIdeal * 100}%`,
                    width: 2.5,
                    borderRadius: 2,
                    background: "rgba(255,255,255,0.5)",
                    transform: "translateX(-50%)",
                  }} />
                </div>
              </div>
            );
          })}
        </SubCard>
      </Expandable>
    </Card>
  );
}

// ── Card Proventos ────────────────────────────────────────────────────────────

function GraficoProventos({ porAno }) {
  const [hovIdx, setHovIdx] = useState(null);
  const vMax     = Math.max(...porAno.map(r => r.valor), 1);
  const anoAtual = String(new Date().getFullYear());
  const CHART_H  = 220;
  const BAR_GAP  = 10;

  return (
    <div style={{ position: "relative", width: "100%", boxSizing: "border-box" }}>
      <div style={{
        display: "flex",
        alignItems: "flex-end",
        gap: BAR_GAP,
        height: CHART_H,
      paddingTop: 60,
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
              {isHov && (
                <div className="chart-tooltip" style={{
                  position: "absolute",
                  bottom: `calc(${heightPct}% + 10px)`,
                  left: "50%",
                  transform: "translateX(-50%)",
                  pointerEvents: "none",
                  whiteSpace: "nowrap",
                  zIndex: 10,
                  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif',
                }}>
                  <div className="tooltip-label">{d.ano}</div>
                  <div className="tooltip-val" style={{ color: "#0a5550" }}>{fmtBRL(d.valor)}</div>
                </div>
              )}

              <div style={{
                width: "100%",
                height: `${heightPct}%`,
                minHeight: d.valor > 0 ? 4 : 0,
                background: isHov ? "#13a097" : isCurrent ? "#13a097" : "#0a5550",
                borderRadius: "10px 10px 4px 4px",
                transition: "height 0.6s cubic-bezier(0.4,0,0.2,1), background 0.15s",
                position: "relative",
                overflow: "hidden",
              }}>
                {isHov && (
                  <div style={{
                    position: "absolute", inset: 0,
                    background: "linear-gradient(180deg, rgba(255,255,255,0.15) 0%, transparent 60%)",
                    borderRadius: "10px 10px 0 0",
                  }} />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: BAR_GAP, marginTop: 8 }}>
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
  const [open, setOpen] = useState(false);
  if (!proventos?.length) return null;

  const totalRecebido = toFloat(proventos[0]?.total_recebido ?? 0);
  const porAno = proventos.map(row => ({
    ano:   String(row.ano ?? ""),
    valor: toFloat(row.total_ano),
  })).filter(r => r.ano);

  return (
    <Card>
      <div className="card-header">
        <h2 className="card-titulo">Proventos</h2>
        <BotaoVer onClick={() => setOpen(o => !o)} altText="Ver Mais">{open ? "Ocultar" : "Ver Mais"}</BotaoVer>
      </div>

      <SubCard style={{ overflow: "hidden" }}>
        <GraficoProventos porAno={porAno} />
      </SubCard>

      <Expandable open={open}>
        <div className="grid3">
          <SubCard><Campo titulo="Total Recebido" valor={fmtBRL(totalRecebido)} /></SubCard>
          {porAno.map(({ ano, valor }, i) => {
            const anterior = i > 0 ? porAno[i - 1].valor : null;
            const crescimento = anterior && anterior > 0 ? ((valor - anterior) / anterior) * 100 : null;
            const corCres = crescimento === null ? null : crescimento >= 0 ? COR_ALTA : COR_BAIXA;
            return (
              <SubCard key={ano}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <Campo titulo={ano} valor={fmtBRL(valor)} />
                  {crescimento !== null && (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, paddingTop: 2 }}>
                      <span style={{ fontSize: 10, color: "var(--color-label)", fontWeight: 500 }}>vs {porAno[i - 1].ano}</span>
                      <span style={{ fontSize: 13, fontWeight: 500, color: corCres, whiteSpace: "nowrap" }}>
                        {crescimento >= 0 ? "+" : ""}{crescimento.toFixed(1)}%
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 500, color: corCres, opacity: 0.85, whiteSpace: "nowrap" }}>
                        {valor - anterior >= 0 ? "+" : ""}{fmtBRL(valor - anterior)}
                      </span>
                    </div>
                  )}
                </div>
              </SubCard>
            );
          })}
        </div>
      </Expandable>
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
  const visiveis = open ? df : df.slice(0, LIMITE);
  const temMais  = df.length > LIMITE;

  return (
    <Card>
      <div className="card-header">
        <h2 className="card-titulo">Mapa de Ativos</h2>
        {temMais && (
          <BotaoVer onClick={() => setOpen(o => !o)} altText="Ver Mais">
            {open ? "Ocultar" : "Ver Mais"}
          </BotaoVer>
        )}
      </div>
      <SubCard>
        <div className="heatmap-grid">
          {visiveis.map((at, i) => <HeatmapCell key={i} ativo={at} />)}
        </div>
      </SubCard>
    </Card>
  );
}

// ── Card Individual de Ativo ──────────────────────────────────────────────────

function CardAtivo({ ativo, highlight }) {
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

  const textoSF = psf > 0 ? "% Sobrando" : psf < 0 ? "% Faltando" : "% Ok";
  const s   = sinal(vt);
  const ssf = sinal(psf);

  const metricas = [
    { titulo: "Cotação",         valor: ehUSD ? fmtUSD(cot) : fmtBRL(cot), cor: null        },
    { titulo: "Quantidade",      valor: String(qtd),                         cor: null        },
    { titulo: "Preço Médio",     valor: ehUSD ? fmtUSD(pm) : fmtBRL(pm),   cor: null        },
    { titulo: "Total Investido", valor: fmtBRL(ti),                          cor: null        },
    { titulo: "Total Atual",     valor: fmtBRL(ta),                          cor: null        },
    { titulo: "Variação",        valor: `${s}${fmtBRL(vt)}`,                cor: corVar(vt)  },
    { titulo: "Variação %",      valor: `${s}${vpct.toFixed(2)}%`,          cor: corVar(vt)  },
    { titulo: "% Meta",          valor: `${pmeta.toFixed(2)}%`,             cor: null        },
    { titulo: "% Atual",         valor: `${pat.toFixed(2)}%`,               cor: null        },
    { titulo: textoSF,           valor: `${ssf}${Math.abs(psf).toFixed(2)}%`, cor: corVar(psf) },
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
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        paddingBottom: "16px",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        marginBottom: "16px",
        marginLeft: "-20px",
        marginRight: "-20px",
        paddingLeft: "20px",
        paddingRight: "20px",
      }}>
        <LogoAtivo ticker={ativo.ticker} size={72} />
        <div style={{ flex: 1 }}>
          <div style={{ color: "var(--color-value)", fontSize: 24, fontWeight: 500, letterSpacing: "0.05em" }}>
            {String(ativo.ticker).toUpperCase()}
          </div>
          <div style={{ color: "var(--color-label)", fontSize: 16, marginTop: 2 }}>{ativo.nome}</div>
        </div>
        <div style={{
          background: `${corVar(vt)}18`,
          border: `1px solid ${corVar(vt)}35`,
          borderRadius: 20,
          padding: "4px 11px",
          fontSize: 13,
          fontWeight: 500,
          color: corVar(vt),
        }}>
          {s}{vpct.toFixed(2)}%
        </div>
      </div>

      <div className="ativo-metricas-grid" style={{ padding: 0 }}>
        {metricas.map((m) => (
          <div key={m.titulo} className="ativo-metrica-cell" style={{ padding: "6px 0" }}>
            <div className="ativo-metrica-titulo">{m.titulo}</div>
            <div className="ativo-metrica-valor" style={m.cor ? { color: m.cor } : {}}>
              {m.valor}
            </div>
          </div>
        ))}
      </div>
    </SubCard>
  );
}

// ── Card de Classe (Stocks, Reits, etc.) ──────────────────────────────────────

function CardClasse({ titulo, sufixo, classe, totais, ativos, selectedTicker, searchVersion, onTickerHandled, scrollRef }) {
  const [open, setOpen]               = useState(false);
  const [sortBy, setSortBy]           = useState(null);
  const [sortDir, setSortDir]         = useState("asc");
  const [filtrosOpen, setFiltrosOpen] = useState(false);
  const [highlightTicker, setHighlightTicker] = useState(null);
  const [isMobile, setIsMobile]       = useState(() => typeof window !== "undefined" && window.innerWidth <= 640);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 640);
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

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
        <h2 className="card-titulo">{titulo}</h2>
        <BotaoVer onClick={() => setOpen(o => !o)} altText="Ver Mais">{open ? "Ocultar" : "Ver Mais"}</BotaoVer>
      </div>

      <SubCard style={{ padding: "20px" }}>
        {/* Total à esq, variação à dir — sem bloco */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <span className="campo-titulo">
              Total Em {titulo}
            </span>
            <AnimatedValue titulo="" rawValue={total} formatter={fmtBRL} />
          </div>

        </div>

        {/* Barra + legenda simples */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 14 }}>
              <div style={{ position: "relative", height: BARRA_ALTURA, borderRadius: 99, overflow: "hidden", background: "rgba(255,255,255,0.05)" }}>
                <div style={{
                  position: "absolute", left: 0, top: 0, height: "100%",
                  width: `${pctVariacao}%`,
                  background: `linear-gradient(90deg, ${corDiff}bb, ${corDiff})`,
                  borderRadius: "99px 0 0 99px",
                  transition: "width 1.1s cubic-bezier(0.4,0,0.2,1) 0.1s",
                  boxShadow: `0 0 8px ${corDiff}55`,
                }} />
                <div style={{
                  position: "absolute", right: 0, top: 0, height: "100%",
                  width: `${pctAportado}%`,
                  background: "rgba(255,255,255,0.05)",
                  borderRadius: "0 99px 99px 0",
                  transition: "width 1.1s cubic-bezier(0.4,0,0.2,1)",
                }} />
              </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>

                  {/* Coluna Variação */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span
                      className="titulo-variacao-ativo"
                      style={{
                        fontSize: 10,
                        color: "var(--color-label)",
                        fontWeight: 500
                      }}
                    >
                      Variação ({pctVariacao.toFixed(1)}%)
                    </span>

                    <span
                      className="texto-variacao-ativo"
                      style={{ color: corDiff, fontWeight: 500 }}
                    >
                      {sinal(diff)}{fmtBRL(Math.abs(diff))}
                    </span>
                  </div>

                  {/* Coluna Aportado */}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                      alignItems: "flex-end",
                    }}
                  >
                    <span
                      className="titulo-aporte-ativo"
                      style={{
                        fontSize: 10,
                        color: "var(--color-label)",
                        fontWeight: 500
                      }}
                    >
                      Aportado ({pctAportado.toFixed(1)}%)
                    </span>

                    <span
                      className="texto-aporte-ativo"
                      style={{ color: "#707070", fontWeight: 500 }}
                    >
                      {fmtBRL(aportado)}
                    </span>
                  </div>

                </div>
        </div>
      </SubCard>

      <Expandable open={open}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16}}>
          {isMobile ? (
            /* ── Mobile: botão "Filtros" com dropdown ── */
            <div style={{ position: "relative" }}>
              <button
                className={`btn-filtro${sortBy ? " btn-filtro-ativo" : ""}`}
                onClick={() => setFiltrosOpen(o => !o)}
                style={{ display: "flex", alignItems: "center", gap: 6, color: "#f5f5f7" }}
              >
                Filtros
                {sortBy && (
                  <span style={{ fontSize: 11, opacity: 0.8, color: "#f5f5f7" }}>
                    · {FILTROS.find(f => f.key === sortBy)?.texto}
                  </span>
                )}
                <span style={{
                  fontSize: 10,
                  marginLeft: 2,
                  color: "#f5f5f7",
                  transition: "transform 0.2s ease",
                  display: "inline-block",
                  transform: filtrosOpen ? "rotate(180deg)" : "rotate(0deg)",
                }}>▾</span>
              </button>

              {filtrosOpen && (
                <div style={{
                  position: "absolute",
                  top: "calc(100% + 8px)",
                  left: 0,
                  zIndex: 50,
                  background: "var(--bg3)",
                  border: "1px solid var(--border2)",
                  borderRadius: 14,
                  padding: "6px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  minWidth: 180,
                  boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                }}>
                  {FILTROS.map(f => {
                    const ativo = sortBy === f.key;
                    return (
                      <button
                        key={f.key}
                        onClick={() => { handleSort(f.key); setFiltrosOpen(false); }}
                        style={{
                          background: ativo ? "#0a5550" : "transparent",
                          color: ativo ? "#f5f5f7" : "var(--color-label)",
                          border: ativo ? "1px solid rgba(5,120,112,0.4)" : "1px solid transparent",
                          borderRadius: 10,
                          padding: "10px 14px",
                          fontSize: 13,
                          fontWeight: ativo ? 600 : 500,
                          cursor: "pointer",
                          textAlign: "left",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          transition: "background 0.15s, color 0.15s",
                          fontFamily: "inherit",
                        }}
                      >
                        {f.texto}
                        {ativo && (
                          <span style={{ fontSize: 12, opacity: 0.9 }}>
                            {sortDir === "asc" ? "↑" : "↓"}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            /* ── Desktop: botões em linha ── */
            <div className="filtros-row">
              {FILTROS.map(f => (
                <BotaoFiltro key={f.key} onClick={() => handleSort(f.key)} ativo={sortBy === f.key}>
                  {f.texto}{sortBy === f.key && <span className="sort-seta">{sortDir === "asc" ? " ↑" : " ↓"}</span>}
                </BotaoFiltro>
              ))}
            </div>
          )}
          <div className="ativos-lista">
            {df.map((at, i) => <CardAtivo key={i} ativo={at} highlight={at.ticker === highlightTicker} />)}
          </div>
        </div>
      </Expandable>
    </Card>
  );
}

// ── App Principal ─────────────────────────────────────────────────────────────

export default function App() {
  const [dados, setDados]           = useState(null);
  const [loading, setLoading]       = useState(true);
  const [erro, setErro]             = useState(null);
  const [scrolled, setScrolled]     = useState(false);
  const [searchCmd, setSearchCmd] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    async function load() {
      try {
        const entries = await Promise.all(
          Object.entries(SHEET_GIDS).map(async ([k, gid]) => [k, await fetchSheet(gid)])
        );
        setDados(Object.fromEntries(entries));
      } catch (e) {
        setErro(String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

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
        <Navbar scrolled={scrolled} ativos={ativos} scrollRef={scrollRef} onSelectTicker={(ticker) => setSearchCmd({ ticker, v: Date.now() })} />
        <BotaoTopoFlutuante scrolled={scrolled} onTop={scrollToTop} />
        <main className="main">
          <div id="sec-patrimonio"><CardPatrimonio totais={totais} proventos={proventos} reservas={reservas} ativos={ativos} /></div>
          <div id="sec-evolucao"><CardEvolucao evolucao={evolucao} /></div>
          <div id="sec-reserva"><CardReserva reservas={reservas} alocacao={alocacao} totais={totais} /></div>
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
                onTickerHandled={() => setSearchCmd(null)}
                scrollRef={scrollRef}
              />
            </div>
          ))}
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
        --navbar-bg:      rgba(24, 28, 28, 0.15);
        --navbar-border:  rgba(255, 255, 255, 0.03);
        --spinner-track:  rgba(10, 85, 80, 0.2);

        --radius-l: 25px;
        --radius-m: 20px;
        --radius-s: 10px;
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
        width: calc(100% - 80px);
        box-sizing: border-box;
        border-radius: 20px;
        padding: 20px 24px;
        display: flex;
        flex-direction: column;
        background: var(--navbar-bg);
        border: 1px solid var(--navbar-border);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
        transition: all 0.5s ease;
      }
      .navbar-inner { display: flex; align-items: center; gap: 8px; width: 100%; }

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
        gap: 8px;
        background: var(--bg4);
        border: 1px solid var(--border2);
        border-radius: 10px;
        padding: 10px 12px;
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
        padding: 12px 16px;
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
      .navbar-spacer { flex: 1; min-width: 8px; }

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
        padding: 13px 16px;
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
        padding: 120px 20px 60px;
        display: flex;
        flex-direction: column;
        gap: 32px;
      }

      /* ── Animação de Entrada ── */
      @keyframes cardFadeUp {
        from { opacity: 0; transform: translate3d(0, 28px, 0); }
        to   { opacity: 1; transform: translate3d(0, 0, 0); }
      }
      .card-enter {
        opacity: 0;
        transform: translate3d(0, 28px, 0);
        transition: opacity 0.6s cubic-bezier(0.22, 1, 0.36, 1),
                    transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
      }
      .card-visible {
        opacity: 1 !important;
        transform: translate3d(0, 0, 0) !important;
      }

      /* ── Seta de Ordenação ── */
      .sort-seta {
        display: inline-block;
        margin-left: 2px;
        font-size: 13px;
        opacity: 0.9;
        transition: transform 0.2s ease;
      }

      /* ── Card ── */
      .card {
        background: var(--bg2);
        border-radius: var(--radius-l);
        border: 1px solid var(--border);
        padding: 20px !important;
        display: flex;
        flex-direction: column;
        gap: 16px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        backface-visibility: hidden;
        perspective: 1000px;
        transform: translate3d(0,0,0);
        will-change: transform;
        transition: background 0.3s ease, border-color 0.3s ease;
      }
      .card-titulo { font-size: 29px; font-weight: 700; color: var(--color-title); }
      .card-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }

      /* ── SubCard ── */
      .subcard {
        background: var(--bg3);
        border-radius: var(--radius-m);
        border: 1px solid var(--border2);
        padding: 20px !important;
        display: flex;
        flex-direction: column;
        gap: 5px;
        transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease, background 0.3s ease;
        position: relative;
        overflow: hidden;
      }

      /* ── SubCard Hero (destaque Patrimônio) ── */
      .subcard-hero {
        padding: 20px !important;
        gap: 16px !important;
      }
      .subcard-hero .campo-titulo {
        font-size: 14px;
        font-weight: 500;
        color: var(--color-label);
      }
      .subcard-hero .campo-valor {
        font-size: 52px;
        font-weight: 300;
        color: var(--color-value);
        line-height: 1;
      }
      @media (max-width: 768px) {
        .subcard-hero .campo-valor { font-size: 36px; }
      }

      /* ── Grid ── */
      .grid3 {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 16px;
      }
      @media (max-width: 768px) {
        .grid3 { grid-template-columns: repeat(2, 1fr); gap: 12px; }
      }

      /* ── Campo ── */
      .campo { display: flex; flex-direction: column; gap: 5px; }
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
      .divisor { height: 1px; background: var(--border2); border: none; margin: 4px 0; }

      /* ── Botões ── */
      .btn-ver, .btn-filtro {
        background: #0a5550;
        color: #f5f5f7;
        border: 1px solid rgba(5, 120, 112, 0.3);
        border-radius: 10px;
        padding: 16px 8px;
        font-size: 14px;
        cursor: pointer;
        font-weight: 600;
        white-space: nowrap;
        min-width: 140px;
        width: 140px;
        text-align: center;
        display: inline-flex;
        justify-content: center;
        align-items: center;
        position: relative;
        overflow: hidden;
        box-shadow: 0 4px 15px rgba(20, 168, 158, 0.3), inset 0 1px 0 rgba(255,255,255,0.15);
        transition: transform 0.2s cubic-bezier(0.34,1.56,0.64,1),
                    box-shadow 0.2s ease,
                    background 0.2s ease;
      }
      .btn-ver::before, .btn-filtro::before {
        content: "";
        position: absolute;
        inset: 0;
        background: linear-gradient(135deg, rgba(255,255,255,0.12) 0%, transparent 60%);
        opacity: 1;
        transition: opacity 0.2s ease;
        pointer-events: none;
      }
      .btn-ver:hover, .btn-filtro:hover {
        background: #0d6e68;
        box-shadow: 0 6px 24px rgba(20, 168, 158, 0.3), inset 0 1px 0 rgba(255,255,255,0.2);
        transform: translateY(-1px);
      }
      .btn-ver:active, .btn-filtro:active {
        transform: scale(0.96) translateY(0px);
        box-shadow: 0 2px 8px rgba(20, 168, 159, 0.3);
      }

      .btn-filtro {
        padding: 8px 12px;
        min-width: auto;
        width: auto;
      }

      /* ── Legenda Alocação ── */
      .alocacao-legenda {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 16px 24px;
        margin-top: 24px;
        width: 100%;
      }
      .alocacao-legenda-item {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0px;
      }

      @media (max-width: 640px) {
        .navbar-search-box {
          position: fixed !important;
          top: 90px;
          left: 50%;
          transform: translateX(-50%);
          width: calc(100vw - 32px);
          max-width: 360px;
          margin: 0;
          box-sizing: border-box;
          z-index: 9999;
        }
        .navbar-search-input {
          width: 100%;
          box-sizing: border-box;
        }
        .alocacao-legenda {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 4px 2px;
          margin-top: 10px;
          justify-items: center;
        }
        .alocacao-legenda-item {
          flex: unset;
          width: 100%;
          justify-content: center;
        }
      }
      .filtros-row {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        padding-top: 4px;
      }

      /* ── Ativos Lista ── */
      .ativos-lista { display: flex; flex-direction: column; gap: 16px; }

      /* ── Grid de Métricas do Ativo ── */
      .ativo-metricas-grid {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        padding: 4px 10px 8px;
        gap: 2px 0;
      }
      .ativo-metrica-cell {
        padding: 6px 10px;
        display: flex;
        flex-direction: column;
        gap: 5px;
        border-radius: 10px;
      }
      .ativo-metrica-titulo {
        font-size: 11px;
        font-weight: 600;
        color: var(--color-label);
      }
      .ativo-metrica-valor {
        font-size: 15px;
        font-weight: 700;
        color: var(--color-value);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      @media (max-width: 1024px) {
        .ativo-metricas-grid { grid-template-columns: repeat(3, 1fr); }
      }
      @media (max-width: 640px) {
        .ativo-metricas-grid { grid-template-columns: repeat(2, 1fr); }
        .ativo-metrica-valor { font-size: 14px; }
      }

      /* ── Card Ativo Legado ── */
      .ativo-header { display: flex; align-items: center; gap: 18px; }
      .ativo-inicial {
        width: 52px; height: 52px;
        background: var(--accent);
        border-radius: 14px;
        display: flex; align-items: center; justify-content: center;
        font-size: 22px; font-weight: 800; color: var(--color-title);
        flex-shrink: 0;
      }
      .ativo-grid {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        gap: 12px 16px;
        margin-top: 4px;
      }
      .ativo-grid .campo-valor  { font-size: 22px; font-weight: 400; }
      .ativo-grid .campo-titulo { font-size: 12px; font-weight: 500; }
      @media (max-width: 1024px) { .ativo-grid { grid-template-columns: repeat(3, 1fr); } }
      @media (max-width: 640px)  { .ativo-grid { grid-template-columns: repeat(2, 1fr); gap: 10px 12px; } }
      @media (max-width: 340px)  { .ativo-grid { grid-template-columns: 1fr; } }

      /* ── Grid compacta para detalhamento em dólar ── */
      .usd-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 12px;
      }
      .usd-item {
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 12px;
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        transition: background 0.18s, border-color 0.18s;
      }
      .usd-item:hover { background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.1); }
      .usd-item-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
      .usd-item-titulo { font-size: 12px; font-weight: 500; color: var(--color-label); letter-spacing: 0.02em; }
      .usd-item-pct    { font-size: 11px; font-weight: 500; color: var(--color-label); opacity: 0.7; }
      .usd-item-valor  { font-size: 18px; font-weight: 400; color: var(--color-value); letter-spacing: 0.02em; }
      @media (max-width: 640px) {
        .usd-grid { grid-template-columns: repeat(2, 1fr); gap: 10px; }
        .usd-item { padding: 10px 12px; }
        .usd-item-valor { font-size: 16px; }
      }

      /* ── Heatmap ── */
      .heatmap-grid {
        display: grid;
        grid-template-columns: repeat(6, 1fr);
        gap: 12px;
      }
      @media (max-width: 1024px) { .heatmap-grid { grid-template-columns: repeat(4, 1fr); } }
      @media (max-width: 640px)  { .heatmap-grid { grid-template-columns: repeat(3, 1fr); } }
      @media (max-width: 380px)  { .heatmap-grid { grid-template-columns: repeat(2, 1fr); } }

      .heatmap-cell {
        border-radius: 14px;
        padding: 12px 8px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
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

      /* ── Tooltip do Gráfico ── */
      .chart-tooltip {
        background: var(--bg3);
        border: 1px solid var(--border2);
        border-radius: 12px;
        padding: 10px 14px;
        font-size: 13px;
      }
      .tooltip-label { color: var(--muted); margin-bottom: 4px; }
      .tooltip-val   { font-size: 16px; font-weight: 700; }
      .tooltip-sub   { font-size: 13px; margin-top: 2px; }

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
        padding: 32px;
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
      .loading-titulo { font-size: 30px; font-weight: 700; color: var(--color-title); }
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

      /* Patrimônio */
      @media (min-width: 1024px) {
        .texto-variacao-patrimonio,
        .texto-aporte-patrimonio {
          font-size: 25px !important;
        }

        .titulo-variacao-patrimonio,
        .titulo-aporte-patrimonio {
          font-size: 15px !important;
        }
      }

      /* Cards dos ativos */
      @media (min-width: 1024px) {
        .texto-variacao-ativo,
        .texto-aporte-ativo {
          font-size: 22px !important;
        }

        .titulo-variacao-ativo,
        .titulo-aporte-ativo {
          font-size: 12px !important;
        }
      }

      /* ── Variação Patrimônio ── */
      .variacao-valor-brl { font-size: 22px; }
      .variacao-valor-pct { font-size: 15px; }
      @media (max-width: 640px) {
        .variacao-valor-brl { font-size: 13px; }
        .variacao-valor-pct { font-size: 11px; }
      }
      @media (max-width: 400px) {
        .variacao-valor-brl { font-size: 11px; }
        .variacao-valor-pct { font-size: 10px; }
      }

      /* ── Botão Filtro Ativo ── */
      .btn-filtro-ativo {
        background: #0a5550 !important;
        color: #f5f5f7 !important;
        border-color: rgba(5, 120, 112, 0.5) !important;
        box-shadow: 0 4px 20px rgba(10,85,80,0.55), inset 0 1px 0 rgba(255,255,255,0.2) !important;
      }

      /* ── Scrollbar ── */
      .root::-webkit-scrollbar { width: 6px; }
      .root::-webkit-scrollbar-track { background: transparent; }
      .root::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 3px; }

      /* ── Responsivo ── */

      /* lg — Landscape tablets e laptops pequenos (≤ 1024px) */
      @media (max-width: 1024px) {
        .main { padding: 106px 18px 52px; gap: 22px; }
        .card { padding: 20px !important; gap: 14px; border-radius: 22px; }
        .subcard { padding: 18px !important; gap: 12px; border-radius: 16px; }
        .card-titulo { font-size: 26px; }
        .campo-valor { font-size: 28px; }
        .campo-titulo { font-size: 13px; }
        .subcard-hero .campo-valor { font-size: 42px !important; }
        .grid3 { grid-template-columns: repeat(3, 1fr); gap: 12px; }
        .ativo-metricas-grid { grid-template-columns: repeat(3, 1fr); }
      }

      /* sm — Smartphones grandes e tablets pequenos (≤ 640px) */
      @media (max-width: 640px) {
        .main { padding: 96px 12px 40px; gap: 16px; }

        /* Navbar */
        .navbar {
          transform: translateX(calc(-50% - 3px));
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
        .card        { padding: 18px !important; gap: 12px; border-radius: 20px; }
        .card-titulo { font-size: 22px; }
        .card-header { gap: 8px; }

        /* SubCard */
        .subcard { padding: 16px !important; gap: 10px; border-radius: 15px; }

        /* SubCard Hero */
        .subcard-hero { padding: 16px !important; gap: 12px !important; }
        .subcard-hero .campo-titulo { font-size: 13px; }
        .subcard-hero .campo-valor  { font-size: 30px !important; }

        /* Campos */
        .campo       { gap: 4px; }
        .campo-valor { font-size: 22px; }
        .campo-titulo { font-size: 12px; }

        /* Grids */
        .grid3 { grid-template-columns: repeat(2, 1fr); gap: 10px; }

        /* Botões */
        .btn-ver    { font-size: 14px; padding: 15px 12px; min-width: 114px; width: 114px; border-radius: 11px; }
        .btn-filtro { font-size: 13px; padding: 8px 10px; min-width: 0; width: auto; border-radius: 11px; }
        .filtros-row { gap: 7px; }

        /* Ativos individuais */
        .ativo-header { gap: 10px; }
        .ativo-grid   { grid-template-columns: repeat(2, 1fr); gap: 8px 14px; }
        .ativo-grid .campo-valor  { font-size: 16px; }
        .ativo-grid .campo-titulo { font-size: 11px; }
        .ativo-metricas-grid      { grid-template-columns: repeat(2, 1fr); gap: 4px 0; }
        .ativo-metrica-cell       { padding: 8px 0; }
        .ativo-metrica-valor      { font-size: 14px; }
        .ativo-metrica-titulo     { font-size: 11px; }

        /* Heatmap */
        .heatmap-grid { gap: 8px; }
        .heatmap-cell { min-height: 66px; padding: 8px 4px; border-radius: 12px; }
        .hm-ticker { font-size: 12px; }
        .hm-pct    { font-size: 11px; }
        .hm-brl    { font-size: 14px; }
      }

      /* Mobile pequeno (≤ 400px) */
      @media (max-width: 400px) {
        .main { padding: 105px 10px 34px; gap: 12px; }
        .card        { padding: 16px !important; gap: 10px; border-radius: 18px; }
        .subcard     { padding: 14px !important; gap: 8px;  border-radius: 13px; }
        .subcard-hero { padding: 14px !important; gap: 10px !important; }
        .subcard-hero .campo-valor { font-size: 26px !important; }
        .campo-valor  { font-size: 19px; }
        .campo-titulo { font-size: 11px; }
        .campo        { gap: 3px; }
        .card-titulo  { font-size: 20px; }
        .grid3        { grid-template-columns: 1fr; gap: 8px; }
        .btn-ver      { font-size: 14px; padding: 14px 10px; min-width: 106px; width: 106px; }
        .btn-filtro   { font-size: 12px; padding: 7px 9px; }
        .ativo-metrica-valor { font-size: 13px; }
        .heatmap-cell { min-height: 58px; padding: 6px 3px; }
        .alocacao-legenda { gap: 4px 4px; margin-top: 10px; }
      }

      /* Mobile muito pequeno (≤ 340px) */
      @media (max-width: 340px) {
        .main    { padding: 78px 8px 28px; gap: 10px; }
        .card    { padding: 14px !important; gap: 8px; }
        .subcard { padding: 12px !important; gap: 6px; }
        .subcard-hero .campo-valor { font-size: 22px !important; }
        .campo-valor  { font-size: 17px; }
        .card-titulo  { font-size: 18px; }
        .grid3        { grid-template-columns: 1fr; gap: 6px; }
      }
    `}</style>
  );
}