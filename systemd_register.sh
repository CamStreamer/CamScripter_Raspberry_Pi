#!/bin/bash

SCRIPT_PATH=$(dirname $(realpath $0))
echo "
[Unit]
Description=CamScripter RPi run.
After=network.target

[Service]
WorkingDirectory=$SCRIPT_PATH
ExecStart=node $SCRIPT_PATH/dist/main.js
Restart=always
LimitNOFILE=1000000
User=$( whoami )
KillMode=mixed
KillSignal=SIGTERM
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
" > camscripter.service
echo "CamScripter Raspberry will be registered as systemd service."
sudo cp camscripter.service /etc/systemd/system/camscripter.service
sudo chmod 644 /etc/systemd/system/camscripter.service
sudo systemctl start camscripter
sudo systemctl enable camscripter
rm camscripter.service
echo "CamScripter is running"