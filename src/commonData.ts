import * as fs from 'fs-extra';

export enum Paths {
    SYSLOG = 'logs/systemlog.txt',
    PACKAGE_JSON = 'package.json',
}

export function getVersion(): string[] {
    if (fs.existsSync(Paths.PACKAGE_JSON)) {
        let rawPckg = fs.readFileSync(Paths.PACKAGE_JSON);
        let pckg = JSON.parse(rawPckg.toString());
        return pckg['version'].split('.');
    }
    throw 'No version file found!';
}

export type Enviroment = {
    httpPort: number;
    httpPortPublic: number;
    persistentDataPath: string;
    installPath: string;
};
