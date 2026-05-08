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
  transicio:  { key: "transicio",  label: "Transició",   emoji: "🐣", color: "#7F77DD", bgLight: "#EEEDFE", colorDark: "#3C3489", pesRang: "5–25 kg" },
  preengreix: { key: "preengreix", label: "Pre-engreix", emoji: "🐖", color: "#E67E22", bgLight: "#FEF0E4", colorDark: "#7D3C0A", pesRang: "25–50 kg" },
  engreix:    { key: "engreix",    label: "Engreix",     emoji: "🐷", color: "#1D9E75", bgLight: "#e1f5ee", colorDark: "#085041", pesRang: "50–110 kg" }
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
  const [gRes, lRes, eRes, sRes, bRes, tRes] = await Promise.all([
    supabase.from("granges").select("*").order("created_at"),
    supabase.from("lots").select("*").order("created_at"),
    supabase.from("entrades").select("*").order("created_at"),
    supabase.from("sortides").select("*").order("created_at"),
    supabase.from("baixes").select("*").order("created_at"),
    supabase.from("tractaments").select("*").order("created_at"),
  ]);
  const fases = { transicio: [], preengreix: [], engreix: [] };
  (gRes.data || []).forEach(g => {
    const lots = (lRes.data || []).filter(l => l.granja_id === g.id).map(l => ({
      id: l.id, nom: l.nom, estat: l.estat,
      entrades:    (eRes.data || []).filter(e => e.lot_id === l.id).map(e => ({ id: e.id, data: e.data, caps: e.caps, pesKg: parseFloat(e.pes_kg), origen: e.origen || "" })),
      sortides:    (sRes.data || []).filter(s => s.lot_id === l.id).map(s => ({ id: s.id, data: s.data, caps: s.caps, pesKg: parseFloat(s.pes_kg), tipusDesti: s.tipus_desti, desti: s.desti || "" })),
      baixes:      (bRes.data || []).filter(b => b.lot_id === l.id).map(b => ({ id: b.id, data: b.data, caps: b.caps, causa: b.causa || "" })),
      tractaments: (tRes.data || []).filter(t => t.lot_id === l.id).map(t => ({ id: t.id, data: t.data, medicament: t.medicament, recepta: t.recepta || "", identificacio: t.identificacio || "Corral infermeria", caps: t.caps || 0 })),
    }));
    if (fases[g.fase]) fases[g.fase].push({ id: g.id, nom: g.nom, lots });
  });
  return fases;
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
      {preview && <div style={{ background: "#1e1e2e", borderRadius: 12, padding: "12px", marginBottom: 14, overflowX: "auto" }}><pre style={{ fontSize: 10, color: "rgba(255,255,255,0.7)", margin: 0, whiteSpace: "pre", fontFamily: "monospace" }}>{lines.slice(0, 40).join("\n")}{lines.length > 40 ? "\n... i " + (lines.length - 40) + " línies més" : ""}</pre></div>}
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
function CalculadoraPesada({ onConfirm, onCancel, capsTotal }) {
  const [viatges, setViatges] = useState([{ id: 1, brut: "", tara: "", caps: "" }]);
  const [modePes, setModePes] = useState("viatge");
  const [capsPerMostra, setCapsPerMostra] = useState(capsTotal ? String(capsTotal) : "");
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
  const inp = { width: "100%", padding: "12px 10px", border: "1.5px solid #444", borderRadius: 10, fontSize: 15, background: "#2a2a3e", color: "#fff", boxSizing: "border-box" };
  const lbl = { fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.6)", display: "block", marginBottom: 4 };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, display: "flex", flexDirection: "column", justifyContent: "flex-end", background: "rgba(0,0,0,0.75)" }}>
      <div style={{ background: "#1a1a2e", borderRadius: "20px 20px 0 0", padding: "20px 16px 32px", maxHeight: "92vh", overflowY: "auto" }}>
        <div style={{ width: 40, height: 4, background: "rgba(255,255,255,0.3)", borderRadius: 2, margin: "0 auto 14px" }} />
        <div style={{ fontSize: 19, fontWeight: 700, color: "#fff", marginBottom: 4 }}>⚖️ Calculadora de pesada</div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", marginBottom: 14 }}>Anota cada viatge. El pes net es calcula sol.</div>
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
        <button onClick={() => { if (!pesNet) return; onConfirm({ pesKg: pesFinal.toFixed(0), caps: capsFinals || "" }); }} style={{ width: "100%", padding: "15px", background: "#1D9E75", border: "none", borderRadius: 14, fontSize: 16, fontWeight: 600, color: "#fff", cursor: "pointer", marginBottom: 10, opacity: pesNet > 0 ? 1 : 0.4 }}>Usar aquests valors</button>
        <button onClick={onCancel} style={{ width: "100%", padding: "13px", background: "transparent", border: "none", fontSize: 15, color: "rgba(255,255,255,0.5)", cursor: "pointer" }}>Cancel·lar</button>
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
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", flexDirection: "column", justifyContent: "flex-end", background: "rgba(0,0,0,0.6)" }}>
      <div style={{ background: "#1e1e2e", borderRadius: "20px 20px 0 0", padding: "20px 16px 32px", maxHeight: "90vh", overflowY: "auto" }}>
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
              ? <select value={vals[f.key]} onChange={e => setVals(v => ({ ...v, [f.key]: e.target.value }))} style={{ width: "100%", padding: "13px 12px", border: "1.5px solid #444", borderRadius: 12, fontSize: 15, background: "#2a2a3e", color: "#fff", boxSizing: "border-box" }}>{f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
              : <input type={f.type} value={vals[f.key]} placeholder={f.placeholder || ""} inputMode={f.inputMode} onChange={e => setVals(v => ({ ...v, [f.key]: e.target.value }))} style={{ width: "100%", padding: "13px 12px", border: "1.5px solid #444", borderRadius: 12, fontSize: 15, background: "#2a2a3e", color: "#fff", boxSizing: "border-box" }} />
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
  const totes = Object.entries(data).flatMap(([f, gs]) => gs.flatMap(g => g.lots.flatMap(l => detectarAlertes(l, g.nom, f))));
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
  const inp = { width: "100%", padding: "14px 12px", border: "1.5px solid #444", borderRadius: 12, fontSize: 16, background: "#2a2a3e", color: "#fff", boxSizing: "border-box", outline: "none" };
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#13131f", padding: "0 24px", fontFamily: "var(--font-sans),-apple-system,sans-serif" }}>
      <div style={{ fontSize: 52, marginBottom: 12 }}>🐷</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", marginBottom: 4 }}>Control de Granges</div>
      <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginBottom: 36 }}>Inicia sessió per continuar</div>
      <div style={{ width: "100%", maxWidth: 340 }}>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.6)", display: "block", marginBottom: 6 }}>Usuari</label>
          <input type="text" value={usuari} onChange={e => { setUsuari(e.target.value); setError(false); }} placeholder="Usuari" autoCapitalize="none" style={inp} />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.6)", display: "block", marginBottom: 6 }}>Contrasenya</label>
          <div style={{ position: "relative" }}>
            <input type={mostrar ? "text" : "password"} value={contrasenya} onChange={e => { setContrasenya(e.target.value); setError(false); }} onKeyDown={e => e.key === "Enter" && handleLogin()} placeholder="Contrasenya" style={{ ...inp, paddingRight: 48 }} />
            <button onClick={() => setMostrar(v => !v)} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", border: "none", background: "transparent", color: "rgba(255,255,255,0.4)", fontSize: 18, cursor: "pointer", padding: 0 }}>{mostrar ? "🙈" : "👁️"}</button>
          </div>
        </div>
        {error && <div style={{ background: "#FCEBEB", border: "1px solid #F7C1C1", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#A32D2D", marginBottom: 14, textAlign: "center" }}>Usuari o contrasenya incorrectes</div>}
        <button onClick={handleLogin} style={{ width: "100%", padding: "15px", background: "#1D9E75", border: "none", borderRadius: 14, fontSize: 16, fontWeight: 700, color: "#fff", cursor: "pointer" }}>Entrar</button>
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

function AppInterna() {
  const [fase, setFase] = useState("engreix");
  const [data, setData] = useState({ transicio: [], preengreix: [], engreix: [] });
  const [carregant] = useState(false);
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

  const toast = useCallback((msg, t = "ok") => {
    const id = Date.now(); setToasts(ts => [...ts, { id, msg, t }]);
    setTimeout(() => setToasts(ts => ts.filter(x => x.id !== id)), 3500);
  }, []);

  const granges = data[fase] || [];
  const granja = granges.find(g => g.id === granjaId);
  const lot = granja?.lots.find(l => l.id === lotId);
  const stats = lot ? calcStats(lot) : null;
  const fc = FASES[fase];

  const totesAlertes = Object.entries(data).flatMap(([f, gs]) => gs.flatMap(g => g.lots.flatMap(l => detectarAlertes(l, g.nom, f))));
  const novesAlertes = totesAlertes.filter(a => !dismissed.has(`${a.fase}-${a.granja}-${a.lot}-${a.regla}`));
  const nCrit = novesAlertes.filter(a => a.nivell === "alerta").length;

  const lotsActius = granges.flatMap(g => g.lots.filter(l => l.estat === "obert").map(l => ({ ...l, _gnom: g.nom, _gid: g.id })));
  const lotsPerDesti = Object.keys(FASES).flatMap(f =>
    (data[f] || []).flatMap(g => g.lots.filter(l => l.estat === "obert" && !(f === fase && g.id === granjaId && l.id === lotId))
      .map(l => ({ value: String(l.id), label: "[" + FASES[f].label + "] " + g.nom + " / " + l.nom })))
  );
  const goLot = (gid, lid) => { setGranjaId(gid); setLotId(lid); setTabLot("resum"); setNav("lots"); };

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
    toast("Lot creat ✓"); setModal(null); setLotId(lotData.id);
  };

  const handleNovaGranja = async vals => {
    if (!vals.nom) return;
    const { data: gData, error } = await supabase.from("granges").insert({ nom: vals.nom, fase }).select().single();
    if (error) { toast("Error en crear granja ❌", "alerta"); return; }
    toast("Granja creada ✓"); setModal(null); setGranjaId(gData.id);
  };

  const handleTancarLot = async () => {
    await supabase.from("lots").update({ estat: "tancat" }).eq("id", lotId);
    setConfirmTancar(false); toast("Lot tancat");
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
          {tabLot === "entrades" && lot.entrades.map((e, i) => (<div key={e.id} style={{ background: "var(--color-background-secondary)", borderRadius: 12, padding: "14px", marginBottom: 8 }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ fontWeight: 600 }}>Entrada {i + 1}</span><span style={{ fontSize: 12, color: "#888" }}>{e.data}</span></div><div style={{ fontSize: 14, fontWeight: 500, marginBottom: 2 }}>{e.caps} caps</div><div style={{ fontSize: 13, color: "#555" }}>{e.pesKg.toLocaleString()} kg · {(e.pesKg / e.caps).toFixed(1)} kg/cap</div>{e.origen && <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>📦 {e.origen}</div>}</div>))}
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
        return (<div key={g.id} onClick={() => setGranjaId(g.id)} style={{ margin: "0 12px 10px", background: "var(--color-background-secondary)", borderRadius: 16, padding: "16px", cursor: "pointer", border: "1.5px solid " + (critG ? "#F7C1C1" : avisG ? "#FAC775" : "transparent") }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{g.nom}</div>
            {critG && <span style={{ fontSize: 11, background: "#FCEBEB", color: "#A32D2D", borderRadius: 8, padding: "2px 8px", fontWeight: 600 }}>ALERTA</span>}
            {!critG && avisG && <span style={{ fontSize: 11, background: "#FAEEDA", color: "#633806", borderRadius: 8, padding: "2px 8px", fontWeight: 600 }}>AVÍS</span>}
          </div>
          <div style={{ fontSize: 13, color: "#888" }}>{g.lots.length} lots · {lotsO} obert{lotsO !== 1 ? "s" : ""}</div>
        </div>);
      })}
      {granjaId && granja?.lots.map(l => {
        const st = calcStats(l); const hc = heatColor(st.pct); const b = bdg(l.estat);
        const als = detectarAlertes(l, granja.nom, fase);
        const crit = als.some(a => a.nivell === "alerta"); const avis = als.some(a => a.nivell === "avis");
        return (<div key={l.id} onClick={() => { setLotId(l.id); setTabLot("resum"); }} style={{ margin: "0 12px 10px", background: "var(--color-background-secondary)", borderRadius: 16, padding: "16px", cursor: "pointer", border: "1.5px solid " + (crit ? "#F7C1C1" : avis ? "#FAC775" : "transparent") }}>
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

  return (
    <div style={{ fontFamily: "var(--font-sans),-apple-system,BlinkMacSystemFont,sans-serif", fontSize: 14, color: "var(--color-text-primary)", display: "flex", flexDirection: "column", height: "100vh", maxWidth: 480, margin: "0 auto", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 300, display: "flex", flexDirection: "column", gap: 6, pointerEvents: "none", width: "90%", maxWidth: 400 }}>
        {toasts.map(t => (<div key={t.id} style={{ background: t.t === "alerta" ? "#FCEBEB" : t.t === "avis" ? "#FAEEDA" : "#1D9E75", color: t.t === "alerta" ? "#A32D2D" : t.t === "avis" ? "#633806" : "#fff", borderRadius: 12, padding: "12px 18px", fontSize: 14, fontWeight: 500, textAlign: "center", boxShadow: "0 4px 20px rgba(0,0,0,0.15)" }}>{t.msg}</div>))}
      </div>
      <div style={{ background: "var(--color-background-primary)", borderBottom: "1px solid #f0f0f0", padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
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
        {nav === "lots" && !lotId && <LlistaLots />}
        {nav === "lots" && lotId && <LotDetall />}
        {nav === "exportacio" && <PantallaExportacio data={data} />}
      </div>
      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, background: "var(--color-background-primary)", borderTop: "1px solid #f0f0f0", display: "flex", zIndex: 100 }}>
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
            {vals.tipusDesti === "lot" && <div style={{ marginBottom: 14 }}><label style={{ fontSize: 15, fontWeight: 600, color: "#fff", display: "block", marginBottom: 7 }}>Lot de destí</label><select value={vals.destiLot || ""} onChange={e => setVals(v => ({ ...v, destiLot: e.target.value }))} style={{ width: "100%", padding: "13px 12px", border: "1.5px solid #444", borderRadius: 12, fontSize: 14, background: "#2a2a3e", color: "#fff", boxSizing: "border-box" }}><option value="">— Selecciona —</option>{lotsPerDesti.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>}
            {(vals.tipusDesti === "escorxador" || vals.tipusDesti === "altre") && <div style={{ marginBottom: 14 }}><label style={{ fontSize: 15, fontWeight: 600, color: "#fff", display: "block", marginBottom: 7 }}>{vals.tipusDesti === "escorxador" ? "Nom escorxador (opcional)" : "Destí (opcional)"}</label><input type="text" value={vals.desti || ""} onChange={e => setVals(v => ({ ...v, desti: e.target.value }))} placeholder={vals.tipusDesti === "escorxador" ? "Ex: Escorxador Girona" : "Ex: Venda directa"} style={{ width: "100%", padding: "13px 12px", border: "1.5px solid #444", borderRadius: 12, fontSize: 15, background: "#2a2a3e", color: "#fff", boxSizing: "border-box" }} /></div>}
          </div>
        )}
        onConfirm={handleSortida} onCancel={() => setModal(null)} />}

      {modal === "baixa" && <ModalForm title="Registrar baixa" confirmLabel="Confirmar baixa" confirmColor="#C0392B" fields={[{ key: "data", label: "Data", type: "date", default: TODAY }, { key: "caps", label: "Caps", type: "number", inputMode: "numeric", placeholder: "Quants animals?" }, { key: "causa", label: "Causa (opcional)", type: "text", placeholder: "Ex: Diarrea, Respiratòria..." }]} onConfirm={handleBaixa} onCancel={() => setModal(null)} />}

      {modal === "tractament" && <ModalForm title="Registrar tractament" confirmLabel="Guardar tractament" confirmColor="#1A4DB0" fields={[{ key: "data", label: "Data", type: "date", default: TODAY }, { key: "medicament", label: "Nom comercial del medicament", type: "text", placeholder: "Ex: Amoxicil·lina 150mg" }, { key: "recepta", label: "Número de recepta", type: "text", placeholder: "Ex: REC-2026-00123" }, { key: "caps", label: "Nombre d'animals tractats (opcional)", type: "number", inputMode: "numeric", placeholder: "Ex: 12" }, { key: "identificacio", label: "Identificació dels animals", type: "text", placeholder: "Corral infermeria", default: "Corral infermeria" }]} onConfirm={handleTractament} onCancel={() => setModal(null)} />}

      {modal === "nouLot" && <ModalForm title="Nou lot" confirmLabel="Crear lot" confirmColor={fc.color} fields={[{ key: "nom", label: "Nom del lot", type: "text", placeholder: "Ex: Lot C-26" }, { key: "data", label: "Data entrada", type: "date", default: TODAY }, { key: "caps", label: "Caps d'entrada", type: "number", inputMode: "numeric" }, { key: "pesKg", label: "Pes total entrada (kg)", type: "number", inputMode: "decimal" }, { key: "origen", label: "Origen (opcional)", type: "text", placeholder: fase === "transicio" ? "Ex: Maternitat Mas Colell" : fase === "preengreix" ? "Ex: Lot de transició" : "Ex: Proveïdor Germans Puig" }]} onConfirm={handleNouLot} onCancel={() => setModal(null)} />}

      {modal === "novaGranja" && <ModalForm title="Nova granja" confirmLabel="Crear granja" confirmColor={fc.color} fields={[{ key: "nom", label: "Nom de la granja", type: "text", placeholder: "Ex: Granja Can Puig" }]} onConfirm={handleNovaGranja} onCancel={() => setModal(null)} />}

      {sortidaPendent && (() => {
        const fd = sortidaPendent.faseDesti;
        const fcDesti = FASES[fd];
        return (
          <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", flexDirection: "column", justifyContent: "flex-end", background: "rgba(0,0,0,0.6)" }}>
            <div style={{ background: "#1e1e2e", borderRadius: "20px 20px 0 0", padding: "20px 16px 32px", maxHeight: "90vh", overflowY: "auto" }}>
              <div style={{ width: 40, height: 4, background: "rgba(255,255,255,0.3)", borderRadius: 2, margin: "0 auto 16px" }} />
              <div style={{ fontSize: 11, fontWeight: 600, color: fcDesti.color, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>Flux automàtic {fcDesti.emoji}</div>
              <div style={{ fontSize: 19, fontWeight: 700, color: "#fff", marginBottom: 6 }}>Crear lot de {fcDesti.label}</div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", marginBottom: 20 }}>Caps, pes i data ja venen de la sortida anterior.</div>
              <div style={{ background: fcDesti.color + "22", border: "1px solid " + fcDesti.color + "55", borderRadius: 12, padding: "12px 14px", marginBottom: 20, display: "flex", gap: 16, flexWrap: "wrap" }}>
                {[["Caps", sortidaPendent.caps], ["Pes total", sortidaPendent.pesKg + " kg"], ["Pes mig", (sortidaPendent.pesKg / sortidaPendent.caps).toFixed(1) + " kg"], ["Data", sortidaPendent.data]].map(([lbl, val]) => (<div key={lbl} style={{ textAlign: "center" }}><div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginBottom: 2 }}>{lbl}</div><div style={{ fontSize: 16, fontWeight: 700, color: fcDesti.color }}>{val}</div></div>))}
              </div>
              <div style={{ marginBottom: 14 }}><label style={{ fontSize: 15, fontWeight: 600, color: "#fff", display: "block", marginBottom: 7 }}>Nom del nou lot de {fcDesti.label}</label><input type="text" placeholder={"Ex: " + (fd === "preengreix" ? "Pre" : "Lot") + " C-26"} value={sortidaPendent.nomLot || ""} onChange={e => setSortidaPendent(p => ({ ...p, nomLot: e.target.value }))} style={{ width: "100%", padding: "13px 12px", border: "1.5px solid #444", borderRadius: 12, fontSize: 15, background: "#2a2a3e", color: "#fff", boxSizing: "border-box" }} /></div>
              <div style={{ marginBottom: 20 }}><label style={{ fontSize: 15, fontWeight: 600, color: "#fff", display: "block", marginBottom: 7 }}>Granja de destí</label>
                <select value={sortidaPendent.granjaDestiId || ""} onChange={e => setSortidaPendent(p => ({ ...p, granjaDestiId: e.target.value }))} style={{ width: "100%", padding: "13px 12px", border: "1.5px solid #444", borderRadius: 12, fontSize: 15, background: "#2a2a3e", color: "#fff", boxSizing: "border-box" }}>
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
        <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", flexDirection: "column", justifyContent: "flex-end", background: "rgba(0,0,0,0.6)" }}>
          <div style={{ background: "#1e1e2e", borderRadius: "20px 20px 0 0", padding: "24px 16px 32px" }}>
            <div style={{ width: 40, height: 4, background: "rgba(255,255,255,0.3)", borderRadius: 2, margin: "0 auto 20px" }} />
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: "#fff" }}>Tancar lot?</div>
            <div style={{ fontSize: 14, color: "rgba(255,255,255,0.6)", marginBottom: 24 }}>Un cop tancat no es podran afegir més registres al lot.</div>
            <button onClick={handleTancarLot} style={{ width: "100%", padding: "15px", background: "#E24B4A", border: "none", borderRadius: 14, fontSize: 16, fontWeight: 600, color: "#fff", cursor: "pointer", marginBottom: 10 }}>Confirmar tancament</button>
            <button onClick={() => setConfirmTancar(false)} style={{ width: "100%", padding: "14px", background: "transparent", border: "none", fontSize: 15, color: "rgba(255,255,255,0.5)", cursor: "pointer" }}>Cancel·lar</button>
          </div>
        </div>
      )}
    </div>
  );
}
