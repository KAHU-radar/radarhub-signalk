# KAHU Radar Hub
*A crowdsourcing [SignalK](https://signalk.org/) plugin*

Contribute AIS and ARPA targets from your vessel to crowdsourcing for marine safety!

This plugin lets you upload AIS and radar ARPA targets (or any NMEA) to an internet server. Upload can be continuous, over intermittent internet, or scheduled, and tracks can be downsampled to fit your bandwidth.
The communication protocol is based on [Apache Avro](https://avro.apache.org/) and batches track points so that the overhead for each point above timestamp and lat/lon is low, meaning it is designed to be as bandwidth conservative as possible.

This plugin requires you too connect SignalK to the NMEA output of your radar and configure your radar for ARPA and to generate target messages ($RATTM).

Some limitations of the current beta version:
* Only supports #RATTM (not $RATTL) NMEA sentences
* Does not collect AIS data, only radar $RATTM sentences
* The protocol is NOT encrypted
* The protocol is NOT cryptographically signed

## Server

An example server written in Python is provided
[here](https://github.com/KAHU-radar/radarhub-server). This server
implements the full protocol, but just dumps all received tracks to
disk in geojson format. It can be used as a simple shore based VDR,
but mostly serves as an example base for anyone wanting to build a
more elaborate server side setup.
