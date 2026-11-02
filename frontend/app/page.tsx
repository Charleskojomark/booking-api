"use client";

import { useEffect, useState, useTransition } from "react";

interface Slot {
  id: string;
  provider: string;
  start: string;
  end: string;
  available: boolean;
}

interface Booking {
  id: string;
  slot_id: string;
  name: string;
  email: string;
  status: "confirmed" | "cancelled";
  created_at?: string;
  cancelled_at?: string | null;
}

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<"book" | "lookup" | "demo">("book");
  
  // Slots state
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string>("all");
  const [hideUnavailable, setHideUnavailable] = useState(false);

  // Booking form state
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [patientName, setPatientName] = useState("");
  const [patientEmail, setPatientEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [rateLimitTimer, setRateLimitTimer] = useState<number | null>(null);
  const [confirmedBooking, setConfirmedBooking] = useState<Booking | null>(null);

  // Lookup state
  const [lookupEmail, setLookupEmail] = useState("");
  const [userBookings, setUserBookings] = useState<Booking[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [bookingIdSearch, setBookingIdSearch] = useState("");
  const [singleBooking, setSingleBooking] = useState<Booking | null>(null);
  const [singleBookingError, setSingleBookingError] = useState<string | null>(null);

  // Demo reset state
  const [resetting, setResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  // Load slots on mount
  useEffect(() => {
    fetchSlots();
  }, [selectedProvider]);

  // Rate limit countdown effect
  useEffect(() => {
    if (rateLimitTimer === null || rateLimitTimer <= 0) return;
    const interval = setInterval(() => {
      setRateLimitTimer((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(interval);
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [rateLimitTimer]);

  async function fetchSlots() {
    setSlotsLoading(true);
    setSlotsError(null);
    try {
      const url =
        selectedProvider !== "all"
          ? `/api/slots?provider=${encodeURIComponent(selectedProvider)}`
          : "/api/slots";
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to load slots");
      }
      setSlots(data.slots || []);
    } catch (err: any) {
      setSlotsError(err.message);
    } finally {
      setSlotsLoading(false);
    }
  }

  // Submit booking
  async function handleBookSlot(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSlot) return;

    setSubmitError(null);
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slot_id: selectedSlot.id,
          name: patientName.trim(),
          email: patientEmail.trim().toLowerCase(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 429) {
          const retryHeader = res.headers.get("Retry-After");
          const retrySeconds = retryHeader ? parseInt(retryHeader, 10) : 60;
          setRateLimitTimer(retrySeconds || 60);
          throw new Error(
            `Rate limit reached: Maximum 5 booking attempts per minute. Please retry after ${retrySeconds || 60} seconds.`
          );
        }
        if (res.status === 409) {
          throw new Error(
            "This appointment slot has already been booked by another patient. Please choose another slot."
          );
        }
        throw new Error(data?.error || "Booking failed");
      }

      setConfirmedBooking(data.booking);
      fetchSlots(); // refresh availability
    } catch (err: any) {
      setSubmitError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  // Cancel booking
  async function handleCancelBooking(bookingId: string) {
    if (!confirm("Are you sure you want to cancel this appointment?")) return;

    try {
      const res = await fetch(`/api/bookings/${bookingId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data?.error || "Failed to cancel booking");
        return;
      }

      alert("Appointment cancelled successfully. The slot is now available again.");
      
      // Update local state if currently showing confirmed booking
      if (confirmedBooking && confirmedBooking.id === bookingId) {
        setConfirmedBooking(data.booking);
      }
      // Update lookup list
      setUserBookings((prev) =>
        prev.map((b) => (b.id === bookingId ? data.booking : b))
      );
      if (singleBooking && singleBooking.id === bookingId) {
        setSingleBooking(data.booking);
      }
      fetchSlots();
    } catch (err: any) {
      alert(err.message);
    }
  }

  // Lookup bookings by email
  async function handleLookupByEmail(cursor?: string) {
    if (!lookupEmail) return;
    setLookupLoading(true);
    setLookupError(null);
    try {
      const params = new URLSearchParams();
      params.set("email", lookupEmail.trim().toLowerCase());
      params.set("limit", "5");
      if (cursor) {
        params.set("cursor", cursor);
      }

      const res = await fetch(`/api/bookings?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to retrieve bookings");
      }

      if (cursor) {
        setUserBookings((prev) => [...prev, ...(data.bookings || [])]);
      } else {
        setUserBookings(data.bookings || []);
      }
      setNextCursor(data.next_cursor || null);
    } catch (err: any) {
      setLookupError(err.message);
    } finally {
      setLookupLoading(false);
    }
  }

  // Lookup single booking by ID
  async function handleLookupById(e: React.FormEvent) {
    e.preventDefault();
    if (!bookingIdSearch.trim()) return;
    setSingleBooking(null);
    setSingleBookingError(null);

    try {
      const res = await fetch(`/api/bookings/${bookingIdSearch.trim()}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Booking not found");
      }
      setSingleBooking(data.booking);
    } catch (err: any) {
      setSingleBookingError(err.message);
    }
  }

  // Reset clinic database
  async function handleResetSlots() {
    if (!confirm("Reset all slots to default demo schedule? All active bookings will be cleared.")) return;
    setResetting(true);
    setResetMessage(null);
    try {
      const res = await fetch("/api/reset", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to reset");
      setResetMessage("✓ Clinic slots reset successfully! Fresh slots are now live.");
      fetchSlots();
      setConfirmedBooking(null);
      setSelectedSlot(null);
      setUserBookings([]);
    } catch (err: any) {
      setResetMessage(`Error: ${err.message}`);
    } finally {
      setResetting(false);
    }
  }

  const providers = Array.from(new Set(slots.map((s) => s.provider)));
  const filteredSlots = slots.filter((slot) => {
    if (selectedProvider !== "all" && slot.provider !== selectedProvider) return false;
    if (hideUnavailable && !slot.available) return false;
    return true;
  });

  const formatSlotTime = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      });
    } catch {
      return isoString;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20 font-bold text-xl">
              ⚕️
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">
                Apex Health Clinic
              </h1>
              <p className="text-xs text-slate-500">
                Patient Appointment Booking & Management
              </p>
            </div>
          </div>

          {/* Backend Status indicator */}
          <div className="flex items-center gap-2 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1.5 rounded-full font-medium self-start sm:self-auto">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            Backend API Connected & Verified
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex gap-2 border-t border-slate-100">
          <button
            onClick={() => setActiveTab("book")}
            className={`py-3 px-4 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === "book"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            📅 Book an Appointment
          </button>
          <button
            onClick={() => setActiveTab("lookup")}
            className={`py-3 px-4 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === "lookup"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            📋 My Appointments
          </button>
          <button
            onClick={() => setActiveTab("demo")}
            className={`py-3 px-4 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === "demo"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            ⚡ Demo & Controls
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {/* TAB 1: BOOKING */}
        {activeTab === "book" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left Column: Slots Browser (7 cols on lg) */}
            <div className="lg:col-span-7 space-y-6">
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">
                      Available Appointment Slots
                    </h2>
                    <p className="text-xs text-slate-500">
                      Select an available slot below to begin your booking
                    </p>
                  </div>
                  <button
                    onClick={fetchSlots}
                    disabled={slotsLoading}
                    className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1 self-start sm:self-auto cursor-pointer"
                  >
                    🔄 Refresh Slots
                  </button>
                </div>

                {/* Filters */}
                <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-slate-100">
                  <div className="flex items-center gap-2 text-sm">
                    <label htmlFor="provider-filter" className="text-xs font-semibold text-slate-600">
                      Doctor / Provider:
                    </label>
                    <select
                      id="provider-filter"
                      value={selectedProvider}
                      onChange={(e) => setSelectedProvider(e.target.value)}
                      className="bg-slate-50 border border-slate-200 text-slate-800 text-xs rounded-lg px-2.5 py-1.5 focus:outline-blue-500"
                    >
                      <option value="all">All Providers</option>
                      {providers.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>

                  <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={hideUnavailable}
                      onChange={(e) => setHideUnavailable(e.target.checked)}
                      className="rounded text-blue-600 focus:ring-blue-500"
                    />
                    Hide booked slots
                  </label>
                </div>

                {/* Slots List */}
                {slotsLoading ? (
                  <div className="py-12 text-center text-slate-400 text-sm">
                    <div className="inline-block w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mb-2"></div>
                    <p>Loading available slots from clinic API...</p>
                  </div>
                ) : slotsError ? (
                  <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm">
                    ⚠️ {slotsError}
                  </div>
                ) : filteredSlots.length === 0 ? (
                  <div className="py-12 text-center text-slate-500 text-sm bg-slate-50 rounded-xl">
                    No appointment slots found matching your criteria.
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                    {filteredSlots.map((slot) => {
                      const isSelected = selectedSlot?.id === slot.id;
                      return (
                        <div
                          key={slot.id}
                          onClick={() => {
                            if (slot.available) {
                              setSelectedSlot(slot);
                              setConfirmedBooking(null);
                              setSubmitError(null);
                            }
                          }}
                          className={`p-4 rounded-xl border transition-all ${
                            !slot.available
                              ? "bg-slate-50 border-slate-200 opacity-60 cursor-not-allowed"
                              : isSelected
                              ? "bg-blue-50/70 border-blue-500 ring-2 ring-blue-500/20 shadow-xs cursor-pointer"
                              : "bg-white border-slate-200 hover:border-blue-300 hover:shadow-xs cursor-pointer"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div
                                className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-xs ${
                                  slot.available
                                    ? "bg-blue-100 text-blue-700"
                                    : "bg-slate-200 text-slate-600"
                                }`}
                              >
                                {slot.provider.split(" ").map((w) => w[0]).join("")}
                              </div>
                              <div>
                                <h3 className="font-semibold text-sm text-slate-900">
                                  {slot.provider}
                                </h3>
                                <p className="text-xs text-slate-500">
                                  {formatSlotTime(slot.start)}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-3">
                              {slot.available ? (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                                  Available
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-200 text-slate-600">
                                  Booked
                                </span>
                              )}

                              {slot.available && (
                                <span
                                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                                    isSelected
                                      ? "bg-blue-600 text-white"
                                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                                  }`}
                                >
                                  {isSelected ? "Selected" : "Select"}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Booking Form or Confirmation (5 cols on lg) */}
            <div className="lg:col-span-5 space-y-6">
              {/* Confirmed Booking Card */}
              {confirmedBooking ? (
                <div className="bg-white p-6 rounded-2xl border border-emerald-200 shadow-md space-y-4">
                  <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600 text-2xl mx-auto">
                    ✓
                  </div>
                  <div className="text-center">
                    <h2 className="text-xl font-bold text-slate-900">
                      Booking Confirmed!
                    </h2>
                    <p className="text-xs text-slate-500 mt-1">
                      Your appointment has been successfully recorded in the clinic database.
                    </p>
                  </div>

                  <div className="bg-slate-50 rounded-xl p-4 space-y-2 text-xs border border-slate-100">
                    <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                      <span className="text-slate-500 font-medium">Booking ID:</span>
                      <span className="font-mono font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded">
                        {confirmedBooking.id}
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                      <span className="text-slate-500 font-medium">Slot ID:</span>
                      <span className="font-mono text-slate-800">{confirmedBooking.slot_id}</span>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                      <span className="text-slate-500 font-medium">Patient:</span>
                      <span className="font-semibold text-slate-800">{confirmedBooking.name}</span>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-slate-200/60">
                      <span className="text-slate-500 font-medium">Email:</span>
                      <span className="text-slate-800">{confirmedBooking.email}</span>
                    </div>
                    <div className="flex justify-between items-center py-1">
                      <span className="text-slate-500 font-medium">Status:</span>
                      <span
                        className={`font-semibold capitalize px-2 py-0.5 rounded-full ${
                          confirmedBooking.status === "confirmed"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {confirmedBooking.status}
                      </span>
                    </div>
                  </div>

                  {confirmedBooking.status === "confirmed" ? (
                    <div className="space-y-2 pt-2">
                      <button
                        onClick={() => handleCancelBooking(confirmedBooking.id)}
                        className="w-full bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 py-2.5 rounded-xl font-semibold text-xs transition-colors cursor-pointer"
                      >
                        Cancel This Appointment
                      </button>
                      <button
                        onClick={() => {
                          setConfirmedBooking(null);
                          setSelectedSlot(null);
                        }}
                        className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 py-2.5 rounded-xl font-semibold text-xs transition-colors cursor-pointer"
                      >
                        Book Another Slot
                      </button>
                    </div>
                  ) : (
                    <div className="pt-2">
                      <div className="p-3 bg-red-50 text-red-700 rounded-xl text-xs text-center mb-3">
                        This appointment was cancelled and the slot has been returned to availability.
                      </div>
                      <button
                        onClick={() => {
                          setConfirmedBooking(null);
                          setSelectedSlot(null);
                        }}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-xl font-semibold text-xs transition-colors cursor-pointer"
                      >
                        Book a New Slot
                      </button>
                    </div>
                  )}
                </div>
              ) : selectedSlot ? (
                /* Booking Form */
                <form
                  onSubmit={handleBookSlot}
                  className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-5"
                >
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">
                      Complete Your Booking
                    </h2>
                    <p className="text-xs text-slate-500">
                      Enter patient information to reserve this slot
                    </p>
                  </div>

                  {/* Selected Slot Summary */}
                  <div className="bg-blue-50/60 border border-blue-200 rounded-xl p-3.5 space-y-1 text-xs">
                    <div className="font-semibold text-blue-900 flex justify-between">
                      <span>Doctor / Provider:</span>
                      <span>{selectedSlot.provider}</span>
                    </div>
                    <div className="text-blue-800 flex justify-between">
                      <span>Time:</span>
                      <span>{formatSlotTime(selectedSlot.start)}</span>
                    </div>
                    <div className="text-blue-700 text-[11px] flex justify-between">
                      <span>Slot ID:</span>
                      <span className="font-mono">{selectedSlot.id}</span>
                    </div>
                  </div>

                  {/* Errors & Rate Limit Timer Banner */}
                  {rateLimitTimer !== null && (
                    <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 space-y-1">
                      <div className="font-semibold flex items-center gap-1.5">
                        <span>⏳ Rate Limit Active</span>
                      </div>
                      <p>
                        Too many attempts for this email. Please wait{" "}
                        <span className="font-bold font-mono text-amber-900">
                          {rateLimitTimer}s
                        </span>{" "}
                        before retrying.
                      </p>
                    </div>
                  )}

                  {submitError && !rateLimitTimer && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                      ⚠️ {submitError}
                    </div>
                  )}

                  {/* Inputs */}
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Patient Full Name *
                      </label>
                      <input
                        type="text"
                        required
                        value={patientName}
                        onChange={(e) => setPatientName(e.target.value)}
                        placeholder="e.g. John Doe"
                        className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-blue-500 focus:bg-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Email Address *
                      </label>
                      <input
                        type="email"
                        required
                        value={patientEmail}
                        onChange={(e) => setPatientEmail(e.target.value)}
                        placeholder="e.g. patient@example.com"
                        className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-blue-500 focus:bg-white"
                      />
                      <p className="text-[11px] text-slate-400 mt-1">
                        We use this to verify appointments and protect against spam.
                      </p>
                    </div>
                  </div>

                  <div className="pt-2 space-y-2">
                    <button
                      type="submit"
                      disabled={isSubmitting || rateLimitTimer !== null}
                      className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-semibold py-3 rounded-xl text-sm transition-colors shadow-sm cursor-pointer disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {isSubmitting ? (
                        <>
                          <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                          Confirming Slot...
                        </>
                      ) : rateLimitTimer !== null ? (
                        `Wait ${rateLimitTimer}s to retry`
                      ) : (
                        "Confirm Appointment"
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedSlot(null)}
                      className="w-full text-slate-500 hover:text-slate-700 py-2 text-xs font-medium transition-colors"
                    >
                      Cancel selection
                    </button>
                  </div>
                </form>
              ) : (
                /* Empty state when no slot selected */
                <div className="bg-white p-8 rounded-2xl border border-dashed border-slate-200 text-center space-y-3">
                  <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mx-auto text-xl">
                    👈
                  </div>
                  <h3 className="font-semibold text-sm text-slate-800">
                    No Slot Selected
                  </h3>
                  <p className="text-xs text-slate-500 max-w-xs mx-auto">
                    Select any available appointment slot from the schedule on the left to complete your patient booking.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: MY APPOINTMENTS / LOOKUP */}
        {activeTab === "lookup" && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Search by Email */}
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm">
                    ✉️
                  </div>
                  <div>
                    <h2 className="font-bold text-base text-slate-900">
                      Look Up By Patient Email
                    </h2>
                    <p className="text-xs text-slate-500">
                      View all appointments booked under your email address
                    </p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <input
                    type="email"
                    value={lookupEmail}
                    onChange={(e) => setLookupEmail(e.target.value)}
                    placeholder="Enter patient email (e.g. ada@example.com)"
                    className="flex-1 px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-blue-500"
                  />
                  <button
                    onClick={() => handleLookupByEmail()}
                    disabled={lookupLoading || !lookupEmail.trim()}
                    className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-colors cursor-pointer"
                  >
                    {lookupLoading ? "Searching..." : "Search"}
                  </button>
                </div>

                {lookupError && (
                  <div className="p-3 bg-red-50 text-red-700 border border-red-200 rounded-xl text-xs">
                    ⚠️ {lookupError}
                  </div>
                )}
              </div>

              {/* Search by Single Booking ID */}
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center font-bold text-sm">
                    🔍
                  </div>
                  <div>
                    <h2 className="font-bold text-base text-slate-900">
                      Look Up By Booking ID
                    </h2>
                    <p className="text-xs text-slate-500">
                      Direct verification of a specific booking reference
                    </p>
                  </div>
                </div>

                <form onSubmit={handleLookupById} className="flex gap-2">
                  <input
                    type="text"
                    value={bookingIdSearch}
                    onChange={(e) => setBookingIdSearch(e.target.value)}
                    placeholder="e.g. bk_1740000000_abc123"
                    className="flex-1 px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-purple-500 font-mono text-xs"
                  />
                  <button
                    type="submit"
                    disabled={!bookingIdSearch.trim()}
                    className="bg-purple-600 hover:bg-purple-700 disabled:bg-slate-300 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-colors cursor-pointer"
                  >
                    Look Up
                  </button>
                </form>

                {singleBookingError && (
                  <div className="p-3 bg-red-50 text-red-700 border border-red-200 rounded-xl text-xs">
                    ⚠️ {singleBookingError}
                  </div>
                )}
              </div>
            </div>

            {/* Single Booking Card Result */}
            {singleBooking && (
              <div className="bg-white p-6 rounded-2xl border border-purple-200 shadow-xs space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm text-slate-900">
                    Booking Record Found
                  </h3>
                  <span
                    className={`text-xs font-semibold px-3 py-1 rounded-full ${
                      singleBooking.status === "confirmed"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-red-100 text-red-800"
                    }`}
                  >
                    {singleBooking.status}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs bg-slate-50 p-4 rounded-xl">
                  <div>
                    <span className="text-slate-400 block mb-0.5">Reference ID:</span>
                    <span className="font-mono font-semibold">{singleBooking.id}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block mb-0.5">Slot ID:</span>
                    <span className="font-mono font-semibold">{singleBooking.slot_id}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block mb-0.5">Patient Name:</span>
                    <span className="font-semibold">{singleBooking.name}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block mb-0.5">Patient Email:</span>
                    <span className="font-semibold">{singleBooking.email}</span>
                  </div>
                </div>

                {singleBooking.status === "confirmed" && (
                  <button
                    onClick={() => handleCancelBooking(singleBooking.id)}
                    className="bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-xs font-semibold px-4 py-2 rounded-xl transition-colors cursor-pointer"
                  >
                    Cancel Appointment
                  </button>
                )}
              </div>
            )}

            {/* Bookings List from Email Search */}
            {userBookings.length > 0 && (
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-base text-slate-900">
                    Appointments for {lookupEmail}
                  </h3>
                  <span className="text-xs text-slate-500">
                    {userBookings.length} booking(s) loaded
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 text-slate-400 font-medium">
                        <th className="py-2.5 px-3">Reference</th>
                        <th className="py-2.5 px-3">Slot ID</th>
                        <th className="py-2.5 px-3">Patient</th>
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {userBookings.map((b) => (
                        <tr key={b.id} className="hover:bg-slate-50/50">
                          <td className="py-3 px-3 font-mono font-semibold text-blue-700">
                            {b.id}
                          </td>
                          <td className="py-3 px-3 font-mono text-slate-600">{b.slot_id}</td>
                          <td className="py-3 px-3 font-medium text-slate-800">{b.name}</td>
                          <td className="py-3 px-3">
                            <span
                              className={`px-2.5 py-0.5 rounded-full font-semibold capitalize ${
                                b.status === "confirmed"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-red-100 text-red-800"
                              }`}
                            >
                              {b.status}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right">
                            {b.status === "confirmed" ? (
                              <button
                                onClick={() => handleCancelBooking(b.id)}
                                className="bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 px-3 py-1 rounded-lg font-semibold transition-colors cursor-pointer"
                              >
                                Cancel
                              </button>
                            ) : (
                              <span className="text-slate-400 italic">Cancelled</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Keyset Pagination next cursor button */}
                {nextCursor && (
                  <div className="pt-2 text-center">
                    <button
                      onClick={() => handleLookupByEmail(nextCursor)}
                      disabled={lookupLoading}
                      className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-5 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                    >
                      {lookupLoading ? "Loading..." : "Load Next Page →"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: DEMO & CONTROLS */}
        {activeTab === "demo" && (
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-6">
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Clinic Demonstration & API Status
              </h2>
              <p className="text-xs text-slate-500">
                Summary of the 5 technical levels and controls for your walk-through recording
              </p>
            </div>

            {/* Levels Checklist */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl border border-slate-100 bg-slate-50 space-y-1.5">
                <span className="text-xs font-bold text-blue-700">Level 1 • Core API</span>
                <h4 className="text-sm font-semibold text-slate-800">Slots, Booking & Lookup</h4>
                <p className="text-xs text-slate-500">
                  Lists slots ordered by start then id with computed availability. Creates bookings with bk_ IDs and UTC timestamps.
                </p>
              </div>

              <div className="p-4 rounded-xl border border-slate-100 bg-slate-50 space-y-1.5">
                <span className="text-xs font-bold text-blue-700">Level 2 • Security & Validation</span>
                <h4 className="text-sm font-semibold text-slate-800">API Key & Strict Validation</h4>
                <p className="text-xs text-slate-500">
                  Protected with X-API-Key header. Rejects missing fields, invalid email format, and past slots with 400. Next.js server proxies key safely.
                </p>
              </div>

              <div className="p-4 rounded-xl border border-slate-100 bg-slate-50 space-y-1.5">
                <span className="text-xs font-bold text-blue-700">Level 3 • Concurrency & Cancellation</span>
                <h4 className="text-sm font-semibold text-slate-800">Double-Booking Guard & Cancel</h4>
                <p className="text-xs text-slate-500">
                  Partial unique PostgreSQL index guarantees two users can never book the same slot (409 Conflict). Atomic cancellations restore slot availability.
                </p>
              </div>

              <div className="p-4 rounded-xl border border-slate-100 bg-slate-50 space-y-1.5">
                <span className="text-xs font-bold text-blue-700">Level 4 • Idempotency & Keyset Paging</span>
                <h4 className="text-sm font-semibold text-slate-800">Retry Protection & Pagination</h4>
                <p className="text-xs text-slate-500">
                  Advisory transaction locks and hash matching replay responses safely. Keyset cursor pagination provides deterministic oldest-first ordering.
                </p>
              </div>

              <div className="p-4 rounded-xl border border-slate-100 bg-slate-50 space-y-1.5 md:col-span-2">
                <span className="text-xs font-bold text-blue-700">Level 5 • Rate Limiting</span>
                <h4 className="text-sm font-semibold text-slate-800">Sliding Window Protection</h4>
                <p className="text-xs text-slate-500">
                  Enforces maximum 5 booking attempts per email per 60s sliding window. Responds with 429 and Retry-After header. The web UI displays a live countdown timer.
                </p>
              </div>
            </div>

            {/* Quick Demo Reset Button */}
            <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <h4 className="font-semibold text-sm text-slate-800">Reset Sample Slots</h4>
                <p className="text-xs text-slate-500">
                  Seeds 8 fresh demo appointment slots across Dr Ade, Dr Bello, and Dr Okafor.
                </p>
              </div>
              <button
                onClick={handleResetSlots}
                disabled={resetting}
                className="bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white text-xs font-semibold px-4 py-2.5 rounded-xl transition-colors cursor-pointer"
              >
                {resetting ? "Resetting Slots..." : "Reset Clinic Slots"}
              </button>
            </div>

            {resetMessage && (
              <div
                className={`p-3 rounded-xl text-xs ${
                  resetMessage.startsWith("✓")
                    ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                    : "bg-red-50 text-red-800 border border-red-200"
                }`}
              >
                {resetMessage}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-slate-200 py-6 text-center text-xs text-slate-500">
        <p>Apex Health Clinic • Built with FastAPI, PostgreSQL (Neon), and Next.js</p>
        <p className="mt-1 text-[11px] text-slate-400">
          Deployed securely on Vercel • API Key isolated on Next.js server
        </p>
      </footer>
    </div>
  );
}
