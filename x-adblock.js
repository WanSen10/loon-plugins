/* X/Twitter JSON timeline filter for Loon. No network or storage access.
 * Only remove explicitly promoted entries; leave unknown schemas untouched.
 * Local simulation: node tests/x-adblock.test.cjs
 */
(function () {
  "use strict";
  var result = {};
  try {
    var route = /^https:\/\/(?:(?:api|www|mobile)\.)?(?:x|twitter)\.com\/(?:(?:i\/api\/)?graphql\/|(?:i\/api\/)?2\/timeline\/)/;
    var body = typeof $response !== "undefined" && $response.body;
    if (typeof $request !== "undefined" && route.test($request.url) &&
        typeof body === "string" && body.length > 0) {
      var data = JSON.parse(body);
      var removed = 0;

      function object(value) {
        return value !== null && typeof value === "object" && !Array.isArray(value);
      }

      function marked(value) {
        return object(value) && (
          object(value.promotedMetadata) || object(value.promoted_metadata)
        );
      }

      function promoted(entry) {
        if (!object(entry)) return false;
        var id = entry.entryId || entry.entry_id;
        if (typeof id === "string" && /^promoted[-_]/i.test(id)) return true;
        // Do not search tweet text, quoted tweets, or arbitrary descendants.
        var content = object(entry.content) ? entry.content : {};
        var item = object(entry.item) ? entry.item : {};
        return marked(entry) || marked(content) || marked(item) ||
          marked(entry.itemContent) || marked(content.itemContent) ||
          marked(item.itemContent);
      }

      function emptyModule(entry) {
        var content = object(entry) && entry.content;
        return object(content) &&
          (content.entryType === "TimelineTimelineModule" ||
           content.__typename === "TimelineTimelineModule") &&
          Array.isArray(content.items) && content.items.length === 0;
      }

      function filter(list) {
        var kept = [];
        list.forEach(function (entry) {
          if (promoted(entry)) {
            removed++;
            return;
          }
          var hadItems = object(entry) && object(entry.content) &&
            Array.isArray(entry.content.items) && entry.content.items.length > 0;
          visit(entry);
          if (hadItems && emptyModule(entry)) return;
          kept.push(entry);
        });
        return kept;
      }

      function visit(node) {
        if (Array.isArray(node)) {
          node.forEach(visit);
          return;
        }
        if (!object(node)) return;
        Object.keys(node).forEach(function (key) {
          var value = node[key];
          if ((key === "entries" || key === "items" || key === "moduleItems") &&
              Array.isArray(value)) {
            node[key] = filter(value);
          } else if (key === "instructions" && Array.isArray(value)) {
            node[key] = value.filter(function (instruction) {
              // Pin/replace instructions contain a single entry, not entries[].
              if (object(instruction) && promoted(instruction.entry)) {
                removed++;
                return false;
              }
              visit(instruction);
              return true;
            });
          } else {
            visit(value);
          }
        });
      }

      visit(data);
      if (removed > 0) {
        result = { body: JSON.stringify(data) };
        console.log("[X-AdBlock] removed=" + removed);
      }
    }
  } catch (error) {
    // Keep the original response on parse errors or unsupported data.
    console.log("[X-AdBlock] unchanged: " + error.name);
  }
  $done(result);
})();
