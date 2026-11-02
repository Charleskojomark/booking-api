"use client";

import { useEffect, useRef, useState } from "react";

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
  const [activeTab, setActiveTab] = useState<"book" | "lookup">("book");

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
  const [lookupMode, setLookupMode] = useState<"email" | "id">("email");
  const [lookupEmail, setLookupEmail] = useState("");
  const [searchedEmail, setSearchedEmail] = useState<string | null>(null);
  const [userBookings, setUserBookings] = useState<Booking[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [bookingIdSearch, setBookingIdSearch] = useState("");
  const [singleBooking, setSingleBooking] = useState<Booking | null>(null);
  const [singleBookingError, setSingleBookingError] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchSlots();
  }, [selectedProvider]);

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
      setSlotsError(err.message || "Unable to load appointment slots.");
    } finally {
      setSlotsLoading(false);
    }
  }

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
            `Rate limit exceeded: Please wait ${retrySeconds || 60} seconds before retrying.`
          );
        }
        if (res.status === 409) {
          throw new Error(
            "This slot has already been booked by another patient. Please choose another slot."
          );
        }
        throw new Error(data?.error || "Booking failed");
      }

      setConfirmedBooking(data.booking);
      fetchSlots();
    } catch (err: any) {
      setSubmitError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  }

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

      if (confirmedBooking && confirmedBooking.id === bookingId) {
        setConfirmedBooking(data.booking);
      }
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

  async function handleLookupByEmail(cursor?: string) {
    if (!lookupEmail) return;
    setLookupLoading(true);
    setLookupError(null);
    setSingleBooking(null);
    setSingleBookingError(null);
    const emailToSearch = lookupEmail.trim().toLowerCase();
    try {
      const params = new URLSearchParams();
      params.set("email", emailToSearch);
      params.set("limit", "5");
      if (cursor) {
        params.set("cursor", cursor);
      }

      const res = await fetch(`/api/bookings?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to retrieve bookings");
      }

      setSearchedEmail(emailToSearch);
      if (cursor) {
        setUserBookings((prev) => [...prev, ...(data.bookings || [])]);
      } else {
        setUserBookings(data.bookings || []);
      }
      setNextCursor(data.next_cursor || null);
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    } catch (err: any) {
      setLookupError(err.message);
    } finally {
      setLookupLoading(false);
    }
  }

  async function handleLookupById(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!bookingIdSearch.trim()) return;
    setSingleBooking(null);
    setSingleBookingError(null);
    setUserBookings([]);
    setLookupError(null);
    setSearchedEmail(null);

    try {
      const res = await fetch(`/api/bookings/${bookingIdSearch.trim()}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Booking not found");
      }
      setSingleBooking(data.booking);
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    } catch (err: any) {
      setSingleBookingError(err.message);
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
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Clinic Appointments
            </h1>
            <p className="text-xs text-slate-500">
              Book appointment slots and view confirmations
            </p>
          </div>

          {/* Navigation Tabs */}
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab("book")}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                activeTab === "book"
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:text-slate-900"
              }`}
            >
              Book an Appointment
            </button>
            <button
              onClick={() => setActiveTab("lookup")}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                activeTab === "lookup"
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:text-slate-900"
              }`}
            >
              My Appointments
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 flex-1 w-full">
        {activeTab === "book" && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            {/* Left: Available Slots */}
            <div className="md:col-span-7 space-y-4">
              <div className="bg-white p-5 rounded-xl border border-slate-200 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-slate-900">
                    Available Slots
                  </h2>
                  <button
                    onClick={fetchSlots}
                    disabled={slotsLoading}
                    className="text-xs bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Refresh
                  </button>
                </div>

                {/* Filters */}
                <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-slate-100 text-xs">
                  <div className="flex items-center gap-2">
                    <label htmlFor="provider-select" className="text-slate-600">
                      Provider:
                    </label>
                    <select
                      id="provider-select"
                      value={selectedProvider}
                      onChange={(e) => setSelectedProvider(e.target.value)}
                      className="bg-slate-50 border border-slate-200 rounded px-2 py-1 text-slate-800"
                    >
                      <option value="all">All Providers</option>
                      {providers.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>

                  <label className="flex items-center gap-1.5 text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hideUnavailable}
                      onChange={(e) => setHideUnavailable(e.target.checked)}
                      className="rounded border-slate-300"
                    />
                    Hide booked
                  </label>
                </div>

                {/* Slots List */}
                {slotsLoading ? (
                  <div className="py-12 text-center text-xs text-slate-500">
                    Loading slots...
                  </div>
                ) : slotsError ? (
                  <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs">
                    {slotsError}
                  </div>
                ) : filteredSlots.length === 0 ? (
                  <div className="py-12 text-center text-xs text-slate-500 bg-slate-50 rounded-lg">
                    No slots available.
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-1">
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
                          className={`p-3.5 rounded-lg border transition-all ${
                            !slot.available
                              ? "bg-slate-50 border-slate-200 opacity-60 cursor-not-allowed"
                              : isSelected
                              ? "bg-slate-50 border-slate-900 ring-1 ring-slate-900 cursor-pointer"
                              : "bg-white border-slate-200 hover:border-slate-300 cursor-pointer"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="font-medium text-sm text-slate-900">
                                {slot.provider}
                              </div>
                              <div className="text-xs text-slate-500 mt-0.5">
                                {formatSlotTime(slot.start)}
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              {slot.available ? (
                                <span className="text-[11px] font-medium bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
                                  Available
                                </span>
                              ) : (
                                <span className="text-[11px] font-medium bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">
                                  Booked
                                </span>
                              )}

                              {slot.available && (
                                <span
                                  className={`text-xs px-2.5 py-1 rounded transition-colors ${
                                    isSelected
                                      ? "bg-slate-900 text-white font-medium"
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

            {/* Right on desktop, Modal Sheet on mobile */}
            <div
              className={
                selectedSlot || confirmedBooking
                  ? "fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 p-0 sm:p-4 md:static md:z-auto md:p-0 md:bg-transparent md:block md:col-span-5"
                  : "hidden md:block md:col-span-5"
              }
              onClick={(e) => {
                if (e.target === e.currentTarget) {
                  setSelectedSlot(null);
                  setConfirmedBooking(null);
                }
              }}
            >
              <div className="w-full max-w-lg md:max-w-none bg-white rounded-t-2xl sm:rounded-xl border border-slate-200 p-5 shadow-2xl md:shadow-none max-h-[90vh] overflow-y-auto space-y-4">
                {/* Mobile top bar */}
                <div className="flex md:hidden justify-between items-center pb-2 border-b border-slate-100">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    {confirmedBooking ? "Booking Confirmation" : "Complete Booking"}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedSlot(null);
                      setConfirmedBooking(null);
                    }}
                    className="text-xs text-slate-600 bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded"
                  >
                    Close
                  </button>
                </div>

                {confirmedBooking ? (
                  /* Confirmed Card */
                  <div className="space-y-4">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900">
                        Booking Confirmed
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Your appointment details are recorded below.
                      </p>
                    </div>

                    <div className="bg-slate-50 rounded-lg p-3.5 space-y-2 text-xs border border-slate-100">
                      <div className="flex justify-between py-0.5">
                        <span className="text-slate-500">Booking ID:</span>
                        <span className="font-mono font-medium text-slate-900">
                          {confirmedBooking.id}
                        </span>
                      </div>
                      <div className="flex justify-between py-0.5">
                        <span className="text-slate-500">Slot ID:</span>
                        <span className="font-mono text-slate-900">
                          {confirmedBooking.slot_id}
                        </span>
                      </div>
                      <div className="flex justify-between py-0.5">
                        <span className="text-slate-500">Patient:</span>
                        <span className="font-medium text-slate-900">
                          {confirmedBooking.name}
                        </span>
                      </div>
                      <div className="flex justify-between py-0.5">
                        <span className="text-slate-500">Email:</span>
                        <span className="text-slate-900">
                          {confirmedBooking.email}
                        </span>
                      </div>
                      <div className="flex justify-between py-0.5">
                        <span className="text-slate-500">Status:</span>
                        <span
                          className={`capitalize font-medium px-2 py-0.5 rounded text-[11px] ${
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
                      <div className="space-y-2 pt-1">
                        <button
                          onClick={() => handleCancelBooking(confirmedBooking.id)}
                          className="w-full bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 py-2 rounded-lg text-xs font-medium transition-colors"
                        >
                          Cancel Appointment
                        </button>
                        <button
                          onClick={() => {
                            setConfirmedBooking(null);
                            setSelectedSlot(null);
                          }}
                          className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 py-2 rounded-lg text-xs font-medium transition-colors"
                        >
                          Book Another Slot
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setConfirmedBooking(null);
                          setSelectedSlot(null);
                        }}
                        className="w-full bg-slate-900 hover:bg-slate-800 text-white py-2 rounded-lg text-xs font-medium transition-colors"
                      >
                        Book a Slot
                      </button>
                    )}
                  </div>
                ) : selectedSlot ? (
                  /* Booking Form */
                  <form onSubmit={handleBookSlot} className="space-y-4">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900">
                        Book Slot
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Enter details to complete reservation
                      </p>
                    </div>

                    {/* Summary of Slot */}
                    <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 text-xs space-y-1">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Provider:</span>
                        <span className="font-medium text-slate-900">
                          {selectedSlot.provider}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Time:</span>
                        <span className="text-slate-800">
                          {formatSlotTime(selectedSlot.start)}
                        </span>
                      </div>
                    </div>

                    {/* Rate Limit Active Notice */}
                    {rateLimitTimer !== null && (
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                        Too many attempts. Please retry after {rateLimitTimer} seconds.
                      </div>
                    )}

                    {submitError && !rateLimitTimer && (
                      <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                        {submitError}
                      </div>
                    )}

                    <div className="space-y-3 text-xs">
                      <div>
                        <label className="block text-slate-700 font-medium mb-1">
                          Full Name
                        </label>
                        <input
                          type="text"
                          required
                          value={patientName}
                          onChange={(e) => setPatientName(e.target.value)}
                          placeholder="e.g. John Doe"
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-slate-900"
                        />
                      </div>

                      <div>
                        <label className="block text-slate-700 font-medium mb-1">
                          Email Address
                        </label>
                        <input
                          type="email"
                          required
                          value={patientEmail}
                          onChange={(e) => setPatientEmail(e.target.value)}
                          placeholder="e.g. patient@example.com"
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-slate-900"
                        />
                      </div>
                    </div>

                    <div className="space-y-2 pt-1">
                      <button
                        type="submit"
                        disabled={isSubmitting || rateLimitTimer !== null}
                        className="w-full bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white py-2.5 rounded-lg text-xs font-medium transition-colors"
                      >
                        {isSubmitting
                          ? "Booking..."
                          : rateLimitTimer !== null
                          ? `Wait ${rateLimitTimer}s to retry`
                          : "Confirm Booking"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedSlot(null)}
                        className="w-full text-slate-500 hover:text-slate-700 py-1.5 text-xs"
                      >
                        Cancel selection
                      </button>
                    </div>
                  </form>
                ) : (
                  /* Empty state on desktop */
                  <div className="p-6 text-center space-y-2">
                    <div className="text-sm font-medium text-slate-800">
                      No Slot Selected
                    </div>
                    <p className="text-xs text-slate-500 max-w-xs mx-auto">
                      Select an available slot from the list to begin booking.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: My Appointments */}
        {activeTab === "lookup" && (
          <div className="space-y-4">
            {/* Unified Compact Search Card */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Find Appointments
                  </h2>
                  <p className="text-xs text-slate-500">
                    Look up appointments by patient email or booking ID
                  </p>
                </div>

                {/* Mode Selector */}
                <div className="flex gap-1 bg-slate-100 p-0.5 rounded-lg text-xs self-start sm:self-auto">
                  <button
                    type="button"
                    onClick={() => {
                      setLookupMode("email");
                      setLookupError(null);
                      setSingleBookingError(null);
                      setSearchedEmail(null);
                    }}
                    className={`px-3 py-1 rounded-md font-medium transition-colors ${
                      lookupMode === "email"
                        ? "bg-white text-slate-900 shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    By Email
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setLookupMode("id");
                      setLookupError(null);
                      setSingleBookingError(null);
                      setSearchedEmail(null);
                    }}
                    className={`px-3 py-1 rounded-md font-medium transition-colors ${
                      lookupMode === "id"
                        ? "bg-white text-slate-900 shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    By Booking ID
                  </button>
                </div>
              </div>

              {/* Search Form */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (lookupMode === "email") {
                    handleLookupByEmail();
                  } else {
                    handleLookupById();
                  }
                }}
                className="flex gap-2"
              >
                <input
                  type={lookupMode === "email" ? "email" : "text"}
                  value={lookupMode === "email" ? lookupEmail : bookingIdSearch}
                  onChange={(e) => {
                    if (lookupMode === "email") {
                      setLookupEmail(e.target.value);
                    } else {
                      setBookingIdSearch(e.target.value);
                    }
                  }}
                  placeholder={
                    lookupMode === "email"
                      ? "Enter patient email (e.g. ada@example.com)"
                      : "Enter booking reference (e.g. bk_123456)"
                  }
                  className="flex-1 px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-slate-900"
                />
                <button
                  type="submit"
                  disabled={
                    lookupLoading ||
                    (lookupMode === "email"
                      ? !lookupEmail.trim()
                      : !bookingIdSearch.trim())
                  }
                  className="bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white text-xs px-4 py-2 rounded-lg font-medium transition-colors shrink-0"
                >
                  {lookupLoading ? "Searching..." : "Search"}
                </button>
              </form>

              {(lookupError || singleBookingError) && (
                <div className="p-2.5 bg-red-50 text-red-700 border border-red-200 rounded-lg text-xs">
                  {lookupError || singleBookingError}
                </div>
              )}
            </div>

            {/* Results Section (Scroll target) */}
            <div ref={resultsRef} className="space-y-4">
              {/* Empty state when email lookup returns zero bookings */}
              {searchedEmail && userBookings.length === 0 && !lookupLoading && !lookupError && (
                <div className="bg-white p-6 rounded-xl border border-slate-200 text-center text-xs text-slate-500">
                  No bookings found for <span className="font-semibold text-slate-900">{searchedEmail}</span>.
                </div>
              )}

              {/* Single Booking Result */}
              {singleBooking && (
                <div className="bg-white p-5 rounded-xl border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-sm text-slate-900">
                      Booking Found
                    </div>
                    <span
                      className={`text-xs px-2 py-0.5 rounded capitalize ${
                        singleBooking.status === "confirmed"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-red-100 text-red-800"
                      }`}
                    >
                      {singleBooking.status}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs bg-slate-50 p-3 rounded-lg">
                    <div>
                      <span className="text-slate-500 block">ID:</span>
                      <span className="font-mono font-medium text-slate-800">
                        {singleBooking.id}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Slot ID:</span>
                      <span className="font-mono text-slate-800">
                        {singleBooking.slot_id}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Patient:</span>
                      <span className="text-slate-800">{singleBooking.name}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Email:</span>
                      <span className="text-slate-800">{singleBooking.email}</span>
                    </div>
                  </div>

                  {singleBooking.status === "confirmed" && (
                    <button
                      onClick={() => handleCancelBooking(singleBooking.id)}
                      className="bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-xs px-3 py-1.5 rounded transition-colors"
                    >
                      Cancel Booking
                    </button>
                  )}
                </div>
              )}

              {/* Bookings List Result */}
              {userBookings.length > 0 && (
                <div className="bg-white p-4 sm:p-5 rounded-xl border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-sm text-slate-900">
                      Bookings for {lookupEmail}
                    </h3>
                    <span className="text-xs text-slate-500">
                      {userBookings.length} booking(s)
                    </span>
                  </div>

                  {/* Mobile Cards (sm:hidden) */}
                  <div className="sm:hidden space-y-2.5">
                    {userBookings.map((b) => (
                      <div
                        key={b.id}
                        className="p-3 bg-slate-50 rounded-lg border border-slate-100 text-xs space-y-1.5"
                      >
                        <div className="flex justify-between items-center">
                          <span className="font-mono font-medium text-slate-900">
                            {b.id}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] capitalize font-medium ${
                              b.status === "confirmed"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-red-100 text-red-800"
                            }`}
                          >
                            {b.status}
                          </span>
                        </div>
                        <div className="flex justify-between text-slate-600 text-[11px]">
                          <span>Slot: {b.slot_id}</span>
                          <span>{b.name}</span>
                        </div>
                        {b.status === "confirmed" && (
                          <div className="pt-1">
                            <button
                              onClick={() => handleCancelBooking(b.id)}
                              className="w-full text-xs bg-red-50 hover:bg-red-100 text-red-700 py-1.5 rounded border border-red-100 font-medium transition-colors"
                            >
                              Cancel Booking
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Tablet/Desktop Table (hidden sm:block) */}
                  <div className="hidden sm:block overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 text-slate-400 font-medium">
                          <th className="py-2 px-2">ID</th>
                          <th className="py-2 px-2">Slot</th>
                          <th className="py-2 px-2">Patient</th>
                          <th className="py-2 px-2">Status</th>
                          <th className="py-2 px-2 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {userBookings.map((b) => (
                          <tr key={b.id}>
                            <td className="py-2.5 px-2 font-mono text-slate-900">
                              {b.id}
                            </td>
                            <td className="py-2.5 px-2 font-mono text-slate-600">
                              {b.slot_id}
                            </td>
                            <td className="py-2.5 px-2 text-slate-800">{b.name}</td>
                            <td className="py-2.5 px-2">
                              <span
                                className={`px-2 py-0.5 rounded text-[11px] capitalize ${
                                  b.status === "confirmed"
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-red-100 text-red-800"
                                }`}
                              >
                                {b.status}
                              </span>
                            </td>
                            <td className="py-2.5 px-2 text-right">
                              {b.status === "confirmed" ? (
                                <button
                                  onClick={() => handleCancelBooking(b.id)}
                                  className="text-xs bg-red-50 hover:bg-red-100 text-red-700 px-2.5 py-1 rounded transition-colors"
                                >
                                  Cancel
                                </button>
                              ) : (
                                <span className="text-slate-400">Cancelled</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {nextCursor && (
                    <div className="text-center pt-2">
                      <button
                        onClick={() => handleLookupByEmail(nextCursor)}
                        disabled={lookupLoading}
                        className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-1.5 rounded text-xs font-medium transition-colors"
                      >
                        {lookupLoading ? "Loading..." : "Load More"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Minimal Footer */}
      <footer className="border-t border-slate-200 py-4 text-center text-xs text-slate-400">
        Clinic Appointment Booking
      </footer>
    </div>
  );
}
