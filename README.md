# Camscripter Raspberry

## Installation

To install CamScripter on your device run the following command:
```
npm install -g camscripter-rabsberry
```

You can also install CamScripter localy for better accessibility to the files with command
```
npm install camscripter-rabsberry
```
CamScripter will be automaticaly registered as systemd service, which will start with your computer.
If you want to access CamScripter only on temporal basis, you can run `systemd_unregister.sh` from the root directory.

## Turning on
To turn Camscripter on temporarily, please type following command into your shell from root directory: `node dist/main.js`
To turn Camscripter on permanently, please run a prepared script: `systemd_register.sh`.
Server can be found on adress 0.0.0.0, port 52520. This means the port 52520 will become accessible from outisde your device as long as CamScripter runs.
To access GUI please type http://localhost:52520/settings.html into your browser.
To access CamScripter on remote devices simply replace `localhost` with an appropriate IP address.

## Turning off
Temporary run can be terminated simply by stadard means of ending a running process on your device.
Permanent run uses `systemd` to keep itself alive as a system service. To turn it off type: `systemctl stop camscripter.service`. This command will stop the process of CSc-Rbi but will not affect its status as registered service.
To start the porcess again type `systemctl start camscripter.service`.

## Removal
To remove CamScripter from your device please type :
```
npm uninstall -g camscripter-rabsberry
```
 or
 ```
npm uninstall camscripter-rabsberry
```
depending on the manner in which was your vesion installed. This will automatically unregister CamScripter service from systemd.
If you removed CamScripter in less formal fashion it might be nessessary to manualy remove Camscripter systemd service file and diable the service.