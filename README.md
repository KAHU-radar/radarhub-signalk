# KAHU Radar Hub

*A crowdsourcing [Signal K](https://signalk.org/) plugin for marine safety*

---

## What Does This Plugin Do?

This plugin takes **radar target data** from your boat and uploads it to a shared server so that other mariners can benefit from the information. Think of it like Waze for boats -- your radar sees nearby vessels and objects, and this plugin shares that data to help build a bigger picture of what's happening on the water.

### The Big Picture

```
Your Boat's Radar
      |
      | detects targets (other boats, obstacles)
      v
  Radar Unit  ──NMEA sentences──>  Signal K Server
                                        |
                                        | this plugin parses the data
                                        v
                                   KAHU Radar Hub Plugin
                                        |
                                        | uploads via TCP/Avro
                                        v
                                   KAHU Cloud Server
                                   (crowdsource.kahu.earth)
```

---

## Key Concepts Explained

### What is NMEA?

**NMEA** (National Marine Electronics Association) is the standard "language" that marine electronics use to talk to each other. When your GPS, radar, depth sounder, or wind instrument sends data, it sends it as **NMEA sentences** -- short text messages with a specific format.

For example, a GPS position might look like: `$GPGGA,123519,4807.038,N,01131.000,E,...`

There are two main versions:
- **NMEA 0183** -- the older serial/text-based standard (what this plugin uses)
- **NMEA 2000** -- the newer CAN-bus based standard

### What is ARPA?

**ARPA** (Automatic Radar Plotting Aid) is a feature built into marine radars. When your radar detects an object (another boat, a buoy, land), ARPA automatically:

1. **Tracks** the object over time
2. **Calculates** its speed and course
3. **Predicts** its future position
4. **Computes CPA** (Closest Point of Approach) -- how close it will get to you and when

ARPA is a critical safety tool for collision avoidance. Without ARPA, a radar just shows blips; with ARPA, those blips become tracked targets with speed, heading, and collision risk information.

### What is $RATTM?

`$RATTM` is the specific NMEA 0183 sentence that a radar sends when reporting an ARPA-tracked target. The "RA" prefix means it comes from a **Radar**, and "TTM" stands for **Tracked Target Message**.

A `$RATTM` sentence contains:
| Field | Meaning |
|-------|---------|
| Target number | Which tracked target (00-99) |
| Distance | How far away the target is |
| Bearing | What direction the target is in (degrees) |
| Speed | How fast the target is moving |
| Course | What direction the target is heading |
| CPA distance | Closest the target will come to you |
| CPA time | When it will be closest |
| Target name | Optional identifier |
| Target status | Tracking status (e.g. lost, tracking) |

### What is Signal K?

[Signal K](https://signalk.org/) is a modern, open-source data format and server for boats. It acts as a central hub that collects data from all your marine instruments (GPS, radar, AIS, wind, depth, etc.) and makes it available in a standard JSON format over your boat's network. Apps and plugins can then read and process this data.

### What is Apache Avro?

[Apache Avro](https://avro.apache.org/) is a compact binary data format. This plugin uses it instead of JSON or plain text to send data to the server because it is much smaller -- important when you're on a boat with limited or expensive satellite/cellular internet.

### What is AIS?

**AIS** (Automatic Identification System) is a tracking system used on ships. Vessels equipped with AIS transponders automatically broadcast their identity, position, course, and speed. Unlike radar (which detects objects passively), AIS requires the other vessel to be actively transmitting. This plugin currently does **not** collect AIS data -- only radar ARPA targets.

---

## How It Works (Step by Step)

1. **Your radar** detects nearby objects and tracks them using ARPA
2. **The radar sends** `$RATTM` NMEA sentences to Signal K (via a serial/network connection you configure)
3. **This plugin** registers a custom NMEA parser inside Signal K that intercepts those sentences
4. **The parser** extracts the target's bearing and distance (relative to your boat), then converts that to an absolute latitude/longitude using your boat's GPS position
5. **Each target** is published into Signal K as a virtual vessel with its own position, speed, and course
6. **Target positions** are cached locally in a SQLite database (so data is not lost if you lose internet)
7. **A background connector** batches up cached track points and sends them to the KAHU server using the Avro protocol over TCP
8. **If the connection drops**, data keeps accumulating locally and is sent when connectivity returns

---

## Installation

```bash
# From your Signal K server's plugin directory
npm install radarhub-signalk

# Or clone and link for development
git clone --recurse-submodules https://github.com/KAHU-radar/radarhub-signalk.git
cd radarhub-signalk
npm install
npm link
# Then from your Signal K server directory:
signalk-server --install radarhub-signalk
```

**Note:** The `data/protocol` folder is a git submodule. If you cloned without `--recurse-submodules`, run:
```bash
git submodule update --init
```

---

## Configuration

Enable the plugin in the Signal K admin UI under **Server > Plugin Config > KAHU Radar Hub**.

| Setting | Default | Description |
|---------|---------|-------------|
| `server` | `crowdsource.kahu.earth` | KAHU server hostname |
| `port` | `9900` | TCP port for the KAHU server |
| `api_key` | *(none)* | Your API key for authentication |
| `min_reconnect_time` | `100` | Minimum delay (ms) before reconnecting after a drop |
| `max_reconnect_time` | `600` | Maximum delay (ms) between reconnection attempts |

### Prerequisites

- Your radar must be configured for **ARPA tracking** and set to output **$RATTM sentences**
- Signal K must have a **data connection** to your radar's NMEA output (serial port, TCP, or UDP)
- Your boat must have a **GPS** providing position data to Signal K

---

## Current Limitations

- Only supports `$RATTM` sentences (not `$RATTL` -- target list sentences)
- Does not collect AIS data, only radar ARPA targets
- The protocol is **NOT encrypted** (data is sent in plain text)
- The protocol is **NOT cryptographically signed** (no tamper protection)
- Relative bearings (`R`) are not supported -- only true bearings (`T`)
- The `uuid` npm package is used but not listed in `package.json` (relies on Signal K providing it)

---

## Project Structure

```
radarhub-signalk/
├── package.json              # Plugin metadata and dependencies
├── README.md                 # This file
├── plugin/
│   ├── index.js              # Main entry: NMEA parser, Signal K integration
│   ├── connector.js          # Background TCP connection and track submission
│   ├── tcpclient.js          # TCP socket client with auto-reconnect
│   ├── avroclient.js         # Avro serialization/deserialization over TCP
│   ├── routecache.js         # SQLite local cache for track points
│   └── utils.js              # Utility helpers
└── data/protocol/            # Git submodule (radarhub-protocol)
    ├── proto_avro.json       # Avro schema defining the wire protocol
    └── migrations/           # SQLite database migrations
        ├── 0001-create-targets.sql
        └── 0002-target-indices.sql
```

---

## Server

An example server written in Python is provided
[here](https://github.com/KAHU-radar/radarhub-server). This server
implements the full protocol, but just dumps all received tracks to
disk in GeoJSON format. It can be used as a simple shore-based VDR
(Voyage Data Recorder), but mostly serves as an example base for anyone
wanting to build a more elaborate server-side setup.

---

## Runtime Requirements

- **Signal K Server:** v2.22.1+ (latest stable)
- **Node.js:** 20.x or later (required by Signal K server v2.22+)
- **Dependencies:** avro-js, promise-socket, sqlite/sqlite3, uuid

---

## License

ISC
