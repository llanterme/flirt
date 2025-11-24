#!/bin/bash
# Flirt Hair & Beauty - SSL Setup Script
# Run this on your Ubuntu/Debian server to set up nginx with Let's Encrypt SSL

set -e

DOMAIN="flirthair.co.za"
EMAIL="admin@flirthair.co.za"
APP_DIR="/var/www/flirt"

echo "========================================="
echo "Flirt Hair & Beauty - SSL Setup"
echo "========================================="

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "Please run as root (sudo)"
    exit 1
fi

# Update system
echo "Updating system packages..."
apt-get update
apt-get upgrade -y

# Install nginx if not present
if ! command -v nginx &> /dev/null; then
    echo "Installing nginx..."
    apt-get install -y nginx
fi

# Install certbot for Let's Encrypt
echo "Installing certbot..."
apt-get install -y certbot python3-certbot-nginx

# Create web root directory
echo "Creating web directory..."
mkdir -p $APP_DIR
mkdir -p /var/www/certbot

# Copy nginx configuration
echo "Copying nginx configuration..."
cp nginx.conf /etc/nginx/nginx.conf

# Test nginx configuration
echo "Testing nginx configuration..."
nginx -t

# Create initial HTTP-only config for certificate issuance
cat > /etc/nginx/sites-available/flirt-temp << EOF
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 200 'Setting up SSL...';
        add_header Content-Type text/plain;
    }
}
EOF

# Enable temporary site
ln -sf /etc/nginx/sites-available/flirt-temp /etc/nginx/sites-enabled/flirt-temp
rm -f /etc/nginx/sites-enabled/default

# Restart nginx with temporary config
systemctl restart nginx

# Obtain SSL certificate
echo "Obtaining SSL certificate from Let's Encrypt..."
certbot certonly --webroot -w /var/www/certbot \
    -d $DOMAIN -d www.$DOMAIN \
    --email $EMAIL \
    --agree-tos \
    --no-eff-email \
    --non-interactive

# Remove temporary config
rm -f /etc/nginx/sites-enabled/flirt-temp
rm -f /etc/nginx/sites-available/flirt-temp

# Apply full nginx configuration
echo "Applying full nginx configuration..."
nginx -t && systemctl restart nginx

# Set up automatic certificate renewal
echo "Setting up automatic certificate renewal..."
cat > /etc/cron.d/certbot-renew << EOF
0 0,12 * * * root certbot renew --quiet --post-hook "systemctl reload nginx"
EOF

# Set proper permissions
echo "Setting permissions..."
chown -R www-data:www-data $APP_DIR
chmod -R 755 $APP_DIR

# Enable nginx to start on boot
systemctl enable nginx

echo ""
echo "========================================="
echo "SSL Setup Complete!"
echo "========================================="
echo ""
echo "Next steps:"
echo "1. Copy your application files to: $APP_DIR"
echo "2. Ensure your Node.js app is running on port 3001"
echo "3. Set up PM2 to manage your Node.js process"
echo ""
echo "Your site should now be accessible at:"
echo "  https://$DOMAIN"
echo "  https://www.$DOMAIN"
echo ""
echo "SSL certificates will auto-renew via cron."
