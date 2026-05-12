import supabase from "../supabase";
export async function carregarTot() {
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