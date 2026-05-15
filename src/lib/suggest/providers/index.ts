// Provider boot module. Each `import "./<provider>"` runs the provider file
// for its registerProvider() / registerWeatherProvider() side-effect — the
// registries have no other way to learn about implementations. Files self-
// skip when their API key env is missing, so leaving an unused provider
// imported is safe.
//
// Anything that calls getProvider() / getWeatherProvider() should import
// this module first.

import "./google-places";
import "./openweather";
import "./tmdb";
import "./eventbrite";
