const API_KEY = "REPLACE_ME";

let currentSlots = [];
let selectedSlot = null;
let currentIdempotencyKey = null;
let lastSlotId = null;
let lastName = null;
let lastEmail = null;

function getHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (API_KEY && API_KEY !== "REPLACE_ME") {
    headers["X-API-Key"] = API_KEY;
  }
  return headers;
}

function getIdempotencyKey(slotId, name, email) {
  if (
    currentIdempotencyKey &&
    slotId === lastSlotId &&
    name === lastName &&
    email === lastEmail
  ) {
    return currentIdempotencyKey;
  }
  currentIdempotencyKey = crypto.randomUUID();
  lastSlotId = slotId;
  lastName = name;
  lastEmail = email;
  return currentIdempotencyKey;
}

function formatSlotTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function loadSlots() {
  const statusEl = document.getElementById("slots-status");
  const containerEl = document.getElementById("slots-container");
  statusEl.textContent = "Loading slots...";
  statusEl.hidden = false;
  containerEl.innerHTML = "";

  try {
    const res = await fetch("/slots", { headers: getHeaders() });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to load slots" }));
      statusEl.textContent = err.error || "Failed to load slots";
      return;
    }

    const data = await res.json();
    const now = new Date();
    currentSlots = (data.slots || []).filter((s) => s.available && new Date(s.start) > now);

    if (currentSlots.length === 0) {
      statusEl.textContent = "No available upcoming slots.";
      return;
    }

    statusEl.hidden = true;
    renderSlotsGroupedByProvider(currentSlots);
  } catch (err) {
    statusEl.textContent = "Network error loading slots. Check connection.";
  }
}

function renderSlotsGroupedByProvider(slots) {
  const container = document.getElementById("slots-container");
  container.innerHTML = "";

  const grouped = {};
  slots.forEach((slot) => {
    if (!grouped[slot.provider]) {
      grouped[slot.provider] = [];
    }
    grouped[slot.provider].push(slot);
  });

  Object.keys(grouped).sort().forEach((provider) => {
    const groupDiv = document.createElement("div");
    groupDiv.className = "provider-group";

    const title = document.createElement("h3");
    title.textContent = provider;
    groupDiv.appendChild(title);

    const listDiv = document.createElement("div");
    listDiv.className = "slot-list";

    grouped[provider].forEach((slot) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "slot-button";
      btn.textContent = `${formatSlotTime(slot.start)} - ${formatSlotTime(slot.end)}`;
      btn.addEventListener("click", () => selectSlot(slot));
      listDiv.appendChild(btn);
    });

    groupDiv.appendChild(listDiv);
    container.appendChild(groupDiv);
  });
}

function selectSlot(slot) {
  selectedSlot = slot;
  document.getElementById("slot-id").value = slot.id;
  document.getElementById("selected-slot-summary").textContent =
    `Selected: ${slot.provider} on ${formatSlotTime(slot.start)}`;
  document.getElementById("booking-error").hidden = true;
  document.getElementById("booking-section").hidden = false;
  document.getElementById("confirmation-section").hidden = true;
}

function cancelSelection() {
  selectedSlot = null;
  document.getElementById("booking-form").reset();
  document.getElementById("booking-section").hidden = true;
  document.getElementById("booking-error").hidden = true;
}

async function submitBooking(event) {
  event.preventDefault();
  const errorBox = document.getElementById("booking-error");
  const submitBtn = document.getElementById("submit-booking");
  errorBox.hidden = true;

  const slotId = document.getElementById("slot-id").value;
  const name = document.getElementById("patient-name").value.trim();
  const email = document.getElementById("patient-email").value.trim().toLowerCase();

  const idempotencyKey = getIdempotencyKey(slotId, name, email);
  const headers = getHeaders();
  headers["Idempotency-Key"] = idempotencyKey;

  submitBtn.disabled = true;

  try {
    const res = await fetch("/bookings", {
      method: "POST",
      headers,
      body: JSON.stringify({ slot_id: slotId, name, email }),
    });

    if (res.status === 201) {
      const booking = await res.json();
      showConfirmation(booking, selectedSlot);
      loadSlots();
      return;
    }

    if (res.status === 409) {
      errorBox.textContent = "This slot was just taken. Please pick another time.";
      errorBox.hidden = false;
      loadSlots();
      return;
    }

    if (res.status === 429) {
      const retryAfter = res.headers.get("Retry-After");
      const waitSeconds = retryAfter ? ` Wait ${retryAfter} seconds.` : "";
      errorBox.textContent = `Too many attempts.${waitSeconds}`;
      errorBox.hidden = false;
      return;
    }

    const err = await res.json().catch(() => ({ error: "Booking request failed" }));
    errorBox.textContent = err.error || "Booking request failed";
    errorBox.hidden = false;
  } catch (err) {
    errorBox.textContent = "Network error. Please try again with the same details.";
    errorBox.hidden = false;
  } finally {
    submitBtn.disabled = false;
  }
}

function showConfirmation(booking, slot) {
  document.getElementById("booking-section").hidden = true;
  document.getElementById("conf-id").textContent = booking.id;
  document.getElementById("conf-provider").textContent = slot ? slot.provider : "";
  document.getElementById("conf-time").textContent = slot ? formatSlotTime(slot.start) : "";
  document.getElementById("conf-name").textContent = booking.name;
  document.getElementById("conf-email").textContent = booking.email;
  document.getElementById("conf-status").textContent = booking.status;
  document.getElementById("confirmation-section").hidden = false;
}

document.addEventListener("DOMContentLoaded", () => {
  loadSlots();

  document.getElementById("booking-form").addEventListener("submit", submitBooking);
  document.getElementById("cancel-selection").addEventListener("click", cancelSelection);
  document.getElementById("book-another").addEventListener("click", () => {
    document.getElementById("confirmation-section").hidden = true;
    cancelSelection();
    loadSlots();
  });
});
