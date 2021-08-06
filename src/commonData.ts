import * as fs from 'fs-extra';

export enum Paths {
    SYSLOG = './systemlog.txt',
    PACKAGE = './package.json',
}

export function getVersion(): string[] {
    if (fs.existsSync(Paths.PACKAGE)) {
        let raw_pckg = fs.readFileSync(Paths.PACKAGE);
        let pckg = JSON.parse(raw_pckg.toString());
        return pckg['version'].split('.');
    }
    throw 'No version file found!';
}

export type Enviroment = {
    http_socket: number;
    http_socket_public: number;
    persistent_data_path: string;
    install_path: string;
};
