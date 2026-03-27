const { v4: uuidv4 } = require("uuid");
const { Routecache } = require("./routecache");
const { Connector } = require("./connector");
const path = require("path");
const fs = require("fs");

let packageDir = __dirname;
while (
  packageDir !== path.dirname(packageDir) &&
  !fs.existsSync(path.join(packageDir, "package.json"))
) {
  packageDir = path.dirname(packageDir);
}

const parseOptionalFloat = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const parseRattmSentence = (sentence) => {
  const [payload] = sentence.split("*");
  if (!payload) return null;

  const parts = payload.trim().split(",");
  if (parts[0] !== "$RATTM") return null;
  if (parts.length < 16) return null;

  const target_id = parseInt(parts[1], 10);
  const target_distance = parseOptionalFloat(parts[2]);
  const target_bearing = parseOptionalFloat(parts[3]);
  const target_bearing_unit = parts[4] || "";
  const target_speed = parseOptionalFloat(parts[5]);
  const target_course = parseOptionalFloat(parts[6]);
  const target_course_unit = parts[7] || "";
  const target_distance_unit = parts[10] || "";
  const target_name = parts[11] || "";
  const target_status = parts[12] || "";

  if (
    !Number.isFinite(target_id) ||
    !Number.isFinite(target_distance) ||
    !Number.isFinite(target_bearing)
  ) {
    return null;
  }

  return {
    target_id,
    target_distance,
    target_bearing,
    target_bearing_unit,
    target_speed,
    target_course,
    target_course_unit,
    target_distance_unit,
    target_name,
    target_status,
  };
};

const deg2rad = (degrees) => degrees * (Math.PI / 180);

const polar2Pos = (ownPos, bearing, distance) => {
  return {
    latitude:
      ownPos.latitude + (distance * Math.cos(deg2rad(bearing))) / 60 / 1852,
    longitude:
      ownPos.longitude +
      (distance * Math.sin(deg2rad(bearing))) /
        Math.cos(deg2rad(ownPos.latitude)) /
        60 /
        1852,
  };
};

const buildRattmDelta = ({
  route_id,
  target_distance,
  target_bearing,
  target_bearing_unit,
  target_distance_unit,
  target_name,
  target_speed,
  target_course,
  targetPos,
  ownPos,
}) => {
  const relative = {
    position: ownPos,
    distance: target_distance,
    bearing: target_bearing,
    bearing_unit: target_bearing_unit,
    distance_unit: target_distance_unit,
  };

  return {
    context: "vessels.urn:mrn:signalk:uuid:" + route_id,
    updates: [
      {
        values: [
          { path: "name", value: target_name },
          { path: "navigation.speedOverGround", value: target_speed },
          { path: "navigation.courseOverGroundTrue", value: target_course },
          { path: "navigation.position", value: { ...targetPos, relative } },
        ],
      },
    ],
  };
};

module.exports = (app) => {
  const plugin = {
    id: "radarhub",
    name: "KAHU Radar Hub",
    start: async (settings, restartPlugin) => {
      console.log("Started KAHU radar Hub");

      plugin.pending_rattm = [];
      plugin.last_no_ownpos_warning_at = 0;

      plugin.cache = new Routecache(
        path.join(packageDir, "data", "protocol", "migrations"),
        path.join(app.getDataDirPath(), "routecache.sqlite3"),
      );
      await plugin.cache.init();

      plugin.connector = new Connector({
        routecache: plugin.cache,
        plugin_dir: packageDir,
        config: settings,
        status_function: app.setPluginStatus.bind(app),
      });

      const now = new Date(1970, 1, 1);
      plugin.route_updates = Array.from(Array(100)).map(() => now);
      plugin.route_ids = Array.from(Array(100));

      app.emitPropertyValue("nmea0183sentenceParser", {
        sentence: "TTM",
        parser: ({ id, sentence, parts, tags }, session) => {
          if (sentence.startsWith("$RATTL")) {
          } else if (sentence.startsWith("$RATTM")) {
            const parsed = parseRattmSentence(sentence);
            if (!parsed) {
              console.error(
                "Failed to parse RATTM NMEA sentence: [",
                sentence,
                "]",
              );
              return;
            }

            const {
              target_id,
              target_distance,
              target_bearing,
              target_bearing_unit,
              target_speed,
              target_course,
              target_course_unit,
              target_distance_unit,
              target_name,
              target_status,
            } = parsed;

            if (target_bearing_unit === "R") {
              console.warn(
                "Relative bearings not yet supported, skipping RATTM sentence",
              );
              return;
            }

            const ownPos = app.getSelfPath("navigation.position")?.value;
            if (!ownPos) {
              // Common at startup / in mixed streams: RATTM may arrive before the first GPS fix.
              plugin.pending_rattm.push({ parsed, received_at: Date.now() });
              if (plugin.pending_rattm.length > 500) plugin.pending_rattm.shift();

              const nowMs = Date.now();
              if (nowMs - plugin.last_no_ownpos_warning_at > 5000) {
                plugin.last_no_ownpos_warning_at = nowMs;
                console.warn(
                  "No own-ship position available yet; buffering RATTM sentences until GPS fix is available",
                );
              }
              return;
            }

            // If GPS is available now, flush any buffered RATTM sentences.
            if (plugin.pending_rattm?.length) {
              if (typeof app.handleMessage === "function") {
                const buffered = plugin.pending_rattm.splice(0);
                for (const item of buffered) {
                  const b = item?.parsed;
                  if (!b) continue;
                  if (b.target_bearing_unit === "R") continue;
                  const bTargetPos = polar2Pos(
                    ownPos,
                    b.target_bearing,
                    b.target_distance,
                  );

                  const bNow = new Date();
                  if (bNow - plugin.route_updates[b.target_id] > 60000) {
                    plugin.route_updates[b.target_id] = bNow;
                    plugin.route_ids[b.target_id] = uuidv4();
                  }

                  app.handleMessage(
                    plugin.id,
                    buildRattmDelta({
                      route_id: plugin.route_ids[b.target_id],
                      target_distance: b.target_distance,
                      target_bearing: b.target_bearing,
                      target_bearing_unit: b.target_bearing_unit,
                      target_distance_unit: b.target_distance_unit,
                      target_name: b.target_name,
                      target_speed: b.target_speed,
                      target_course: b.target_course,
                      targetPos: bTargetPos,
                      ownPos,
                    }),
                  );
                }
              } else {
                // Can't publish buffered deltas in this environment; drop to prevent leaks.
                plugin.pending_rattm.length = 0;
              }
            }
            const targetPos = polar2Pos(
              ownPos,
              target_bearing,
              target_distance,
            );

            // target_distance_closes_point_of_approac: parseInt(match[8]),
            // target_time_closes_point_of_approac: parseInt(match[9]),

            const now = new Date();
            if (now - plugin.route_updates[target_id] > 60000) {
              plugin.route_updates[target_id] = now;
              plugin.route_ids[target_id] = uuidv4();
            }

            return buildRattmDelta({
              route_id: plugin.route_ids[target_id],
              target_distance,
              target_bearing,
              target_bearing_unit,
              target_distance_unit,
              target_name,
              target_speed,
              target_course,
              targetPos,
              ownPos,
            });
          }
        },
      });

      app.streambundle
        .getBus("navigation.position")
        .forEach(plugin.updatePosition);
    },
    stop: async () => {
      await plugin.connector?.destroy?.();
      await plugin.cache?.destroy?.();
      console.log("Stopped KAHU radar Hub");
    },
    schema: () => {
      return {
        properties: {
          server: { type: "string", default: "crowdsource.kahu.earth" },
          port: { type: "number", default: 9900 },
          api_key: { type: "string" },
          min_reconnect_time: { type: "number", default: 100.0 },
          max_reconnect_time: { type: "number", default: 600.0 },
        },
      };
    },
    updatePosition: (pos) => {
      if (pos.source.sentence != "TTM") return;

      const rest = app.getPath(pos.context);

      const target_id = pos.context.split("vessels.urn:mrn:signalk:uuid:")[1];

      plugin.cache.insert({
        target_id: target_id,
        position: pos.value,
        speedOverGround: rest?.navigation?.speedOverGround?.value,
        courseOverGroundTrue: rest?.navigation?.courseOverGroundTrue?.value,
        name: rest?.name?.value,
      });
    },
  };

  return plugin;
};
