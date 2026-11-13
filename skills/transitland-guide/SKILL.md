---
name: transitland-guide
description: Use transitland_* tools to check departures around a place, interpret overnight service and disruption alerts, or find an operator's transit feed and check its reuse terms.
license: Apache-2.0
metadata:
  author: "cyanheads"
  version: "1.0"
---

## Scope

Transitland covers indexed transit networks and their published feeds. The server uses a Transitland API key. Stop departures and alerts are limited to what Transitland has for the selected stop, its returned children, and the returned trips.

## Identifiers

- Take the operator Onestop ID from `transitland_find_operators` for `transitland_get_operator` or an operator's feed and route searches.
- Take the feed Onestop ID from the operator's feed references, `transitland_find_feeds`, or the source-feed reference on a route or stop when present. Use it for an exact feed lookup when checking the terms for a specific dataset.
- Take the station or platform Onestop ID from `transitland_find_stops` for `transitland_get_departures`. A child's `parentOnestopId`, when resolved, is the ID to use for departures across the station. Use `platformCode` and the stop description when present to identify the boarding platform and direction.
- A departure's `route.onestopId` can resolve line details through `transitland_find_routes`. A departure's `tripId` identifies a trip within its source GTFS feed.

## Gates

- Before reporting that a place has no indexed stops, verify the place and review the first-page filters. A point and bounding box intersect, so a point outside the intended box can hide every match. Use a precise stop name or coordinates near the place. Continue general searches with the returned cursor and the same filters. An empty continuation ends that listing.
- Before reporting no departures, verify that the station or intended platform and the local time window match the question. For service after midnight, check the preceding GTFS service date as appropriate. A Monday service day can include departures on Tuesday, expressed with GTFS hours such as `25:15:00`. Use the returned timestamp to present the local departure time. Report an empty result as no departures returned for the checked window. When typical-service fallback is enabled, present the result as representative, even if the returned service date matches the request. For dated service, leave fallback off.
- Before presenting a departure as boardable, check the row's cancellation status and the applicable stop and trip alerts. Check each row for a prediction when describing it as live. Use the operator's disruption information for agency-wide coverage.
- Before claiming permission to redistribute or use a feed commercially, check the exact feed's terms for the intended use, including attribution and share-alike obligations. Resolve unknown terms from the license URL or the publisher. Endpoint authorization controls access to the data. Reuse permission comes from the applicable license.

## Workflows

**Departures near a place.** For a known station name, start with `transitland_find_stops`. For an address or landmark, resolve coordinates with `openstreetmap_search_places` if available, then look for nearby stops. Choose the station for departures across returned platforms or the specific platform for a known boarding location. Use the route and headsign to identify the rider's direction in the returned departures.

**An operator's downloadable data.** Find the operator, then look up its feeds with `transitland_find_feeds`. Choose the dataset by spec and feed ID before using its URL or license. Operator-scoped results are a single page. If they are capped, narrow the feed search or use an exact feed reference from `transitland_get_operator`. For a dated timetable, check that the reported feed version covers the intended service date. The version's recorded fetch timestamp alone does not establish present-day coverage.
