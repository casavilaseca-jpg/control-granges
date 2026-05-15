import { useState, useCallback, useEffect } from "react";
import { supabase } from "./supabase";

const TODAY = new Date().toISOString().slice(0, 10);

// ── Dades locals (en producció, substituir per Supabase) ───────────────────


// ── Utils ──────────────────────────────────────────────────────────────────
function dias(d1, d2) { return Math.max(0, Math.round((new Date(d2) - new Date(d1)) / 86400000)); }

function calcStats(lot) {
  const tCE = lot.entrades.reduce((s, e) => s + e.caps, 0);
  const tPE = lot.entrades.reduce((s, e) => s + e.pesKg, 0);
  const tCS = lot.sortides.reduce((s, e) => s + e.caps, 0);
  const tPS = lot.sortides.reduce((s, e) => s + e.pesKg, 0);
  const tB  = lot.baixes.reduce((s, b) => s + b.caps, 0);
  const cap = tCE - tB - tCS;
  const pct = tCE > 0 ? parseFloat(((tB / tCE) * 100).toFixed(1)) : 0;
  const d0  = lot.entrades.length > 0 ? lot.entrades.reduce((m, e) => e.data < m ? e.data : m, lot.entrades[0].data) : TODAY;
  const d1  = lot.estat === "tancat" && lot.sortides.length > 0 ? lot.sortides.reduce((m, s) => s.data > m ? s.data : m, lot.sortides[0].data) : TODAY;
  const die = dias(d0, d1);
  const pem = tCE > 0 ? parseFloat((tPE / tCE).toFixed(1)) : 0;
  const psm = tCS > 0 ? parseFloat((tPS / tCS).toFixed(1)) : null;
  const gKg = psm ? parseFloat((psm - pem).toFixed(1)) : null;
  const gmd = gKg && die > 0 ? Math.round(gKg / die * 1000) : null;
  return { tCE, tPE, tCS, tPS, tB, cap, pct, die, pem, psm, gKg, gmd };
}

function detectarAlertes(lot, granjaName, fase) {
  if (lot.estat === "tancat" || !lot.entrades.length) return [];
  const st = calcStats(lot); const als = [];
  const b7 = lot.baixes.filter(b => dias(b.data, TODAY) <= 7).reduce((s, b) => s + b.caps, 0);
  const b3 = lot.baixes.filter(b => dias(b.data, TODAY) <= 3).reduce((s, b) => s + b.caps, 0);
  if (b3 >= 3) als.push({ nivell: "alerta", regla: "pic3", lot: lot.nom, granja: granjaName, fase, msg: `${b3} baixes en 3 dies`, detall: "Possible brot agut. Revisar immediatament." });
  else if (b7 >= 5) als.push({ nivell: "alerta", regla: "pic7", lot: lot.nom, granja: granjaName, fase, msg: `${b7} baixes en 7 dies`, detall: "Increment elevat. Inspecció veterinària." });
  else if (b7 >= 3) als.push({ nivell: "avis", regla: "avis7", lot: lot.nom, granja: granjaName, fase, msg: `${b7} baixes en 7 dies`, detall: "Vigilar evolució." });
  if (st.pct >= 5) als.push({ nivell: "alerta", regla: "mort5", lot: lot.nom, granja: granjaName, fase, msg: `Mortalitat ${st.pct}%`, detall: "Supera el 5%. Revisió urgent." });
  else if (st.pct >= 3) als.push({ nivell: "avis", regla: "mort3", lot: lot.nom, granja: granjaName, fase, msg: `Mortalitat ${st.pct}%`, detall: "Supera el 3%. Mantenir vigilància." });
  return als;
}

function heatColor(p) {
  if (p === 0) return { bg: "#e1f5ee", color: "#085041" };
  if (p < 1)  return { bg: "#c0dd97", color: "#27500A" };
  if (p < 2)  return { bg: "#eaf3de", color: "#3B6D11" };
  if (p < 3)  return { bg: "#faeeda", color: "#633806" };
  if (p < 4)  return { bg: "#FAC775", color: "#412402" };
  if (p < 5)  return { bg: "#F09595", color: "#501313" };
  return { bg: "#E24B4A", color: "#fff" };
}
const bdg = e => e === "obert" ? { bg: "#e1f5ee", color: "#0f6e56", text: "Obert" } : { bg: "#f1efe8", color: "#5f5e5a", text: "Tancat" };

const FASES = {
  desmamats:  { key: "desmamats",  label: "Desmamats",   emoji: "🍼", color: "#ec4899", bgLight: "#fdf2f8", colorDark: "#9d174d", pesRang: "0–5 kg" },
  transicio:  { key: "transicio",  label: "Transició",   emoji: "🐣", color: "#6366f1", bgLight: "#eef2ff", colorDark: "#3730a3", pesRang: "5–25 kg" },
  preengreix: { key: "preengreix", label: "Pre-engreix", emoji: "🐖", color: "#f59e0b", bgLight: "#fffbeb", colorDark: "#92400e", pesRang: "25–50 kg" },
  engreix:    { key: "engreix",    label: "Engreix",     emoji: "🐷", color: "#10b981", bgLight: "#ecfdf5", colorDark: "#065f46", pesRang: "50–110 kg" }
};

function destiOptions(fase) {
  if (fase === "transicio") return [
    { value: "nouPreengreix", label: "Nou lot de pre-engreix" },
    { value: "nouEngreix",    label: "Nou lot d'engreix (directe)" },
    { value: "lot",           label: "Lot existent" },
    { value: "altre",         label: "Altre" },
  ];
  if (fase === "preengreix") return [
    { value: "nouEngreix",  label: "Nou lot d'engreix" },
    { value: "escorxador",  label: "Escorxador" },
    { value: "lot",         label: "Lot existent" },
    { value: "altre",       label: "Altre" },
  ];
  return [
    { value: "escorxador", label: "Escorxador" },
    { value: "lot",        label: "Lot existent" },
    { value: "altre",      label: "Altre" },
  ];
}
function defaultDesti(fase) {
  if (fase === "transicio")  return "nouPreengreix";
  if (fase === "preengreix") return "nouEngreix";
  return "escorxador";
}

// ── Supabase DB ────────────────────────────────────────────────────────────
async function carregarTot() {
  const [{ data: gDB }, { data: lDB }, { data: eDB }, { data: sDB }, { data: bDB }, { data: tDB }, { data: dDB }] = await Promise.all([
    supabase.from("granges").select("*"),
    supabase.from("lots").select("*"),
    supabase.from("entrades").select("*"),
    supabase.from("sortides").select("*"),
    supabase.from("baixes").select("*"),
    supabase.from("tractaments").select("*"),
    supabase.from("desmamats").select("*").order("created_at", { ascending: false }),
  ]);
  const result = { transicio: [], preengreix: [], engreix: [], desmamats: dDB || [] };
  for (const g of (gDB || [])) {
    const lots = (lDB || []).filter(l => l.granja_id === g.id).map(l => ({
      id: l.id, nom: l.nom, estat: l.estat,
      entrades:    (eDB || []).filter(e => e.lot_id === l.id).map(e => ({ id: e.id, data: e.data, caps: e.caps, pesKg: e.pes_kg, origen: e.origen })),
      sortides:    (sDB || []).filter(s => s.lot_id === l.id).map(s => ({ id: s.id, data: s.data, caps: s.caps, pesKg: s.pes_kg, tipusDesti: s.tipus_desti, desti: s.desti })),
      baixes:      (bDB || []).filter(b => b.lot_id === l.id).map(b => ({ id: b.id, data: b.data, caps: b.caps, causa: b.causa })),
      tractaments: (tDB || []).filter(t => t.lot_id === l.id).map(t => ({ id: t.id, data: t.data, medicament: t.medicament, recepta: t.recepta, identificacio: t.identificacio, caps: t.caps })),
    }));
    if (result[g.fase]) result[g.fase].push({ id: g.id, nom: g.nom, lots });
  }
  return result;
}

// ── CSV ────────────────────────────────────────────────────────────────────
function esc(v) { const s = String(v ?? ""); return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : "" + s; }
function rowCsv(arr) { return arr.map(esc).join(","); }
function buildCsv(data, filtres) {
  const { fases, estat, tipusRegistre } = filtres;
  const ok = l => estat === "tots" || (estat === "obert" && l.estat === "obert") || (estat === "tancat" && l.estat === "tancat");
  const lines = [];
  if (tipusRegistre.includes("resum")) {
    lines.push("=== RESUM DE LOTS ===");
    lines.push(rowCsv(["Fase", "Granja", "Lot", "Estat", "Data inici", "Dies", "Caps entrada", "Caps actuals", "Caps sortits", "Baixes", "% Mortalitat", "Pes entrada mig", "Pes sortida mig", "Guany/cap", "GMD"]));
    fases.forEach(f => data[f].forEach(g => g.lots.filter(ok).forEach(l => {
      const st = calcStats(l);
      const d0 = l.entrades.length > 0 ? l.entrades.reduce((m, e) => e.data < m ? e.data : m, l.entrades[0].data) : "";
      lines.push(rowCsv([FASES[f].label, g.nom, l.nom, l.estat === "obert" ? "Obert" : "Tancat", d0, st.die, st.tCE, st.cap, st.tCS, st.tB, st.pct + "%", st.pem, st.psm ?? "", st.gKg ?? "", st.gmd ?? ""]));
    })));
    lines.push("");
  }
  if (tipusRegistre.includes("entrades")) {
    lines.push("=== ENTRADES ===");
    lines.push(rowCsv(["Fase", "Granja", "Lot", "Estat", "Data", "Caps", "Pes total (kg)", "Pes mig (kg/cap)", "Origen"]));
    fases.forEach(f => data[f].forEach(g => g.lots.filter(ok).forEach(l => l.entrades.forEach(e => lines.push(rowCsv([FASES[f].label, g.nom, l.nom, l.estat === "obert" ? "Obert" : "Tancat", e.data, e.caps, e.pesKg, (e.pesKg / e.caps).toFixed(2), e.origen]))))));
    lines.push("");
  }
  if (tipusRegistre.includes("sortides")) {
    lines.push("=== SORTIDES ===");
    lines.push(rowCsv(["Fase", "Granja", "Lot", "Estat", "Data", "Caps", "Pes total (kg)", "Pes mig (kg/cap)", "Tipus destí", "Destí"]));
    fases.forEach(f => data[f].forEach(g => g.lots.filter(ok).forEach(l => l.sortides.forEach(s => lines.push(rowCsv([FASES[f].label, g.nom, l.nom, l.estat === "obert" ? "Obert" : "Tancat", s.data, s.caps, s.pesKg, (s.pesKg / s.caps).toFixed(2), s.tipusDesti, s.desti]))))));
    lines.push("");
  }
  if (tipusRegistre.includes("baixes")) {
    lines.push("=== BAIXES ===");
    lines.push(rowCsv(["Fase", "Granja", "Lot", "Estat", "Data", "Caps", "Causa", "% Mort acumulada"]));
    fases.forEach(f => data[f].forEach(g => g.lots.filter(ok).forEach(l => {
      const tCE = l.entrades.reduce((s, e) => s + e.caps, 0); let bAcum = 0;
      [...l.baixes].sort((a, b) => a.data.localeCompare(b.data)).forEach(b => {
        bAcum += b.caps;
        lines.push(rowCsv([FASES[f].label, g.nom, l.nom, l.estat === "obert" ? "Obert" : "Tancat", b.data, b.caps, b.causa, tCE > 0 ? ((bAcum / tCE) * 100).toFixed(1) + "%" : ""]));
      });
    })));
    lines.push("");
  }
  if (tipusRegistre.includes("tractaments")) {
    lines.push("=== TRACTAMENTS ===");
    lines.push(rowCsv(["Fase", "Granja", "Lot", "Estat", "Data", "Medicament", "Recepta", "Animals tractats", "Caps"]));
    fases.forEach(f => data[f].forEach(g => g.lots.filter(ok).forEach(l => (l.tractaments || []).forEach(t => lines.push(rowCsv([FASES[f].label, g.nom, l.nom, l.estat === "obert" ? "Obert" : "Tancat", t.data, t.medicament, t.recepta, t.identificacio, t.caps || ""]))))));
    lines.push("");
  }
  return "\uFEFF" + lines.join("\n");
}
function downloadCsv(csv, nom) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = nom; a.click(); URL.revokeObjectURL(url);
}

// ── Exportació ─────────────────────────────────────────────────────────────
function PantallaExportacio({ data }) {
  const [filtFases, setFiltFases] = useState(["transicio", "preengreix", "engreix"]);
  const [filtEstat, setFiltEstat] = useState("tots");
  const [filtTipus, setFiltTipus] = useState(["resum", "entrades", "sortides", "baixes", "tractaments"]);
  const [preview, setPreview] = useState(false);
  const toggleFase = f => setFiltFases(v => v.includes(f) ? v.filter(x => x !== f) : [...v, f]);
  const toggleTipus = t => setFiltTipus(v => v.includes(t) ? v.filter(x => x !== t) : [...v, t]);
  const ok = l => filtEstat === "tots" || (filtEstat === "obert" && l.estat === "obert") || (filtEstat === "tancat" && l.estat === "tancat");
  const nLots = filtFases.flatMap(f => data[f].flatMap(g => g.lots.filter(ok))).length;
  const nE = filtFases.flatMap(f => data[f].flatMap(g => g.lots.filter(ok).flatMap(l => l.entrades))).length;
  const nS = filtFases.flatMap(f => data[f].flatMap(g => g.lots.filter(ok).flatMap(l => l.sortides))).length;
  const nB = filtFases.flatMap(f => data[f].flatMap(g => g.lots.filter(ok).flatMap(l => l.baixes))).length;
  const nT = filtFases.flatMap(f => data[f].flatMap(g => g.lots.filter(ok).flatMap(l => l.tractaments || []))).length;
  const compt = { resum: nLots, entrades: nE, sortides: nS, baixes: nB, tractaments: nT };
  const csvStr = buildCsv(data, { fases: filtFases, estat: filtEstat, tipusRegistre: filtTipus });
  const lines = csvStr.split("\n").filter(l => l.trim());
  const pill = (actiu, color = "#1D9E75") => ({ border: `1.5px solid ${actiu ? color : "#e0e0e0"}`, borderRadius: 20, padding: "7px 14px", background: actiu ? `${color}18` : "transparent", color: actiu ? color : "#888", fontSize: 13, fontWeight: actiu ? 600 : 400, cursor: "pointer" });
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "16px 14px 100px" }}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Exportació</div>
      <div style={{ fontSize: 13, color: "#888", marginBottom: 20 }}>Filtra i descarrega el CSV compatible amb Excel i Google Sheets.</div>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Fase</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {Object.values(FASES).map(f => <button key={f.key} onClick={() => toggleFase(f.key)} style={pill(filtFases.includes(f.key), f.color)}>{f.emoji} {f.label}</button>)}
        </div>
      </div>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Estat del lot</div>
        <div style={{ display: "flex", gap: 8 }}>
          {[["tots", "Tots"], ["obert", "Oberts"], ["tancat", "Tancats"]].map(([k, lbl]) => <button key={k} onClick={() => setFiltEstat(k)} style={pill(filtEstat === k)}>{lbl}</button>)}
        </div>
      </div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Tipus de registre</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {[["resum", "📋 Resum lots"], ["entrades", "📥 Entrades"], ["sortides", "📤 Sortides"], ["baixes", "💀 Baixes"], ["tractaments", "💊 Tractaments"]].map(([k, lbl]) => (
            <button key={k} onClick={() => toggleTipus(k)} style={{ ...pill(filtTipus.includes(k)), display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
              <span>{lbl}</span>
              <span style={{ fontSize: 11, background: filtTipus.includes(k) ? "rgba(29,158,117,0.15)" : "#f5f5f5", borderRadius: 10, padding: "1px 7px", color: filtTipus.includes(k) ? "#1D9E75" : "#aaa" }}>{compt[k]}</span>
            </button>
          ))}
        </div>
      </div>
      <button onClick={() => setPreview(v => !v)} style={{ width: "100%", padding: "11px", border: "1.5px solid #ddd", borderRadius: 12, background: "transparent", fontSize: 13, color: "#555", cursor: "pointer", marginBottom: 10 }}>
        {preview ? "▲ Amagar previsualització" : "▼ Previsualitzar dades"}
      </button>
      {preview && <div style={{ background: "#1e293b", borderRadius: 12, padding: "12px", marginBottom: 14, overflowX: "auto" }}><pre style={{ fontSize: 10, color: "rgba(255,255,255,0.7)", margin: 0, whiteSpace: "pre", fontFamily: "monospace" }}>{lines.slice(0, 40).join("\n")}{lines.length > 40 ? "\n... i " + (lines.length - 40) + " línies més" : ""}</pre></div>}
      <button onClick={() => downloadCsv(csvStr, "granges_" + TODAY + ".csv")} disabled={filtFases.length === 0 || filtTipus.length === 0}
        style={{ width: "100%", padding: "16px", background: filtFases.length > 0 && filtTipus.length > 0 ? "#1D9E75" : "#ccc", border: "none", borderRadius: 14, fontSize: 16, fontWeight: 700, color: "#fff", cursor: "pointer", marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
        <span style={{ fontSize: 20 }}>⬇️</span> Descarregar CSV
      </button>
      <div style={{ background: "#EEF4FF", borderRadius: 12, padding: "12px 14px", fontSize: 12, color: "#555", lineHeight: 1.5 }}>
        <div style={{ fontWeight: 600, marginBottom: 4, color: "#1A4DB0" }}>💡 Com obrir-ho a Excel o Google Sheets</div>
        <div>1. Toca "Descarregar CSV"</div>
        <div>2. Obre amb Excel o puja a Google Drive → Sheets</div>
      </div>
    </div>
  );
}

// ── Calculadora pesada ─────────────────────────────────────────────────────
const PESADA_KEY = "pesada_draft";
function CalculadoraPesada({ onConfirm, onCancel, capsTotal }) {
  const [viatges, setViatges] = useState(() => {
    try { const s = JSON.parse(localStorage.getItem(PESADA_KEY)); if (s?.viatges?.length) return s.viatges; } catch {}
    return [{ id: 1, brut: "", tara: "", caps: "" }];
  });
  const [modePes, setModePes] = useState(() => {
    try { const s = JSON.parse(localStorage.getItem(PESADA_KEY)); if (s?.modePes) return s.modePes; } catch {}
    return "viatge";
  });
  const [capsPerMostra, setCapsPerMostra] = useState(() => {
    try { const s = JSON.parse(localStorage.getItem(PESADA_KEY)); if (s?.capsPerMostra) return s.capsPerMostra; } catch {}
    return capsTotal ? String(capsTotal) : "";
  });
  const [recuperat, setRecuperat] = useState(() => {
    try { const s = JSON.parse(localStorage.getItem(PESADA_KEY)); return !!(s?.viatges?.length && s.viatges.some(v => v.brut)); } catch {}
    return false;
  });

  useEffect(() => {
    localStorage.setItem(PESADA_KEY, JSON.stringify({ viatges, modePes, capsPerMostra }));
  }, [viatges, modePes, capsPerMostra]);

  const neteja = () => localStorage.removeItem(PESADA_KEY);
  const addV = () => setViatges(v => [...v, { id: Date.now(), brut: "", tara: "", caps: "" }]);
  const updV = (id, k, val) => setViatges(v => v.map(x => x.id !== id ? x : { ...x, [k]: val }));
  const delV = id => setViatges(v => v.filter(x => x.id !== id));
  const valids = viatges.filter(v => parseFloat(v.brut) > 0);
  const pesNet = valids.reduce((s, v) => s + (parseFloat(v.brut) - (parseFloat(v.tara) || 0)), 0);
  const capsPesats = valids.reduce((s, v) => s + (parseInt(v.caps) || 0), 0);
  const pesMig = capsPesats > 0 ? pesNet / capsPesats : 0;
  const capsExt = parseInt(capsPerMostra) || 0;
  const pesExt = modePes === "mostra" && pesMig > 0 && capsExt > 0 ? pesMig * capsExt : null;
  const pesFinal = modePes === "mostra" && pesExt ? pesExt : pesNet;
  const capsFinals = modePes === "mostra" ? capsExt : (capsPesats > 0 ? capsPesats : (capsTotal || 0));
  const inp = { width: "100%", padding: "12px 10px", border: "1.5px solid var(--modal-border)", borderRadius: 10, fontSize: 15, background: "var(--modal-surface)", color: "#fff", boxSizing: "border-box" };
  const lbl = { fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.6)", display: "block", marginBottom: 4 };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, display: "flex", flexDirection: "column", justifyContent: "flex-end", background: "rgba(0,0,0,0.75)" }}>
      <div style={{ background: "#1a1a2e", borderRadius: "20px 20px 0 0", padding: "20px 16px 32px", maxHeight: "92vh", overflowY: "auto" }}>
        <div style={{ width: 40, height: 4, background: "rgba(255,255,255,0.3)", borderRadius: 2, margin: "0 auto 14px" }} />
        <div style={{ fontSize: 19, fontWeight: 700, color: "#fff", marginBottom: 4 }}>⚖️ Calculadora de pesada</div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", marginBottom: recuperat ? 8 : 14 }}>Anota cada viatge. El pes net es calcula sol.</div>
        {recuperat && (
          <div style={{ background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.4)", borderRadius: 10, padding: "10px 14px", marginBottom: 14, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 18 }}>🔄</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#f59e0b" }}>Pesada recuperada</div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>S'han recuperat els viatges anteriors.</div>
            </div>
            <button onClick={() => { setViatges([{ id: Date.now(), brut: "", tara: "", caps: "" }]); setRecuperat(false); }} style={{ marginLeft: "auto", border: "none", background: "transparent", color: "rgba(255,255,255,0.4)", fontSize: 12, cursor: "pointer", padding: "4px 8px" }}>Descartar</button>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {[["viatge", "Pesada completa"], ["mostra", "Per mostreig"]].map(([k, t]) => (
            <button key={k} onClick={() => setModePes(k)} style={{ flex: 1, padding: "10px", border: `1.5px solid ${modePes === k ? "#1D9E75" : "#444"}`, borderRadius: 12, background: modePes === k ? "rgba(29,158,117,0.2)" : "transparent", color: modePes === k ? "#1D9E75" : "rgba(255,255,255,0.5)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{t}</button>
          ))}
        </div>
        {viatges.map((v, i) => (
          <div key={v.id} style={{ background: "rgba(255,255,255,0.05)", borderRadius: 14, padding: "12px", marginBottom: 10, border: "1px solid #333" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.8)" }}>Viatge {i + 1}</span>
              {viatges.length > 1 && <button onClick={() => delV(v.id)} style={{ border: "none", background: "transparent", color: "#E24B4A", fontSize: 20, cursor: "pointer" }}>×</button>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              <div><label style={lbl}>Pes brut (kg)</label><input type="number" inputMode="decimal" placeholder="Ex: 2450" value={v.brut} onChange={e => updV(v.id, "brut", e.target.value)} style={inp} /></div>
              <div><label style={lbl}>Tara (kg)</label><input type="number" inputMode="decimal" placeholder="Ex: 1800" value={v.tara} onChange={e => updV(v.id, "tara", e.target.value)} style={inp} /></div>
            </div>
            <div><label style={lbl}>{modePes === "mostra" ? "Animals mostrejats" : "Caps en aquest viatge"}</label><input type="number" inputMode="numeric" placeholder="Nombre de caps" value={v.caps} onChange={e => updV(v.id, "caps", e.target.value)} style={inp} /></div>
            {parseFloat(v.brut) > 0 && <div style={{ marginTop: 8, fontSize: 13, color: "#1D9E75", fontWeight: 600 }}>Net: {(parseFloat(v.brut) - (parseFloat(v.tara) || 0)).toFixed(0)} kg{parseInt(v.caps) > 0 && <span style={{ color: "rgba(255,255,255,0.45)", fontWeight: 400 }}> · {((parseFloat(v.brut) - (parseFloat(v.tara) || 0)) / parseInt(v.caps)).toFixed(1)} kg/cap</span>}</div>}
          </div>
        ))}
        <button onClick={addV} style={{ width: "100%", padding: "12px", border: "1.5px dashed #444", borderRadius: 12, background: "transparent", color: "rgba(255,255,255,0.5)", fontSize: 14, cursor: "pointer", marginBottom: 14 }}>+ Afegir viatge</button>
        {modePes === "mostra" && (
          <div style={{ background: "rgba(29,158,117,0.1)", border: "1px solid rgba(29,158,117,0.3)", borderRadius: 12, padding: "12px 14px", marginBottom: 14 }}>
            <div style={{ fontSize: 13, color: "#a0f0d0", fontWeight: 600, marginBottom: 8 }}>Extrapolació per mostreig</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", marginBottom: 10 }}>Pes mig: <strong style={{ color: "#1D9E75" }}>{pesMig > 0 ? pesMig.toFixed(2) + " kg/cap" : "—"}</strong></div>
            <label style={lbl}>Caps totals reals del lot</label>
            <input type="number" inputMode="numeric" value={capsPerMostra} onChange={e => setCapsPerMostra(e.target.value)} placeholder={capsTotal ? "Ex: " + capsTotal : "Caps totals"} style={inp} />
            {pesExt && <div style={{ marginTop: 8, fontSize: 13, color: "#a0f0d0" }}>Pes extrapol·lat: <strong>{pesExt.toFixed(0)} kg</strong></div>}
          </div>
        )}
        {pesNet > 0 && (
          <div style={{ background: "rgba(29,158,117,0.15)", border: "1px solid rgba(29,158,117,0.4)", borderRadius: 14, padding: "14px", marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.5)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Resultat final</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, textAlign: "center" }}>
              <div><div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginBottom: 3 }}>Pes net total</div><div style={{ fontSize: 17, fontWeight: 700, color: "#1D9E75" }}>{pesFinal.toFixed(0)} kg</div></div>
              <div><div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginBottom: 3 }}>Caps</div><div style={{ fontSize: 17, fontWeight: 700, color: "#fff" }}>{capsFinals || "—"}</div></div>
              <div><div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginBottom: 3 }}>Pes mig</div><div style={{ fontSize: 17, fontWeight: 700, color: "#fff" }}>{capsFinals > 0 ? (pesFinal / capsFinals).toFixed(1) : "—"} kg</div></div>
            </div>
          </div>
        )}
        <button onClick={() => { if (!pesNet) return; neteja(); onConfirm({ pesKg: pesFinal.toFixed(0), caps: capsFinals || "" }); }} style={{ width: "100%", padding: "15px", background: "#1D9E75", border: "none", borderRadius: 14, fontSize: 16, fontWeight: 600, color: "#fff", cursor: "pointer", marginBottom: 10, opacity: pesNet > 0 ? 1 : 0.4 }}>Usar aquests valors</button>
        <button onClick={() => { neteja(); onCancel(); }} style={{ width: "100%", padding: "13px", background: "transparent", border: "none", fontSize: 15, color: "rgba(255,255,255,0.5)", cursor: "pointer" }}>Cancel·lar</button>
      </div>
    </div>
  );
}

// ── Modal formulari ────────────────────────────────────────────────────────
function ModalForm({ title, fields, onConfirm, onCancel, confirmLabel, confirmColor, extraContent, capsActuals }) {
  const [vals, setVals] = useState(() => { const i = {}; fields.forEach(f => { i[f.key] = f.default || ""; }); return i; });
  const [mostraPesada, setMostraPesada] = useState(false);
  const ambPes = fields.some(f => f.key === "pesKg");
  return (<>
    {mostraPesada && <CalculadoraPesada capsTotal={parseInt(vals.caps) || capsActuals || 0} onCancel={() => setMostraPesada(false)} onConfirm={({ pesKg, caps }) => { setVals(v => ({ ...v, pesKg, ...(caps ? { caps } : {}) })); setMostraPesada(false); }} />}
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", flexDirection: "column", justifyContent: "flex-end", background: "rgba(0,0,0,0.75)" }}>
      <div style={{ background: "#1e293b", borderRadius: "20px 20px 0 0", padding: "20px 16px 32px", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ width: 40, height: 4, background: "rgba(255,255,255,0.3)", borderRadius: 2, margin: "0 auto 16px" }} />
        <div style={{ fontSize: 19, fontWeight: 700, marginBottom: 16, color: "#fff" }}>{title}</div>
        {ambPes && (
          <button onClick={() => setMostraPesada(true)} style={{ width: "100%", padding: "14px", border: "2px solid #1D9E75", borderRadius: 14, background: "rgba(29,158,117,0.2)", color: "#1D9E75", fontSize: 15, fontWeight: 700, cursor: "pointer", marginBottom: 18, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
            <span style={{ fontSize: 22 }}>⚖️</span> Calculadora de pesada
          </button>
        )}
        {fields.map(f => (
          <div key={f.key} style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 15, fontWeight: 600, color: "#fff", display: "block", marginBottom: 7 }}>{f.label}</label>
            {f.type === "select"
              ? <select value={vals[f.key]} onChange={e => setVals(v => ({ ...v, [f.key]: e.target.value }))} style={{ width: "100%", padding: "13px 12px", border: "1.5px solid var(--modal-border)", borderRadius: 12, fontSize: 15, background: "var(--modal-surface)", color: "#fff", boxSizing: "border-box" }}>{f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
              : <input type={f.type} value={vals[f.key]} placeholder={f.placeholder || ""} inputMode={f.inputMode} onChange={e => setVals(v => ({ ...v, [f.key]: e.target.value }))} style={{ width: "100%", padding: "13px 12px", border: "1.5px solid var(--modal-border)", borderRadius: 12, fontSize: 15, background: "var(--modal-surface)", color: "#fff", boxSizing: "border-box" }} />
            }
          </div>
        ))}
        {extraContent && extraContent(vals, setVals)}
        {ambPes && vals.pesKg && vals.caps && (
          <div style={{ background: "rgba(29,158,117,0.12)", border: "1px solid rgba(29,158,117,0.25)", borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 13, color: "#a0f0d0" }}>
            Pes mig: <strong>{(parseFloat(vals.pesKg) / parseInt(vals.caps)).toFixed(1)} kg/cap</strong>
          </div>
        )}
        <button onClick={() => onConfirm(vals)} style={{ width: "100%", padding: "15px", background: confirmColor || "#1D9E75", border: "none", borderRadius: 14, fontSize: 16, fontWeight: 600, color: "#fff", cursor: "pointer", marginTop: 6 }}>{confirmLabel}</button>
        <button onClick={onCancel} style={{ width: "100%", padding: "14px", background: "transparent", border: "none", fontSize: 15, color: "rgba(255,255,255,0.6)", cursor: "pointer", marginTop: 8 }}>Cancel·lar</button>
      </div>
    </div>
  </>);
}

// ── Alertes ────────────────────────────────────────────────────────────────
function PantallaAlertes({ data, onLotClick, dismissed, onDismiss }) {
  const totes = Object.entries(data).filter(([f]) => f !== "desmamats").flatMap(([f, gs]) => gs.flatMap(g => g.lots.flatMap(l => detectarAlertes(l, g.nom, f))));
  const noves = totes.filter(a => !dismissed.has(`${a.fase}-${a.granja}-${a.lot}-${a.regla}`));
  return (
    <div style={{ padding: "16px 12px", overflowY: "auto", flex: 1 }}>
      <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Alertes</div>
      <div style={{ fontSize: 13, color: "#888", marginBottom: 16 }}>{noves.length === 0 ? "Tot correcte" : "Lots que requereixen atenció"}</div>
      {noves.length === 0 && <div style={{ textAlign: "center", padding: "48px 0", color: "#aaa" }}><div style={{ fontSize: 48, marginBottom: 12 }}>✅</div><div style={{ fontSize: 15 }}>Cap alerta activa</div></div>}
      {noves.map((a, i) => {
        const crit = a.nivell === "alerta";
        return (
          <div key={i} style={{ background: crit ? "#FCEBEB" : "#FAEEDA", border: `1px solid ${crit ? "#F7C1C1" : "#FAC775"}`, borderRadius: 14, padding: "14px", marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 18 }}>{crit ? "🔴" : "🟡"}</span>
                  <span style={{ fontWeight: 600, fontSize: 14, color: crit ? "#A32D2D" : "#633806" }}>{a.lot}</span>
                  <span style={{ fontSize: 11, background: "rgba(0,0,0,0.08)", borderRadius: 6, padding: "1px 7px" }}>{FASES[a.fase].label}</span>
                </div>
                <div style={{ fontSize: 13, color: "#555", marginBottom: 2 }}>📍 {a.granja}</div>
                <div style={{ fontSize: 14, fontWeight: 500, color: crit ? "#A32D2D" : "#633806", marginBottom: 3 }}>{a.msg}</div>
                <div style={{ fontSize: 12, color: "#777" }}>{a.detall}</div>
              </div>
              <button onClick={() => onDismiss(a)} style={{ border: "none", background: "transparent", fontSize: 20, color: "#aaa", cursor: "pointer", padding: "0 0 0 8px" }}>×</button>
            </div>
            <button onClick={() => onLotClick(a)} style={{ marginTop: 10, width: "100%", padding: "9px", border: `1px solid ${crit ? "#F7C1C1" : "#FAC775"}`, borderRadius: 10, background: "transparent", fontSize: 13, fontWeight: 500, color: crit ? "#A32D2D" : "#633806", cursor: "pointer" }}>Veure lot →</button>
          </div>
        );
      })}
    </div>
  );
}

// ── Login ──────────────────────────────────────────────────────────────────
function PantallaLogin({ onLogin }) {
  const [usuari, setUsuari] = useState("");
  const [contrasenya, setContrasenya] = useState("");
  const [error, setError] = useState(false);
  const [mostrar, setMostrar] = useState(false);
  const handleLogin = () => {
    if (usuari === "admin" && contrasenya === "admin1234") { onLogin(); }
    else { setError(true); setTimeout(() => setError(false), 2500); }
  };
  const inp = { width: "100%", padding: "14px 12px", border: "1.5px solid #e2e8f0", borderRadius: 12, fontSize: 16, background: "#fff", color: "#0f172a", boxSizing: "border-box", outline: "none", fontFamily: "var(--font-sans)" };
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)", padding: "0 24px", fontFamily: "var(--font-sans)" }}>
      <div style={{ width: "100%", maxWidth: 360, background: "#fff", borderRadius: 24, padding: "40px 32px", boxShadow: "0 24px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🐷</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>Control de Granges</div>
          <div style={{ fontSize: 13, color: "#94a3b8" }}>Inicia sessió per continuar</div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: "#475569", display: "block", marginBottom: 6 }}>Usuari</label>
          <input type="text" value={usuari} onChange={e => { setUsuari(e.target.value); setError(false); }} placeholder="Usuari" autoCapitalize="none" style={inp} />
        </div>
        <div style={{ marginBottom: 24 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: "#475569", display: "block", marginBottom: 6 }}>Contrasenya</label>
          <div style={{ position: "relative" }}>
            <input type={mostrar ? "text" : "password"} value={contrasenya} onChange={e => { setContrasenya(e.target.value); setError(false); }} onKeyDown={e => e.key === "Enter" && handleLogin()} placeholder="Contrasenya" style={{ ...inp, paddingRight: 48 }} />
            <button onClick={() => setMostrar(v => !v)} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", border: "none", background: "transparent", color: "#94a3b8", fontSize: 18, cursor: "pointer", padding: 0 }}>{mostrar ? "🙈" : "👁️"}</button>
          </div>
        </div>
        {error && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#dc2626", marginBottom: 16, textAlign: "center" }}>Usuari o contrasenya incorrectes</div>}
        <button onClick={handleLogin} style={{ width: "100%", padding: "15px", background: "#10b981", border: "none", borderRadius: 14, fontSize: 16, fontWeight: 700, color: "#fff", cursor: "pointer", letterSpacing: "0.02em" }}>Entrar</button>
      </div>
    </div>
  );
}

// ── Desmamats ──────────────────────────────────────────────────────────────
function PantallaDesmamats({ registres, grangesTransicio, onGuardar, onCrearLot, toast }) {
  const fc = FASES.desmamats;
  const [vista, setVista] = useState("llista");
  const [seleccionat, setSeleccionat] = useState(null);
  const [granja, setGranja] = useState("");
  const [dataDes, setDataDes] = useState(TODAY);
  const [truges, setTruges] = useState([{ id: 1, garrins: "" }]);
  const [nomLot, setNomLot] = useState("");
  const [granjaDestiId, setGranjaDestiId] = useState("");
  const [pesDes, setPesDes] = useState("");
  const [desantLot, setDesantLot] = useState(false);
  const [desant, setDesant] = useState(false);
  const [mostraPesada, setMostraPesada] = useState(false);

  const totalTruges = truges.filter(t => parseInt(t.garrins) > 0).length;
  const totalGarrins = truges.reduce((s, t) => s + (parseInt(t.garrins) || 0), 0);
  const mittana = totalTruges > 0 ? (totalGarrins / totalTruges).toFixed(1) : "—";

  const resetNou = () => { setGranja(""); setDataDes(TODAY); setTruges([{ id: 1, garrins: "" }]); };
  const afegirTruja = () => setTruges(v => [...v, { id: Date.now(), garrins: "" }]);
  const updTruja = (id, val) => setTruges(v => v.map(t => t.id !== id ? t : { ...t, garrins: val }));
  const elimTruja = id => setTruges(v => v.length > 1 ? v.filter(t => t.id !== id) : v);

  const guardar = async () => {
    if (!granja) { toast("Indica la granja", "avis"); return; }
    if (totalGarrins === 0) { toast("Afegeix almenys un garri", "avis"); return; }
    setDesant(true);
    await onGuardar({ granja, data: dataDes, garrins: truges.map(t => parseInt(t.garrins) || 0) });
    setDesant(false);
    setVista("llista");
    resetNou();
  };

  const inp = { width: "100%", padding: "12px", border: "1.5px solid #e2e8f0", borderRadius: 12, fontSize: 15, background: "#fff", color: "#0f172a", boxSizing: "border-box" };

  if (vista === "nou") return (
    <div style={{ flex: 1, overflowY: "auto", paddingBottom: 100 }}>
      <div style={{ padding: "12px 16px 8px" }}>
        <button onClick={() => { setVista("llista"); resetNou(); }} style={{ border: "none", background: "transparent", fontSize: 13, color: fc.color, padding: "0 0 6px", cursor: "pointer" }}>← Enrere</button>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Nova desmamada</div>
        <div style={{ fontSize: 13, color: "#888", marginBottom: 16 }}>Anota els garrins per cada truja desmamada.</div>
      </div>
      <div style={{ padding: "0 16px" }}>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: "#475569", display: "block", marginBottom: 6 }}>Data</label>
          <input type="date" value={dataDes} onChange={e => setDataDes(e.target.value)} style={inp} />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: "#475569", display: "block", marginBottom: 6 }}>Granja</label>
          <input type="text" value={granja} onChange={e => setGranja(e.target.value)} placeholder="Ex: Granja Can Puig" style={inp} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: "#475569" }}>Truges desmamades</label>
            <span style={{ fontSize: 12, color: "#888" }}>{truges.length} truges</span>
          </div>
          {truges.map((t, i) => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: "#aaa", minWidth: 22, textAlign: "right" }}>{i + 1}.</span>
              <input type="number" inputMode="numeric" min="0" value={t.garrins} onChange={e => updTruja(t.id, e.target.value)} placeholder="Garrins" style={{ ...inp, flex: 1 }} />
              <span style={{ fontSize: 12, color: "#888", whiteSpace: "nowrap" }}>gar.</span>
              <button onClick={() => elimTruja(t.id)} style={{ border: "none", background: "transparent", color: "#ddd", fontSize: 22, cursor: "pointer", padding: "0 2px", lineHeight: 1 }}>×</button>
            </div>
          ))}
          <button onClick={afegirTruja} style={{ width: "100%", padding: "12px", border: "1.5px dashed #e2e8f0", borderRadius: 12, background: "transparent", fontSize: 14, color: "#888", cursor: "pointer", marginTop: 4 }}>+ Afegir truja</button>
        </div>
        {totalGarrins > 0 && (
          <div style={{ background: fc.bgLight, border: `1px solid ${fc.color}44`, borderRadius: 14, padding: "16px", marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: fc.colorDark, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>Resum actual</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, textAlign: "center" }}>
              <div><div style={{ fontSize: 11, color: "#888", marginBottom: 3 }}>Truges</div><div style={{ fontSize: 22, fontWeight: 700, color: fc.colorDark }}>{totalTruges}</div></div>
              <div><div style={{ fontSize: 11, color: "#888", marginBottom: 3 }}>Garrins</div><div style={{ fontSize: 22, fontWeight: 700, color: fc.colorDark }}>{totalGarrins}</div></div>
              <div><div style={{ fontSize: 11, color: "#888", marginBottom: 3 }}>Mitj./truja</div><div style={{ fontSize: 22, fontWeight: 700, color: fc.colorDark }}>{mittana}</div></div>
            </div>
          </div>
        )}
        <button onClick={guardar} disabled={desant} style={{ width: "100%", padding: "15px", background: fc.color, border: "none", borderRadius: 14, fontSize: 16, fontWeight: 600, color: "#fff", cursor: "pointer", opacity: desant ? 0.6 : 1, marginBottom: 10 }}>
          {desant ? "Guardant..." : "Guardar desmamada"}
        </button>
        <button onClick={() => { setVista("llista"); resetNou(); }} style={{ width: "100%", padding: "13px", background: "transparent", border: "none", fontSize: 15, color: "#888", cursor: "pointer" }}>Cancel·lar</button>
      </div>
    </div>
  );

  if (vista === "detall" && seleccionat) {
    const rec = registres.find(r => r.id === seleccionat);
    if (!rec) { setVista("llista"); return null; }
    const garArr = Array.isArray(rec.garrins) ? rec.garrins : [];
    const tT = garArr.filter(g => g > 0).length;
    const tG = garArr.reduce((s, g) => s + (g || 0), 0);
    const mit = tT > 0 ? (tG / tT).toFixed(1) : "—";
    return (<>
      <div style={{ flex: 1, overflowY: "auto", paddingBottom: 80 }}>
        <div style={{ padding: "12px 16px 8px" }}>
          <button onClick={() => { setVista("llista"); setDesantLot(false); }} style={{ border: "none", background: "transparent", fontSize: 13, color: fc.color, padding: "0 0 6px", cursor: "pointer" }}>← Desmamats</button>
          <div style={{ fontSize: 20, fontWeight: 700 }}>Desmamada</div>
          <div style={{ fontSize: 13, color: "#888" }}>{rec.granja} · {rec.data}</div>
        </div>
        <div style={{ padding: "0 16px" }}>
          <div style={{ background: fc.bgLight, border: `1px solid ${fc.color}44`, borderRadius: 14, padding: "16px", marginBottom: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, textAlign: "center" }}>
              <div><div style={{ fontSize: 11, color: "#888", marginBottom: 3 }}>Truges</div><div style={{ fontSize: 24, fontWeight: 700, color: fc.colorDark }}>{tT}</div></div>
              <div><div style={{ fontSize: 11, color: "#888", marginBottom: 3 }}>Garrins</div><div style={{ fontSize: 24, fontWeight: 700, color: fc.colorDark }}>{tG}</div></div>
              <div><div style={{ fontSize: 11, color: "#888", marginBottom: 3 }}>Mitj./truja</div><div style={{ fontSize: 24, fontWeight: 700, color: fc.colorDark }}>{mit}</div></div>
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#475569", marginBottom: 10 }}>Detall per truja</div>
            {garArr.map((g, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "#fff", borderRadius: 10, marginBottom: 6, border: "1px solid #f0f0f0" }}>
                <span style={{ fontSize: 13, color: "#888" }}>Truja {i + 1}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: g > 0 ? fc.colorDark : "#ccc" }}>{g > 0 ? g + " garrins" : "—"}</span>
              </div>
            ))}
          </div>
          {rec.lot_id ? (
            <div style={{ background: "#ecfdf5", border: "1px solid #6ee7b7", borderRadius: 14, padding: "16px", textAlign: "center" }}>
              <div style={{ fontSize: 20, marginBottom: 6 }}>✅</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#065f46" }}>Lot de Transició ja creat</div>
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>Aquests garrins ja estan assignats a un lot de transició.</div>
            </div>
          ) : !desantLot ? (
            <button onClick={() => { setNomLot("LT" + rec.data.slice(8,10) + rec.data.slice(5,7) + rec.data.slice(2,4) + "S"); setGranjaDestiId(""); setPesDes(""); setDesantLot(true); }} style={{ width: "100%", padding: "15px", background: FASES.transicio.color, border: "none", borderRadius: 14, fontSize: 15, fontWeight: 600, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
              <span style={{ fontSize: 20 }}>{FASES.transicio.emoji}</span> Crear lot de Transició
            </button>
          ) : (
            <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 14, padding: "16px" }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14, color: FASES.transicio.colorDark }}>{FASES.transicio.emoji} Crear lot de Transició</div>
              <div style={{ background: FASES.transicio.bgLight, borderRadius: 12, padding: "12px 14px", marginBottom: 16, textAlign: "center" }}>
                <div style={{ fontSize: 12, color: "#888", marginBottom: 2 }}>Caps a assignar</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: FASES.transicio.colorDark }}>{tG}</div>
                <div style={{ fontSize: 12, color: "#888" }}>garrins</div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: "#475569", display: "block", marginBottom: 6 }}>Nom del lot</label>
                <input type="text" value={nomLot} onChange={e => setNomLot(e.target.value)} style={inp} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: "#475569", display: "block", marginBottom: 6 }}>Granja de destí (Transició)</label>
                <select value={granjaDestiId} onChange={e => setGranjaDestiId(e.target.value)} style={{ ...inp }}>
                  <option value="">— Selecciona una granja —</option>
                  {grangesTransicio.map(g => <option key={g.id} value={g.id}>{g.nom}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: "#475569", display: "block", marginBottom: 6 }}>Pes total entrada (kg) — opcional</label>
                <button onClick={() => setMostraPesada(true)} style={{ width: "100%", padding: "13px", border: "2px solid #1D9E75", borderRadius: 12, background: "rgba(29,158,117,0.08)", color: "#1D9E75", fontSize: 14, fontWeight: 700, cursor: "pointer", marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <span style={{ fontSize: 18 }}>⚖️</span> Calculadora de pesada
                </button>
                <input type="number" inputMode="decimal" value={pesDes} onChange={e => setPesDes(e.target.value)} placeholder="O escriu el pes directament (kg)" style={inp} />
                {pesDes && tG > 0 && <div style={{ fontSize: 12, color: "#1D9E75", marginTop: 4, fontWeight: 600 }}>Pes mig: {(parseFloat(pesDes) / tG).toFixed(1)} kg/garri</div>}
              </div>
              <button onClick={async () => {
                if (!nomLot || !granjaDestiId) { toast("Omple el nom i la granja", "avis"); return; }
                await onCrearLot({ desmamatsId: rec.id, nomLot, granjaDestiId, totalGarrins: tG, data: rec.data, pesKg: pesDes || "0" });
                setDesantLot(false);
                setVista("llista");
              }} style={{ width: "100%", padding: "15px", background: FASES.transicio.color, border: "none", borderRadius: 14, fontSize: 15, fontWeight: 600, color: "#fff", cursor: "pointer", marginBottom: 10 }}>
                Crear lot 🐣
              </button>
              <button onClick={() => setDesantLot(false)} style={{ width: "100%", padding: "13px", background: "transparent", border: "none", fontSize: 14, color: "#888", cursor: "pointer" }}>Enrere</button>
            </div>
          )}
        </div>
      </div>
      {mostraPesada && <CalculadoraPesada capsTotal={tG} onCancel={() => setMostraPesada(false)} onConfirm={({ pesKg }) => { setPesDes(pesKg); setMostraPesada(false); }} />}
    </>);
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", paddingBottom: 80 }}>
      <div style={{ padding: "12px 16px 8px" }}>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 2 }}>Desmamats</div>
        <div style={{ fontSize: 13, color: "#888", marginBottom: 16 }}>Registres de garrins per truja</div>
      </div>
      <div style={{ padding: "0 12px" }}>
        {registres.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px 0", color: "#aaa" }}>
            <div style={{ fontSize: 48, marginBottom: 10 }}>🍼</div>
            <div style={{ fontSize: 15 }}>Cap registre de desmamats</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>Toca el botó per afegir el primer</div>
          </div>
        )}
        {registres.map(r => {
          const garArr = Array.isArray(r.garrins) ? r.garrins : [];
          const tT = garArr.filter(g => g > 0).length;
          const tG = garArr.reduce((s, g) => s + (g || 0), 0);
          const mit = tT > 0 ? (tG / tT).toFixed(1) : "—";
          return (
            <div key={r.id} onClick={() => { setSeleccionat(r.id); setDesantLot(false); setVista("detall"); }} style={{ background: "#fff", borderRadius: 16, padding: "16px", marginBottom: 10, cursor: "pointer", border: `1.5px solid ${r.lot_id ? "#6ee7b7" : "transparent"}`, boxShadow: "var(--shadow-sm)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{r.granja}</div>
                {r.lot_id && <span style={{ fontSize: 11, background: "#ecfdf5", color: "#065f46", borderRadius: 8, padding: "2px 8px", fontWeight: 600 }}>✓ Lot creat</span>}
              </div>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>{r.data}</div>
              <div style={{ display: "flex", gap: 16, fontSize: 13 }}>
                <span style={{ color: fc.colorDark, fontWeight: 600 }}>{tT} truges</span>
                <span style={{ color: fc.colorDark, fontWeight: 600 }}>{tG} garrins</span>
                <span style={{ color: "#888" }}>{mit}/truja</span>
              </div>
            </div>
          );
        })}
        <button onClick={() => { resetNou(); setVista("nou"); }} style={{ width: "100%", padding: "14px", background: "#fff", border: `1.5px dashed ${fc.color}`, borderRadius: 14, fontSize: 15, fontWeight: 600, color: fc.colorDark, cursor: "pointer" }}>
          + Nova desmamada
        </button>
      </div>
    </div>
  );
}

// ── App ────────────────────────────────────────────────────────────────────
export default function App() {
  const [logat, setLogat] = useState(false);
  if (!logat) return <PantallaLogin onLogin={() => setLogat(true)} />;
  return <AppInterna />;
}

function ModalEliminar({ item, onConfirm, onCancel }) {
  const [usr, setUsr] = useState("");
  const [pwd, setPwd] = useState("");
  const [error, setError] = useState(false);
  const tipusLabel = item.tipus === "granja" ? "granja" : "lot";

  const confirmar = () => {
    if (usr === "admin" && pwd === "admin1234") {
      onConfirm();
    } else {
      setError(true);
      setTimeout(() => setError(false), 2000);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 250, display: "flex", flexDirection: "column", justifyContent: "flex-end", background: "rgba(0,0,0,0.7)" }}>
      <div style={{ background: "#1e293b", borderRadius: "20px 20px 0 0", padding: "24px 16px 32px" }}>
        <div style={{ width: 40, height: 4, background: "rgba(255,255,255,0.3)", borderRadius: 2, margin: "0 auto 20px" }} />
        <div style={{ fontSize: 22, marginBottom: 6, textAlign: "center" }}>🗑️</div>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6, color: "#fff", textAlign: "center" }}>Eliminar {tipusLabel}</div>
        <div style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", marginBottom: 4, textAlign: "center" }}>«{item.nom}»</div>
        <div style={{ fontSize: 13, color: "#E24B4A", marginBottom: 20, textAlign: "center" }}>Aquesta acció és permanent i no es pot desfer.</div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", display: "block", marginBottom: 6 }}>Usuari</label>
          <input value={usr} onChange={e => setUsr(e.target.value)} placeholder="Escriu l'usuari" autoComplete="off" style={{ width: "100%", padding: "13px 12px", border: "1.5px solid " + (error ? "#E24B4A" : "#444"), borderRadius: 12, fontSize: 15, background: "var(--modal-surface)", color: "#fff", boxSizing: "border-box" }} />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", display: "block", marginBottom: 6 }}>Contrasenya</label>
          <input type="password" value={pwd} onChange={e => setPwd(e.target.value)} onKeyDown={e => e.key === "Enter" && confirmar()} placeholder="Escriu la contrasenya" autoComplete="new-password" style={{ width: "100%", padding: "13px 12px", border: "1.5px solid " + (error ? "#E24B4A" : "#444"), borderRadius: 12, fontSize: 15, background: "var(--modal-surface)", color: "#fff", boxSizing: "border-box" }} />
        </div>
        {error && <div style={{ background: "#FCEBEB", borderRadius: 10, padding: "10px", fontSize: 13, color: "#A32D2D", marginBottom: 14, textAlign: "center" }}>Credencials incorrectes</div>}
        <button onClick={confirmar} style={{ width: "100%", padding: "15px", background: "#E24B4A", border: "none", borderRadius: 14, fontSize: 16, fontWeight: 600, color: "#fff", cursor: "pointer", marginBottom: 10 }}>Eliminar definitivament</button>
        <button onClick={onCancel} style={{ width: "100%", padding: "14px", background: "transparent", border: "none", fontSize: 15, color: "rgba(255,255,255,0.5)", cursor: "pointer" }}>Cancel·lar</button>
      </div>
    </div>
  );
}

function AppInterna() {
  const [fase, setFase] = useState("engreix");
  const [data, setData] = useState({ transicio: [], preengreix: [], engreix: [], desmamats: [] });
  const [carregant, setCarregant] = useState(true);
  const [nav, setNav] = useState("lots");
  const [granjaId, setGranjaId] = useState(null);
  const [lotId, setLotId] = useState(null);
  const [tabLot, setTabLot] = useState("resum");
  const [modal, setModal] = useState(null);
  const [dismissed, setDismissed] = useState(new Set());
  const [toasts, setToasts] = useState([]);
  const [showFaseMenu, setShowFaseMenu] = useState(false);
  const [confirmTancar, setConfirmTancar] = useState(false);
  const [sortidaPendent, setSortidaPendent] = useState(null);
  const [confirmarEliminar, setConfirmarEliminar] = useState(null);
  const [editantEntrada, setEditantEntrada] = useState(null);

  useEffect(() => {
    carregarTot().then(d => { setData(d); setCarregant(false); }).catch(() => setCarregant(false));
  }, []);

  useEffect(() => {
    const taules = ["granges", "lots", "entrades", "sortides", "baixes", "tractaments", "desmamats"];
    const subs = taules.map(t =>
      supabase.channel("rt_" + t)
        .on("postgres_changes", { event: "*", schema: "public", table: t }, () => {
          carregarTot().then(setData).catch(() => {});
        })
        .subscribe()
    );
    return () => subs.forEach(s => supabase.removeChannel(s));
  }, []);

  const toast = useCallback((msg, t = "ok") => {
    const id = Date.now(); setToasts(ts => [...ts, { id, msg, t }]);
    setTimeout(() => setToasts(ts => ts.filter(x => x.id !== id)), 3500);
  }, []);

  const granges = (fase !== "desmamats" ? data[fase] : []) || [];
  const granja = granges.find(g => g.id === granjaId);
  const lot = granja?.lots.find(l => l.id === lotId);
  const stats = lot ? calcStats(lot) : null;
  const fc = FASES[fase];

  const totesAlertes = Object.entries(data).filter(([f]) => f !== "desmamats").flatMap(([f, gs]) => gs.flatMap(g => g.lots.flatMap(l => detectarAlertes(l, g.nom, f))));
  const novesAlertes = totesAlertes.filter(a => !dismissed.has(`${a.fase}-${a.granja}-${a.lot}-${a.regla}`));
  const nCrit = novesAlertes.filter(a => a.nivell === "alerta").length;

  const lotsActius = granges.flatMap(g => g.lots.filter(l => l.estat === "obert").map(l => ({ ...l, _gnom: g.nom, _gid: g.id })));
  const lotsPerDesti = Object.keys(FASES).filter(f => f !== "desmamats").flatMap(f =>
    (data[f] || []).flatMap(g => g.lots.filter(l => l.estat === "obert" && !(f === fase && g.id === granjaId && l.id === lotId))
      .map(l => ({ value: String(l.id), label: "[" + FASES[f].label + "] " + g.nom + " / " + l.nom })))
  );
  const goLot = (gid, lid) => { setGranjaId(gid); setLotId(lid); setTabLot("resum"); setNav("lots"); };

  const handleEliminar = async () => {
    if (!confirmarEliminar) return;
    if (confirmarEliminar.tipus === "granja") {
      await supabase.from("granges").delete().eq("id", confirmarEliminar.id);
      setGranjaId(null); setLotId(null);
    } else {
      await supabase.from("lots").delete().eq("id", confirmarEliminar.id);
      setLotId(null);
    }
    const newData = await carregarTot(); setData(newData);
    toast("Eliminat correctament"); setConfirmarEliminar(null);
  };

  const handleEntrada = async vals => {
    if (!vals.data || !vals.caps || !vals.pesKg) return;
    const { error } = await supabase.from("entrades").insert({ lot_id: lotId, data: vals.data, caps: parseInt(vals.caps), pes_kg: parseFloat(vals.pesKg), origen: vals.origen || "" });
    if (error) { toast("Error en guardar ❌", "alerta"); return; }
    toast("Entrada registrada ✓"); setModal(null);
  };

  const handleSortida = async vals => {
    if (!vals.data || !vals.caps || !vals.pesKg) return;
    const de = vals.tipusDesti === "lot" ? lotsPerDesti.find(x => x.value === vals.destiLot)?.label || "" : vals.desti || "";
    const { error } = await supabase.from("sortides").insert({ lot_id: lotId, data: vals.data, caps: parseInt(vals.caps), pes_kg: parseFloat(vals.pesKg), tipus_desti: vals.tipusDesti, desti: de });
    if (error) { toast("Error en guardar ❌", "alerta"); return; }
    toast("Sortida registrada ✓"); setModal(null);
    if (vals.tipusDesti === "nouPreengreix" || vals.tipusDesti === "nouEngreix") {
      const faseDesti = vals.tipusDesti === "nouPreengreix" ? "preengreix" : "engreix";
      setSortidaPendent({ data: vals.data, caps: parseInt(vals.caps), pesKg: parseFloat(vals.pesKg), origenNom: (granja?.nom || "") + " / " + (lot?.nom || ""), faseDesti });
    }
  };

  const handleBaixa = async vals => {
    if (!vals.data || !vals.caps || parseInt(vals.caps) < 1) return;
    const { error } = await supabase.from("baixes").insert({ lot_id: lotId, data: vals.data, caps: parseInt(vals.caps), causa: vals.causa || "" });
    if (error) { toast("Error en guardar ❌", "alerta"); return; }
    toast("Baixa registrada ✓"); setModal(null);
  };

  const handleTractament = async vals => {
    if (!vals.data || !vals.medicament) return;
    const { error } = await supabase.from("tractaments").insert({ lot_id: lotId, data: vals.data, medicament: vals.medicament, recepta: vals.recepta || "", identificacio: vals.identificacio || "Corral infermeria", caps: parseInt(vals.caps) || 0 });
    if (error) { toast("Error en guardar ❌", "alerta"); return; }
    toast("Tractament registrat ✓"); setModal(null);
  };

  const handleNouLot = async vals => {
    if (!vals.nom || !vals.caps || !vals.pesKg) return;
    const { data: lotData, error: lotErr } = await supabase.from("lots").insert({ granja_id: granjaId, nom: vals.nom, fase, estat: "obert" }).select().single();
    if (lotErr) { toast("Error en crear lot ❌", "alerta"); return; }
    await supabase.from("entrades").insert({ lot_id: lotData.id, data: vals.data, caps: parseInt(vals.caps), pes_kg: parseFloat(vals.pesKg), origen: vals.origen || "" });
    const newData = await carregarTot(); setData(newData);
    toast("Lot creat ✓"); setModal(null); setLotId(lotData.id);
  };

  const handleNovaGranja = async vals => {
    if (!vals.nom) return;
    const { data: gData, error } = await supabase.from("granges").insert({ nom: vals.nom, fase }).select().single();
    if (error) { toast("Error en crear granja ❌", "alerta"); return; }
    const newData = await carregarTot(); setData(newData);
    toast("Granja creada ✓"); setModal(null); setGranjaId(gData.id);
  };

  const handleTancarLot = async () => {
    await supabase.from("lots").update({ estat: "tancat" }).eq("id", lotId);
    setConfirmTancar(false); toast("Lot tancat");
  };

  const handleEditarEntrada = async vals => {
    if (!vals.caps) return;
    await supabase.from("entrades").update({ caps: parseInt(vals.caps), pes_kg: parseFloat(vals.pesKg) || 0 }).eq("id", editantEntrada.id);
    const newData = await carregarTot(); setData(newData);
    toast("Entrada actualitzada ✓"); setModal(null); setEditantEntrada(null);
  };

  const handleGuardarDesmamats = async ({ granja, data: dataDes, garrins }) => {
    const { error } = await supabase.from("desmamats").insert({ granja, data: dataDes, garrins });
    if (error) { toast("Error en guardar ❌", "alerta"); return; }
    const newData = await carregarTot(); setData(newData);
    toast("Desmamada guardada ✓");
  };

  const handleCrearLotFromDesmamats = async ({ desmamatsId, nomLot, granjaDestiId, totalGarrins, data: dataDes, pesKg }) => {
    const { data: lotData, error: lotErr } = await supabase.from("lots")
      .insert({ granja_id: granjaDestiId, nom: nomLot, fase: "transicio", estat: "obert" })
      .select().single();
    if (lotErr) { toast("Error en crear lot ❌", "alerta"); return; }
    await supabase.from("entrades").insert({ lot_id: lotData.id, data: dataDes, caps: totalGarrins, pes_kg: parseFloat(pesKg) || 0, origen: "Desmamats" });
    await supabase.from("desmamats").update({ lot_id: lotData.id }).eq("id", desmamatsId);
    const newData = await carregarTot(); setData(newData);
    toast("Lot de Transició creat! 🐣");
  };

  // ── Detall lot ─────────────────────────────────────────────────────────
  const LotDetall = () => {
    if (!lot || !stats) return null;
    const als = detectarAlertes(lot, granja.nom, fase);
    const hc = heatColor(stats.pct);
    const tracts = lot.tractaments || [];
    return (
      <div style={{ flex: 1, overflowY: "auto", paddingBottom: 80 }}>
        <div style={{ padding: "12px 16px 0" }}>
          <button onClick={() => setLotId(null)} style={{ border: "none", background: "transparent", fontSize: 13, color: fc.color, padding: "0 0 8px", cursor: "pointer" }}>← {granja.nom}</button>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{lot.nom}</div>
            <span style={{ fontSize: 12, background: bdg(lot.estat).bg, color: bdg(lot.estat).color, borderRadius: 8, padding: "3px 10px" }}>{bdg(lot.estat).text}</span>
          </div>
          <div style={{ fontSize: 13, color: "#888", marginBottom: 12 }}>{fc.emoji} {fc.label} · {stats.die} dies actius</div>
        </div>
        {als.map((a, i) => (
          <div key={i} style={{ margin: "0 12px 10px", background: a.nivell === "alerta" ? "#FCEBEB" : "#FAEEDA", border: `1px solid ${a.nivell === "alerta" ? "#F7C1C1" : "#FAC775"}`, borderRadius: 12, padding: "12px 14px", display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span style={{ fontSize: 20 }}>{a.nivell === "alerta" ? "🔴" : "🟡"}</span>
            <div><div style={{ fontWeight: 600, fontSize: 13, color: a.nivell === "alerta" ? "#A32D2D" : "#633806" }}>{a.msg}</div><div style={{ fontSize: 12, color: "#777", marginTop: 2 }}>{a.detall}</div></div>
          </div>
        ))}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, padding: "0 12px 12px" }}>
          {[{ lbl: "Caps actuals", val: stats.cap, col: "#378ADD" }, { lbl: "% Mortalitat", val: stats.pct + "%", col: hc.color === "#fff" ? "#E24B4A" : hc.color, bg: hc.bg }, { lbl: "Caps entrats", val: stats.tCE, col: "#1D9E75" }, { lbl: "Baixes", val: stats.tB, col: "#E24B4A" }, { lbl: "Caps sortits", val: stats.tCS, col: "#BA7517" }, { lbl: "Dies actius", val: stats.die, col: "#7F77DD" }, ...(stats.gmd ? [{ lbl: "GMD", val: stats.gmd + "g", col: "#0F6E56" }] : []), ...(stats.gKg ? [{ lbl: "Guany/cap", val: stats.gKg + " kg", col: "#1D9E75" }] : [])].map(({ lbl, val, col, bg }) => (
            <div key={lbl} style={{ background: bg || "var(--color-background-secondary)", borderRadius: 14, padding: "14px", borderLeft: "4px solid " + col }}>
              <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>{lbl}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: col }}>{val}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", borderBottom: "1px solid #f0f0f0", margin: "0 12px", overflowX: "auto" }}>
          {[["resum", "Resum"], ["entrades", "Entrades (" + lot.entrades.length + ")"], ["sortides", "Sortides (" + lot.sortides.length + ")"], ["baixes", "Baixes (" + stats.tB + ")"], ["tractaments", "Tractaments (" + tracts.length + ")"]].map(([k, lbl]) => (
            <button key={k} onClick={() => setTabLot(k)} style={{ border: "none", background: "transparent", borderBottom: tabLot === k ? "3px solid " + fc.color : "3px solid transparent", padding: "10px 14px", cursor: "pointer", fontSize: 13, fontWeight: tabLot === k ? 600 : 400, color: tabLot === k ? fc.color : "#888", whiteSpace: "nowrap" }}>{lbl}</button>
          ))}
        </div>
        <div style={{ padding: "12px 12px 0" }}>
          {tabLot === "resum" && (
            <div>
              {lot.entrades.map((e, i) => (<div key={e.id} style={{ background: "var(--color-background-secondary)", borderRadius: 12, padding: "12px 14px", marginBottom: 8 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}><span style={{ fontWeight: 600, fontSize: 14 }}>Entrada {i + 1}</span><span style={{ fontSize: 12, color: "#888" }}>{e.data}</span></div><div style={{ fontSize: 13, color: "#555" }}>{e.caps} caps · {e.pesKg.toLocaleString()} kg · {(e.pesKg / e.caps).toFixed(1)} kg/cap</div>{e.origen && <div style={{ fontSize: 12, color: "#888", marginTop: 3 }}>📦 {e.origen}</div>}</div>))}
              {lot.sortides.map((e, i) => (<div key={e.id} style={{ background: "var(--color-background-secondary)", borderRadius: 12, padding: "12px 14px", marginBottom: 8 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}><span style={{ fontWeight: 600, fontSize: 14 }}>Sortida {i + 1}</span><span style={{ fontSize: 12, color: "#888" }}>{e.data}</span></div><div style={{ fontSize: 13, color: "#555" }}>{e.caps} caps · {e.pesKg.toLocaleString()} kg · {(e.pesKg / e.caps).toFixed(1)} kg/cap</div>{e.desti && <div style={{ fontSize: 12, color: "#888", marginTop: 3 }}>📍 {e.desti}</div>}</div>))}
              {lot.baixes.length > 0 && <div style={{ background: "#FFF5F5", borderRadius: 12, padding: "12px 14px", marginBottom: 8 }}><div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6, color: "#E24B4A" }}>Baixes ({stats.tB} caps)</div>{lot.baixes.slice(-3).map(b => (<div key={b.id} style={{ fontSize: 13, color: "#555", padding: "4px 0", borderBottom: "1px solid #FFE0E0" }}>{b.data} · {b.caps} caps{b.causa ? " · " + b.causa : ""}</div>))}{lot.baixes.length > 3 && <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>+{lot.baixes.length - 3} més</div>}</div>}
              {tracts.length > 0 && <div style={{ background: "#F0F4FF", borderRadius: 12, padding: "12px 14px", marginBottom: 8 }}><div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6, color: "#1A4DB0" }}>Tractaments ({tracts.length})</div>{tracts.slice(-2).map(t => (<div key={t.id} style={{ fontSize: 13, color: "#555", padding: "4px 0", borderBottom: "1px solid #D0DCFF" }}>💊 {t.data} · {t.medicament}</div>))}{tracts.length > 2 && <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>+{tracts.length - 2} més</div>}</div>}
            </div>
          )}
          {tabLot === "entrades" && lot.entrades.map((e, i) => (<div key={e.id} style={{ background: "var(--color-background-secondary)", borderRadius: 12, padding: "14px", marginBottom: 8 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}><span style={{ fontWeight: 600 }}>Entrada {i + 1}</span><div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontSize: 12, color: "#888" }}>{e.data}</span>{lot.estat === "obert" && <button onClick={() => { setEditantEntrada(e); setModal("editarEntrada"); }} style={{ border: "none", background: "transparent", color: "#aaa", fontSize: 15, cursor: "pointer", padding: "0 2px" }} title="Editar entrada">✏️</button>}</div></div><div style={{ fontSize: 14, fontWeight: 500, marginBottom: 2 }}>{e.caps} caps</div><div style={{ fontSize: 13, color: "#555" }}>{e.pesKg > 0 ? `${e.pesKg.toLocaleString()} kg · ${(e.pesKg / e.caps).toFixed(1)} kg/cap` : <span style={{ color: "#f59e0b" }}>Pes pendent</span>}</div>{e.origen && <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>📦 {e.origen}</div>}</div>))}
          {tabLot === "sortides" && (lot.sortides.length === 0 ? <div style={{ textAlign: "center", padding: "32px 0", color: "#aaa", fontSize: 14 }}>Sense sortides</div> : lot.sortides.map((e, i) => (<div key={e.id} style={{ background: "var(--color-background-secondary)", borderRadius: 12, padding: "14px", marginBottom: 8 }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ fontWeight: 600 }}>Sortida {i + 1}</span><span style={{ fontSize: 12, color: "#888" }}>{e.data}</span></div><div style={{ fontSize: 14, fontWeight: 500, marginBottom: 2 }}>{e.caps} caps</div><div style={{ fontSize: 13, color: "#555" }}>{e.pesKg.toLocaleString()} kg · {(e.pesKg / e.caps).toFixed(1)} kg/cap</div>{e.desti && <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>📍 {e.desti}</div>}</div>)))}
          {tabLot === "baixes" && (lot.baixes.length === 0 ? <div style={{ textAlign: "center", padding: "32px 0", color: "#aaa", fontSize: 14 }}>Sense baixes</div> : [...lot.baixes].reverse().map(b => (<div key={b.id} style={{ background: "#FFF5F5", borderRadius: 12, padding: "14px", marginBottom: 8 }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ fontWeight: 600, color: "#E24B4A" }}>{b.caps} cap{b.caps > 1 ? "s" : ""}</span><span style={{ fontSize: 12, color: "#888" }}>{b.data}</span></div>{b.causa && <div style={{ fontSize: 13, color: "#555" }}>Causa: {b.causa}</div>}</div>)))}
          {tabLot === "tractaments" && (tracts.length === 0 ? <div style={{ textAlign: "center", padding: "32px 0", color: "#aaa", fontSize: 14 }}>Sense tractaments</div> : [...tracts].reverse().map(t => (<div key={t.id} style={{ background: "#F0F4FF", borderRadius: 12, padding: "14px", marginBottom: 8, border: "1px solid #D0DCFF" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}><span style={{ fontWeight: 700, fontSize: 14, color: "#1A4DB0" }}>💊 {t.medicament}</span><span style={{ fontSize: 12, color: "#888" }}>{t.data}</span></div>{t.recepta && <div style={{ fontSize: 12, color: "#555", marginBottom: 3 }}>📋 Recepta: <strong>{t.recepta}</strong></div>}<div style={{ fontSize: 12, color: "#555" }}>🐷 {t.identificacio}{t.caps > 0 ? " (" + t.caps + " caps)" : ""}</div></div>)))}
        </div>
        {lot.estat === "obert" && (
          <div style={{ padding: "16px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <button onClick={() => setModal("entrada")} style={{ padding: "14px", background: fc.bgLight, border: "none", borderRadius: 14, fontSize: 15, fontWeight: 600, color: fc.colorDark, cursor: "pointer" }}>+ Entrada</button>
              <button onClick={() => setModal("sortida")} style={{ padding: "14px", background: "#EEF4FF", border: "none", borderRadius: 14, fontSize: 15, fontWeight: 600, color: "#1A4DB0", cursor: "pointer" }}>+ Sortida</button>
            </div>
            <button onClick={() => setModal("baixa")} style={{ padding: "14px", background: "#FFF0F0", border: "none", borderRadius: 14, fontSize: 15, fontWeight: 600, color: "#C0392B", cursor: "pointer" }}>+ Registrar baixa</button>
            <button onClick={() => setModal("tractament")} style={{ padding: "14px", background: "#EEF4FF", border: "none", borderRadius: 14, fontSize: 15, fontWeight: 600, color: "#1A4DB0", cursor: "pointer" }}>+ Registrar tractament</button>
            <button onClick={() => setConfirmTancar(true)} style={{ padding: "13px", background: "transparent", border: "1.5px solid #E24B4A", borderRadius: 14, fontSize: 14, color: "#E24B4A", cursor: "pointer" }}>Tancar lot</button>
          </div>
        )}
      </div>
    );
  };

  const LlistaLots = () => (
    <div style={{ flex: 1, overflowY: "auto", paddingBottom: 80 }}>
      <div style={{ padding: "12px 16px 8px" }}>
        {granjaId ? <><button onClick={() => setGranjaId(null)} style={{ border: "none", background: "transparent", fontSize: 13, color: fc.color, padding: "0 0 6px", cursor: "pointer" }}>← Totes les granges</button><div style={{ fontSize: 20, fontWeight: 700 }}>{granja?.nom}</div></> : <div style={{ fontSize: 20, fontWeight: 700 }}>Granges</div>}
      </div>
      {!granjaId && granges.map(g => {
        const lotsO = g.lots.filter(l => l.estat === "obert").length;
        const alsG = g.lots.flatMap(l => detectarAlertes(l, g.nom, fase));
        const critG = alsG.some(a => a.nivell === "alerta"); const avisG = alsG.some(a => a.nivell === "avis");
        return (<div key={g.id} style={{ margin: "0 12px 10px", background: "var(--color-background-secondary)", borderRadius: 16, padding: "16px", boxShadow: "var(--shadow-sm)", border: "1.5px solid " + (critG ? "#F7C1C1" : avisG ? "#FAC775" : "transparent") }}>
          <div onClick={() => setGranjaId(g.id)} style={{ cursor: "pointer" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{g.nom}</div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {critG && <span style={{ fontSize: 11, background: "#FCEBEB", color: "#A32D2D", borderRadius: 8, padding: "2px 8px", fontWeight: 600 }}>ALERTA</span>}
                {!critG && avisG && <span style={{ fontSize: 11, background: "#FAEEDA", color: "#633806", borderRadius: 8, padding: "2px 8px", fontWeight: 600 }}>AVÍS</span>}
              </div>
            </div>
            <div style={{ fontSize: 13, color: "#888" }}>{g.lots.length} lots · {lotsO} obert{lotsO !== 1 ? "s" : ""}</div>
          </div>
          <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
            <button onClick={e => { e.stopPropagation(); setConfirmarEliminar({ tipus: "granja", id: g.id, nom: g.nom }); }} style={{ border: "none", background: "transparent", color: "#ccc", fontSize: 18, cursor: "pointer", padding: "2px 6px" }} title="Eliminar granja">🗑️</button>
          </div>
        </div>);
      })}
      {granjaId && granja?.lots.map(l => {
        const st = calcStats(l); const hc = heatColor(st.pct); const b = bdg(l.estat);
        const als = detectarAlertes(l, granja.nom, fase);
        const crit = als.some(a => a.nivell === "alerta"); const avis = als.some(a => a.nivell === "avis");
        return (<div key={l.id} style={{ margin: "0 12px 10px", background: "var(--color-background-secondary)", borderRadius: 16, padding: "16px", border: "1.5px solid " + (crit ? "#F7C1C1" : avis ? "#FAC775" : "transparent") }}>
          <div onClick={() => { setLotId(l.id); setTabLot("resum"); }} style={{ cursor: "pointer" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{l.nom}</div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {crit && <span style={{ fontSize: 11, background: "#FCEBEB", color: "#A32D2D", borderRadius: 8, padding: "2px 8px", fontWeight: 600 }}>ALERTA</span>}
                {!crit && avis && <span style={{ fontSize: 11, background: "#FAEEDA", color: "#633806", borderRadius: 8, padding: "2px 8px", fontWeight: 600 }}>AVÍS</span>}
                <span style={{ fontSize: 11, background: b.bg, color: b.color, borderRadius: 8, padding: "3px 10px" }}>{b.text}</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 16, fontSize: 13, color: "#555", marginBottom: 8 }}><span>🐷 {st.tCE} caps</span><span>📅 {st.die} dies</span><span>📉 {st.tB} baixes</span></div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ background: hc.bg, color: hc.color, borderRadius: 8, padding: "4px 12px", fontWeight: 700, fontSize: 14 }}>Mort. {st.pct}%</span><span style={{ fontSize: 13, color: "#888" }}>{st.cap} caps actuals</span></div>
          </div>
          <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
            <button onClick={e => { e.stopPropagation(); setConfirmarEliminar({ tipus: "lot", id: l.id, nom: l.nom }); }} style={{ border: "none", background: "transparent", color: "#ccc", fontSize: 18, cursor: "pointer", padding: "2px 6px" }} title="Eliminar lot">🗑️</button>
          </div>
        </div>);
      })}
      {granjaId && <div style={{ padding: "4px 12px" }}><button onClick={() => setModal("nouLot")} style={{ width: "100%", padding: "14px", background: fc.bgLight, border: "1.5px dashed " + fc.color, borderRadius: 14, fontSize: 15, fontWeight: 600, color: fc.colorDark, cursor: "pointer" }}>+ Nou lot</button></div>}
      {!granjaId && <div style={{ padding: "4px 12px" }}><button onClick={() => setModal("novaGranja")} style={{ width: "100%", padding: "14px", background: "var(--color-background-secondary)", border: "1.5px dashed #ccc", borderRadius: 14, fontSize: 15, fontWeight: 500, color: "#888", cursor: "pointer" }}>+ Nova granja</button></div>}
    </div>
  );

  const VistaGlobal = () => {
    const tots = lotsActius;
    const tCap = tots.reduce((s, l) => s + calcStats(l).cap, 0);
    const tBx = tots.reduce((s, l) => s + calcStats(l).tB, 0);
    const avgM = tots.length > 0 ? (tots.reduce((s, l) => s + calcStats(l).pct, 0) / tots.length).toFixed(1) : 0;
    return (
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 12px 80px" }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Resum global</div>
        <div style={{ fontSize: 13, color: "#888", marginBottom: 14 }}>{fc.emoji} Fase {fc.label} · {tots.length} lots actius</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
          {[["Lots actius", tots.length, fc.color], ["Caps totals", tCap.toLocaleString(), "#1D9E75"], ["Baixes totals", tBx, "#E24B4A"], ["Mort. mitjana", avgM + "%", "#BA7517"]].map(([lbl, val, col]) => (
            <div key={lbl} style={{ background: "var(--color-background-secondary)", borderRadius: 14, padding: "14px", borderLeft: "4px solid " + col }}><div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>{lbl}</div><div style={{ fontSize: 22, fontWeight: 700, color: col }}>{val}</div></div>
          ))}
        </div>
        {tots.sort((a, b) => calcStats(b).pct - calcStats(a).pct).map(l => {
          const st = calcStats(l); const hc = heatColor(st.pct);
          const crit = detectarAlertes(l, l._gnom, fase).some(a => a.nivell === "alerta");
          return (<div key={l.id} onClick={() => goLot(l._gid, l.id)} style={{ background: "var(--color-background-secondary)", borderRadius: 14, padding: "14px", marginBottom: 8, cursor: "pointer", border: "1.5px solid " + (crit ? "#F7C1C1" : "transparent") }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <div><span style={{ fontWeight: 600, fontSize: 14 }}>{l.nom}</span><span style={{ fontSize: 12, color: "#888", marginLeft: 8 }}>{l._gnom}</span></div>
              <span style={{ background: hc.bg, color: hc.color, borderRadius: 8, padding: "4px 12px", fontWeight: 700, fontSize: 14 }}>{st.pct}%</span>
            </div>
            <div style={{ fontSize: 13, color: "#888" }}>{st.cap} caps · {st.die} dies · {st.tB} baixes{crit ? " 🔴" : ""}</div>
          </div>);
        })}
      </div>
    );
  };

  if (carregant) return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#1e293b" }}>
      <div style={{ fontSize: 52, marginBottom: 16 }}>🐷</div>
      <div style={{ fontSize: 16, color: "rgba(255,255,255,0.6)" }}>Carregant dades...</div>
    </div>
  );

  return (
    <div style={{ fontFamily: "var(--font-sans),-apple-system,BlinkMacSystemFont,sans-serif", fontSize: 14, color: "var(--color-text-primary)", display: "flex", flexDirection: "column", height: "100vh", maxWidth: 480, margin: "0 auto", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)", zIndex: 300, display: "flex", flexDirection: "column", gap: 6, pointerEvents: "none", width: "90%", maxWidth: 400 }}>
        {toasts.map(t => (<div key={t.id} style={{ background: t.t === "alerta" ? "#FCEBEB" : t.t === "avis" ? "#FAEEDA" : "#1D9E75", color: t.t === "alerta" ? "#A32D2D" : t.t === "avis" ? "#633806" : "#fff", borderRadius: 12, padding: "12px 18px", fontSize: 14, fontWeight: 500, textAlign: "center", boxShadow: "0 4px 20px rgba(0,0,0,0.15)" }}>{t.msg}</div>))}
      </div>
      <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
        <button onClick={() => setShowFaseMenu(v => !v)} style={{ display: "flex", alignItems: "center", gap: 8, border: "none", background: "var(--color-background-secondary)", borderRadius: 12, padding: "8px 14px", cursor: "pointer" }}>
          <span style={{ fontSize: 18 }}>{fc.emoji}</span>
          <span style={{ fontWeight: 700, fontSize: 15, color: fc.color }}>{fc.label}</span>
          <span style={{ fontSize: 11, color: "#aaa" }}>▼</span>
        </button>
        <button onClick={() => setNav("alertes")} style={{ position: "relative", border: "none", background: nCrit > 0 ? "#FCEBEB" : "var(--color-background-secondary)", borderRadius: 12, padding: "8px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 18 }}>🔔</span>
          {novesAlertes.length > 0 && <span style={{ position: "absolute", top: 4, right: 4, width: 18, height: 18, background: nCrit > 0 ? "#E24B4A" : "#BA7517", color: "#fff", borderRadius: "50%", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{novesAlertes.length}</span>}
        </button>
      </div>
      {showFaseMenu && (
        <div style={{ position: "absolute", top: 60, left: 12, right: 12, background: "#fff", borderRadius: 16, boxShadow: "0 8px 30px rgba(0,0,0,0.25)", zIndex: 150, padding: 8 }}>
          {Object.values(FASES).map(f => (
            <button key={f.key} onClick={() => { setFase(f.key); setGranjaId(null); setLotId(null); setNav("lots"); setShowFaseMenu(false); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", border: "none", background: fase === f.key ? f.bgLight : "transparent", borderRadius: 12, cursor: "pointer", marginBottom: 4 }}>
              <span style={{ fontSize: 28 }}>{f.emoji}</span>
              <div style={{ textAlign: "left" }}><div style={{ fontWeight: 700, fontSize: 16, color: fase === f.key ? f.colorDark : "var(--color-text-primary)" }}>{f.label}</div><div style={{ fontSize: 12, color: "#888" }}>{f.pesRang}</div></div>
              {fase === f.key && <span style={{ marginLeft: "auto", color: f.color, fontSize: 18 }}>✓</span>}
            </button>
          ))}
        </div>
      )}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }} onClick={() => showFaseMenu && setShowFaseMenu(false)}>
        {nav === "alertes" && <PantallaAlertes data={data} dismissed={dismissed} onDismiss={a => setDismissed(s => new Set([...s, `${a.fase}-${a.granja}-${a.lot}-${a.regla}`]))} onLotClick={a => { const g = (data[a.fase] || []).find(g => g.nom === a.granja); if (g) { setFase(a.fase); setGranjaId(g.id); const l = g.lots.find(l => l.nom === a.lot); if (l) { setLotId(l.id); setTabLot("resum"); setNav("lots"); } } }} />}
        {nav === "global" && <VistaGlobal />}
        {nav === "lots" && !lotId && fase !== "desmamats" && <LlistaLots />}
        {nav === "lots" && !lotId && fase === "desmamats" && <PantallaDesmamats registres={data.desmamats || []} grangesTransicio={data.transicio || []} onGuardar={handleGuardarDesmamats} onCrearLot={handleCrearLotFromDesmamats} toast={toast} />}
        {nav === "lots" && lotId && fase !== "desmamats" && <LotDetall />}
        {nav === "exportacio" && <PantallaExportacio data={data} />}
      </div>
      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, background: "#fff", borderTop: "1px solid #e2e8f0", display: "flex", zIndex: 100, boxShadow: "0 -4px 16px rgba(0,0,0,0.06)" }}>
        {[["lots", "🏠", "Lots"], ["global", "📊", "Resum"], ["alertes", "🔔", "Alertes"], ["exportacio", "📤", "Exportar"]].map(([k, icon, lbl]) => (
          <button key={k} onClick={() => { setNav(k); if (k === "lots") setLotId(null); }} style={{ flex: 1, padding: "10px 0 14px", border: "none", background: "transparent", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
            <span style={{ fontSize: 20, position: "relative" }}>{icon}{k === "alertes" && novesAlertes.length > 0 && <span style={{ position: "absolute", top: -4, right: -6, width: 16, height: 16, background: nCrit > 0 ? "#E24B4A" : "#BA7517", color: "#fff", borderRadius: "50%", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{novesAlertes.length}</span>}</span>
            <span style={{ fontSize: 10, color: nav === k ? fc.color : "#aaa", fontWeight: nav === k ? 700 : 400 }}>{lbl}</span>
          </button>
        ))}
      </div>

      {modal === "entrada" && <ModalForm title="Nova entrada" confirmLabel="Registrar entrada" confirmColor={fc.color} capsActuals={stats?.tCE} fields={[{ key: "data", label: "Data", type: "date", default: TODAY }, { key: "caps", label: "Caps", type: "number", inputMode: "numeric", placeholder: "Nombre de porcs" }, { key: "pesKg", label: "Pes total (kg)", type: "number", inputMode: "decimal" }, { key: "origen", label: "Origen (opcional)", type: "text", placeholder: fase === "transicio" ? "Ex: Maternitat Mas Colell" : fase === "preengreix" ? "Ex: Lot de transició" : "Ex: Proveïdor Germans Puig" }]} onConfirm={handleEntrada} onCancel={() => setModal(null)} />}

      {modal === "sortida" && <ModalForm title="Nova sortida" confirmLabel="Registrar sortida" confirmColor="#1A4DB0" capsActuals={stats?.cap}
        fields={[{ key: "data", label: "Data", type: "date", default: TODAY }, { key: "caps", label: "Caps", type: "number", inputMode: "numeric" }, { key: "pesKg", label: "Pes total (kg)", type: "number", inputMode: "decimal" }, { key: "tipusDesti", label: "Tipus de destí", type: "select", default: defaultDesti(fase), options: destiOptions(fase) }]}
        extraContent={(vals, setVals) => (
          <div>
            {(vals.tipusDesti === "nouPreengreix" || vals.tipusDesti === "nouEngreix") && <div style={{ marginBottom: 14, background: "rgba(29,158,117,0.15)", borderRadius: 12, padding: "12px 14px", border: "1px solid rgba(29,158,117,0.3)" }}><div style={{ fontSize: 13, color: "#a0f0d0", fontWeight: 600, marginBottom: 4 }}>✨ Flux automàtic</div><div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>{vals.tipusDesti === "nouPreengreix" ? "Es crearà un nou lot de pre-engreix automàticament." : "Es crearà un nou lot d'engreix directament."}</div></div>}
            {vals.tipusDesti === "lot" && <div style={{ marginBottom: 14 }}><label style={{ fontSize: 15, fontWeight: 600, color: "#fff", display: "block", marginBottom: 7 }}>Lot de destí</label><select value={vals.destiLot || ""} onChange={e => setVals(v => ({ ...v, destiLot: e.target.value }))} style={{ width: "100%", padding: "13px 12px", border: "1.5px solid var(--modal-border)", borderRadius: 12, fontSize: 14, background: "var(--modal-surface)", color: "#fff", boxSizing: "border-box" }}><option value="">— Selecciona —</option>{lotsPerDesti.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>}
            {(vals.tipusDesti === "escorxador" || vals.tipusDesti === "altre") && <div style={{ marginBottom: 14 }}><label style={{ fontSize: 15, fontWeight: 600, color: "#fff", display: "block", marginBottom: 7 }}>{vals.tipusDesti === "escorxador" ? "Nom escorxador (opcional)" : "Destí (opcional)"}</label><input type="text" value={vals.desti || ""} onChange={e => setVals(v => ({ ...v, desti: e.target.value }))} placeholder={vals.tipusDesti === "escorxador" ? "Ex: Escorxador Girona" : "Ex: Venda directa"} style={{ width: "100%", padding: "13px 12px", border: "1.5px solid var(--modal-border)", borderRadius: 12, fontSize: 15, background: "var(--modal-surface)", color: "#fff", boxSizing: "border-box" }} /></div>}
          </div>
        )}
        onConfirm={handleSortida} onCancel={() => setModal(null)} />}

      {modal === "baixa" && <ModalForm title="Registrar baixa" confirmLabel="Confirmar baixa" confirmColor="#C0392B" fields={[{ key: "data", label: "Data", type: "date", default: TODAY }, { key: "caps", label: "Caps", type: "number", inputMode: "numeric", placeholder: "Quants animals?" }, { key: "causa", label: "Causa (opcional)", type: "text", placeholder: "Ex: Diarrea, Respiratòria..." }]} onConfirm={handleBaixa} onCancel={() => setModal(null)} />}

      {modal === "tractament" && <ModalForm title="Registrar tractament" confirmLabel="Guardar tractament" confirmColor="#1A4DB0" fields={[{ key: "data", label: "Data", type: "date", default: TODAY }, { key: "medicament", label: "Nom comercial del medicament", type: "text", placeholder: "Ex: Amoxicil·lina 150mg" }, { key: "recepta", label: "Número de recepta", type: "text", placeholder: "Ex: REC-2026-00123" }, { key: "caps", label: "Nombre d'animals tractats (opcional)", type: "number", inputMode: "numeric", placeholder: "Ex: 12" }, { key: "identificacio", label: "Identificació dels animals", type: "text", placeholder: "Corral infermeria", default: "Corral infermeria" }]} onConfirm={handleTractament} onCancel={() => setModal(null)} />}

      {modal === "nouLot" && <ModalForm title="Nou lot" confirmLabel="Crear lot" confirmColor={fc.color} fields={[{ key: "nom", label: "Nom del lot", type: "text", placeholder: "Ex: LT150526S3", default: "L" + (fase === "transicio" ? "T" : fase === "preengreix" ? "P" : "E") + TODAY.slice(8,10) + TODAY.slice(5,7) + TODAY.slice(2,4) + "S" }, { key: "data", label: "Data entrada", type: "date", default: TODAY }, { key: "caps", label: "Caps d'entrada", type: "number", inputMode: "numeric" }, { key: "pesKg", label: "Pes total entrada (kg)", type: "number", inputMode: "decimal" }, { key: "origen", label: "Origen (opcional)", type: "text", placeholder: fase === "transicio" ? "Ex: Maternitat Mas Colell" : fase === "preengreix" ? "Ex: Lot de transició" : "Ex: Proveïdor Germans Puig" }]} onConfirm={handleNouLot} onCancel={() => setModal(null)} />}

      {modal === "editarEntrada" && editantEntrada && <ModalForm title="Editar entrada" confirmLabel="Guardar canvis" confirmColor={fc.color} capsActuals={editantEntrada.caps}
        fields={[{ key: "caps", label: "Caps", type: "number", inputMode: "numeric", default: String(editantEntrada.caps) }, { key: "pesKg", label: "Pes total (kg)", type: "number", inputMode: "decimal", default: editantEntrada.pesKg > 0 ? String(editantEntrada.pesKg) : "" }]}
        onConfirm={handleEditarEntrada} onCancel={() => { setModal(null); setEditantEntrada(null); }} />}

      {modal === "novaGranja" && <ModalForm title="Nova granja" confirmLabel="Crear granja" confirmColor={fc.color} fields={[{ key: "nom", label: "Nom de la granja", type: "text", placeholder: "Ex: Granja Can Puig" }]} onConfirm={handleNovaGranja} onCancel={() => setModal(null)} />}

      {sortidaPendent && (() => {
        const fd = sortidaPendent.faseDesti;
        const fcDesti = FASES[fd];
        return (
          <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", flexDirection: "column", justifyContent: "flex-end", background: "rgba(0,0,0,0.75)" }}>
            <div style={{ background: "#1e293b", borderRadius: "20px 20px 0 0", padding: "20px 16px 32px", maxHeight: "90vh", overflowY: "auto" }}>
              <div style={{ width: 40, height: 4, background: "rgba(255,255,255,0.3)", borderRadius: 2, margin: "0 auto 16px" }} />
              <div style={{ fontSize: 11, fontWeight: 600, color: fcDesti.color, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>Flux automàtic {fcDesti.emoji}</div>
              <div style={{ fontSize: 19, fontWeight: 700, color: "#fff", marginBottom: 6 }}>Crear lot de {fcDesti.label}</div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", marginBottom: 20 }}>Caps, pes i data ja venen de la sortida anterior.</div>
              <div style={{ background: fcDesti.color + "22", border: "1px solid " + fcDesti.color + "55", borderRadius: 12, padding: "12px 14px", marginBottom: 20, display: "flex", gap: 16, flexWrap: "wrap" }}>
                {[["Caps", sortidaPendent.caps], ["Pes total", sortidaPendent.pesKg + " kg"], ["Pes mig", (sortidaPendent.pesKg / sortidaPendent.caps).toFixed(1) + " kg"], ["Data", sortidaPendent.data]].map(([lbl, val]) => (<div key={lbl} style={{ textAlign: "center" }}><div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginBottom: 2 }}>{lbl}</div><div style={{ fontSize: 16, fontWeight: 700, color: fcDesti.color }}>{val}</div></div>))}
              </div>
              <div style={{ marginBottom: 14 }}><label style={{ fontSize: 15, fontWeight: 600, color: "#fff", display: "block", marginBottom: 7 }}>Nom del nou lot de {fcDesti.label}</label><input type="text" placeholder={"Ex: " + (fd === "preengreix" ? "Pre" : "Lot") + " C-26"} value={sortidaPendent.nomLot || ""} onChange={e => setSortidaPendent(p => ({ ...p, nomLot: e.target.value }))} style={{ width: "100%", padding: "13px 12px", border: "1.5px solid var(--modal-border)", borderRadius: 12, fontSize: 15, background: "var(--modal-surface)", color: "#fff", boxSizing: "border-box" }} /></div>
              <div style={{ marginBottom: 20 }}><label style={{ fontSize: 15, fontWeight: 600, color: "#fff", display: "block", marginBottom: 7 }}>Granja de destí</label>
                <select value={sortidaPendent.granjaDestiId || ""} onChange={e => setSortidaPendent(p => ({ ...p, granjaDestiId: e.target.value }))} style={{ width: "100%", padding: "13px 12px", border: "1.5px solid var(--modal-border)", borderRadius: 12, fontSize: 15, background: "var(--modal-surface)", color: "#fff", boxSizing: "border-box" }}>
                  <option value="">— Selecciona una granja —</option>
                  {(data[fd] || []).map(g => <option key={g.id} value={g.id}>{g.nom}</option>)}
                </select>
              </div>
              <button onClick={async () => {
                if (!sortidaPendent.nomLot || !sortidaPendent.granjaDestiId) { toast("Omple el nom i la granja", "avis"); return; }
                const nl = { id: Date.now(), nom: sortidaPendent.nomLot, estat: "obert", entrades: [{ id: 1, data: sortidaPendent.data, caps: sortidaPendent.caps, pesKg: sortidaPendent.pesKg, origen: sortidaPendent.origenNom }], sortides: [], baixes: [], tractaments: [] };
                setData(d => ({ ...d, [fd]: d[fd].map(g => g.id !== sortidaPendent.granjaDestiId ? g : { ...g, lots: [...g.lots, nl] }) }));
                toast("Lot de " + fcDesti.label + " creat! " + fcDesti.emoji); setSortidaPendent(null);
              }} style={{ width: "100%", padding: "15px", background: fcDesti.color, border: "none", borderRadius: 14, fontSize: 16, fontWeight: 600, color: "#fff", cursor: "pointer", marginBottom: 10 }}>
                Crear lot de {fcDesti.label}
              </button>
              <button onClick={() => setSortidaPendent(null)} style={{ width: "100%", padding: "14px", background: "transparent", border: "none", fontSize: 15, color: "rgba(255,255,255,0.5)", cursor: "pointer" }}>Ara no</button>
            </div>
          </div>
        );
      })()}

      {confirmTancar && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", flexDirection: "column", justifyContent: "flex-end", background: "rgba(0,0,0,0.75)" }}>
          <div style={{ background: "#1e293b", borderRadius: "20px 20px 0 0", padding: "24px 16px 32px" }}>
            <div style={{ width: 40, height: 4, background: "rgba(255,255,255,0.3)", borderRadius: 2, margin: "0 auto 20px" }} />
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: "#fff" }}>Tancar lot?</div>
            <div style={{ fontSize: 14, color: "rgba(255,255,255,0.6)", marginBottom: 24 }}>Un cop tancat no es podran afegir més registres al lot.</div>
            <button onClick={handleTancarLot} style={{ width: "100%", padding: "15px", background: "#E24B4A", border: "none", borderRadius: 14, fontSize: 16, fontWeight: 600, color: "#fff", cursor: "pointer", marginBottom: 10 }}>Confirmar tancament</button>
            <button onClick={() => setConfirmTancar(false)} style={{ width: "100%", padding: "14px", background: "transparent", border: "none", fontSize: 15, color: "rgba(255,255,255,0.5)", cursor: "pointer" }}>Cancel·lar</button>
          </div>
        </div>
      )}

      {confirmarEliminar && <ModalEliminar item={confirmarEliminar} onConfirm={handleEliminar} onCancel={() => setConfirmarEliminar(null)} />}
    </div>
  );
}
