const fs = require('fs').promises;
const path = require('path');

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (e) {
  DatabaseSync = null;
}

function requireNodeSqlite() {
  if (!DatabaseSync) {
    throw new Error(
      'kahu-signalk requires Node.js 22.5+ (built-in node:sqlite). ' +
      'Install Node 22 LTS as recommended for Signal K: ' +
      'https://github.com/SignalK/signalk-server/wiki/Installing-and-Updating-Node.js'
    );
  }
}

class Routecache {
  constructor(migrations_dir, db_name) {
    this.db = null;
    this.migrations_dir = migrations_dir;
    this.db_name = db_name;
    console.log("Routecache created for " + db_name + " with migrations " + migrations_dir);
  }

  _sanitizeParam(v) {
    return v === undefined ? null : v;
  }

  _all(sql, params = []) {
    const stmt = this.db.prepare(sql);
    const safe = params.map(this._sanitizeParam);
    return safe.length ? stmt.all(...safe) : stmt.all();
  }

  _run(sql, params = []) {
    const stmt = this.db.prepare(sql);
    const safe = params.map(this._sanitizeParam);
    return safe.length ? stmt.run(...safe) : stmt.run();
  }

  async init() {
    try {
      requireNodeSqlite();
      await this.openDB();
      await this.createEmpty();
      await this.migrate();
      await this.ensureCompatibleSchemaOrRebuild();
      return;
    } catch (e) {
      console.error(e, ". Deleting route cache.");
      try {
        await fs.unlink(this.db_name);
        this.closeDB();
        throw e;
      } catch (err) {
        console.error("Unable to delete route cache: ", this.db_name);
        throw err;
      }
    }
  }

  async ensureCompatibleSchemaOrRebuild() {
    const hasTargetTable = this.doesTableExist("target");
    const hasTargetPositionTable = this.doesTableExist("target_position");
    if (!hasTargetTable || !hasTargetPositionTable) return;

    const fkRows = this._all("PRAGMA foreign_key_list(target_position)");
    const hasExpectedFk = fkRows.some(
      (row) =>
        row.from === "target_id" &&
        row.table === "target" &&
        row.to === "target_id"
    );

    if (hasExpectedFk) return;

    console.warn(
      "Detected incompatible route cache schema (target_position FK mismatch). Rebuilding route cache database."
    );

    await this.closeDB();
    await fs.unlink(this.db_name);
    await this.openDB();
    await this.createEmpty();
    await this.migrate();

    const rebuiltFkRows = this._all("PRAGMA foreign_key_list(target_position)");
    const rebuiltHasExpectedFk = rebuiltFkRows.some(
      (row) =>
        row.from === "target_id" &&
        row.table === "target" &&
        row.to === "target_id"
    );
    if (!rebuiltHasExpectedFk) {
      throw new Error(
        "Route cache rebuild completed, but target_position foreign key is still incompatible."
      );
    }
  }

  doesTableExist(tableName) {
    const row = this.db
      .prepare("SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name=?")
      .get(tableName);
    return Number(row.count) > 0;
  }

  async destroy() {
    if (this.db != null) this.db.close();
    this.db = null;
  }

  async openDB() {
    this.db = new DatabaseSync(this.db_name);
  }

  async closeDB() {
    if (this.db != null) this.db.close();
    this.db = null;
  }

  async createEmpty() {
    if (await this.doesTableExist("migrations")) return;
    this.db.exec(`
        CREATE TABLE IF NOT EXISTS migrations (
            id integer,
            name text,
            applied datetime default current_timestamp
        )
    `);
  }

  async migrate() {
    const rows = this._all("SELECT max(id) as maxid FROM migrations");
    const maxId = rows[0].maxid;
    const baseline = maxId == null ? 0 : Number(maxId);

    try {
      const files = (
        await fs.readdir(this.migrations_dir, { withFileTypes: true })
      )
        .filter((file) => file.isFile())
        .map((file) => file.name);
      files.sort();

      for (const filename of files) {
        const migrationId = parseInt(filename, 10);
        if (!Number.isFinite(migrationId) || migrationId <= baseline) continue;
        const migrationPath = path.join(this.migrations_dir, filename);
        await this.runMigration(migrationId, migrationPath);
      }
    } catch (error) {
      throw new Error(`Unable to process migrations directory: ${error.message}`);
    }
  }

  async runMigration(i, name) {
    console.error("Running migration ", i, ": ", name);

    const sql = await fs.readFile(name, 'utf8');
    this.db.exec(sql);
    this._run("insert into migrations (id, name) values (?, ?)", [i, name]);
  }

  async insert({ ...props }) {
    const target_count = this._all(
      `select count(*) as count from target where uuid = ?;`,
      [props.target_id]
    );
    if (Number(target_count[0].count) === 0) {
      this._run(`insert into target (uuid) values (?);`, [props.target_id]);
    }
    const target = this._all(`select target_id from target where uuid = ?;`, [
      props.target_id,
    ]);

    this._run(
      `insert into target_position (
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
        latitude,
        longitude,
        target_latitude,
        target_longitude
      ) values (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   `,
      [
        target[0].target_id,
        props.position?.relative?.distance,
        props.position?.relative?.bearing,
        props.position?.relative?.bearing_unit,
        props.speedOverGround,
        props.courseOverGroundTrue,
        'T',
        props.position?.relative?.distance_unit,
        props.name,
        'T',
        props.position?.relative?.position?.latitude,
        props.position?.relative?.position?.longitude,
        props.position?.latitude,
        props.position?.longitude,
      ]
    );
  }

  async connectionStats() {
    const query1 = this._all(`
      select
        count(*) as unsent_datapoints
      from
        target_position
      where
        not sent;
      `);
    const query2 = this._all(`
      select
        count(*) as unsent_tracks
      from
        (select distinct
           target_id
         from
           target_position
         where
           not sent
        )
    `);
    return {
      unsent_datapoints: Number(query1[0].unsent_datapoints),
      unsent_tracks: Number(query2[0].unsent_tracks),
    };
  }

  async retrieve() {
    const query = this._all(`
      select
        target.uuid,
        target_position.timestamp,
        (strftime('%s', timestamp) +  strftime('%f', timestamp) - strftime('%S', timestamp)) * 1000
          as timestamp_epoch,
        target_position.target_latitude,
        target_position.target_longitude
      from
        target_position,
        target
      where
        target_position.target_id = (
          select
            target_id
          from
            target_position
          where
            not sent
            and target_id in (
              select
                target_id
              from
                target_position
              group by
                target_id
              having
                count(*) > 1
            )
          order by
            timestamp ASC
          limit 1)
        and target.target_id = target_position.target_id
        and not target_position.sent
        order by timestamp asc
        limit 100;
      `);

    if (!query.length) return null;

    const res = {
      uuid: { string: query[0].uuid },
      route: [],
      nmea: null,
      start: Number(query[0].timestamp_epoch),
    };

    for (const row of query) {
      res.route.push({
        lat: row.target_latitude,
        lon: row.target_longitude,
        timestamp: Number(row.timestamp_epoch) - res.start,
      });
    }

    return res;
  }

  async markAsSent(route_message) {
    const end =
      route_message.route[route_message.route.length - 1].timestamp +
      route_message.start;

    const uuid = route_message.uuid.string;

    const result = this._run(
      `update
        target_position
      set
        sent = 1
      where
        target_id = (select target_id from target where uuid = ?)
        and timestamp <= datetime(? / 1000, 'unixepoch');`,
      [uuid, end]
    );

    console.error(
      'Updated ' +
        result.changes +
        ' rows for ' +
        uuid +
        ' @ ' +
        end +
        '.'
    );
  }
}

module.exports = { Routecache };
