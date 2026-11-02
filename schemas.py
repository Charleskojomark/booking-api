from pydantic import BaseModel, ConfigDict


class Error(BaseModel):
    model_config = ConfigDict(extra="forbid")
    error: str


class Slot(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    provider: str
    start: str
    end: str


class SlotWithAvailability(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    provider: str
    start: str
    end: str
    available: bool


class NewBooking(BaseModel):
    model_config = ConfigDict(extra="ignore")
    slot_id: str
    name: str
    email: str


class Booking(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    slot_id: str
    name: str
    email: str
    status: str
    created_at: str


class BookingsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    bookings: list[Booking]
    next_cursor: str | None
