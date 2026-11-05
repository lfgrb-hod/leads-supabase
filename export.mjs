// Exporta os leads do Supabase para data/leads.js (formato lido pelo painel).
// Roda no GitHub Actions. Credenciais vêm dos Secrets SUPABASE_URL e SUPABASE_SERVICE_KEY.
import { writeFileSync, mkdirSync } from "node:fs";

// ===== CONFIGURAÇÃO =====
const TABELA = "";   // nome da tabela no Supabase. Vazio = só lista as tabelas no log.
const DESDE = "";    // ex.: "2026-09-01" para exportar só a partir dessa data. Vazio = tudo.

// Campo do painel -> nomes possíveis da coluna no Supabase (usa o primeiro que existir).
// Nome, e-mail, telefone e rastreamento NÃO entram: só estes campos são gravados.
const CAMPOS = {
  data: ["data", "data_cadastro", "data_lead", "created_at"],
  fonte: ["fonte", "utm_source"],
  meio: ["meio", "utm_medium"],
  campanha: ["campanha", "utm_campaign"],
  conteudo: ["conteudo", "utm_content"],
  genero: ["genero"],
  idade: ["idade"],
  renda: ["renda"],
  situacao_profissional: ["situacao_profissional"],
  tempo_felipe: ["tempo_felipe"],
  tempo_disponivel: ["tempo_disponivel"],
  experiencia: ["experiencia"],
  formacao: ["formacao"],
  estado: ["estado"],
  computador: ["computador"],
  capacidade_financeira: ["capacidade_financeira"],
  classificacao: ["classificacao"],
  score: ["score"],
  plano: ["plano"],
  valor: ["valor"],
  data_venda: ["data_venda"],
};
const CAMPOS_DATA = new Set(["data", "data_venda"]);
// ========================

const URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!URL || !KEY) throw new Error("Secrets SUPABASE_URL / SUPABASE_SERVICE_KEY não configurados.");
const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function listarTabelas() {
  const r = await fetch(`${URL}/rest/v1/`, { headers: HEADERS });
  if (!r.ok) { console.log(`Não consegui listar as tabelas (${r.status}).`); return; }
  const spec = await r.json();
  console.log("\n=== Tabelas/views disponíveis e suas colunas ===");
  for (const [nome, def] of Object.entries(spec.definitions || {})) {
    console.log(`\n${nome}:\n  ${Object.keys(def.properties || {}).join(", ")}`);
  }
}

if (!TABELA) {
  await listarTabelas();
  throw new Error("Defina TABELA no topo de scripts/export.mjs e rode de novo.");
}

// Busca todas as linhas em páginas de 1000
const PAGE = 1000;
const linhas = [];
for (let offset = 0; ; offset += PAGE) {
  const r = await fetch(`${URL}/rest/v1/${encodeURIComponent(TABELA)}?select=*&limit=${PAGE}&offset=${offset}`, { headers: HEADERS });
  if (!r.ok) {
    console.log(`Erro ${r.status}: ${await r.text()}`);
    await listarTabelas();
    throw new Error(`Falha ao ler a tabela "${TABELA}".`);
  }
  const lote = await r.json();
  linhas.push(...lote);
  if (lote.length < PAGE) break;
}
if (!linhas.length) throw new Error("A tabela veio vazia. Nada foi gravado.");

// Descobre qual coluna do Supabase alimenta cada campo do painel
const colunas = Object.keys(linhas[0]);
const mapa = {};
const faltando = [];
for (const [campo, opcoes] of Object.entries(CAMPOS)) {
  const achada = opcoes.find((c) => colunas.includes(c));
  if (achada) mapa[campo] = achada; else faltando.push(campo);
}
console.log("Colunas da tabela:", colunas.join(", "));
console.log("Mapeamento usado:", JSON.stringify(mapa));
if (faltando.length) console.log("ATENÇÃO, campos sem coluna correspondente (ficam vazios):", faltando.join(", "));
if (!mapa.data) throw new Error('Nenhuma coluna de data encontrada. Ajuste CAMPOS.data no script.');

// Datas/horas viram AAAA-MM-DD no fuso de Brasília
const fmtDia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
function dia(v) {
  if (v == null || v === "") return "";
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const d = new Date(s);
  return isNaN(d) ? s : fmtDia.format(d);
}
const txt = (v) => (v == null ? "" : String(v).trim());

let registros = linhas.map((l) => {
  const o = {};
  for (const campo of Object.keys(CAMPOS)) {
    const v = mapa[campo] ? l[mapa[campo]] : "";
    o[campo] = CAMPOS_DATA.has(campo) ? dia(v) : txt(v);
  }
  o.ganho = o.data_venda ? "1" : "0"; // ganho = data_venda preenchida
  return o;
});
if (DESDE) registros = registros.filter((r) => r.data >= DESDE);
registros.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));

// Formato compacto que o painel já entende: { n, cols: { campo: { d: [valores únicos], v: [índices] } } }
const cols = {};
for (const campo of [...Object.keys(CAMPOS), "ganho"]) {
  const d = [...new Set(registros.map((r) => r[campo]))].sort();
  const idx = new Map(d.map((x, i) => [x, i]));
  cols[campo] = { d, v: registros.map((r) => idx.get(r[campo])) };
}
const saida = { n: registros.length, atualizado_em: new Date().toISOString(), cols };

mkdirSync("data", { recursive: true });
writeFileSync("data/leads.js", `window.__LEADS__=${JSON.stringify(saida)};\n`);
console.log(`OK: ${registros.length} registros gravados em data/leads.js`);
