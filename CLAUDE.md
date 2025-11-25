# Flirt Hair & Beauty - Project Overview

This repository contains **two distinct projects** in different stages of development:

1. **The Butterfly Effect Lab** - A simple email waitlist landing page (root directory)
2. **Flirt Hair & Beauty** - A comprehensive salon booking and e-commerce PWA (Flirt/ subdirectory)

## 🎯 Main Project: Flirt Hair & Beauty

A comprehensive Progressive Web App (PWA) for a hair salon specializing in hair extensions, built for the South African market.

**✅ Current Status:** Fully migrated to SQLite-only architecture with zero JSON dependencies. All core business logic uses SQLite repositories, while transient features (chat, gallery, hair tips) use in-memory storage.

### Tech Stack

- **Backend:** Node.js, Express.js
- **Database:** SQLite3 (100% converted from JSON storage)
- **Authentication:** JWT tokens with bcrypt password hashing
- **Payments:** PayFast and Yoco (South African payment gateways)
- **PWA Features:** Service Worker, Web Push notifications, App Manifest
- **Email:** Nodemailer for transactional emails
- **Real-time:** Chat system with in-memory storage for transient messages

### Key Features

#### 🗓️ Booking System
- Stylist-centric appointment booking
- Service selection (Weft, Tape, Keratin extensions)
- Calendar integration with availability
- Automated email reminders

#### 🛒 E-Commerce Platform
- Product marketplace for hair extensions and care products
- Shopping cart and wishlist functionality
- Order tracking and payment processing
- Inventory management

#### 👑 Customer Experience
- User authentication with role-based access
- Loyalty points system (Bronze, Silver, Gold, Platinum tiers)
- Referral program with rewards
- Hair journey tracking
- Real-time chat support

#### 📊 Admin Console
- Comprehensive dashboard with analytics
- User and booking management
- Inventory control and reporting
- Promotion management
- Stylist performance tracking

#### 📱 PWA Capabilities
- Offline support with service worker
- Push notifications for bookings/promotions
- Installable app experience
- Responsive mobile-first design

## 🚀 Quick Start Guide

### Prerequisites

- Node.js (v14+ recommended)
- npm or yarn
- SQLite3 (for database)

### Setup Instructions

#### 1. Clone and Navigate
```bash
git clone <repository-url>
cd Flirt
```

#### 2. Install Dependencies
```bash
npm install
```

#### 3. Environment Configuration
```bash
# Copy the example environment file
cp .env.example .env

# Edit .env with your configuration
nano .env
```

Required environment variables:
```env
PORT=3001
JWT_SECRET=your-super-secure-jwt-secret-key
ADMIN_SEED_PASSWORD=your-admin-password
DB_PATH=./db/flirt.db

# Email Configuration (for notifications)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# Payment Gateway (Optional for development)
PAYFAST_MERCHANT_ID=your-merchant-id
PAYFAST_MERCHANT_KEY=your-merchant-key
YOCO_SECRET_KEY=your-yoco-secret-key

# Web Push (Generated below)
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
```

#### 4. Database Setup
```bash
# Initialize SQLite database (migration from JSON is complete)
npm run db:init
```

#### 5. Generate VAPID Keys (for push notifications)
```bash
npm run vapid:generate
```

#### 6. Start the Server
```bash
npm start
# or for development with nodemon
npm run dev
```

#### 7. Access the Application
- **Customer App:** http://localhost:3001/
- **Admin Console:** http://localhost:3001/admin
- **API Base:** http://localhost:3001/api
- **API Health Check:** http://localhost:3001/api/health

### Default Login Credentials

#### Admin Account
- **Email:** admin@flirt.co.za
- **Password:** [Value from ADMIN_SEED_PASSWORD in .env]

## 📁 Project Structure

```
Flirt/
├── server.js                 # Main Express server (3000+ lines)
├── flirt-hair-app.html      # Customer PWA (8000+ lines)
├── flirt-admin-console.html # Admin dashboard (7000+ lines)
├── package.json             # Dependencies and scripts
├── .env.example             # Environment template
├── data/                    # Empty (migrated to SQLite)
│   └── (no longer used - all data in SQLite)
├── db/                      # SQLite database
│   ├── database.js         # Database connection & queries
│   ├── schema.sql          # Database schema
│   ├── migrate-from-json.js # Migration script
│   └── flirt.db           # SQLite database file
├── services/               # Backend services
│   ├── email.js           # Email notifications
│   ├── payments.js        # Payment processing
│   └── push-notifications.js # Web push
├── nginx/                 # Production configs
├── icons/                 # PWA app icons
└── sw.js                 # Service Worker
```

## 🔌 Key API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/register` - User registration
- `POST /api/auth/logout` - User logout

### Booking System
- `GET /api/services` - List all services
- `GET /api/stylists` - List available stylists
- `POST /api/bookings` - Create new booking
- `GET /api/bookings` - Get user bookings
- `PUT /api/bookings/:id` - Update booking

### E-Commerce
- `GET /api/products` - List all products
- `POST /api/cart/add` - Add to cart
- `POST /api/orders` - Create order
- `GET /api/orders` - Get user orders

### Loyalty & Gamification
- `GET /api/loyalty/points` - Get user points
- `POST /api/loyalty/redeem` - Redeem points
- `GET /api/referrals` - Get referral stats

### Chat & Support
- `POST /api/chat/send` - Send chat message
- `GET /api/chat/messages` - Get chat history

## 🛠️ Development Commands

```bash
# Start development server with auto-reload
npm run dev

# Initialize/reset database
npm run db:init

# Run database migrations
npm run db:migrate

# Generate VAPID keys for push notifications
npm run vapid:generate

# Backup database
npm run db:backup

# Start production server
npm start
```

## 🗃️ Database Schema

### Core Tables
- **users** - Customer accounts with loyalty tiers
- **stylists** - Staff profiles with specialties
- **services** - Available treatments with pricing
- **bookings** - Appointments with status tracking
- **products** - E-commerce inventory
- **orders** - Purchase transactions
- **loyalty_points** - Points tracking and history
- **referrals** - Referral program data
- **chat_messages** - Customer support messages

### Key Relationships
- Users have many bookings, orders, and loyalty points
- Bookings belong to users and stylists
- Orders contain multiple products
- Loyalty points are earned through bookings and referrals

## 🌍 Production Deployment

### Nginx Configuration
The project includes nginx configuration for production deployment:

```bash
# Copy nginx config
sudo cp nginx/flirt.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/flirt.conf /etc/nginx/sites-enabled/

# SSL setup (script provided)
./ssl-setup.sh
```

### Environment Considerations
- Set `NODE_ENV=production`
- Configure proper SMTP settings
- Set up payment gateway credentials
- Enable SSL/HTTPS for PWA features
- Configure database backups
- Set up monitoring and logging

## 📱 PWA Features

### Installation
Users can install the app on their devices:
- **Desktop:** Chrome install prompt
- **Mobile:** Add to Home Screen

### Offline Support
- Service worker caches essential resources
- Offline booking viewing
- Cached product catalog
- Queue actions for when online

### Push Notifications
- Booking confirmations and reminders
- Promotional offers
- Loyalty point updates
- Chat message notifications

## 🎨 Customization

### Branding
- Update colors in CSS custom properties
- Replace logo in `/icons/` directory
- Modify app name in `manifest.json`

### Services & Products
- Add new services via admin console
- Configure pricing and duration
- Upload product images
- Set inventory levels

### Payment Methods
Currently supports South African payment gateways:
- **PayFast** - Bank transfers, cards
- **Yoco** - Card payments

## 🐛 Troubleshooting

### Common Issues

1. **Database Connection Errors**
   ```bash
   # Reset database
   rm db/flirt.db
   npm run db:init
   ```

2. **VAPID Keys Missing**
   ```bash
   npm run vapid:generate
   # Copy keys to .env file
   ```

3. **Email Not Sending**
   - Verify SMTP credentials in .env
   - Check Gmail app passwords for Gmail SMTP

4. **Push Notifications Not Working**
   - Ensure HTTPS in production
   - Verify VAPID keys are set
   - Check browser permissions

### Logs and Debugging
- Server logs are output to console
- Check browser console for frontend errors
- Database queries are logged in development mode

## 📞 Support & Contact

For technical support or questions about this implementation:
- Check the issue tracker
- Review API documentation in server.js comments
- Examine the admin console for configuration options

---

**Note:** This is a feature-rich PWA specifically designed for the South African hair and beauty market, with integrated local payment gateways and business practices.