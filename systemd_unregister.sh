

sudo systemctl stop camscripter
sudo systemctl disable camscripter
sudo rm /etc/systemd/system/camscripter.service
systemctl daemon-reload
systemctl reset-failed
echo "CamScripter service is removed "