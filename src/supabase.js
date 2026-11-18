import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_KEY;

export const supabase = createClient(url, key);

// Client secundari per donar d'alta usuaris sense alterar la sessió de l'administrador.
// No persisteix ni refresca cap sessió, així que el signUp no desconnecta qui està logat.
export const crearClientAlta = () => createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
