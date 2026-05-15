// Provider boot module. Each `import "./<provider>"` runs the provider file
// for its registerProvider() side-effect — the registry has no other way to
// learn about implementations. Files self-skip when their API key env is
// missing, so leaving an unused provider imported is safe.
//
// S9 will append `./openweather`, `./tmdb`, `./eventbrite` here. Anything
// that calls `getProvider()` should import this module first.

import "./google-places";
