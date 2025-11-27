# Flirt Hair & Beauty - Local Development Guide

A comprehensive Progressive Web App (PWA) for a South African hair salon specializing in extensions, with integrated booking, e-commerce, and customer management.

## 🚀 Quick Start (Local Development)

### Prerequisites

- **Node.js** v18+ (Required)
- **npm** (comes with Node.js)
- **Git** (for cloning)

### Setup & Run Locally

1. **Navigate to the project directory**
   ```bash
   cd Flirt
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Initialize the database**
   ```bash
   npm run db:init
   ```

4. **Start the development server**
   ```bash
   npm start
   ```

5. **Access the application**
   - **Customer App**: http://localhost:3001/
   - **Admin Console**: http://localhost:3001/admin
   - **API Health**: http://localhost:3001/api/health

## 🔑 Default Admin Login

- **Email**: `admin@flirthair.co.za`
- **Password**: `admin123` (change this in production!)

## 🧪 Testing the Application

### Customer Features to Test

1. **User Registration & Login**
   - Navigate to http://localhost:3001/
   - Create a new account or login with existing credentials
   - Test Google/Facebook OAuth (requires OAuth setup)

2. **Booking System**
   - Browse available stylists and services
   - Create hair or beauty appointments
   - View booking history and status

3. **E-Commerce Shop**
   - Browse product catalog
   - Add items to cart
   - Place orders with delivery options
   - Apply promo codes

4. **Loyalty Program**
   - View points balance and tier status
   - Redeem points for discounts
   - Apply referral codes

5. **Hair Tracker**
   - Set up extension tracking
   - Log wash events and maintenance
   - View care recommendations

### Admin Features to Test

1. **Dashboard Analytics** (http://localhost:3001/admin)
   - View revenue and booking statistics
   - Monitor customer activity

2. **Booking Management**
   - Confirm hair appointments
   - Update booking statuses
   - View customer details

3. **Product & Inventory**
   - Add/edit/remove products
   - Manage stock levels
   - Create promotional codes

4. **Customer Support**
   - Access chat conversations
   - Respond to customer messages
   - Manage support requests

## 🔧 Configuration (Optional)

### Environment Variables (.env file)

Create a `.env` file in the `/Flirt` directory for custom configuration:

```env
PORT=3001
JWT_SECRET=your-secure-jwt-secret
ADMIN_SEED_PASSWORD=your-admin-password

# Email (Optional - for notifications)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# OAuth (Optional - for social login)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
FACEBOOK_CLIENT_ID=your-facebook-app-id
FACEBOOK_CLIENT_SECRET=your-facebook-app-secret
```

### Generate VAPID Keys (for Push Notifications)

```bash
npm run vapid:generate
```

Then add the generated keys to your `.env` file.

## 📊 Database

- **Type**: SQLite (100% migrated from JSON)
- **Location**: `./db/flirt.db`
- **Schema**: Automatically initialized on first run
- **Reset Database**: Delete `flirt.db` file and run `npm run db:init`

## 🛠️ Available Scripts

```bash
npm start          # Start the server
npm run db:init    # Initialize/reset database
npm run vapid:generate  # Generate push notification keys
```

## 🔗 Key API Endpoints for Testing

### Authentication
- `POST /api/auth/signup` - User registration
- `POST /api/auth/login` - User login
- `GET /api/auth/me` - Get current user

### Bookings
- `GET /api/stylists` - List stylists
- `GET /api/services/hair` - Hair services
- `POST /api/bookings` - Create booking
- `GET /api/bookings` - User's bookings

### E-Commerce
- `GET /api/products` - Product catalog
- `POST /api/orders` - Create order
- `POST /api/promo/validate` - Validate promo code

### Admin
- `GET /api/admin/stats` - Dashboard statistics
- `GET /api/admin/bookings` - All bookings
- `GET /api/admin/customers` - Customer list

## 🐛 Common Issues & Solutions

### Database Issues
```bash
# Reset database if corrupted
rm db/flirt.db
npm run db:init
```

### Port Already in Use
```bash
# Change port in server.js or kill the process
lsof -ti:3001 | xargs kill -9
```

### Missing Dependencies
```bash
# Clean install
rm -rf node_modules package-lock.json
npm install
```

## 🏗️ Architecture Overview

- **Backend**: Node.js + Express.js
- **Database**: SQLite with repository pattern
- **Authentication**: JWT tokens + bcrypt
- **Storage**:
  - Core business data → SQLite repositories
  - Transient features (chat, gallery, tips) → In-memory storage
- **Frontend**: Vanilla HTML/CSS/JS (PWA)
- **Deployment**: Railway.app with Nixpacks

## 📱 PWA Features

- Offline support with service worker
- Installable app experience
- Push notifications (with VAPID setup)
- Responsive mobile-first design

## 🎯 Feature Highlights

- **Booking System**: Stylist-based appointments with availability
- **E-Commerce**: Full shop with cart, orders, and inventory
- **Loyalty Program**: Points, tiers, and referral system
- **Hair Tracker**: Extension care and maintenance tracking
- **Admin Console**: Complete business management dashboard
- **Real-time Chat**: Customer support messaging system

---

**Need Help?** Check the comprehensive documentation in [CLAUDE.md](CLAUDE.md) or review the API endpoints in [server.js](server.js).


## Railway
- **dump db**: sqlite3 /app/data/production.db .schema