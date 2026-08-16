import { Page } from "playwright";

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
export type PlayerIdentifier = { name: string };

export type BookingSession = Booking & {
    page: Page;
};
