const { v4: uuidv4 } = require('uuid');
const { Routecache } = require("./routecache");
const { Connector } = require("./connector");
const path = require('path');
const fs = require('fs');

let packageDir = __dirname;
while (packageDir !== path.dirname(packageDir)
       && !fs.existsSync(path.join(packageDir, 'package.json'))) {
  packageDir = path.dirname(packageDir);
}

const nmeaRattmRegex = /\$RATTM,(\d{2}),([\d\.\-]+),([\d\.\-]+),([^,]*),([\d\.\-]+),([\d\.\-]+),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),(..*)\*([A-Fa-f0-9]{2})\s*/;

const deg2rad = (degrees) => degrees * (Math.PI / 180);

const polar2Pos = (ownPos, bearing, distance) => {
  return {
    latitude: ownPos.latitude + distance * Math.cos(deg2rad(bearing)) / 60. / 1852.,
    longitude: ownPos.longitude + distance * Math.sin(deg2rad(bearing)) / Math.cos(deg2rad(ownPos.latitude)) / 60. / 1852.};
}

module.exports = (app) => {

  const plugin = {
    id: 'radarhub',
    name: 'KAHU Radar Hub',
    start: async (settings, restartPlugin) => {
      console.log("Started KAHU radar Hub")

      plugin.cache = new Routecache(
        path.join(packageDir, "data", "migrations"),
        path.join(app.getDataDirPath(), "routecache.sqlite3"));
      await plugin.cache.init();
      
      plugin.connector = new Connector({
        routecache: plugin.cache,
        plugin_dir: packageDir,
        config: settings,
        status_function: app.setPluginStatus.bind(app)});
      
      const now = new Date(1970, 1, 1);
      plugin.route_updates = Array.from(Array(100)).map(() => now);
      plugin.route_ids = Array.from(Array(100));
      
      app.emitPropertyValue('nmea0183sentenceParser', {
        sentence: 'TTM',
        parser: ({ id, sentence, parts, tags }, session) => {
          if (sentence.startsWith("$RATTL")) {
          } else if (sentence.startsWith("$RATTM")) {
            const match = nmeaRattmRegex.exec(sentence);

            if (!match) {
              console.error("Failed to parse RATTM NMEA sentence: [", sentence, "]");
              return;
            }
            if (match.length - 1 != 14) {
              console.log("Only parsed ", (match.length - 1), " fields of RATTM NMEA sentence: [", sentence, "]");
              return;
            }
            
            const target_id = parseInt(match[1]);
            const target_distance = parseInt(match[2]);
            const target_bearing = parseInt(match[3]);
            const target_bearing_unit = match[4];

            if (target_bearing_unit == 'R')
              throw "Relative bearings not yet supported";
            
            const ownPos = app.getSelfPath("navigation.position").value;
            const targetPos = polar2Pos(ownPos, target_bearing, target_distance);
            
            const relative = {
              position: ownPos,
              distance: target_distance,
              bearing: target_bearing,
              bearing_unit: target_bearing_unit,
              distance_unit: match[10],
            }

            const target_speed = parseInt(match[5]);
            const target_course = parseInt(match[6]);
            const target_course_unit = match[7];
            // target_distance_closes_point_of_approac: parseInt(match[8]),
            // target_time_closes_point_of_approac: parseInt(match[9]),
            const target_name = match[11];
            const target_status = match[12];
            
            const now = new Date();
            if (now - plugin.route_updates[target_id] > 60000) {
              plugin.route_updates[target_id] = now;
              plugin.route_ids[target_id] = uuidv4();
            }
            
            return {
              context: 'vessels.urn:mrn:signalk:uuid:' + plugin.route_ids[target_id],
              updates: [
                {
                  values: [
                    { path: 'name',
                      value: target_name
                    },
                    { path: 'navigation.speedOverGround',
                      value: target_speed
                    },
                    { path: 'navigation.courseOverGroundTrue',
                      value: target_course
                    },
                    { path: 'navigation.position',
                      value: {...targetPos, relative}
                    },
                  ]
                }
              ]
            };
          }
        }
      });

      app.streambundle
        .getBus('navigation.position')
        .forEach(plugin.updatePosition);
  
    },
    stop: async () => {
      await plugin.connector?.destroy?.();
      await plugin.routecache?.destroy?.();
      console.log("Stopped KAHU radar Hub")
    },
    schema: () => {
      return {
        properties: {
          server: {type: "string", default: "crowdsource.kahu.earth"},
          port: {type: "number", default: 9900},
          api_key: {type: "string"},
          min_reconnect_time: {type: "number", default: 100.0},
          max_reconnect_time: {type: "number", default: 600.0}
        }
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
    }
  };

  return plugin;
};
