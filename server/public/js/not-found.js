// The not-found page, for an upload that isn't on this server. A Dropgate 3
// single file's link has the same path as one of Dropgate 4's, /<id>, but its
// key after the # is 44 characters of standard base64 (32 bytes, ending in
// =), where Dropgate 4's secret is 43 characters of URL-safe base64. No such
// upload is ever on a Dropgate 4 server, so the page says the link is from an
// older version, as a Dropgate 3 bundle's link (/b/<id>) does. The # part
// never leaves the browser: it's only read here.

const UUID_PATH = /^\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const V3_KEY = /^[A-Za-z0-9+/]{43}=$/;

/** What's after the #, as it was written: a chat app may have percent-encoded the = and the /. */
function fragment() {
  const raw = location.hash.slice(1);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function showOlderVersion() {
  const notFound = document.getElementById('not-found');
  const olderVersion = document.getElementById('older-version');
  if (!notFound || !olderVersion) return;
  notFound.replaceWith(olderVersion.content.cloneNode(true));
}

if (UUID_PATH.test(location.pathname) && V3_KEY.test(fragment())) showOlderVersion();
