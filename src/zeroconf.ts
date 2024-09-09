import * as dgram from 'dgram';

import { errToString, logger } from './logger';

const mdnsQueryHeader = Buffer.from([
    0x00, // ID
    0x00,
    0x00, // Flags
    0x00,
    0x00, // QDCOUNT
    0x01,
    0x00, // ANCOUNT
    0x00,
    0x00, // NSCOUNT
    0x00,
    0x00, // ARCOUNT
    0x00,
]);

const mdnsQueryFooter = Buffer.from([
    0x00, // QTYPE
    0x0c,
    0x00, // QCLASS
    0x01,
]);

export class MdnsResponse {
    name: string = '';
    domainName: string = '';
    addr: string[] = [];

    merge(response: MdnsResponse): boolean {
        let newAddresses = false;
        for (const addr of response.addr) {
            if (!this.addr.includes(addr)) {
                this.addr.push(addr);
                newAddresses = true;
            }
        }
        return newAddresses;
    }
}

export class Zeroconf {
    private finishTimer?: NodeJS.Timeout;

    constructor(private serviceNames: string[]) {}

    async resolve(timeout: number) {
        const queries: Buffer[] = [];
        for (const serviceName of this.serviceNames) {
            const query = Buffer.concat([mdnsQueryHeader, this.writeFqdn(serviceName), mdnsQueryFooter]);
            queries.push(query);
        }

        const sockets: dgram.Socket[] = [];
        const socketIPv4 = await this.createSocketIPv4();
        if (socketIPv4 !== undefined && (await this.sendQueriesIPv4(socketIPv4, queries))) {
            sockets.push(socketIPv4);
        }

        const socketIPv6 = await this.createSocketIPv6();
        if (socketIPv6 !== undefined && (await this.sendQueriesIPv6(socketIPv6, queries))) {
            sockets.push(socketIPv6);
        }

        if (sockets.length > 0) {
            return await this.receive(sockets, timeout);
        }
        return undefined;
    }

    private createSocketIPv4(): Promise<dgram.Socket | undefined> {
        return new Promise((resolve) => {
            const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

            socket.bind(5353, () => {
                socket.setBroadcast(true);
                socket.setMulticastTTL(255);
                socket.addMembership('224.0.0.251');
                resolve(socket);
            });

            socket.on('error', (err) => {
                logger.logError(`Zeroconf(IPv4) - failed to create socket: ${err.message}`);
                socket.close();
                resolve(undefined);
            });
        });
    }

    private createSocketIPv6(): Promise<dgram.Socket | undefined> {
        return new Promise((resolve) => {
            const socket = dgram.createSocket({ type: 'udp6', reuseAddr: true });

            socket.bind(5353, () => {
                socket.setBroadcast(true);
                socket.setMulticastTTL(255);
                socket.addMembership('ff02::fb');
                resolve(socket);
            });

            socket.on('error', (err) => {
                logger.logError(`Zeroconf(IPv6) - failed to create socket: ${err.message}`);
                socket.close();
                resolve(undefined);
            });
        });
    }

    private async sendQueriesIPv4(socket: dgram.Socket, queries: Buffer[]) {
        try {
            const addr = '224.0.0.251';
            const port = 5353;
            await Promise.all(queries.map((query) => this.sendAsync(socket, query, port, addr)));
            return true;
        } catch (err) {
            logger.logDebug(`Zeroconf(IPv4) - failed to send the query: ${errToString(err)}`);
            return false;
        }
    }

    private async sendQueriesIPv6(socket: dgram.Socket, queries: Buffer[]) {
        try {
            const addr = 'ff02::fb';
            const port = 5353;
            await Promise.all(queries.map((query) => this.sendAsync(socket, query, port, addr)));
            return true;
        } catch (err) {
            logger.logDebug(`Zeroconf(IPv6) - failed to send the query: ${errToString(err)}`);
            return false;
        }
    }

    private sendAsync(socket: dgram.Socket, msg: Buffer, port: number, address: string): Promise<void> {
        return new Promise((resolve, reject) => {
            socket.send(msg, port, address, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    private receive(sockets: dgram.Socket[], timeout: number): Promise<MdnsResponse[]> {
        return new Promise((resolve) => {
            const responseMap: Map<string, MdnsResponse> = new Map();

            const finishCallback = () => {
                sockets.forEach((socket) => socket.close());
                const result: MdnsResponse[] = [];
                result.push(...Array.from(responseMap.values()));
                resolve(result);
            };

            sockets.forEach((socket) => {
                socket.on('message', (msg, rinfo) => {
                    const response = this.parse(msg);
                    if (
                        response !== undefined &&
                        response.name.length > 0 &&
                        response.domainName.length > 0 &&
                        response.addr.length > 0
                    ) {
                        const existingResponse = responseMap.get(response.domainName);
                        if (existingResponse) {
                            if (existingResponse.merge(response)) {
                                clearTimeout(this.finishTimer);
                                this.finishTimer = setTimeout(finishCallback, timeout);
                            }
                        } else {
                            responseMap.set(response.domainName, response);
                            clearTimeout(this.finishTimer);
                            this.finishTimer = setTimeout(finishCallback, timeout);
                        }
                    }
                });
            });
            this.finishTimer = setTimeout(finishCallback, timeout);
        });
    }

    private parse(data: Buffer): MdnsResponse | undefined {
        if (data.length === 0) {
            return undefined;
        }

        const result = new MdnsResponse();
        try {
            let offset = 0;
            offset += 2; // ID
            const flags = data.readUInt16BE(offset);
            offset += 2;
            if (flags !== 0x8400) {
                // logger.logDebug('Zeroconf - mdns parse - found unexpected Flags value while parsing response');
                return undefined;
            }

            offset += 2; // QDCOUNT

            const answerRRs = data.readUInt16BE(offset);
            offset += 2;
            const authorityRRs = data.readUInt16BE(offset);
            offset += 2;
            const additionalRRs = data.readUInt16BE(offset);
            offset += 2;

            for (let i = 0; i < answerRRs + authorityRRs + additionalRRs; i++) {
                offset = this.parseRecord(data, offset, result);
            }
        } catch (err) {
            logger.logDebug(`Zeroconf - stream error while parsing response: ${errToString(err)}`);
        }

        return result;
    }

    private parseRecord(data: Buffer, offset: number, result: MdnsResponse): number {
        const { name, offset: newOffset } = this.readFqdn(data, offset);
        offset = newOffset;

        const type = data.readUInt16BE(offset);
        offset += 2;

        offset += 2; // Class
        offset += 4; // TTL
        const dataLength = data.readUInt16BE(offset);
        offset += 2;

        switch (type) {
            case 1: {
                // IPv4
                const addrData4 = data.subarray(offset, offset + 4);
                const addr4 = addrData4.join('.');
                result.addr.push(addr4.trim());
                offset += 4;
                break;
            }
            case 28: {
                // IPv6
                const addrData6 = data.subarray(offset, offset + 16);
                const addr6 = addrData6
                    .toString('hex')
                    .match(/.{1,4}/g)
                    ?.join(':');
                if (addr6 !== undefined) {
                    result.addr.push(addr6.trim());
                }
                offset += 16;
                break;
            }
            case 12: {
                // PTR
                const { name: domainName } = this.readFqdn(data, offset);
                offset += dataLength;

                // Filter only requested responses
                if (this.serviceNames.some((serviceName) => name.startsWith(serviceName))) {
                    result.name = name;
                    result.domainName = domainName;
                }
                break;
            }
            default: {
                offset += dataLength;
            }
        }

        return offset;
    }

    readFqdn(buffer: Buffer, offset: number): { name: string; offset: number } {
        let name = '';
        while (offset < buffer.length) {
            const u8 = buffer[offset++];
            if (u8 >> 6 === 3) {
                // Pointer - first two bits are 1
                if (name.length > 0) {
                    name += '.';
                }

                const u8_2 = buffer[offset++];
                const pointerOffset = ((u8 & 0x3f) << 8) | u8_2;

                const { name: pointedName } = this.readFqdn(buffer, pointerOffset);
                name += pointedName;
                break;
            } else if (u8 === 0) {
                // End
                break;
            } else {
                // Name
                if (name.length > 0) {
                    name += '.';
                }

                name += buffer.toString('utf8', offset, offset + u8);
                offset += u8;
            }
        }

        return { name, offset };
    }

    private writeFqdn(name: string): Buffer {
        const result: number[] = [];
        let len = 0;
        let pos = result.length;
        result.push(0);

        for (let i = 0; i < name.length; i++) {
            if (name[i] !== '.') {
                result.push(name.charCodeAt(i));
                len++;

                if (len > 255) {
                    result.length = 0;
                    break;
                }
            }

            if (name[i] === '.' || i === name.length - 1) {
                if (len === 0) {
                    continue;
                }

                result[pos] = len;
                len = 0;
                pos = result.length;
                result.push(0);
            }
        }

        return Buffer.from(result);
    }
}
