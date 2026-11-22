import { showServerVersion } from './page-common.js';

// The footer's server version, on every page that may ask the server for its
// info as it opens. A direct transfer's receive page asks only once someone
// has chosen to connect, so it doesn't load this.
void showServerVersion();
