const uploadForm = document.querySelector("#upload-product-form");
const uploadStatus = document.querySelector("#upload-status");
const productTitle = document.querySelector("#product-title");
const productDescription = document.querySelector("#product-description");
const productCategory = document.querySelector("#product-category");
const productPrice = document.querySelector("#product-price");
const productImages = document.querySelector("#product-images");
const productEnds = document.querySelector("#product-ends");
const productFeatured = document.querySelector("#product-featured");
const uploadSubmit = uploadForm.querySelector("[type='submit']");
let currentUserId = null;

async function requireSellerSession() {
  const user = await getSessionUser();

  if (!user) {
    window.location.href = "login.html";
    return false;
  }

  const { data: profile, error } = await db
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (error) {
    uploadStatus.textContent = error.message;
    return false;
  }

  if (!["subastador", "admin"].includes(profile.role)) {
    uploadStatus.textContent = "Necesitas una cuenta de subastador para publicar productos.";
    uploadForm.querySelectorAll("input, textarea, select, button").forEach((control) => {
      control.disabled = true;
    });
    return false;
  }

  currentUserId = user.id;
  return true;
}

async function uploadProductImages(productId, files) {
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
      display_order: index
    });
  }

  return rows;
}

async function ensureProductImagesBucket() {
  const { error } = await db.storage
    .from("product-images")
    .list(currentUserId, { limit: 1 });

  if (error) {
    throw new Error("No existe el bucket product-images en Supabase Storage. Ejecuta database/supabase-schema.sql o crea ese bucket manualmente.");
  }
}

async function saveProductImages(productId) {
  const imageRows = await uploadProductImages(productId, productImages.files);

  if (!imageRows.length) {
    return;
  }

  const { error } = await db.from("product_images").insert(imageRows);

  if (error) {
    throw new Error(`No se pudo guardar la informacion de las imagenes: ${error.message}`);
  }

  await db
    .from("products")
    .update({ image_url: imageRows[0].image_url })
    .eq("id", productId);
}

async function createProduct(event) {
  event.preventDefault();

  if (uploadSubmit.disabled) {
    return;
  }

  if (!currentUserId) {
    return;
  }

  const price = Number(productPrice.value.replace(",", "."));

  if (!productTitle.value.trim() || !productDescription.value.trim() || !productCategory.value || productPrice.value === "" || !productEnds.value) {
    uploadStatus.textContent = "Completa todos los campos obligatorios.";
    return;
  }

  if (!isFutureDateTime(productEnds.value)) {
    uploadStatus.textContent = "La fecha de cierre debe ser posterior al momento actual.";
    return;
  }

  if (!Number.isFinite(price) || price <= 0) {
    uploadStatus.textContent = "Ingresa un precio valido mayor que cero.";
    return;
  }

  if (!productImages.files.length) {
    uploadStatus.textContent = "Sube al menos una imagen del producto.";
    return;
  }

  if (productImages.files.length > 10) {
    uploadStatus.textContent = "Puedes subir maximo 10 imagenes por producto.";
    return;
  }

  try {
    setLoading(uploadSubmit, true, "Publicando...");
    uploadStatus.textContent = "Publicando producto...";
    await ensureProductImagesBucket();

    const { data, error } = await db
      .from("products")
      .insert({
        seller_id: currentUserId,
        title: productTitle.value.trim(),
        description: productDescription.value.trim(),
        category: productCategory.value,
        starting_price: price,
        current_price: price,
        ends_at: new Date(productEnds.value).toISOString(),
        is_featured: productFeatured.checked
      })
      .select("id")
      .single();

    if (error) {
      throw new Error(`No se pudo crear el producto: ${error.message}`);
    }

    try {
      await saveProductImages(data.id);
    } catch (imageError) {
      await db.from("products").delete().eq("id", data.id);
      throw imageError;
    }

    uploadStatus.textContent = "Producto publicado correctamente. Puedes verlo en tu perfil.";
    uploadForm.reset();
  } catch (error) {
    uploadStatus.textContent = `No se pudo publicar: ${getErrorMessage(error)}`;
  } finally {
    setLoading(uploadSubmit, false);
  }
}

uploadForm.addEventListener("submit", createProduct);
requireSellerSession();
