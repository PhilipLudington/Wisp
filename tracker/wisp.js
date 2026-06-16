/*
 * Wisp tracker — the ~1KB, dependency-free script served at /wisp.js.
 *
 * One <script> tag per site:
 *   <script defer data-site="blog" src="https://wisp.example.com/wisp.js"></script>
 *
 * Responsibilities (kept deliberately small):
 *   - Send a pageview on load and on SPA route changes (pushState/replaceState/popstate).
 *   - Transport via navigator.sendBeacon(), falling back to fetch(keepalive) — both
 *     fire-and-forget so they never block navigation and survive page unload.
 *   - Expose window.wisp('event', name, props?) for custom events, flushing any
 *     calls queued before the script loaded.
 *   - Optionally auto-track outbound link clicks and scroll depth. Which
 *     behaviors run is driven by the site's server-side config, fetched from
 *     `/c/<site>` (so a central config change reaches every embed without
 *     editing the snippet). A `data-auto="outboundLinks,scrollDepth"` attribute
 *     overrides that fetch for one-off/inline control.
 *   - Collect nothing identifying: path, referrer, screen width, site key only.
 *
 * Written as a hand-minifiable IIFE; the build step (scripts/build-tracker.ts)
 * minifies this into dist/wisp.js. Globals are passed in so the bundle stays
 * compact and so the script is testable with stubbed globals.
 */
(function (window, document, navigator, location, history, screen) {
  // Locate our own <script> tag to read configuration attributes.
  var self =
    document.currentScript ||
    (function () {
      var all = document.getElementsByTagName('script');
      return all[all.length - 1];
    })();
  if (!self) return;

  var site = self.getAttribute('data-site');
  if (!site) return;

  // Endpoint base: explicit data-host wins, else derive the origin from the
  // script src. /e takes events; /c/<site> serves this site's auto-track config.
  var base = (self.getAttribute('data-host') || new URL(self.src).origin).replace(/\/$/, '');
  var endpoint = base + '/e';

  // Fire-and-forget transport: sendBeacon when available, else keepalive fetch.
  // A plain-string body keeps the request CORS-"simple" (text/plain), so no
  // preflight; the collector ignores content-type and JSON-parses the body.
  function send(kind, name, props) {
    var body = JSON.stringify({
      site: site,
      kind: kind,
      name: name || null,
      path: location.pathname + location.search,
      referrer: document.referrer || null,
      width: screen.width,
      props: props || null,
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, body);
    } else {
      fetch(endpoint, { method: 'POST', body: body, keepalive: true, mode: 'no-cors' });
    }
  }

  function pageview() {
    send('pageview');
  }

  // SPA route changes: wrap pushState/replaceState and listen for popstate.
  function wrap(method) {
    var original = history[method];
    if (!original) return;
    history[method] = function () {
      var result = original.apply(this, arguments);
      pageview();
      return result;
    };
  }
  wrap('pushState');
  wrap('replaceState');
  window.addEventListener('popstate', pageview);

  // Public API. Capture any pre-load queue (the standard snippet pushes calls
  // onto window.wisp.q before this script loads), then replace and flush it.
  var queued = window.wisp && window.wisp.q;
  window.wisp = function (cmd, name, props) {
    if (cmd === 'event') send('event', name, props);
  };
  if (queued) {
    for (var i = 0; i < queued.length; i++) {
      window.wisp.apply(null, queued[i]);
    }
  }

  // Wire the auto-track behaviors named in `flags` (a list of flag strings).
  function setupAuto(flags) {
    // Outbound link clicks.
    if (flags.indexOf('outboundLinks') > -1) {
      document.addEventListener('click', function (e) {
        var node = e.target;
        while (node && node.tagName !== 'A') node = node.parentNode;
        if (node && node.host && node.host !== location.host) {
          send('event', 'outbound', { url: node.href });
        }
      });
    }
    // Scroll depth — fire once when the user passes 90% of the page.
    if (flags.indexOf('scrollDepth') > -1) {
      var fired = false;
      window.addEventListener(
        'scroll',
        function () {
          if (fired) return;
          var doc = document.documentElement;
          if ((window.scrollY + window.innerHeight) / doc.scrollHeight >= 0.9) {
            fired = true;
            send('event', 'scroll', { depth: 90 });
          }
        },
        { passive: true },
      );
    }
  }

  // Inline data-auto overrides the server; otherwise fetch this site's config.
  var inline = self.getAttribute('data-auto');
  if (inline) {
    setupAuto(inline.split(','));
  } else {
    fetch(base + '/c/' + site)
      .then(function (r) {
        return r.json();
      })
      .then(function (cfg) {
        setupAuto(cfg.autoTrack || []);
      })
      .catch(function () {});
  }

  // Initial pageview.
  pageview();
})(window, document, navigator, location, history, screen);
