# Camscripter Raspberry

## Turning on
To turn Camscripter on temporarily, please type following command into your shell from root directory: `node dist/main.js`
To turn Camscripter on permanently, please run a prepared script: `systemd_register.sh`.
Server can be found on adress 0.0.0.0, port 52520.
To access GUI please type http://localhost:52520/settings.html into your browser.

## Turning off
Temporary run can be terminated simply by stadard means of ending a running process on your device.
Permanent run uses `systemd` to keep itself alive as a system service. To turn it off type: `systemctl stop camscripter.service`. This command will stop the process of CSc-Rbi but will not affect its status as registered service.
To start the porcess again type `systemctl start camscripter.service`.

