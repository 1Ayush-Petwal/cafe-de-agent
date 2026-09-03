# Money becomes per-slot paise

> Local mirror of [1Ayush-Petwal/cafe-de-agent/issues/3](https://github.com/1Ayush-Petwal/cafe-de-agent/issues/3) - GitHub is the source of truth. Label: `ready-for-agent`, `Sandcastle`.

## Parent

#1

## What to build

Every price in the system becomes an integer paise value carried on the slot it belongs to. Cafés gain a price band and an owner-set maximum-discount floor. Slots gain a price derived at seed time from that band and the slot's hour and day, so evenings and weekends cost more than mid-afternoon. The wallet moves from whole rupees to paise, and the flat per-booking charge constant is removed entirely: the charge becomes the slot's own price, resolved at the single point every write path already routes through. Availability responses and the slot grid show the price before it is picked.

This is a prefactor as much as a feature. Making the charge take an amount turns the shared booking-write helper into the one seam that the mandate consume and the payment-provider switch both branch at later, so both of those become insertions rather than refactors.

## Acceptance criteria

- [ ] Café carries a price band and a maximum-discount floor
- [ ] Every seeded slot carries an integer paise price that varies by hour and by weekday versus weekend
- [ ] Confirming a booking charges the slot's own price rather than a constant, and the payment record stores the same amount
- [ ] Direct-book and hold-then-confirm paths charge identically
- [ ] Wallet balances are stored in paise; the insufficient-balance message still reads in rupees
- [ ] The flat per-booking charge constant no longer exists anywhere in the codebase
- [ ] Availability responses include the price, and the slot grid displays it (manual)
- [ ] Existing wallet, confirm-payment and booking e2e specs migrated to paise and passing

## Blocked by

None - can start immediately

