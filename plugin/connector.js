const fs = require('fs').promises;
const { delay } = require('./utils');
const { AvroClient } = require('./avroclient');
const path = require('path');

// Connector acts as a cooperative thread: When created, it starts an
// async timeout function immediately

process.on("unhandledRejection", (reason, promise) => {
    console.error("Unhandled Rejection at:", promise);
    console.error("Reason:", reason.stack);
});

class Connector {
  constructor({status_function, routecache, plugin_dir, config}) {
    this.last_stats = null;
    this.last_status = null;
    this.status_function = status_function;
    this.routecache = routecache;
    this.config = config;
    this.client = null;
    this.schema = null;
    this.callid = 0;
    this.last_connection = Date(1970, 1, 1);
    this.last_track_sent = Date(1970, 1, 1);
    this.cancelled = false;
    this.schema_file = path.join(
      plugin_dir,
      "data",
      "proto_avro.json");
    this.schema = null;
    console.error("Connector created");
    setTimeout(this.main.bind(this), 0);
  }

  async destroy() {
    console.error("Connector destroyed");
    this.cancelled = true;
    if (this.client) await this.client.destroy();
    this.client = null;
  }

  async updateStats() {
    this.last_stats = await this.routecache.connectionStats();
    this.updateStatus();
  }
  
  setStatus(status) {
    this.last_status = status;
    this.updateStatus();
  }

  updateStatus() {
    const status = [];
    if (this.last_status !== null) status.push(this.last_status);
    if (this.last_stats !== null) {
      status.push(`${this.last_stats.unsent_tracks} unsent tracks totalling ${this.last_stats.unsent_datapoints} unsent datapoints`);
    }
    this.status_function?.(status.join(", "));
  }
  
  async read(type) {
    console.error("Connector parsing response");

    const container = await this.client.read();
    const message = container.Message;
    const response = message["kahu.Response"].Response;
    if (response.id != this.callid) {
      throw "Received response with wrong callid";
    }
    const content = response.Response;
    
    if (content["kahu.ErrorResponseMessage"] !== undefined) {    
      throw content.Error.exception;
    } else if (   (type !== undefined)
               && (content[type] === undefined)) {
      throw "Received response for wrong method: expected " + type + " but got " + Object.keys(content)[0];
    }
    console.error("Connector response parsed");
    return container;
  }

  async login() {
    while (!this.config.api_key) await delay(500);
    
    console.error("Connector logging in");

    await this.client.send({
      Message: {
        "kahu.Call": {
          Call: {
            id: ++this.callid,
            Call: {
              "kahu.LoginMessage": {
                Login: {
                  apikey: this.config.api_key
                }
              }
            }
          }
        }
      }
    });
    
    console.error("Send done, gonna parse response\n");
    const response = await this.read("kahu.LoginResponseMessage");
    console.error("Response parsed");
    this.last_connection = new Date();
  }

  async sendTracks() {
    console.error("Connector sending tracks");
    const submit = await this.routecache.retrieve();
    if (submit === null) return;
    await this.client.send({
      Message: {
        "kahu.Call": {
          Call: {
            id: ++this.callid,
            Call: {
              "kahu.SubmitMessage": {
                Submit: submit
              }
            }
          }
        }
      }
    });
    
    this.read("kahu.SubmitResponseMessage");
    this.routecache.markAsSent(submit);
    this.last_track_sent = new Date();
    console.log("Tracks sent");
    await this.updateStats();
  }

  async main() {
    try {
      console.error("Connector running client is null: ", (this.client === null));

      this.schema = await fs.readFile(this.schema_file, 'utf8');

      this.client = new AvroClient({
        schema: this.schema,
        ip: this.config.server || "crowdsource.kahu.earth",
        port: this.config.port || 9900,
        min_reconnect_time: this.config.min_reconnect_time || 100.0,
        max_reconnect_time: this.config.max_reconnect_time || 6000.0,
        connect_function: this.login.bind(this),
        status_function: this.setStatus.bind(this)
      });

      while (!this.cancelled) {
        try {
          console.error("Connector connecting...");
          await this.client.ensureConnection();
          if (this.cancelled) break;
          await this.sendTracks();
          if (this.cancelled) break;
          await delay(500);
        } catch (e) {
          console.error(e.toString(), " in Connector");
          console.error(e.stack);
        }
      }
      console.error("Connector exiting");
    } catch (e) {
      console.error(e.toString(), " in Connector, exiting");
      console.error(e.stack);
    }
  }
};

module.exports = { Connector };
