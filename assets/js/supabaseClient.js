const SUPABASE_URL = "https://qiiqelydamghbzowgkof.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_IbZYZiUPwPkVChQIEJA_OQ_2IPefV7o";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

function getRedirectUrl(page) {
  return new URL(page, window.location.href).href;
}

async function getSessionUser() {
  const { data, error } = await db.auth.getUser();

  if (error) {
    return null;
  }

  return data.user;
}

function formatPrice(value) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0
  }).format(Number(value));
}
