// How large the longest ferry draws on screen.
//
// Was 44px, which put a 460' Jumbo Mark II at 44x13 and a 274' Kwa-di
// Tabil at 26x8 on a 390px phone - small enough that the traced WSDOT
// profiles read as pale dashes and the class differences were invisible.
// 68px keeps the strict length proportion (the point of tracing real
// profiles) while making the boats the loudest thing on a ferry map,
// which is what they should have been all along.
export const VESSEL_ANCHOR_PX = 68;
