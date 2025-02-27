const net = require("net");
const { delay } = require('./utils');

_PromiseSocket = null;
async function getPromiseSocket() {
  if (_PromiseSocket === null) {
    const { PromiseSocket } = await import('promise-socket');
    _PromiseSocket = PromiseSocket;
  }
  return _PromiseSocket;
};

class SocketException extends Error {
  constructor(exc, attempt) {
    const msg = attempt + ": " + exc.toString();
    super(msg);
    this.exc = exc;
    this.attempt = attempt;
  }
}

class TCPClient {
  constructor({ip, port, min_reconnect_time, max_reconnect_time, connect_function, status_function}) {
    this.ip = ip;
    this.port = port;
    this.reconnect_time = 0;
    this.min_reconnect_time = min_reconnect_time;
    this.max_reconnect_time = max_reconnect_time;
    this.connect_function = connect_function;
    this.status_function = status_function;
    this.sock = null;
    this.reconnect_time;
    this.cancelled = false;
    this.buffer = Buffer.alloc(0);
    this.setStatus("Not yet connected");
  }
  
  async destroy() {
    this.cancelled = true;
    this.close();
  }
  
  close() {
    if (this.sock) {
      console.error("Deleting socket");
      this.sock.destroy();
      this.sock = null;
    }
  }

  setStatus(status) {
    this.status = status;
    this.status_function?.(status);
  }
  
  connectionFailure(error, attempt) {
    this.close();
    this.buffer = Buffer.alloc(0);
    if (this.reconnect_time == 0) {
        this.reconnect_time = this.min_reconnect_time;
    } else if (this.reconnect_time < this.max_reconnect_time) {
        this.reconnect_time = this.reconnect_time * 2;
    }
    const exc = new SocketException(error, attempt);
    if (error.stack !== undefined) exc.stack = error.stack;
    this.setStatus(exc.toString());
    throw exc;
  }

  async connect() {
    try {
      if (this.cancelled) return;
      console.log("Reconnecting in " + this.reconnect_time + "ms");
      await delay(this.reconnect_time);
      if (this.cancelled) return;    

      // If any exception is thrown from inside Connect that isn't from
      // a ConnectionFailure(), we might have an old socket here that
      // needs cleanup.
      this.close();

      const PromiseSocket = await getPromiseSocket();
      this.sock = new PromiseSocket(new net.Socket());
      await this.sock.connect(this.port, this.ip);

      this.setStatus("Connected");
      await this.connect_function?.();

      this.setStatus("Logged in");
      this.reconnect_time = this.min_reconnect_time;
    } catch (e) {
      this.connectionFailure(e, "Unsable to connect");
    }
  }

  async ensureConnection() {
    while (!this.cancelled && !this.sock) {
      try {
        await this.connect();
      } catch (e) {
        console.error(e.toString());
        console.error(e.stack);
        if (this.cancelled) throw e;
      }
    }
  }

  async send(data) {    
    if (!this.sock) {
        this.connectionFailure("No socket", "Socket disconnected when trying to send");
    }

    try {
      await this.sock.write(data);
    } catch (e) {
      this.connectionFailure(e, "Send failed");
    }
  }

  async waitAndSendInitial(data) {
    while (!this.cancelled) {
      this.ensureConnection();
      try {
        this.send(data);
        return;
      } catch (e) {
        console.error(e.toString());
        console.error(e.stack);
      }
    }
  }

  async read() {
    if (this.cancelled) {
      this.connectionFailure("Cancelled", "Interrupted by thread termination");
    }
    try {
      this.buffer = Buffer.concat([
        this.buffer,
        await this.sock.read()]);
    } catch (e) {
      this.connectionFailure(e, "Socket error while reading");
    }
    return this.buffer;
  }

  consume(size) {
    if (this.buffer_size < size) {
      throw "Not enough data in buffer";
    }
    this.buffer = this.buffer.subarray(size);
  }
}

module.exports = { TCPClient }
