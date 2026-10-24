import { Page } from "playwright";

/** CourtReserve account credentials, used to re-login unattended. */
export type Credentials = {
    username: string;
    password: string;
};

export type ClientOptions = {
    headless?: boolean;
    authPath?: string;
    profileDir?: string;
    manualLogin?: boolean;
    debugPause?: boolean;
    /**
     * Email/password for unattended re-login when the saved session is stale or
     * missing. Defaults to `COURTRESERVE_USERNAME` / `COURTRESERVE_PASSWORD`
     * when both are set. Never logged.
     */
    credentials?: Credentials;
    /** Log directory for the library's own log file; `false` disables it. */
    logPath?: string | false;
    /** Minimum log level (default `info`, or `LOG_LEVEL`). */
    logLevel?: string;
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
    /**
     * Every court on the card, when one reservation covers more than one. Length
     * 1 for the usual single-court booking. Length > 1 means a single
     * reservation spanning several courts, which the site edits as one unit
     * (one flat member list, one save). That count scales the session's per-court
     * capacity: a reservation covering N courts holds N times courtCapacity
     * players, with one slot for its organizer.
     */
    courtNumbers?: number[];
    players: string[];
};

export type PlayerInput = {
    name: string;
    /**
     * CourtReserve `MemberId` to select instead of matching `name` against the
     * search results. Set for the members the club lists under a name another
     * member shares, where no string comparison can tell the results apart.
     * Absent for everyone else, and the search then behaves exactly as before.
     */
    memberId?: number;
};

export type BookingSession = Booking & {
    page: Page;
};

export type PlayerAddReason =
    | "already-added"
    | "not-found"
    | "ambiguous"
    | "member-id-not-found"
    | "query-too-short"
    | "not-added";

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
    /**
     * Whether the save POST was actually observed. `saved` can be true with this
     * false: the roster changed and Save was clicked, but no response arrived in
     * time, so whether it landed is unknown. The caller reports that rather than
     * counting it as done.
     */
    confirmed: boolean;
};
