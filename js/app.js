"use strict";
const STORAGE_KEY = "baby-shower-gifts-v1";
const GUEST_ID_KEY = "baby-shower-guest-id-v1";
const LEGACY_NAME_KEY = "baby-shower-guest-name-v1";
const adminStandalone = document.body.dataset.view === "admin";
if (!adminStandalone && new URLSearchParams(location.search).get("vista") === "admin") {
  location.replace("admin.html");
}
const supabaseConfig = window.BABY_SHOWER_SUPABASE || {};
const cloudEnabled = Boolean(supabaseConfig.url && supabaseConfig.anonKey);
const localAdminAllowed = location.protocol === "file:" || ["localhost", "127.0.0.1"].includes(location.hostname);
const guestId = readStorage(GUEST_ID_KEY) || makeId();
const legacyGuestName = readStorage(LEGACY_NAME_KEY);
try { localStorage.setItem(GUEST_ID_KEY, guestId); }
catch { setTimeout(() => showToast("No se pudo guardar la identificación de este dispositivo; el historial podría no conservarse.", true), 0); }
const STARTER_GIFTS = [
  { name: "Cobija grande", quantity: 1, image: "" },
  { name: "Cobija pequeña", quantity: 1, image: "" },
  { name: "Camisetas y pantalones de 0 a 3 meses", quantity: 1, image: "" },
  { name: "Bodies de 3 a 6 meses", quantity: 1, image: "" },
  { name: "Body manga larga o manga corta", quantity: 1, image: "" },
  { name: "Conjunto de 0 a 3 meses", quantity: 1, image: "" },
  { name: "Conjuntos de 3 a 6 meses", quantity: 2, image: "" },
  { name: "Conjuntos de 6 a 9 meses", quantity: 2, image: "" },
  { name: "Tina", quantity: 1, image: "" },
  { name: "Kit de aseo", quantity: 1, image: "" },
  { name: "Termómetro y kit de uñas", quantity: 1, image: "" },
  { name: "Kit de cuidado para bebé", quantity: 1, image: "" },
  { name: "Toalla y babero plástico", quantity: 1, image: "" },
  { name: "Colcha o almohada", quantity: 1, image: "" },
  { name: "Cambiador y medias", quantity: 1, image: "" },
  { name: "Sacos térmicos", quantity: 1, image: "" },
  { name: "Pijamas de 3 a 6 meses", quantity: 1, image: "" },
  { name: "Pijamas de 6 a 9 meses", quantity: 1, image: "" },
  { name: "Pañalera", quantity: 1, image: "" },
  { name: "Cargador", quantity: 1, image: "" },
  { name: "Loza para bebé", quantity: 1, image: "" },
  { name: "Mi primera muda", quantity: 1, image: "" }
];
const LEGACY_GIFT_NAMES = new Set([
  "Cobija suave para bebé", "Pañales talla recién nacido", "Pañales talla M", "Bodies de 0 a 3 meses",
  "Conjunto de 3 a 6 meses", "Pijama de 6 a 9 meses", "Toalla y babero", "Kit de aseo para bebé",
  "Termómetro para bebé", "Biberón", "Peluche", "Cambiador portátil"
]);
let state = loadState();
let editingId = null;
let selectedImage = null;
let toastTimer;
let cloud = null;
let cloudSession = null;
let cloudReady = false;
let cloudError = "";
let isAdmin = false;
let refreshTimer = null;
if (adminStandalone) {
  document.body.classList.add("admin-mode");
  document.title = "Administración | Baby Shower";
}

function readStorage(key) {
  try { return localStorage.getItem(key); }
  catch { return null; }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    showToast("No se pudieron guardar los cambios. Revisa el espacio disponible en el navegador.", true);
    return false;
  }
}

function migrateLegacyGiftList() {
  if (!state.products.length || state.products.some((gift) => !LEGACY_GIFT_NAMES.has(gift.name))) return;
  const previous = state;
  state = {
    products: STARTER_GIFTS.map((gift) => ({ ...gift, id: makeId() })),
    reservations: previous.reservations.map((reservation) => ({
      ...reservation,
      status: reservation.status === "active" ? "released" : reservation.status
    }))
  };
  if (!saveState()) state = previous;
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return { products: STARTER_GIFTS.map((gift) => ({ ...gift, id: makeId() })), reservations: [] };
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed.products) || !Array.isArray(parsed.reservations)) throw new Error("Formato de lista no válido.");
    return {
      products: parsed.products
        .filter((gift) => gift && typeof gift.id === "string" && typeof gift.name === "string" && Number.isInteger(gift.quantity) && gift.quantity >= 0)
        .map((gift) => ({
          id: gift.id,
          name: gift.name,
          quantity: gift.quantity,
          image: typeof gift.image === "string" && !gift.image.startsWith("assets/regalos/") ? gift.image : ""
        })),
      reservations: parsed.reservations.filter((reservation) => reservation && typeof reservation.id === "string" && typeof reservation.giftId === "string" && typeof reservation.guest === "string" && Number.isInteger(reservation.quantity) && reservation.quantity > 0 && ["active", "released"].includes(reservation.status))
    };
  } catch {
    return { products: STARTER_GIFTS.map((gift) => ({ ...gift, id: makeId() })), reservations: [] };
  }
}

function belongsToCurrentGuest(reservation) {
  return reservation.userId === guestId
    || (!reservation.userId && legacyGuestName
      && reservation.guest.toLocaleLowerCase() === legacyGuestName.toLocaleLowerCase());
}

function makeId() {
  return globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function activeQuantity(giftId) {
  const gift = state.products.find((product) => product.id === giftId);
  if (cloudEnabled && gift && Number.isInteger(gift.reservedQuantity)) return gift.reservedQuantity;
  return state.reservations.reduce((total, reservation) =>
    total + (reservation.giftId === giftId && reservation.status === "active" ? reservation.quantity : 0), 0);
}

function syncLatestState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) state = loadState();
    return true;
  } catch {
    showToast("No se pudo actualizar la lista guardada en este navegador.", true);
    return false;
  }
}

function availableQuantity(gift) {
  if (cloudEnabled && Number.isInteger(gift.availableQuantity)) return gift.availableQuantity;
  return Math.max(0, gift.quantity - activeQuantity(gift.id));
}

function giftFromCloud(gift) {
  const cachedGift = state.products.find((product) => product.id === gift.id);
  return {
    id: gift.id,
    name: gift.name,
    quantity: gift.total_quantity,
    image: gift.image_data || (cachedGift?.image && !cachedGift.image.startsWith("assets/regalos/") ? cachedGift.image : "") || "",
    reservedQuantity: gift.reserved_quantity,
    availableQuantity: gift.available_quantity
  };
}

function reservationFromCloud(reservation) {
  return {
    id: reservation.id,
    giftId: reservation.gift_id,
    giftName: reservation.gift_name,
    guest: reservation.guest_name,
    userId: reservation.guest_user_id,
    quantity: reservation.quantity,
    createdAt: reservation.created_at,
    status: reservation.status
  };
}

async function loadCloudData(includeImages = true) {
  if (!cloud || !cloudSession) return false;
  let giftsResult;
  let reservationsResult;
  try {
    [giftsResult, reservationsResult] = await Promise.all([
      cloud.from("gift_inventory")
        .select(includeImages ? "*" : "id,name,total_quantity,reserved_quantity,available_quantity")
        .order("name"),
      cloud.from("reservations").select("*").order("created_at", { ascending: false })
    ]);
  } catch (error) {
    cloudReady = false;
    cloudError = `No se pudo cargar la lista compartida: ${error.message}`;
    render();
    return false;
  }
  if (giftsResult.error || reservationsResult.error) {
    const error = giftsResult.error || reservationsResult.error;
    cloudReady = false;
    cloudError = `No se pudo cargar la lista compartida: ${error.message}`;
    render();
    return false;
  }
  state.products = giftsResult.data.map(giftFromCloud);
  state.reservations = reservationsResult.data.map(reservationFromCloud);
  cloudReady = true;
  cloudError = "";
  render();
  if (isAdmin) renderAdmin();
  return true;
}

async function initCloud() {
  if (!cloudEnabled) return;
  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    cloudError = "No se pudo cargar el cliente de Supabase. Comprueba tu conexión a Internet.";
    render();
    return;
  }
  try {
    cloud = window.supabase.createClient(supabaseConfig.url, supabaseConfig.anonKey);
    cloud.auth.onAuthStateChange((event, session) => {
      if (!["SIGNED_IN", "SIGNED_OUT", "TOKEN_REFRESHED"].includes(event)) return;
      cloudSession = session;
      isAdmin = session?.user?.app_metadata?.role === "admin";
      window.setTimeout(() => {
        loadCloudData(false).catch((error) => {
          cloudReady = false;
          cloudError = `No se pudo cargar la lista compartida: ${error.message}`;
          render();
        });
      }, 0);
    });
    const { data, error } = await cloud.auth.getSession();
    if (error) throw error;
    cloudSession = data.session;
    if (!cloudSession) {
      const { data: anonymousData, error: anonymousError } = await cloud.auth.signInAnonymously();
      if (anonymousError) throw anonymousError;
      cloudSession = anonymousData.session;
    }
    isAdmin = cloudSession?.user?.app_metadata?.role === "admin";
    await loadCloudData();
    clearInterval(refreshTimer);
    refreshTimer = window.setInterval(() => {
      if (!document.hidden && cloudReady) {
        loadCloudData(false).catch((error) => {
          cloudReady = false;
          cloudError = `No se pudo actualizar la lista compartida: ${error.message}`;
          render();
        });
      }
    }, 6000);
  } catch (error) {
    cloudReady = false;
    cloudError = `No se pudo conectar con Supabase: ${error.message}`;
    render();
    showToast(cloudError, true);
  }
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showToast(message, isError = false) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3300);
}

function render() {
  if (adminStandalone) {
    document.getElementById("admin-local-warning").hidden = cloudEnabled;
    document.getElementById("admin-description").textContent = cloudEnabled
      ? "Agrega regalos, actualiza sus cantidades y sube una foto. Los cambios se comparten con todos los invitados."
      : "Agrega regalos, actualiza sus cantidades y sube una foto. Los cambios se guardan en este navegador.";
    document.getElementById("admin-content").hidden = cloudEnabled ? !isAdmin : !localAdminAllowed;
    document.getElementById("admin-login").hidden = !cloudEnabled || isAdmin;
    document.getElementById("admin-logout").hidden = !cloudEnabled || !isAdmin;
    if (!cloudEnabled || isAdmin) renderAdmin();
    return;
  }
  document.getElementById("sharing-note").hidden = cloudEnabled;
  const total = state.products.reduce((sum, gift) => sum + gift.quantity, 0);
  const taken = cloudEnabled
    ? state.products.reduce((sum, gift) => sum + (gift.reservedQuantity || 0), 0)
    : state.reservations.reduce((sum, reservation) => sum + (reservation.status === "active" ? reservation.quantity : 0), 0);
  const percent = total ? Math.round((taken / total) * 100) : 0;
  document.getElementById("progress-count").textContent = `${taken} de ${total}`;
  document.getElementById("progress-fill").style.width = `${percent}%`;
  document.querySelector('[role="progressbar"]').setAttribute("aria-valuenow", String(percent));
  document.getElementById("progress-label").textContent = taken ? "Regalitos que ya tienen quien los lleve" : "¡Sé el primero en escoger un regalito!";
  renderGifts();
  renderHistory();
}

function renderGifts() {
  const grid = document.getElementById("gift-grid");
  grid.replaceChildren();
  if (cloudEnabled && !cloudReady) {
    grid.append(element("div", "empty", cloudError || "Conectando con la lista compartida…"));
    return;
  }
  const available = state.products.filter((gift) => availableQuantity(gift) > 0);
  if (!available.length) {
    grid.append(element("div", "empty", "¡Misión cumplida! Por ahora todos los regalitos están apartados. Gracias por ayudar a la familia."));
    return;
  }
  available.forEach((gift, index) => {
    const remaining = availableQuantity(gift);
    const card = element("article", "gift-card");
    card.style.animationDelay = `${Math.min(index * 35, 245)}ms`;
    const imageBox = element("div", "gift-image");
    renderGiftVisual(imageBox, gift, gift.name);
    const info = element("div", "gift-info");
    const description = element("div");
    description.append(element("h3", "gift-name", gift.name));
    description.append(element("p", "gift-stock", `${remaining} ${remaining === 1 ? "disponible" : "disponibles"}`));
    const actions = element("div", "gift-actions");
    const reserve = element("button", "button", "Yo lo llevo");
    reserve.type = "button";
    reserve.addEventListener("click", () => reserveGift(gift.id, 1));
    actions.append(reserve);
    info.append(description, actions);
    card.append(imageBox, info);
    grid.append(card);
  });
}

function reserveGift(giftId, quantity) {
  if (cloudEnabled) {
    if (!cloudReady || !cloudSession) {
      showToast(cloudError || "La lista aún se está conectando. Inténtalo en un momento.", true);
      return;
    }
    const gift = state.products.find((product) => product.id === giftId);
    if (!gift || !Number.isInteger(quantity) || quantity < 1 || quantity > availableQuantity(gift)) {
      loadCloudData(false).then(() => showToast("La cantidad disponible cambió. Actualizamos la lista.", true));
      return;
    }
    cloud.rpc("reserve_gift", {
      p_gift_id: giftId,
      p_quantity: quantity,
      p_guest_name: "Invitado"
    }).then(({ error }) => {
      if (error) {
        showToast(`No se pudo apartar el regalo: ${error.message}`, true);
        return;
      }
      showToast(`¡Listo! Apartaste ${quantity} ${quantity === 1 ? "unidad" : "unidades"} de «${gift.name}».`);
      return loadCloudData(false);
    }).catch((error) => showToast(`No se pudo apartar el regalo: ${error.message}`, true));
    return;
  }
  if (!syncLatestState()) return;
  const gift = state.products.find((product) => product.id === giftId);
  if (!gift || !Number.isInteger(quantity) || quantity < 1 || quantity > availableQuantity(gift)) {
    showToast("La cantidad disponible cambió. Actualizamos la lista.", true);
    render();
    return;
  }
  state.reservations.push({
    id: makeId(),
    giftId,
    giftName: gift.name,
    guest: "Invitado",
    userId: guestId,
    quantity,
    createdAt: new Date().toISOString(),
    status: "active"
  });
  if (!saveState()) {
    state.reservations.pop();
    return;
  }
  render();
  showToast(`¡Listo! Apartaste ${quantity} ${quantity === 1 ? "unidad" : "unidades"} de «${gift.name}».`);
}

function renderHistory() {
  const history = document.getElementById("history-list");
  history.replaceChildren();
  if (cloudEnabled && !cloudReady) {
    history.append(element("div", "empty", "El historial aparecerá cuando conectemos con la lista."));
    return;
  }
  const mine = state.reservations.filter((reservation) => reservation.status === "active"
    && (cloudEnabled
      ? reservation.userId === cloudSession?.user.id
      : belongsToCurrentGuest(reservation)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!mine.length) {
    history.append(element("div", "empty", "Todavía no has escogido ningún regalo. Cuando reserves uno, aquí quedará tu historial."));
    return;
  }
  mine.forEach((reservation) => {
    const row = element("article", "history-row");
    const details = element("div");
    details.append(element("div", "history-name", reservation.giftName || giftName(reservation.giftId)));
    const date = new Date(reservation.createdAt);
    details.append(element("div", "history-meta", Number.isNaN(date.getTime()) ? "" : `Escogido el ${new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(date)}`));
    const quantity = element("span", "history-qty", `× ${reservation.quantity}`);
    const status = element("span", "history-status", "Apartado");
    row.append(details, quantity, status);
    const release = element("button", "button secondary small", "Liberar");
    release.type = "button";
    release.setAttribute("aria-label", `Liberar ${reservation.giftName || giftName(reservation.giftId)}`);
    release.addEventListener("click", () => releaseReservation(reservation.id));
    row.append(release);
    history.append(row);
  });
}

function giftName(id) {
  const gift = state.products.find((product) => product.id === id);
  return gift ? gift.name : "Regalo retirado de la lista";
}

function renderGiftVisual(container, gift, alt) {
  const source = gift.image;
  const showPlaceholder = () => {
    container.classList.add("no-image");
    container.textContent = "Sin imagen";
  };
  if (source) {
    const image = element("img");
    image.src = source;
    image.alt = alt;
    image.onerror = () => {
      image.remove();
      showPlaceholder();
    };
    container.append(image);
  } else showPlaceholder();
}

function releaseReservation(reservationId) {
  if (cloudEnabled) {
    cloud.rpc("release_gift", { p_reservation_id: reservationId }).then(({ error }) => {
      if (error) {
        showToast(`No se pudo liberar el regalo: ${error.message}`, true);
        return;
      }
      showToast("Regalo liberado; volvió a estar disponible para los invitados.");
      return loadCloudData(false);
    }).catch((error) => showToast(`No se pudo liberar el regalo: ${error.message}`, true));
    return;
  }
  if (!syncLatestState()) return;
  const reservation = state.reservations.find((item) => item.id === reservationId && item.status === "active");
  if (!reservation || !belongsToCurrentGuest(reservation)) return;
  reservation.status = "released";
  if (!saveState()) {
    reservation.status = "active";
    return;
  }
  render();
  showToast("Regalo liberado; volvió a estar disponible para los invitados.");
}

function renderAdmin() {
  if (cloudEnabled && !isAdmin) return;
  const list = document.getElementById("admin-list");
  const reservationsList = document.getElementById("admin-reservation-list");
  if (!list || !reservationsList) return;
  list.replaceChildren();
  reservationsList.replaceChildren();
  const activeReservations = state.reservations
    .filter((reservation) => reservation.status === "active")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!activeReservations.length) {
    reservationsList.append(element("div", "empty", "Todavía no hay regalos que llevarán."));
  } else {
    activeReservations.forEach((reservation) => {
      const row = element("article", "admin-reservation");
      const details = element("div");
      details.append(element("div", "admin-name", reservation.giftName || giftName(reservation.giftId)));
      const date = new Date(reservation.createdAt);
      const dateLabel = Number.isNaN(date.getTime())
        ? ""
        : new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(date);
      details.append(element("div", "admin-stock", `${reservation.guest || "Invitado"}${dateLabel ? ` · ${dateLabel}` : ""}`));
      row.append(details, element("span", "history-qty", `× ${reservation.quantity}`));
      reservationsList.append(row);
    });
  }
  if (!state.products.length) {
    list.append(element("div", "empty", "Todavía no hay regalos. Agrega el primero con el formulario."));
    return;
  }
  const searchTerm = document.getElementById("admin-product-search").value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
  const filteredProducts = state.products.filter((gift) => gift.name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .includes(searchTerm));
  if (!filteredProducts.length) {
    list.append(element("div", "empty", "No se encontraron regalos con ese nombre."));
    return;
  }
  filteredProducts.forEach((gift) => {
    const active = activeQuantity(gift.id);
    const available = availableQuantity(gift);
    const item = element("article", "admin-item");
    const thumb = element("div", "admin-thumb");
    renderGiftVisual(thumb, gift, "");
    const info = element("div");
    info.append(element("div", "admin-name", gift.name));
    info.append(element("div", "admin-stock", `${available} ${available === 1 ? "disponible" : "disponibles"} · ${active} ${active === 1 ? "apartado" : "apartados"} · ${gift.quantity} en total`));
    const actions = element("div", "admin-actions");
    const edit = element("button", "button secondary small", "Editar");
    edit.type = "button";
    edit.addEventListener("click", () => startEdit(gift));
    const remove = element("button", "button danger small", "Eliminar");
    remove.type = "button";
    remove.disabled = active > 0;
    remove.title = active > 0 ? "No se puede eliminar mientras haya regalos apartados." : "Eliminar regalo";
    remove.addEventListener("click", () => removeGift(gift.id));
    actions.append(edit, remove);
    item.append(thumb, info, actions);
    list.append(item);
  });
}

function startEdit(gift) {
  editingId = gift.id;
  selectedImage = gift.image || null;
  document.getElementById("gift-name").value = gift.name;
  document.getElementById("gift-quantity").value = String(gift.quantity);
  document.getElementById("gift-image").value = "";
  document.getElementById("form-heading").textContent = "Editar detallito";
  document.getElementById("submit-gift").textContent = "Guardar cambios";
  document.getElementById("cancel-edit").hidden = false;
  document.getElementById("gift-name").focus();
}

function resetForm() {
  editingId = null;
  selectedImage = null;
  document.getElementById("gift-form").reset();
  document.getElementById("gift-quantity").value = "1";
  document.getElementById("form-heading").textContent = "Agregar un detallito";
  document.getElementById("submit-gift").textContent = "Agregar regalo";
  document.getElementById("cancel-edit").hidden = true;
}

async function saveGift(event) {
  event.preventDefault();
  const name = document.getElementById("gift-name").value.trim();
  const quantity = Number(document.getElementById("gift-quantity").value);
  if (!name || !Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
    showToast("Escribe un nombre y una cantidad válida (de 1 a 999).", true);
    return;
  }
  if (cloudEnabled && (!cloudReady || !isAdmin)) {
    showToast("Inicia sesión como administrador antes de modificar la lista.", true);
    return;
  }
  if (!cloudEnabled && !syncLatestState()) return;
  const existing = editingId ? state.products.find((gift) => gift.id === editingId) : null;
  if (editingId && !existing) {
    resetForm();
    showToast("No se encontró el regalo que quieres editar. Actualiza la lista.", true);
    render();
    return;
  }
  if (existing && quantity < activeQuantity(existing.id)) {
    showToast(`No puedes dejar menos de ${activeQuantity(existing.id)} unidades: esa cantidad ya está apartada.`, true);
    return;
  }
  const giftValues = {
    name,
    total_quantity: quantity,
    image_data: selectedImage || ""
  };
  if (giftValues.image_data.length > 1500000) {
    showToast("La foto procesada es demasiado grande. Prueba con una imagen más pequeña.", true);
    return;
  }
  if (cloudEnabled) {
    try {
      const result = existing
        ? await cloud.from("gifts").update(giftValues).eq("id", existing.id)
        : await cloud.from("gifts").insert(giftValues);
      if (result.error) {
        showToast(`No se pudo guardar el regalo: ${result.error.message}`, true);
        return;
      }
      resetForm();
      await loadCloudData();
      showToast(existing ? "Regalo actualizado." : "Regalo agregado.");
    } catch (error) {
      showToast(`No se pudo guardar el regalo: ${error.message}`, true);
    }
    return;
  }
  const previous = existing ? { ...existing } : null;
  if (existing) Object.assign(existing, { name, quantity, image: selectedImage || "" });
  else state.products.unshift({ id: makeId(), name, quantity, image: selectedImage || "" });
  if (!saveState()) {
    if (previous) Object.assign(existing, previous);
    else state.products.shift();
    return;
  }
  resetForm();
  render();
  renderAdmin();
  showToast(existing ? "Regalo actualizado." : "Regalo agregado.");
}

async function removeGift(giftId) {
  if (cloudEnabled && (!cloudReady || !isAdmin)) {
    showToast("Inicia sesión como administrador antes de modificar la lista.", true);
    return;
  }
  if (!cloudEnabled && !syncLatestState()) return;
  if (activeQuantity(giftId) > 0) {
    showToast("Libera primero las unidades apartadas antes de eliminar este regalo.", true);
    return;
  }
  if (cloudEnabled) {
    try {
      const { error } = await cloud.from("gifts").delete().eq("id", giftId);
      if (error) {
        showToast(`No se pudo eliminar el regalo: ${error.message}`, true);
        return;
      }
      if (editingId === giftId) resetForm();
      await loadCloudData();
      showToast("Regalo eliminado de la lista.");
    } catch (error) {
      showToast(`No se pudo eliminar el regalo: ${error.message}`, true);
    }
    return;
  }
  const index = state.products.findIndex((gift) => gift.id === giftId);
  if (index < 0) return;
  const [removed] = state.products.splice(index, 1);
  if (!saveState()) {
    state.products.splice(index, 0, removed);
    return;
  }
  if (editingId === giftId) resetForm();
  render();
  renderAdmin();
  showToast("Regalo eliminado de la lista.");
}

async function signInAdmin(event) {
  event.preventDefault();
  if (!cloud) {
    showToast("Supabase aún no está configurado.", true);
    return;
  }
  try {
    const { data, error } = await cloud.auth.signInWithPassword({
      email: document.getElementById("admin-email").value.trim(),
      password: document.getElementById("admin-password").value
    });
    if (error) {
      showToast(`No se pudo iniciar sesión: ${error.message}`, true);
      return;
    }
    if (data.user.app_metadata?.role !== "admin") {
      const { error: signOutError } = await cloud.auth.signOut();
      if (signOutError) throw signOutError;
      const { data: guestData, error: guestError } = await cloud.auth.signInAnonymously();
      if (guestError) throw guestError;
      cloudSession = guestData.session;
      isAdmin = false;
      cloudReady = false;
      await loadCloudData();
      showToast("Esta cuenta no tiene permisos de administrador.", true);
      return;
    }
    cloudSession = data.session;
    isAdmin = true;
    cloudReady = false;
    document.getElementById("admin-password").value = "";
    await loadCloudData();
    render();
  } catch (error) {
    showToast(`No se pudo iniciar sesión: ${error.message}`, true);
  }
}

async function signOutAdmin() {
  try {
    const { error } = await cloud.auth.signOut();
    if (error) throw error;
    const { data, error: anonymousError } = await cloud.auth.signInAnonymously();
    if (anonymousError) throw anonymousError;
    cloudSession = data.session;
    isAdmin = false;
    cloudReady = false;
    await loadCloudData();
    render();
  } catch (error) {
    cloudSession = null;
    isAdmin = false;
    cloudReady = false;
    cloudError = `No se pudo cerrar la sesión de administrador: ${error.message}`;
    render();
    showToast(cloudError, true);
  }
}

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("El archivo seleccionado no es una imagen."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("El archivo de imagen no es válido."));
      image.onload = () => {
        const maxDimension = 700;
        const ratio = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("No se pudo procesar la imagen."));
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.78));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

const giftForm = document.getElementById("gift-form");
if (giftForm) giftForm.addEventListener("submit", saveGift);
const productSearch = document.getElementById("admin-product-search");
if (productSearch) productSearch.addEventListener("input", renderAdmin);
const adminLogin = document.getElementById("admin-login");
if (adminLogin) adminLogin.addEventListener("submit", signInAdmin);
const adminLogout = document.getElementById("admin-logout");
if (adminLogout) adminLogout.addEventListener("click", signOutAdmin);
const cancelEdit = document.getElementById("cancel-edit");
if (cancelEdit) cancelEdit.addEventListener("click", resetForm);
const giftImage = document.getElementById("gift-image");
if (giftImage) giftImage.addEventListener("change", async (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (file.size > 12 * 1024 * 1024) {
    event.target.value = "";
    showToast("La foto debe pesar menos de 12 MB.", true);
    return;
  }
  try {
    selectedImage = await resizeImage(file);
    showToast("Foto lista. Guarda el regalo para aplicar los cambios.");
  } catch (error) {
    selectedImage = null;
    event.target.value = "";
    showToast(error.message || "No se pudo procesar la imagen.", true);
  }
});
window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEY) {
    state = loadState();
    render();
    renderAdmin();
  }
});
if (!cloudEnabled && readStorage(STORAGE_KEY) === null) saveState();
migrateLegacyGiftList();
render();
if (cloudEnabled) initCloud();
