import { Page } from "playwright";
import { CourtLocation } from "./constants";

export type ClientOptions = {
    headless?: boolean;
    authPath?: string;
    profileDir?: string;
    manualLogin?: boolean;
    debugPause?: boolean;
};

export type BookingFilters = {
    date?: string | Date;
    startTime?: string;
    weekday?: string;
};

export type Booking = {
    bookingId: string;
    dayOfWeek: string;
    startTime: Date;
    endTime: Date;
    courtNumber: number;
    courtLocation: string;
    players: string[];
};

export type PlayerInput = { name: string };

export type BookingSession = Booking & {
    page: Page;
};

export type PlayerAddReason =
    | "already-added"
    | "not-found"
    | "ambiguous"
    | "query-too-short";

export type PlayerAddOutcome = {
    name: string;
    reason: PlayerAddReason;
    candidates?: string[];
};

export type AddPlayersResult = {
    players: string[];
    added: string[];
    skipped: PlayerAddOutcome[];
    failed: PlayerAddOutcome[];
    saved: boolean;
};

export type PlayerRemoveReason = "not-in-roster" | "not-removable";

export type PlayerRemoveOutcome = {
    name: string;
    reason: PlayerRemoveReason;
};

export type RemovePlayersResult = {
    players: string[];
    removed: string[];
    skipped: PlayerRemoveOutcome[];
    failed: PlayerRemoveOutcome[];
    saved: boolean;
};

export type SwapPlayerResult = {
    players: string[];
    removed: string[];
    added: string[];
    skipped: (PlayerAddOutcome | PlayerRemoveOutcome)[];
    failed: (PlayerAddOutcome | PlayerRemoveOutcome)[];
    saved: boolean;
};

export type ReserveDurationMinutes = 60 | 90 | 120 | 150 | 180;

export type ReserveCourtOptions = {
    location: CourtLocation;
    date: string | Date;
    startTime: string;
    durationMinutes: ReserveDurationMinutes;
    players: PlayerInput[];
    preferCourts?: number[];
};

export type ReservedSlot = {
    courtLocation: string;
    courtNumber: number;
    startTime: Date;
    endTime: Date;
    players: string[];
};

export type ReserveCourtResult = {
    reserved: boolean;
    paid: boolean;
    courtLabel: string;
    courtNumber: number;
    startTime: Date;
    endTime: Date;
    totalDue: string;
    players: string[];
    added: string[];
    skipped: PlayerAddOutcome[];
    failed: PlayerAddOutcome[];
};
