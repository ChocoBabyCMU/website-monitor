This only runs when the laptop is on 

cd "/Users/kasperhong/Library/Mobile Documents/com~apple~CloudDocs/Desktop/"                 

# See if the process is running
pm2 list

# Check the logs
pm2 logs website-monitor


# If the monitor is already in PM2's list but stopped
pm2 restart website-monitor

# If the monitor is not in PM2's list
pm2 start website-monitor.js --name "website-monitor"

# To make it start automatically on system boot
pm2 save
pm2 startup

# Show monitor status
pm2 status
