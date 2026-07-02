/**
 * M1 (issue #3): the naive M0 check-then-insert double-books under
 * concurrency. These are the three ways to make check-and-reserve atomic,
 * selectable per-request so they can be compared under contention. `unique`
 * is the default and the one the UI uses; `pessimistic`/`optimistic` exist
 * for the M1 comparison.
 */
export enum BookingStrategy {
  UNIQUE = 'unique',
  PESSIMISTIC = 'pessimistic',
  OPTIMISTIC = 'optimistic',
}
