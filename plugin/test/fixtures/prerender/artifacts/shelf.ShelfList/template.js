// A stand-in for an emitted template artifact, shaped like the real thing:
// the markup a component's locators address, and the element it hangs from.
//
// Nothing in this suite ever paints this markup, which is the point — it gives
// the verbatim check something to fail on, so the check itself is proved rather
// than assumed.
export const html = '<div class="shelf-mount"><ul class="shelf"></ul></div>';
export const root = 'div';
