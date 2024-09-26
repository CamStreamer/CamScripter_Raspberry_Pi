import * as http from 'http';
import * as https from 'https';

import { Digest } from './digest';
import { errToString } from './logger';

export type Target = {
    protocol: string;
    host: string;
    port: number;
    path: string;
    username: string;
    password: string;
};

export class HttpProxy {
    async request(target: Target, req: http.IncomingMessage, res: http.ServerResponse) {
        try {
            let proxyRes = await this.sendProxyRequest(target, req);
            if (
                proxyRes.statusCode === 401 &&
                proxyRes.headers['www-authenticate'] !== undefined &&
                proxyRes.headers['www-authenticate'].indexOf('Digest') !== -1
            ) {
                proxyRes = await this.sendProxyRequest(target, req, proxyRes.headers['www-authenticate']);
            }
            if (proxyRes.statusCode === 401) {
                proxyRes.statusCode = 400; // Avoid authorization window in browser
            }

            res.writeHead(proxyRes.statusCode ?? 500, proxyRes.headers);
            proxyRes.on('data', (chunk) => {
                res.write(chunk);
            });
            proxyRes.on('end', () => {
                res.end();
            });
        } catch (err) {
            const body = errToString(err);
            res.writeHead(500, {
                'Content-Length': Buffer.byteLength(body),
                'Content-Type': 'text/plain',
            }).end(body);
        }
    }

    private async sendProxyRequest(target: Target, req: http.IncomingMessage, digestHeader?: string) {
        return new Promise<http.IncomingMessage>((resolve, reject) => {
            const options: https.RequestOptions = {
                method: req.method,
                protocol: target.protocol === 'http' ? 'http:' : 'https:',
                host: target.host,
                port: target.port,
                path: target.path,
                auth: target.username + ':' + target.password,
                timeout: 10000,
                headers: req.headers ?? {},
                rejectUnauthorized: target.protocol === 'https',
            };
            if (
                digestHeader !== undefined &&
                options.method !== undefined &&
                options.path !== undefined &&
                options.path !== null
            ) {
                delete options.auth;
                options.headers!['authorization'] = Digest.getAuthHeader(
                    target.username,
                    target.password,
                    options.method,
                    options.path,
                    digestHeader
                );
            } else {
                delete options.headers!['authorization'];
            }

            const client = target.protocol === 'http' ? http : https;
            const proxyReq = client.request(options, resolve).on('error', reject);
            proxyReq.end();
        });
    }
}
