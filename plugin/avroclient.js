const { TCPClient } = require('./tcpclient');
const avro = require('avro-js');

class AvroClient {
  constructor({schema, ...props}) {
    this.schema = schema;
    this.type = avro.parse(schema);
    this.tcpClient = new TCPClient(props);
  }

  async destroy() {
    await this.tcpClient.destroy();
  }
  
  async ensureConnection() {
    return await this.tcpClient.ensureConnection();
  }
    
  async send(data) {
    this.tcpClient.send(this.type.toBuffer(data));
  }

  async read() {
    while (true) {
      const buffer = await this.tcpClient.read();
      try {
        const decoded = this.type.fromBuffer(buffer, undefined, true);
        this.tcpClient.consume(this.type.toBuffer(decoded).length);
        return decoded;
      } catch (err) {
        if (!(err.message == "truncated buffer")) {
          this.tcpClient.connectionFailure(err, 'Failed to parse Avro document');
        }
      }
    }  
  }  
}

module.exports = { AvroClient };
