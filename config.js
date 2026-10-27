// Where problems come from. The bank is a separate public repository; see
// DESIGN.md for its layout. On localhost, `?bank=<url>` overrides this so a
// local checkout of the bank can be served next to the app.
export const BANK_URL =
  "https://raw.githubusercontent.com/pujunru/practical-coding-problems/main/";

// A run longer than this is treated as an infinite loop and the worker is
// restarted.
export const RUN_TIMEOUT_MS = 10_000;
