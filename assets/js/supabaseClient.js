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

async function closeExpiredAuctions() {
  const { error } = await db.rpc("close_expired_auctions");

  return !error;
}

function getErrorMessage(error, fallback = "Ocurrio un error inesperado.") {
  return error?.message || fallback;
}

function setLoading(control, isLoading, loadingText = "Procesando...") {
  if (!control) {
    return;
  }

  if (isLoading) {
    control.dataset.originalText = control.textContent;
    control.textContent = loadingText;
    control.disabled = true;
    return;
  }

  control.disabled = false;

  if (control.dataset.originalText) {
    control.textContent = control.dataset.originalText;
    delete control.dataset.originalText;
  }
}

function isFutureDateTime(value) {
  if (!value) {
    return false;
  }

  return new Date(value).getTime() > Date.now();
}

function formatPrice(value) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0
  }).format(Number(value));
}
