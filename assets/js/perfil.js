const profileTitle = document.querySelector("#profile-title");
const profileDescription = document.querySelector("#profile-description");
const profileName = document.querySelector("#profile-name");
const profileEmail = document.querySelector("#profile-email");
const profileRole = document.querySelector("#profile-role");
const adminPanel = document.querySelector("#admin-panel");
const userPanel = document.querySelector("#user-panel");
const userBids = document.querySelector("#user-bids");
const userBidsEmpty = document.querySelector("#user-bids-empty");
const userBidsTotal = document.querySelector("#user-bids-total");
const userWinningTotal = document.querySelector("#user-winning-total");
const userHighestBid = document.querySelector("#user-highest-bid");
const sellerPanel = document.querySelector("#seller-panel");
const sellerProducts = document.querySelector("#seller-products");
const sellerEmpty = document.querySelector("#seller-empty");
const sellerTotal = document.querySelector("#seller-total");
const sellerFeatured = document.querySelector("#seller-featured");
const sellerHighest = document.querySelector("#seller-highest");
const dealPanel = document.querySelector("#deal-panel");
const activeDealList = document.querySelector("#active-deal-list");
const completedDealList = document.querySelector("#completed-deal-list");
const activeDealsCount = document.querySelector("#active-deals-count");
const completedDealsCount = document.querySelector("#completed-deals-count");
const dealEmpty = document.querySelector("#deal-empty");
const logoutButton = document.querySelector("#logout-button");
const editModal = document.querySelector("#edit-product-modal");
const editModalClose = document.querySelector("#edit-modal-close");
const editForm = document.querySelector("#edit-product-form");
const editProductId = document.querySelector("#edit-product-id");
const editTitle = document.querySelector("#edit-title");
const editDescription = document.querySelector("#edit-description");
const editCategory = document.querySelector("#edit-category");
const editEnds = document.querySelector("#edit-ends");
const editFeatured = document.querySelector("#edit-featured");
const editImageList = document.querySelector("#edit-image-list");
const editImages = document.querySelector("#edit-images");
const editStatus = document.querySelector("#edit-status");
const deleteModal = document.querySelector("#delete-product-modal");
const deleteModalClose = document.querySelector("#delete-modal-close");
const deleteProductCopy = document.querySelector("#delete-product-copy");
const deletePreview = document.querySelector("#delete-preview");
const cancelDelete = document.querySelector("#cancel-delete");
const confirmDelete = document.querySelector("#confirm-delete");
const deleteStatus = document.querySelector("#delete-status");
const logoutModal = document.querySelector("#logout-modal");
const logoutModalClose = document.querySelector("#logout-modal-close");
const cancelLogout = document.querySelector("#cancel-logout");
const confirmLogout = document.querySelector("#confirm-logout");
const logoutStatus = document.querySelector("#logout-status");
const dealModal = document.querySelector("#deal-modal");
const dealModalClose = document.querySelector("#deal-modal-close");
const dealModalTitle = document.querySelector("#deal-modal-title");
const dealModalCopy = document.querySelector("#deal-modal-copy");
const dealBuyerStatus = document.querySelector("#deal-buyer-status");
const dealSellerStatus = document.querySelector("#deal-seller-status");
const dealMessages = document.querySelector("#deal-messages");
const dealMessageForm = document.querySelector("#deal-message-form");
const dealMessageInput = document.querySelector("#deal-message-input");
const refreshDeal = document.querySelector("#refresh-deal");
const confirmDeal = document.querySelector("#confirm-deal");
const dealStatus = document.querySelector("#deal-status");
let currentUserId = null;
let sellerProductList = [];
let dealItems = [];
let pendingDeleteProductId = null;
let activeDealId = null;
let activeDealChannel = null;

function getBidStatus(bid) {
  if (!bid.products) {
    return {
      label: "Producto no disponible",
      className: "is-lost"
    };
  }

  if (bid.products.status !== "open" || new Date(bid.products.ends_at) <= new Date()) {
    return {
      label: "Finalizada",
      className: "is-closed"
    };
  }

  if (Number(bid.amount) >= Number(bid.products.current_price)) {
    return {
      label: "Vas ganando",
      className: "is-winning"
    };
  }

  return {
    label: "Superada",
    className: "is-lost"
  };
}

function roleLabel(role) {
  const labels = {
    admin: "Administrador",
    usuario: "Usuario",
    subastador: "Subastador"
  };

  return labels[role] || role;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function toDateTimeLocal(value) {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function sortedImages(product) {
  return (product.product_images || [])
    .slice()
    .sort((a, b) => a.display_order - b.display_order);
}

function getProductImage(product) {
  const images = sortedImages(product);

  if (images.length > 0) {
    return images[0].image_url;
  }

  return product.image_url || "https://images.unsplash.com/photo-1607083206968-13611e3d76db?auto=format&fit=crop&w=900&q=80";
}

function renderSellerProduct(product) {
  const article = document.createElement("article");
  article.className = "seller-product";
  article.innerHTML = `
    <img src="${escapeHtml(getProductImage(product))}" alt="${escapeHtml(product.title)}">
    <div>
      <h3>${escapeHtml(product.title)}</h3>
      <p>${escapeHtml(product.category)} &middot; Cierra ${new Date(product.ends_at).toLocaleDateString("es-CL")}</p>
      <p>${sortedImages(product).length} imagen${sortedImages(product).length === 1 ? "" : "es"}</p>
    </div>
    <strong>${formatPrice(product.current_price)}</strong>
    <div class="seller-actions">
      <button class="button button-secondary" type="button" data-edit-product="${product.id}">Editar</button>
      <button class="button danger-button" type="button" data-delete-product="${product.id}">Eliminar</button>
    </div>
  `;
  sellerProducts.appendChild(article);
}

function updateSellerSummary() {
  sellerTotal.textContent = String(sellerProductList.length);
  sellerFeatured.textContent = String(sellerProductList.filter((product) => product.is_featured).length);
  const highest = sellerProductList.reduce((max, product) => Math.max(max, Number(product.current_price)), 0);
  sellerHighest.textContent = formatPrice(highest);
}

function renderUserBid(bid) {
  const product = bid.products;
  const status = getBidStatus(bid);
  const article = document.createElement("article");
  article.className = "user-bid-card";
  article.innerHTML = `
    <div>
      <span class="bid-status ${status.className}">${status.label}</span>
      <h3>${escapeHtml(product?.title || "Producto eliminado")}</h3>
      <p>${escapeHtml(product?.category || "Sin categoria")} &middot; ${product ? `Cierra ${new Date(product.ends_at).toLocaleDateString("es-CL")}` : "Sin fecha"}</p>
    </div>
    <div class="bid-amounts">
      <span>
        <small>Tu puja</small>
        <strong>${formatPrice(bid.amount)}</strong>
      </span>
      <span>
        <small>Oferta actual</small>
        <strong>${formatPrice(product?.current_price || bid.amount)}</strong>
      </span>
    </div>
  `;
  userBids.appendChild(article);
}

function getCounterpartName(deal) {
  if (deal.seller_id === currentUserId) {
    return deal.buyer?.full_name || "Comprador";
  }

  return deal.seller?.full_name || "Subastador";
}

function dealStatusLabel(deal) {
  if (deal.status === "completed") {
    return "Venta confirmada";
  }

  if (deal.buyer_confirmed || deal.seller_confirmed) {
    return "Confirmacion parcial";
  }

  return "Coordinando venta";
}

function getDealProgressText(deal) {
  if (deal.status === "completed") {
    return "Ambas partes confirmaron la venta.";
  }

  if (deal.buyer_confirmed && !deal.seller_confirmed) {
    return "Falta confirmacion del subastador.";
  }

  if (!deal.buyer_confirmed && deal.seller_confirmed) {
    return "Falta confirmacion del comprador.";
  }

  return "Ambas partes deben confirmar el acuerdo.";
}

function renderDeal(deal, targetList) {
  const product = deal.products;
  const article = document.createElement("article");
  article.className = "deal-card";
  article.innerHTML = `
    <div>
      <span class="bid-status ${deal.status === "completed" ? "is-winning" : "is-closed"}">${dealStatusLabel(deal)}</span>
      <h3>${escapeHtml(product?.title || "Producto finalizado")}</h3>
      <p>${escapeHtml(product?.category || "Sin categoria")} &middot; Con ${escapeHtml(getCounterpartName(deal))}</p>
      <p>${escapeHtml(getDealProgressText(deal))}</p>
    </div>
    <div class="deal-card-side">
      <strong>${formatPrice(deal.final_price)}</strong>
      <button class="button button-primary" type="button" data-open-deal="${deal.id}">Abrir acuerdo</button>
    </div>
  `;
  targetList.appendChild(article);
}

function bindDealActions() {
  document.querySelectorAll("[data-open-deal]").forEach((button) => {
    button.addEventListener("click", () => openDealModal(button.dataset.openDeal));
  });
}

async function ensureDealForProduct(productId) {
  const { error } = await db.rpc("ensure_auction_deal", {
    target_product_id: productId
  });

  return !error;
}

async function ensureDealsFromBids(bids) {
  const now = new Date();
  const finishedWinningBids = bids.filter((bid) => {
    const product = bid.products;
    return product
      && new Date(product.ends_at) <= now
      && Number(bid.amount) >= Number(product.current_price);
  });

  for (const bid of finishedWinningBids) {
    await ensureDealForProduct(bid.products.id);
  }
}

async function ensureDealsFromSellerProducts(products) {
  const now = new Date();
  const finishedProducts = products.filter((product) => (
    product.status === "closed" || new Date(product.ends_at) <= now
  ));

  for (const product of finishedProducts) {
    await ensureDealForProduct(product.id);
  }
}

async function loadDeals() {
  const { data, error } = await db
    .from("auction_deals")
    .select(`
      id,
      product_id,
      seller_id,
      buyer_id,
      final_price,
      seller_confirmed,
      buyer_confirmed,
      status,
      created_at,
      products(id, title, category, image_url),
      seller:profiles!auction_deals_seller_id_fkey(full_name),
      buyer:profiles!auction_deals_buyer_id_fkey(full_name)
    `)
    .order("created_at", { ascending: false });

  if (error) {
    dealPanel.hidden = false;
    dealEmpty.hidden = false;
    dealEmpty.textContent = error.message.includes("auction_deals")
      ? "Ejecuta database/auction-deals.sql en Supabase para activar los acuerdos post-subasta."
      : error.message;
    return;
  }

  dealItems = data || [];
  const activeDeals = dealItems.filter((deal) => deal.status !== "completed");
  const completedDeals = dealItems.filter((deal) => deal.status === "completed");

  activeDealList.innerHTML = "";
  completedDealList.innerHTML = "";
  dealPanel.hidden = dealItems.length === 0;
  dealEmpty.hidden = dealItems.length > 0;
  activeDealsCount.textContent = String(activeDeals.length);
  completedDealsCount.textContent = String(completedDeals.length);
  activeDeals.forEach((deal) => renderDeal(deal, activeDealList));
  completedDeals.forEach((deal) => renderDeal(deal, completedDealList));
  bindDealActions();
}

function updateUserBidSummary(bids) {
  const activeBids = bids.filter((bid) => bid.products?.status === "open" && new Date(bid.products.ends_at) > new Date());
  const winningBids = activeBids.filter((bid) => Number(bid.amount) >= Number(bid.products.current_price));
  const highestBid = bids.reduce((max, bid) => Math.max(max, Number(bid.amount)), 0);

  userBidsTotal.textContent = String(activeBids.length);
  userWinningTotal.textContent = String(winningBids.length);
  userHighestBid.textContent = formatPrice(highestBid);
}

async function loadUserBids(userId) {
  const { data, error } = await db
    .from("bids")
    .select("id, product_id, amount, created_at, products(id, title, category, current_price, ends_at, status)")
    .eq("bidder_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    userBidsEmpty.hidden = false;
    userBidsEmpty.textContent = error.message;
    return;
  }

  const bidsByProduct = new Map();

  (data || []).forEach((bid) => {
    const key = bid.product_id || bid.products?.id || bid.id;
    const current = bidsByProduct.get(key);

    if (!current || Number(bid.amount) > Number(current.amount)) {
      bidsByProduct.set(key, bid);
    }
  });

  const bids = Array.from(bidsByProduct.values());
  userBids.innerHTML = "";
  userBidsEmpty.hidden = bids.length > 0;
  bids.forEach(renderUserBid);
  updateUserBidSummary(bids);
  await ensureDealsFromBids(bids);
}

function bindProductActions() {
  document.querySelectorAll("[data-edit-product]").forEach((button) => {
    button.addEventListener("click", () => openEditModal(button.dataset.editProduct));
  });

  document.querySelectorAll("[data-delete-product]").forEach((button) => {
    button.addEventListener("click", () => openDeleteModal(button.dataset.deleteProduct));
  });
}

async function loadSellerProducts(userId) {
  const { data, error } = await db
    .from("products")
    .select("id, title, description, category, image_url, starting_price, current_price, ends_at, is_featured, status, product_images(id, image_url, storage_path, display_order)")
    .eq("seller_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    sellerEmpty.hidden = false;
    sellerEmpty.textContent = error.message;
    return;
  }

  sellerProductList = data || [];
  sellerProducts.innerHTML = "";
  sellerEmpty.hidden = sellerProductList.length > 0;
  sellerProductList.forEach(renderSellerProduct);
  updateSellerSummary();
  bindProductActions();
  await ensureDealsFromSellerProducts(sellerProductList);
}

function getActiveDeal() {
  return dealItems.find((deal) => deal.id === activeDealId);
}

function renderDealConfirmation(deal) {
  dealBuyerStatus.textContent = deal.buyer_confirmed ? "Confirmado" : "Pendiente";
  dealSellerStatus.textContent = deal.seller_confirmed ? "Confirmado" : "Pendiente";
  confirmDeal.disabled = deal.status === "completed"
    || (deal.buyer_id === currentUserId && deal.buyer_confirmed)
    || (deal.seller_id === currentUserId && deal.seller_confirmed);
}

function renderMessage(message) {
  const item = document.createElement("div");
  item.className = `chat-message ${message.sender_id === currentUserId ? "is-mine" : ""}`;
  item.innerHTML = `
    <strong>${escapeHtml(message.sender?.full_name || "Usuario")}</strong>
    <p>${escapeHtml(message.message)}</p>
    <small>${new Date(message.created_at).toLocaleString("es-CL")}</small>
  `;
  dealMessages.appendChild(item);
}

async function loadDealMessages(dealId) {
  const { data, error } = await db
    .from("deal_messages")
    .select("id, sender_id, message, created_at, sender:profiles!deal_messages_sender_id_fkey(full_name)")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: true });

  dealMessages.innerHTML = "";

  if (error) {
    dealMessages.innerHTML = `<p class="empty-inline">${escapeHtml(error.message)}</p>`;
    return;
  }

  if (!data?.length) {
    dealMessages.innerHTML = `<p class="empty-inline">Aun no hay mensajes. Puedes iniciar la coordinacion.</p>`;
    return;
  }

  data.forEach(renderMessage);
  dealMessages.scrollTop = dealMessages.scrollHeight;
}

function unsubscribeDealMessages() {
  if (activeDealChannel) {
    db.removeChannel(activeDealChannel);
    activeDealChannel = null;
  }
}

function subscribeDealMessages(dealId) {
  unsubscribeDealMessages();

  activeDealChannel = db
    .channel(`deal-messages-${dealId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "deal_messages",
        filter: `deal_id=eq.${dealId}`
      },
      async () => {
        if (activeDealId === dealId) {
          await loadDealMessages(dealId);
          dealStatus.textContent = "Chat actualizado.";
        }
      }
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        dealStatus.textContent = "Chat en vivo activo.";
      }
    });
}

async function openDealModal(dealId) {
  const deal = dealItems.find((item) => item.id === dealId);

  if (!deal) {
    return;
  }

  activeDealId = deal.id;
  dealModalTitle.textContent = deal.products?.title || "Acuerdo de venta";
  dealModalCopy.textContent = `Precio final: ${formatPrice(deal.final_price)}. Coordina con ${getCounterpartName(deal)} para completar la venta.`;
  dealStatus.textContent = "";
  dealMessageInput.value = "";
  renderDealConfirmation(deal);
  dealModal.hidden = false;
  await loadDealMessages(deal.id);
  subscribeDealMessages(deal.id);
}

function closeDealModal() {
  unsubscribeDealMessages();
  dealModal.hidden = true;
  activeDealId = null;
  dealMessages.innerHTML = "";
  dealStatus.textContent = "";
  dealMessageForm.reset();
}

async function sendDealMessage(event) {
  event.preventDefault();

  if (!activeDealId || !dealMessageInput.value.trim()) {
    return;
  }

  try {
    dealStatus.textContent = "Enviando mensaje...";
    const { error } = await db.from("deal_messages").insert({
      deal_id: activeDealId,
      sender_id: currentUserId,
      message: dealMessageInput.value.trim()
    });

    if (error) {
      throw new Error(error.message);
    }

    dealMessageInput.value = "";
    dealStatus.textContent = "";
    await loadDealMessages(activeDealId);
  } catch (error) {
    dealStatus.textContent = error.message;
  }
}

async function confirmActiveDeal() {
  const deal = getActiveDeal();

  if (!deal) {
    return;
  }

  try {
    dealStatus.textContent = "Guardando confirmacion...";
    const { data, error } = await db.rpc("mark_deal_confirmation", {
      target_deal_id: activeDealId,
      confirmed: true
    });

    if (error) {
      throw new Error(error.message);
    }

    const updatedDeal = Array.isArray(data) ? data[0] : data;
    const index = dealItems.findIndex((item) => item.id === activeDealId);
    if (index >= 0) {
      dealItems[index] = { ...dealItems[index], ...updatedDeal };
      renderDealConfirmation(dealItems[index]);
    }

    dealStatus.textContent = updatedDeal.status === "completed"
      ? "Venta confirmada por ambas partes."
      : "Tu confirmacion quedo guardada.";
    await loadDeals();
  } catch (error) {
    dealStatus.textContent = error.message;
  }
}

function renderImageManager(product) {
  const images = sortedImages(product);
  editImageList.innerHTML = "";

  if (!images.length) {
    editImageList.innerHTML = `<p class="empty-inline">Este producto no tiene imagenes guardadas.</p>`;
    return;
  }

  images.forEach((image) => {
    const item = document.createElement("div");
    item.className = "image-manager-item";
    item.innerHTML = `
      <img src="${escapeHtml(image.image_url)}" alt="Imagen del producto">
      <button class="filter-close" type="button" data-delete-image="${image.id}" aria-label="Eliminar imagen">X</button>
    `;
    editImageList.appendChild(item);
  });

  document.querySelectorAll("[data-delete-image]").forEach((button) => {
    button.addEventListener("click", () => deleteProductImage(button.dataset.deleteImage));
  });
}

function openEditModal(productId) {
  const product = sellerProductList.find((item) => item.id === productId);

  if (!product) {
    return;
  }

  editProductId.value = product.id;
  editTitle.value = product.title;
  editDescription.value = product.description;
  editCategory.value = product.category;
  editEnds.value = toDateTimeLocal(product.ends_at);
  editFeatured.checked = product.is_featured;
  editImages.value = "";
  editStatus.textContent = "";
  renderImageManager(product);
  editModal.hidden = false;
  editTitle.focus();
}

function closeEditModal() {
  editModal.hidden = true;
  editForm.reset();
  editImageList.innerHTML = "";
  editStatus.textContent = "";
}

function openDeleteModal(productId) {
  const product = sellerProductList.find((item) => item.id === productId);

  if (!product) {
    return;
  }

  pendingDeleteProductId = product.id;
  deleteProductCopy.textContent = `Vas a eliminar "${product.title}". Tambien se quitaran sus imagenes y ofertas asociadas.`;
  deletePreview.innerHTML = `
    <img src="${escapeHtml(getProductImage(product))}" alt="${escapeHtml(product.title)}">
    <div>
      <h3>${escapeHtml(product.title)}</h3>
      <p>${escapeHtml(product.category)} &middot; ${formatPrice(product.current_price)}</p>
    </div>
  `;
  deleteStatus.textContent = "";
  deleteModal.hidden = false;
}

function closeDeleteModal() {
  deleteModal.hidden = true;
  pendingDeleteProductId = null;
  deletePreview.innerHTML = "";
  deleteStatus.textContent = "";
}

async function ensureProductImagesBucket() {
  const { error } = await db.storage
    .from("product-images")
    .list(currentUserId, { limit: 1 });

  if (error) {
    throw new Error("No existe el bucket product-images en Supabase Storage. Ejecuta database/fix-product-publication.sql.");
  }
}

async function uploadProductImages(productId, files, startingOrder) {
  const rows = [];

  for (const [index, file] of Array.from(files).entries()) {
    const cleanName = file.name.replace(/[^a-zA-Z0-9.-]/g, "-");
    const path = `${currentUserId}/${productId}/${Date.now()}-${index}-${cleanName}`;
    const { error: uploadError } = await db.storage
      .from("product-images")
      .upload(path, file, { upsert: false });

    if (uploadError) {
      throw new Error(`No se pudo subir la imagen: ${uploadError.message}`);
    }

    const { data } = db.storage.from("product-images").getPublicUrl(path);

    rows.push({
      product_id: productId,
      image_url: data.publicUrl,
      storage_path: path,
      display_order: startingOrder + index
    });
  }

  return rows;
}

async function addImagesToProduct(product) {
  const currentImages = sortedImages(product);
  const newImages = Array.from(editImages.files);

  if (!newImages.length) {
    return;
  }

  if (currentImages.length + newImages.length > 10) {
    throw new Error("Cada producto puede tener maximo 10 imagenes.");
  }

  await ensureProductImagesBucket();
  const rows = await uploadProductImages(product.id, newImages, currentImages.length);
  const { error } = await db.from("product_images").insert(rows);

  if (error) {
    throw new Error(`No se pudo guardar la informacion de las imagenes: ${error.message}`);
  }

  if (!product.image_url && rows[0]) {
    await db.from("products").update({ image_url: rows[0].image_url }).eq("id", product.id);
  }
}

async function saveProductChanges(event) {
  event.preventDefault();

  const product = sellerProductList.find((item) => item.id === editProductId.value);

  if (!product) {
    return;
  }

  if (!editTitle.value.trim() || !editDescription.value.trim() || !editCategory.value || !editEnds.value) {
    editStatus.textContent = "Completa todos los campos obligatorios.";
    return;
  }

  try {
    editStatus.textContent = "Guardando cambios...";

    const { error } = await db
      .from("products")
      .update({
        title: editTitle.value.trim(),
        description: editDescription.value.trim(),
        category: editCategory.value,
        ends_at: new Date(editEnds.value).toISOString(),
        is_featured: editFeatured.checked
      })
      .eq("id", product.id);

    if (error) {
      throw new Error(`No se pudo actualizar el producto: ${error.message}`);
    }

    await addImagesToProduct(product);
    editStatus.textContent = "Producto actualizado correctamente.";
    await loadSellerProducts(currentUserId);
    closeEditModal();
  } catch (error) {
    editStatus.textContent = error.message;
  }
}

async function deleteProductImage(imageId) {
  const product = sellerProductList.find((item) => item.id === editProductId.value);
  const image = sortedImages(product).find((item) => item.id === imageId);

  if (!product || !image) {
    return;
  }

  if (sortedImages(product).length <= 1) {
    editStatus.textContent = "El producto debe mantener al menos una imagen.";
    return;
  }

  try {
    editStatus.textContent = "Eliminando imagen...";

    if (image.storage_path) {
      await db.storage.from("product-images").remove([image.storage_path]);
    }

    const { error } = await db.from("product_images").delete().eq("id", image.id);

    if (error) {
      throw new Error(`No se pudo eliminar la imagen: ${error.message}`);
    }

    await loadSellerProducts(currentUserId);
    const updatedProduct = sellerProductList.find((item) => item.id === product.id);
    renderImageManager(updatedProduct);
    editStatus.textContent = "Imagen eliminada.";
  } catch (error) {
    editStatus.textContent = error.message;
  }
}

async function deleteProduct(productId) {
  const product = sellerProductList.find((item) => item.id === productId);

  if (!product) {
    return;
  }

  try {
    deleteStatus.textContent = "Eliminando producto...";
    confirmDelete.disabled = true;

    const storagePaths = sortedImages(product)
      .map((image) => image.storage_path)
      .filter(Boolean);

    const { error } = await db.from("products").delete().eq("id", product.id);

    if (error) {
      throw new Error(`No se pudo eliminar el producto: ${error.message}`);
    }

    if (storagePaths.length) {
      await db.storage.from("product-images").remove(storagePaths);
    }

    await loadSellerProducts(currentUserId);
    closeDeleteModal();
  } catch (error) {
    deleteStatus.textContent = error.message;
  } finally {
    confirmDelete.disabled = false;
  }
}

async function loadProfile() {
  const user = await getSessionUser();

  if (!user) {
    window.location.href = "login.html";
    return;
  }

  const pendingGoogleRole = localStorage.getItem("aurum_pending_google_role");

  if (pendingGoogleRole) {
    const displayName = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split("@")[0] || "Usuario Google";
    await db.rpc("complete_google_profile", {
      full_name: displayName,
      desired_role: pendingGoogleRole
    });
    localStorage.removeItem("aurum_pending_google_role");
  }

  currentUserId = user.id;
  await closeExpiredAuctions();

  const { data: profile, error } = await db
    .from("profiles")
    .select("full_name, role")
    .eq("id", user.id)
    .single();

  if (error) {
    profileDescription.textContent = error.message;
    return;
  }

  profileTitle.textContent = `Perfil ${roleLabel(profile.role)}`;
  profileDescription.textContent = profile.role === "subastador"
    ? "Gestiona tus productos publicados, edita su informacion y controla sus imagenes."
    : "Revisa tus datos y actividad dentro de Aurum Subastas.";

  profileName.textContent = profile.full_name;
  profileEmail.textContent = user.email;
  profileRole.textContent = roleLabel(profile.role);

  adminPanel.hidden = profile.role !== "admin";
  userPanel.hidden = profile.role !== "usuario";
  sellerPanel.hidden = profile.role !== "subastador";

  if (profile.role === "subastador") {
    await loadSellerProducts(user.id);
  }

  if (profile.role === "usuario") {
    await loadUserBids(user.id);
  }

  if (profile.role !== "admin") {
    await loadDeals();
  }
}

function openLogoutModal() {
  logoutStatus.textContent = "";
  logoutModal.hidden = false;
  confirmLogout.focus();
}

function closeLogoutModal() {
  logoutModal.hidden = true;
  logoutStatus.textContent = "";
}

logoutButton.addEventListener("click", openLogoutModal);
logoutModalClose.addEventListener("click", closeLogoutModal);
cancelLogout.addEventListener("click", closeLogoutModal);
logoutModal.addEventListener("click", (event) => {
  if (event.target === logoutModal) {
    closeLogoutModal();
  }
});
confirmLogout.addEventListener("click", async () => {
  logoutStatus.textContent = "Cerrando sesion...";
  confirmLogout.disabled = true;
  await db.auth.signOut();
  window.location.href = "login.html";
});

editModalClose.addEventListener("click", closeEditModal);
editModal.addEventListener("click", (event) => {
  if (event.target === editModal) {
    closeEditModal();
  }
});
editForm.addEventListener("submit", saveProductChanges);
deleteModalClose.addEventListener("click", closeDeleteModal);
cancelDelete.addEventListener("click", closeDeleteModal);
deleteModal.addEventListener("click", (event) => {
  if (event.target === deleteModal) {
    closeDeleteModal();
  }
});
confirmDelete.addEventListener("click", () => {
  if (pendingDeleteProductId) {
    deleteProduct(pendingDeleteProductId);
  }
});
dealModalClose.addEventListener("click", closeDealModal);
dealModal.addEventListener("click", (event) => {
  if (event.target === dealModal) {
    closeDealModal();
  }
});
dealMessageForm.addEventListener("submit", sendDealMessage);
refreshDeal.addEventListener("click", () => {
  if (activeDealId) {
    loadDealMessages(activeDealId);
  }
});
confirmDeal.addEventListener("click", confirmActiveDeal);

loadProfile();
