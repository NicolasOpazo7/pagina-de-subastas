const productDetail = document.querySelector("#product-detail");
const detailEmpty = document.querySelector("#detail-empty");
const detailMainImage = document.querySelector("#detail-main-image");
const detailThumbs = document.querySelector("#detail-thumbs");
const detailCategory = document.querySelector("#detail-category");
const detailTitle = document.querySelector("#detail-title");
const detailDescription = document.querySelector("#detail-description");
const detailCurrentPrice = document.querySelector("#detail-current-price");
const detailStartingPrice = document.querySelector("#detail-starting-price");
const detailTimeLeft = document.querySelector("#detail-time-left");
const detailOpenBid = document.querySelector("#detail-open-bid");
const detailStatus = document.querySelector("#detail-status");
const bidHistoryPanel = document.querySelector("#bid-history-panel");
const bidHistoryList = document.querySelector("#bid-history-list");
const bidHistoryEmpty = document.querySelector("#bid-history-empty");
const bidModal = document.querySelector("#bid-modal");
const bidModalClose = document.querySelector("#bid-modal-close");
const bidForm = document.querySelector("#bid-form");
const bidModalProduct = document.querySelector("#bid-modal-product");
const bidCurrentPrice = document.querySelector("#bid-current-price");
const bidAmount = document.querySelector("#bid-amount");
const bidError = document.querySelector("#bid-error");
const bidStatus = document.querySelector("#bid-status");

let currentProduct = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getProductId() {
  return new URLSearchParams(window.location.search).get("id");
}

function getTimeLeft(endsAt) {
  const diff = new Date(endsAt) - new Date();

  if (diff <= 0) {
    return "Cerrada";
  }

  const hours = Math.floor(diff / 36e5);
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;

  if (days > 0) {
    return `${days}d ${remainingHours}h`;
  }

  return `${hours}h`;
}

function getProductImages(product) {
  const uploadedImages = Array.isArray(product.product_images)
    ? product.product_images
      .slice()
      .sort((a, b) => a.display_order - b.display_order)
      .map((image) => image.image_url)
    : [];

  if (uploadedImages.length > 0) {
    return uploadedImages;
  }

  if (product.image_url) {
    return [product.image_url];
  }

  return ["https://images.unsplash.com/photo-1607083206968-13611e3d76db?auto=format&fit=crop&w=900&q=80"];
}

function selectImage(src, button) {
  detailMainImage.src = src;

  document.querySelectorAll(".detail-thumb").forEach((thumb) => {
    thumb.classList.toggle("is-active", thumb === button);
  });
}

function renderGallery(product) {
  const images = getProductImages(product);
  detailMainImage.src = images[0];
  detailMainImage.alt = product.title;
  detailThumbs.innerHTML = "";

  images.forEach((image, index) => {
    const button = document.createElement("button");
    button.className = `detail-thumb ${index === 0 ? "is-active" : ""}`;
    button.type = "button";
    button.innerHTML = `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.title)} imagen ${index + 1}">`;
    button.addEventListener("click", () => selectImage(image, button));
    detailThumbs.appendChild(button);
  });
}

function renderProduct(product) {
  currentProduct = product;
  document.title = `${product.title} | Aurum Subastas`;
  detailCategory.textContent = product.category;
  detailTitle.textContent = product.title;
  detailDescription.textContent = product.description;
  detailCurrentPrice.textContent = formatPrice(product.current_price);
  detailStartingPrice.textContent = formatPrice(product.starting_price);
  detailTimeLeft.textContent = getTimeLeft(product.ends_at);
  detailOpenBid.disabled = product.status !== "open" || new Date(product.ends_at) <= new Date();
  detailOpenBid.textContent = detailOpenBid.disabled ? "Subasta cerrada" : "Hacer una oferta";
  renderGallery(product);
  detailEmpty.hidden = true;
  productDetail.hidden = false;
}

function renderBidHistoryItem(bid, index) {
  const item = document.createElement("article");
  item.className = "bid-history-item";
  item.innerHTML = `
    <span>#${index + 1}</span>
    <strong>${formatPrice(bid.amount)}</strong>
    <small>${new Date(bid.created_at).toLocaleString("es-CL")}</small>
  `;
  bidHistoryList.appendChild(item);
}

async function loadBidHistory(productId) {
  const { data, error } = await db.rpc("get_product_bid_history", {
    target_product_id: productId
  });

  bidHistoryPanel.hidden = false;
  bidHistoryList.innerHTML = "";

  if (error) {
    bidHistoryEmpty.hidden = false;
    bidHistoryEmpty.textContent = error.message.includes("get_product_bid_history")
      ? "Ejecuta database/migrations/003_product_bid_history.sql en Supabase para activar el historial."
      : error.message;
    return;
  }

  bidHistoryEmpty.hidden = data?.length > 0;
  (data || []).forEach(renderBidHistoryItem);
}

function openBidModal() {
  if (!currentProduct) {
    return;
  }

  bidModalProduct.textContent = currentProduct.title;
  bidCurrentPrice.textContent = formatPrice(currentProduct.current_price);
  bidAmount.value = "";
  bidAmount.min = String(Number(currentProduct.current_price) + 1000);
  bidError.textContent = "";
  bidStatus.textContent = "";
  bidModal.hidden = false;
  bidAmount.focus();
}

function closeBidModal() {
  bidModal.hidden = true;
}

async function placeBid(amount) {
  const user = await getSessionUser();

  if (!user) {
    window.location.href = "login.html";
    return;
  }

  if (!amount || amount <= Number(currentProduct.current_price)) {
    bidError.textContent = "La oferta debe superar la oferta actual.";
    return;
  }

  bidStatus.textContent = "Enviando oferta...";

  const { data, error } = await db.rpc("place_bid", {
    product_id: currentProduct.id,
    bid_amount: amount
  });

  if (error) {
    bidStatus.textContent = "";
    bidError.textContent = error.message;
    return;
  }

  currentProduct = { ...currentProduct, current_price: data.current_price };
  detailCurrentPrice.textContent = formatPrice(data.current_price);
  closeBidModal();
  detailStatus.textContent = "Oferta enviada correctamente.";
  await loadBidHistory(currentProduct.id);
}

async function loadProductDetail() {
  const productId = getProductId();

  if (!productId) {
    detailEmpty.textContent = "No se indico ningun producto.";
    return;
  }

  await closeExpiredAuctions();

  const { data, error } = await db
    .from("products")
    .select("id, title, description, category, image_url, starting_price, current_price, ends_at, is_featured, status, product_images(image_url, display_order)")
    .eq("id", productId)
    .single();

  if (error || !data) {
    detailEmpty.textContent = error?.message || "No se encontro el producto.";
    return;
  }

  renderProduct(data);
  await loadBidHistory(data.id);
}

detailOpenBid.addEventListener("click", openBidModal);
bidModalClose.addEventListener("click", closeBidModal);
bidModal.addEventListener("click", (event) => {
  if (event.target === bidModal) {
    closeBidModal();
  }
});
bidForm.addEventListener("submit", (event) => {
  event.preventDefault();
  placeBid(Number(bidAmount.value));
});

loadProductDetail();
