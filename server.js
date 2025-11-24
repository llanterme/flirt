const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const EMAILS_FILE = path.join(__dirname, 'emails.json');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Initialize emails file if it doesn't exist
if (!fs.existsSync(EMAILS_FILE)) {
    fs.writeFileSync(EMAILS_FILE, JSON.stringify({ subscribers: [] }, null, 2));
}

// Email validation function
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Load existing emails
function loadEmails() {
    try {
        const data = fs.readFileSync(EMAILS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error loading emails:', error);
        return { subscribers: [] };
    }
}

// Save emails
function saveEmails(data) {
    try {
        fs.writeFileSync(EMAILS_FILE, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('Error saving emails:', error);
        return false;
    }
}

// API endpoint to subscribe
app.post('/api/subscribe', (req, res) => {
    const { email, source } = req.body;

    // Validate email
    if (!email) {
        return res.status(400).json({
            success: false,
            message: 'Email is required'
        });
    }

    if (!isValidEmail(email)) {
        return res.status(400).json({
            success: false,
            message: 'Please enter a valid email address'
        });
    }

    // Normalize email (lowercase and trim)
    const normalizedEmail = email.toLowerCase().trim();

    // Load existing emails
    const emailData = loadEmails();

    // Check for duplicates
    const existingSubscriber = emailData.subscribers.find(
        sub => sub.email === normalizedEmail
    );

    if (existingSubscriber) {
        return res.status(409).json({
            success: false,
            message: 'This email is already on our waitlist!'
        });
    }

    // Add new subscriber
    const newSubscriber = {
        email: normalizedEmail,
        source: source || 'website',
        subscribedAt: new Date().toISOString(),
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent') || 'Unknown'
    };

    emailData.subscribers.push(newSubscriber);

    // Save to file
    if (saveEmails(emailData)) {
        console.log(`New subscriber: ${normalizedEmail} from ${source || 'website'}`);

        return res.status(201).json({
            success: true,
            message: 'Thank you for joining our waitlist! We\'ll notify you when we launch.',
            subscriberCount: emailData.subscribers.length
        });
    } else {
        return res.status(500).json({
            success: false,
            message: 'Server error. Please try again later.'
        });
    }
});

// API endpoint to get subscriber count (for admin)
app.get('/api/stats', (req, res) => {
    const emailData = loadEmails();

    res.json({
        totalSubscribers: emailData.subscribers.length,
        lastSubscribed: emailData.subscribers.length > 0
            ? emailData.subscribers[emailData.subscribers.length - 1].subscribedAt
            : null
    });
});

// API endpoint to export emails (for admin - should be protected in production)
app.get('/api/export', (req, res) => {
    const emailData = loadEmails();

    // Return as CSV
    let csv = 'Email,Source,Subscribed At\n';
    emailData.subscribers.forEach(sub => {
        csv += `${sub.email},${sub.source},${sub.subscribedAt}\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=subscribers.csv');
    res.send(csv);
});

// Serve the main landing pages
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'Thebutterfly effect.html'));
});

app.get('/variant-a', (req, res) => {
    res.sendFile(path.join(__dirname, 'Thebutterfly effect.html'));
});

app.get('/variant-b', (req, res) => {
    res.sendFile(path.join(__dirname, 'The butterflyeffectv2.html'));
});

app.get('/science', (req, res) => {
    res.sendFile(path.join(__dirname, 'The butterflyeffectv2.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`
    ========================================
    The Butterfly Effect Lab - Email Server
    ========================================

    Server running on: http://localhost:${PORT}

    Available routes:
    - Main site (Variant A): http://localhost:${PORT}/
    - Science page (Variant B): http://localhost:${PORT}/science

    API Endpoints:
    - POST /api/subscribe - Add new email
    - GET /api/stats - View subscriber count
    - GET /api/export - Download subscribers CSV

    Emails stored in: ${EMAILS_FILE}
    ========================================
    `);
});
