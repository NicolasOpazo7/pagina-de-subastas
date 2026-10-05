const filterToggle = document.querySelector("#filter-toggle");
const filterClose = document.querySelector("#filter-close");
const filterPanel = document.querySelector("#filter-panel");
const searchInput = document.querySelector("#product-search");
const categoryFilter = document.querySelector("#category-filter");
const priceFilter = document.querySelector("#price-filter");
const dateFilter = document.querySelector("#date-filter");
const featuredFilter = document.querySelector("#featured-filter");
const clearFilters = document.querySelector("#clear-filters");
const resultCount = document.querySelector("#result-count");
const emptyResults = document.querySelector("#empty-results");
const productGrid = document.querySelector(".product-grid");
const bidModal = document.querySelector("#bid-modal");
const bidModalClose = document.querySelector("#bid-modal-close");
const bidForm = document.querySelector("#bid-form");
const bidModalTitle = document.querySelector("#bid-modal-title");
const bidModalProduct = document.querySelector("#bid-modal-product");
const bidCurrentPrice = document.querySelector("#bid-current-price");
const bidAmount = document.querySelector("#bid-amount");
const bidError = document.querySelector("#bid-error");
const bidStatus = document.querySelector("#bid-status");
let productCards = Array.from(document.querySelectorAll(".product-card"));
let activeBidProduct = null;

function normalizeText(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getDateFilter(endsAt) {
  const now = new Date();
  const end = new Date(endsAt);
  const hoursLeft = (end - now) / 36e5;

  if (hoursLeft <= 24) {
    return "today";
  }

  if (hoursLeft <= 168) {
    return "week";
  }

  return "later";
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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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

function toggleFilters(forceOpen) {
  const shouldOpen = typeof forceOpen === "boolean"
    ? forceOpen
    : !filterPanel.classList.contains("is-open");

  filterPanel.classList.toggle("is-open", shouldOpen);
  filterToggle.setAttribute("aria-expanded", String(shouldOpen));
}

function productMatchesSearch(card, query) {
  if (!query) {
    return true;
  }

  return normalizeText(card.textContent).includes(query);
}

function productMatchesFilters(card) {
  const category = categoryFilter.value;
  const maxPrice = priceFilter.value;
  const closingDate = dateFilter.value;
  const onlyFeatured = featuredFilter.checked;
  const price = Number(card.dataset.price);

  if (category !== "all" && normalizeText(card.dataset.category) !== category) {
    return false;
  }

  if (maxPrice !== "all" && price > Number(maxPrice)) {
    return false;
  }

  if (closingDate !== "all" && card.dataset.date !== closingDate) {
    return false;
  }

  if (onlyFeatured && card.dataset.featured !== "true") {
    return false;
  }

  return true;
}

function applyProductFilters() {
  const query = normalizeText(searchInput.value.trim());
  let visibleCount = 0;

  productCards.forEach((card) => {
    const isVisible = productMatchesSearch(card, query) && productMatchesFilters(card);
    card.hidden = !isVisible;

    if (isVisible) {
      visibleCount += 1;
    }
  });

  resultCount.textContent = `${visibleCount} producto${visibleCount === 1 ? "" : "s"} encontrado${visibleCount === 1 ? "" : "s"}`;
  emptyResults.hidden = visibleCount > 0;
}

function resetFilters() {
  searchInput.value = "";
  categoryFilter.value = "all";
  priceFilter.value = "all";
  dateFilter.value = "all";
  featuredFilter.checked = false;
  applyProductFilters();
}

function applyInitialCategoryFromUrl() {
  const category = normalizeText(new URLSearchParams(window.location.search).get("category") || "");

  if (!category) {
    return;
  }

  const hasCategory = Array.from(categoryFilter.options).some((option) => option.value === category);

  if (hasCategory) {
    categoryFilter.value = category;
  }
}

function renderProductCard(product) {
  const card = document.createElement("article");
  const images = getProductImages(product);
  const detailUrl = `pages/producto.html?id=${encodeURIComponent(product.id)}`;
  card.className = "product-card";
  card.dataset.id = product.id;
  card.dataset.name = product.title;
  card.dataset.category = normalizeText(product.category);
  card.dataset.price = product.current_price;
  card.dataset.date = getDateFilter(product.ends_at);
  card.dataset.featured = String(product.is_featured);
  card.dataset.title = product.title;
  card.dataset.description = product.description;
  card.dataset.currentPrice = product.current_price;
  card.innerHTML = `
    <div class="product-carousel" data-carousel>
      ${images.map((image, index) => `
        <img class="${index === 0 ? "is-active" : ""}" src="${escapeHtml(image)}" alt="${escapeHtml(product.title)}">
      `).join("")}
      ${images.length > 1 ? `<span class="image-count">1/${images.length}</span>` : ""}
    </div>
    <div class="card-content">
      <div class="card-topline">
        <span>${escapeHtml(product.category)}</span>
        <span>${getTimeLeft(product.ends_at)}</span>
      </div>
      <h3>${escapeHtml(product.title)}</h3>
      <p>${escapeHtml(product.description)}</p>
      <a class="text-link card-detail-link" href="${detailUrl}">Ver detalle</a>
      <div class="bid-row">
        <div>
          <span class="label">Oferta mas alta</span>
          <strong>${formatPrice(product.current_price)}</strong>
        </div>
        <button type="button" data-bid-product="${product.id}">Ofertar</button>
      </div>
    </div>
  `;

  return card;
}

function startCarousels() {
  document.querySelectorAll("[data-carousel]").forEach((carousel) => {
    const images = Array.from(carousel.querySelectorAll("img"));
    const counter = carousel.querySelector(".image-count");
    let activeIndex = 0;

    if (images.length < 2) {
      return;
    }

    setInterval(() => {
      images[activeIndex].classList.remove("is-active");
      activeIndex = (activeIndex + 1) % images.length;
      images[activeIndex].classList.add("is-active");

      if (counter) {
        counter.textContent = `${activeIndex + 1}/${images.length}`;
      }
    }, 10000);
  });
}

function openBidModal(productId) {
  const card = productCards.find((item) => item.dataset.id === productId);

  if (!card) {
    return;
  }

  activeBidProduct = {
    id: productId,
    title: card.dataset.title,
    currentPrice: Number(card.dataset.currentPrice || card.dataset.price)
  };

  bidModalTitle.textContent = "Hacer una oferta";
  bidModalProduct.textContent = activeBidProduct.title;
  bidCurrentPrice.textContent = formatPrice(activeBidProduct.currentPrice);
  bidAmount.value = "";
  bidAmount.min = String(activeBidProduct.currentPrice + 1000);
  bidError.textContent = "";
  bidStatus.textContent = "";
  bidModal.hidden = false;
  bidAmount.focus();
}

function closeBidModal() {
  bidModal.hidden = true;
  activeBidProduct = null;
}

async function placeBid(productId, amount) {
  const user = await getSessionUser();

  if (!user) {
    window.location.href = "pages/login.html";
    return;
  }

  if (!amount || amount <= activeBidProduct.currentPrice) {
    bidError.textContent = "La oferta debe superar la oferta actual.";
    return;
  }

  bidStatus.textContent = "Enviando oferta...";

  const { data, error } = await db.rpc("place_bid", {
    product_id: productId,
    bid_amount: amount
  });

  if (error) {
    bidStatus.textContent = "";
    bidError.textContent = error.message;
    return;
  }

  const card = productCards.find((item) => item.dataset.id === data.id);

  if (card) {
    card.dataset.price = data.current_price;
    card.dataset.currentPrice = data.current_price;
    card.querySelector(".bid-row strong").textContent = formatPrice(data.current_price);
  }

  closeBidModal();
  applyProductFilters();
}

function bindBidButtons() {
  document.querySelectorAll("[data-bid-product]").forEach((button) => {
    button.addEventListener("click", () => openBidModal(button.dataset.bidProduct));
  });
}

function bindStaticDetailLinks() {
  productCards.forEach((card) => {
    if (card.querySelector(".card-detail-link") || !card.dataset.id) {
      return;
    }

    const link = document.createElement("a");
    link.className = "text-link card-detail-link";
    link.href = `pages/producto.html?id=${encodeURIComponent(card.dataset.id)}`;
    link.textContent = "Ver detalle";
    card.querySelector(".card-content")?.insertBefore(link, card.querySelector(".bid-row"));
  });
}

async function loadProductsFromSupabase() {
  if (!window.supabase || !db) {
    bindStaticDetailLinks();
    bindBidButtons();
    applyProductFilters();
    return;
  }

  await closeExpiredAuctions();

  const { data, error } = await db
    .from("products")
    .select("id, title, description, category, image_url, current_price, ends_at, is_featured, product_images(image_url, display_order)")
    .eq("status", "open")
    .order("is_featured", { ascending: false })
    .order("created_at", { ascending: false });

  if (error || !data || data.length === 0) {
    bindStaticDetailLinks();
    bindBidButtons();
    applyProductFilters();
    return;
  }

  productGrid.innerHTML = "";
  data.forEach((product) => productGrid.appendChild(renderProductCard(product)));
  productCards = Array.from(document.querySelectorAll(".product-card"));
  bindBidButtons();
  startCarousels();
  applyInitialCategoryFromUrl();
  applyProductFilters();
}

if (filterToggle && filterPanel) {
  filterToggle.addEventListener("click", () => toggleFilters());
}

if (filterClose) {
  filterClose.addEventListener("click", () => toggleFilters(false));
}

[searchInput, categoryFilter, priceFilter, dateFilter, featuredFilter].forEach((control) => {
  control.addEventListener("input", applyProductFilters);
  control.addEventListener("change", applyProductFilters);
});

clearFilters.addEventListener("click", resetFilters);
applyInitialCategoryFromUrl();
bidModalClose.addEventListener("click", closeBidModal);
bidModal.addEventListener("click", (event) => {
  if (event.target === bidModal) {
    closeBidModal();
  }
});
bidForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!activeBidProduct) {
    return;
  }

  placeBid(activeBidProduct.id, Number(bidAmount.value));
});
loadProductsFromSupabase();
