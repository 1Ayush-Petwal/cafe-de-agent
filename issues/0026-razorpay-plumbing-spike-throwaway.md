# Razorpay plumbing spike (throwaway)

> Local mirror of [1Ayush-Petwal/cafe-de-agent/issues/2](https://github.com/1Ayush-Petwal/cafe-de-agent/issues/2) - GitHub is the source of truth. Label: `ready-for-human`, `Sandcastle`.

## Parent

#1

## What to build

Prove the Razorpay test-mode plumbing before any of it is designed into the application, using outbound API calls and locally self-signed webhook payloads.

**A publicly reachable URL is deliberately out of scope.** The only fact inbound delivery would establish that this scope does not is whether Razorpay reaches the endpoint - and that has to be proven on the deployment that actually runs the demo, not on a temporary tunnel with different network characteristics. Proving delivery through a tunnel proves delivery to the tunnel.

Verify by outbound call that an order is created with an integer paise amount, and that all five notes keys survive the round trip on both the order and the resulting payment. The correctness argument for #8 depends entirely on those keys coming back intact on the webhook.

Verify signature handling locally: compute an HMAC over a representative payload using the configured webhook secret, post it at the route, and confirm a correct signature passes while a wrong-secret payload is rejected before anything parses it. Confirm that enabling raw-body parsing does not disturb the existing JSON routes.

The signing helper written here is **not throwaway** - #11 needs exactly this helper to drive the harness through the real webhook route. Everything else is.

Findings go back onto this issue as a comment. Real inbound delivery is proven once, as part of #8, against the deployed service.

## Acceptance criteria

- [ ] Test-mode credentials in place; key id confirmed to be a test key, not a live one
- [ ] A webhook secret exists and is confirmed distinct from the API key secret
- [ ] Order created via outbound call, with the amount confirmed as integer paise
- [ ] All five notes keys round-trip intact on the order and on the resulting payment
- [ ] Razorpay's constraints on notes key count and value types confirmed against our five-key usage
- [ ] A correctly signed payload verifies against the raw bytes; a wrong-secret payload is rejected before parsing
- [ ] Raw-body parsing confirmed not to break existing JSON routes
- [ ] Findings posted as a comment on this issue
- [ ] Spike code is not merged

## Blocked by

None - can start immediately

