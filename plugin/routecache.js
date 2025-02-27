const sqlite3 = require('sqlite3').verbose();
const sqlite = require('sqlite');
const fs = require('fs').promises;
const path = require('path');

class Routecache {
  constructor(migrations_dir, db_name) {
    this.db = null;
    this.migrations_dir = migrations_dir;
    this.db_name = db_name;
    console.log("Routecache created for " + db_name + " with migrations " + migrations_dir);
  }

  async init() {
    try {
      await this.openDB();
      await this.createEmpty();
      await this.migrate();
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

  async doesTableExist(tableName) {
    const query = await this.db.all(
      "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name=?",
      [tableName]);
    return query[0].count > 0;
  }

  async destroy() {
    if (this.db != null) await this.db.close();
    this.db = null;
  }

  async openDB() {
    this.db = await sqlite.open({
      filename: this.db_name,
      driver: sqlite3.Database
    });
  }

  async closeDB() {
    if (this.db != null) await this.db.close();
    this.db = null;
  }

  async createEmpty() {
    if (await this.doesTableExist("migrations")) return;
    const res = await this.db.run(`
        CREATE TABLE IF NOT EXISTS migrations (
            id integer,
            name text,
            applied datetime default current_timestamp
        )
    `);
  }

  async migrate() {
    const rows = await this.db.all(
      "SELECT max(id) as maxid FROM migrations");
    const maxId = rows[0].maxid;

    try {
      const files = (
        await fs.readdir(
          this.migrations_dir, { withFileTypes: true }
        )
      ).filter(
        (file) => file.isFile()
      ).map(
        (file) => file.name);
      files.sort();
      
      for (const filename of files) {
        const migrationId = parseInt(filename, 10);
        if (migrationId > maxId) {
          const migrationPath = path.join(this.migrations_dir, filename);
          await this.runMigration(migrationId, migrationPath);
        }
      }
    } catch (error) {
        throw new Error(`Unable to process migrations directory: ${error.message}`);
    }
  }

  async runMigration(i, name) {
    console.error("Running migration ", i, ": ", name);

    const sql = await fs.readFile(name, 'utf8');    
    await this.db.exec(sql);
    await this.db.run(
      "insert into migrations (id, name) values (?, ?)",
      [i, name]);
  }

  async insert({...props}) {
    const target_count = await this.db.all(`
      select count(*) as count from target where uuid = ?;
    `, [props.target_id]);
    if (target_count[0].count == 0) {
      await this.db.run(`
        insert into target (uuid) values (?);
      `, [props.target_id]);
    }
    const target = await this.db.all(`
      select target_id from target where uuid = ?;
    `, [props.target_id]);
    
    await this.db.run(`
      insert into target_position (
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
      [target[0].target_id,
       props.position?.relative?.distance,
       props.position?.relative?.bearing,
       props.position?.relative?.bearing_unit,
       props.speedOverGround,
       props.courseOverGroundTrue,
       'T', // target_course_unit
       props.position?.relative?.distance_unit,
       props.name,
       'T', //props.target_status,
       props.position?.relative?.position?.latitude,
       props.position?.relative?.position?.longitude,
       props.position?.latitude,
       props.position?.longitude]);
  }

  async connectionStats() {
    const query1 = await this.db.all(`
      select
        count(*) as unsent_datapoints
      from
        target_position
      where       
        not sent;
      `);
    const query2 = await this.db.all(`
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
    return {unsent_datapoints: query1[0].unsent_datapoints,
            unsent_tracks: query2[0].unsent_tracks};
  }
  
  async retrieve() {
    const query = await this.db.all(`
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
      uuid: {"string": query[0].uuid},
      route: [],
      nmea: null,
      start: query[0].timestamp_epoch};

    let isfirst = true;
    let start;

    for (const row of query) {
      res.route.push({
        lat: row.target_latitude,
        lon: row.target_longitude,
        timestamp: row.timestamp_epoch - res.start
      });
    }

    return res;
  }

  async markAsSent(route_message) {
    const end = route_message.route[route_message.route.length - 1].timestamp + route_message.start;

    const uuid = route_message.uuid.string;
    
    const query = await this.db.run(`
      update
        target_position
      set
        sent = 1
      where
        target_id = (select target_id from target where uuid = ?)
        and timestamp <= datetime(? / 1000, 'unixepoch');
    `, [uuid, end]);
    
    console.error(
      "Updated "
        + query.changes
        + " rows for "
        + uuid
        + " @ "
        + end
        + ".");
  }
}

module.exports = { Routecache };
