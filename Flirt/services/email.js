// Flirt Hair & Beauty - Email Notification Service
// Using Nodemailer for transactional emails

const nodemailer = require('nodemailer');

// Email configuration from environment variables
const EMAIL_CONFIG = {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || ''
    }
};

const FROM_EMAIL = process.env.FROM_EMAIL || 'bookings@flirthair.co.za';
const FROM_NAME = process.env.FROM_NAME || 'Flirt Hair & Beauty';
const SALON_PHONE = process.env.SALON_PHONE || '+27 11 123 4567';
const SALON_ADDRESS = process.env.SALON_ADDRESS || 'Shop 12, Mall of the South, Johannesburg';

// Create transporter
let transporter = null;

function getTransporter() {
    if (!transporter) {
        if (!EMAIL_CONFIG.auth.user || !EMAIL_CONFIG.auth.pass) {
            console.warn('Email credentials not configured. Emails will be logged but not sent.');
            return null;
        }

        transporter = nodemailer.createTransport(EMAIL_CONFIG);
    }
    return transporter;
}

// Brand styling for emails
const BRAND_STYLES = `
    <style>
        body { font-family: 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #414042; margin: 0; padding: 0; }
        .email-container { max-width: 600px; margin: 0 auto; background: #ffffff; }
        .header { background: linear-gradient(135deg, #F67599 0%, #e05a7f 100%); padding: 30px; text-align: center; }
        .header img { max-height: 60px; }
        .header h1 { color: white; font-size: 24px; margin: 15px 0 0; letter-spacing: 2px; font-weight: 300; }
        .content { padding: 30px; }
        .greeting { font-size: 18px; color: #414042; margin-bottom: 20px; }
        .details-box { background: #f8f8f8; border-radius: 8px; padding: 20px; margin: 20px 0; }
        .detail-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
        .detail-row:last-child { border-bottom: none; }
        .detail-label { color: #6d6e70; font-size: 14px; }
        .detail-value { color: #414042; font-weight: 600; }
        .total-row { font-size: 18px; color: #F67599; font-weight: bold; }
        .cta-button { display: inline-block; background: linear-gradient(135deg, #F67599 0%, #e05a7f 100%); color: white; text-decoration: none; padding: 14px 32px; border-radius: 4px; font-weight: 600; letter-spacing: 1px; margin: 20px 0; }
        .footer { background: #414042; color: white; padding: 30px; text-align: center; }
        .footer a { color: #F67599; text-decoration: none; }
        .social-links { margin: 15px 0; }
        .social-links a { margin: 0 10px; color: white; text-decoration: none; }
        .divider { height: 3px; background: linear-gradient(to right, #F67599, #e05a7f); margin: 20px 0; }
    </style>
`;

function formatEmailDate(dateValue) {
    const date = new Date(dateValue);
    return new Intl.DateTimeFormat('en-GB', {
        weekday: 'long',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    }).format(date);
}

// Email header with logo
function emailHeader(title = '') {
    return `
        <div class="header">
            <div style="font-size: 32px; font-weight: 300; letter-spacing: 4px; color: white;">
                FL<span style="color: #414042;">!</span>RT
            </div>
            <div style="font-size: 12px; letter-spacing: 2px; color: rgba(255,255,255,0.8); margin-top: 5px;">
                HAIR & BEAUTY BAR
            </div>
            ${title ? `<h1>${title}</h1>` : ''}
        </div>
    `;
}

// Email footer
function emailFooter() {
    return `
        <div class="footer">
            <p style="margin: 0 0 10px;">Questions? Contact us:</p>
            <p style="margin: 0;">
                <a href="tel:${SALON_PHONE}">${SALON_PHONE}</a> |
                <a href="mailto:${FROM_EMAIL}">${FROM_EMAIL}</a>
            </p>
            <div class="social-links">
                <a href="https://instagram.com/flirthairbeauty">Instagram</a>
                <a href="https://facebook.com/flirthairbeauty">Facebook</a>
            </div>
            <p style="font-size: 12px; color: rgba(255,255,255,0.6); margin-top: 20px;">
                ${SALON_ADDRESS}<br>
                &copy; ${new Date().getFullYear()} Flirt Hair & Beauty. All rights reserved.
            </p>
        </div>
    `;
}

// Send email helper
async function sendEmail(to, subject, html) {
    const transport = getTransporter();

    const mailOptions = {
        from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
        to,
        subject,
        html: `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                ${BRAND_STYLES}
            </head>
            <body>
                <div class="email-container">
                    ${html}
                </div>
            </body>
            </html>
        `
    };

    if (!transport) {
        console.log('Email would be sent:');
        console.log('To:', to);
        console.log('Subject:', subject);
        console.log('---');
        return { success: true, simulated: true };
    }

    try {
        const info = await transport.sendMail(mailOptions);
        console.log('Email sent:', info.messageId);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('Email send error:', error);
        return { success: false, error: error.message };
    }
}

// ============================================
// BOOKING EMAILS
// ============================================

// Booking confirmation email
async function sendBookingConfirmation(booking, customer, stylist = null) {
    const subject = booking.status === 'confirmed'
        ? 'Your Booking is Confirmed!'
        : 'Booking Request Received';

    const statusMessage = booking.status === 'confirmed'
        ? `<p style="color: #4CAF50; font-weight: 600;">Your appointment is confirmed!</p>`
        : `<p>We've received your booking request and will contact you within 24 hours to confirm the exact time.</p>`;

    const html = `
        ${emailHeader('Booking ' + (booking.status === 'confirmed' ? 'Confirmed' : 'Received'))}
        <div class="content">
            <p class="greeting">Hi ${customer.name},</p>
            ${statusMessage}

            <div class="details-box">
                <h3 style="margin: 0 0 15px; color: #F67599;">Appointment Details</h3>
                <div class="detail-row">
                    <span class="detail-label">Service</span>
                    <span class="detail-value">${booking.serviceName}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Date</span>
                    <span class="detail-value">${formatEmailDate(booking.date)}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Time</span>
                    <span class="detail-value">${booking.confirmedTime || booking.time || booking.preferredTimeOfDay || 'To be confirmed'}</span>
                </div>
                ${stylist ? `
                <div class="detail-row">
                    <span class="detail-label">Stylist</span>
                    <span class="detail-value">${stylist.name}</span>
                </div>
                ` : ''}
                <div class="detail-row total-row">
                    <span class="detail-label">Price</span>
                    <span class="detail-value">R${booking.servicePrice}</span>
                </div>
            </div>

            ${booking.notes ? `
            <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0;">
                <strong>Your Notes:</strong><br>
                ${booking.notes}
            </div>
            ` : ''}

            <div class="divider"></div>

            <h3 style="color: #414042;">Before Your Appointment</h3>
            <ul style="color: #6d6e70; padding-left: 20px;">
                <li>Please arrive 10 minutes early</li>
                <li>Wear comfortable clothing</li>
                <li>Let us know about any allergies or sensitivities</li>
            </ul>

            <p style="text-align: center;">
                <a href="tel:${SALON_PHONE}" class="cta-button">Call to Reschedule</a>
            </p>

            <p style="font-size: 14px; color: #6d6e70;">
                Need to cancel? Please give us at least 24 hours notice.
            </p>
        </div>
        ${emailFooter()}
    `;

    return sendEmail(customer.email, subject, html);
}

// Booking reminder email (24 hours before)
async function sendBookingReminder(booking, customer, stylist = null) {
    const subject = 'Reminder: Your Appointment Tomorrow';

    const html = `
        ${emailHeader('Appointment Reminder')}
        <div class="content">
            <p class="greeting">Hi ${customer.name},</p>
            <p>Just a friendly reminder about your upcoming appointment tomorrow!</p>

            <div class="details-box">
                <div class="detail-row">
                    <span class="detail-label">Service</span>
                    <span class="detail-value">${booking.serviceName}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Date</span>
                    <span class="detail-value">${formatEmailDate(booking.date)}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Time</span>
                    <span class="detail-value">${booking.confirmedTime || booking.time}</span>
                </div>
                ${stylist ? `
                <div class="detail-row">
                    <span class="detail-label">Stylist</span>
                    <span class="detail-value">${stylist.name}</span>
                </div>
                ` : ''}
            </div>

            <p style="text-align: center; font-size: 18px; color: #F67599;">
                We can't wait to see you!
            </p>

            <p style="text-align: center;">
                <a href="tel:${SALON_PHONE}" class="cta-button">Need to Reschedule?</a>
            </p>
        </div>
        ${emailFooter()}
    `;

    return sendEmail(customer.email, subject, html);
}

// ============================================
// ORDER EMAILS
// ============================================

// Order confirmation email
async function sendOrderConfirmation(order, customer) {
    const subject = `Order Confirmed #${order.id.substring(0, 8).toUpperCase()}`;

    const itemsHtml = order.items.map(item => `
        <div class="detail-row">
            <span class="detail-label">${item.productName} x${item.quantity}</span>
            <span class="detail-value">R${(item.unitPrice * item.quantity).toFixed(2)}</span>
        </div>
    `).join('');

    const deliveryInfo = order.deliveryMethod === 'pickup'
        ? `<p><strong>Pickup Location:</strong><br>${SALON_ADDRESS}</p>`
        : `<p><strong>Delivery Address:</strong><br>${typeof order.deliveryAddress === 'string' ? order.deliveryAddress : order.deliveryAddress?.formatted || 'Address on file'}</p>`;

    const html = `
        ${emailHeader('Order Confirmed')}
        <div class="content">
            <p class="greeting">Hi ${customer.name},</p>
            <p>Thank you for your order! We're getting it ready for you.</p>

            <div class="details-box">
                <h3 style="margin: 0 0 15px; color: #F67599;">Order #${order.id.substring(0, 8).toUpperCase()}</h3>

                ${itemsHtml}

                <div style="border-top: 2px solid #eee; margin-top: 15px; padding-top: 15px;">
                    <div class="detail-row">
                        <span class="detail-label">Subtotal</span>
                        <span class="detail-value">R${order.subtotal.toFixed(2)}</span>
                    </div>
                    ${order.discount > 0 ? `
                    <div class="detail-row" style="color: #4CAF50;">
                        <span class="detail-label">Discount ${order.promoCode ? `(${order.promoCode})` : ''}</span>
                        <span class="detail-value">-R${order.discount.toFixed(2)}</span>
                    </div>
                    ` : ''}
                    <div class="detail-row">
                        <span class="detail-label">Delivery (${order.deliveryMethod})</span>
                        <span class="detail-value">${order.deliveryFee > 0 ? 'R' + order.deliveryFee.toFixed(2) : 'FREE'}</span>
                    </div>
                    <div class="detail-row total-row">
                        <span class="detail-label">Total</span>
                        <span class="detail-value">R${order.total.toFixed(2)}</span>
                    </div>
                </div>
            </div>

            <div class="divider"></div>

            <h3 style="color: #414042;">${order.deliveryMethod === 'pickup' ? 'Pickup' : 'Delivery'} Information</h3>
            ${deliveryInfo}

            ${order.deliveryMethod === 'pickup' ? `
            <p style="background: #e8f5e9; padding: 15px; border-radius: 8px;">
                We'll send you an SMS when your order is ready for pickup.
            </p>
            ` : `
            <p style="background: #e3f2fd; padding: 15px; border-radius: 8px;">
                Estimated delivery: ${order.deliveryMethod === 'express' ? '1-2' : '3-5'} business days
            </p>
            `}
        </div>
        ${emailFooter()}
    `;

    return sendEmail(customer.email, subject, html);
}

// Order shipped email
async function sendOrderShipped(order, customer, trackingNumber = null) {
    const subject = `Your Order is On Its Way! #${order.id.substring(0, 8).toUpperCase()}`;

    const html = `
        ${emailHeader('Order Shipped')}
        <div class="content">
            <p class="greeting">Hi ${customer.name},</p>
            <p>Great news! Your order has been shipped and is on its way to you.</p>

            <div class="details-box">
                <h3 style="margin: 0 0 15px; color: #F67599;">Order #${order.id.substring(0, 8).toUpperCase()}</h3>
                <p><strong>Status:</strong> <span style="color: #4CAF50;">Shipped</span></p>
                ${trackingNumber ? `<p><strong>Tracking Number:</strong> ${trackingNumber}</p>` : ''}
            </div>

            <p style="text-align: center;">
                <a href="#" class="cta-button">Track Your Order</a>
            </p>

            <p style="font-size: 14px; color: #6d6e70;">
                If you have any questions, don't hesitate to contact us.
            </p>
        </div>
        ${emailFooter()}
    `;

    return sendEmail(customer.email, subject, html);
}

// Order ready for pickup email
async function sendOrderReady(order, customer) {
    const subject = `Your Order is Ready for Pickup! #${order.id.substring(0, 8).toUpperCase()}`;

    const html = `
        ${emailHeader('Ready for Pickup')}
        <div class="content">
            <p class="greeting">Hi ${customer.name},</p>
            <p style="font-size: 20px; color: #4CAF50; font-weight: bold;">
                Your order is ready and waiting for you!
            </p>

            <div class="details-box">
                <h3 style="margin: 0 0 15px; color: #F67599;">Order #${order.id.substring(0, 8).toUpperCase()}</h3>
                <p><strong>Pickup Location:</strong></p>
                <p>${SALON_ADDRESS}</p>
                <p><strong>Store Hours:</strong></p>
                <p>Mon-Sat: 9am - 6pm<br>Sun: 10am - 4pm</p>
            </div>

            <p style="text-align: center;">
                <a href="https://maps.google.com/?q=${encodeURIComponent(SALON_ADDRESS)}" class="cta-button">Get Directions</a>
            </p>

            <p style="font-size: 14px; color: #6d6e70;">
                Please bring your order confirmation or ID for pickup.
            </p>
        </div>
        ${emailFooter()}
    `;

    return sendEmail(customer.email, subject, html);
}

// ============================================
// WELCOME & LOYALTY EMAILS
// ============================================

// Welcome email for new users
async function sendWelcomeEmail(customer) {
    const subject = 'Welcome to Flirt Hair & Beauty!';

    const html = `
        ${emailHeader('Welcome!')}
        <div class="content">
            <p class="greeting">Hi ${customer.name},</p>
            <p>Welcome to the Flirt family! We're so excited to have you.</p>

            <div class="details-box" style="text-align: center;">
                <h3 style="color: #F67599; margin-bottom: 10px;">Your Referral Code</h3>
                <div style="background: #F67599; color: white; font-size: 24px; letter-spacing: 3px; padding: 15px; border-radius: 8px; display: inline-block;">
                    ${customer.referralCode}
                </div>
                <p style="margin-top: 15px; color: #6d6e70;">
                    Share this code with friends - you both earn 100 points!
                </p>
            </div>

            <h3 style="color: #414042;">Getting Started</h3>
            <ul style="color: #6d6e70; padding-left: 20px;">
                <li>Book your first appointment and earn 50 points</li>
                <li>Shop our exclusive hair care products</li>
                <li>Refer friends to earn bonus points</li>
                <li>Reach Gold tier for 15% off all services</li>
            </ul>

            <p style="text-align: center;">
                <a href="#" class="cta-button">Book Your First Appointment</a>
            </p>
        </div>
        ${emailFooter()}
    `;

    return sendEmail(customer.email, subject, html);
}

// Loyalty tier upgrade email
async function sendTierUpgrade(customer, newTier) {
    const tierBenefits = {
        silver: ['5% off all services', 'Birthday surprise', 'Early access to sales'],
        gold: ['15% off all services', 'Free birthday blowout', 'Priority booking', 'Exclusive events'],
        platinum: ['20% off all services', 'Free monthly treatment', 'VIP parking', 'Personal stylist']
    };

    const benefits = tierBenefits[newTier] || [];
    const subject = `Congratulations! You've Reached ${newTier.charAt(0).toUpperCase() + newTier.slice(1)} Status`;

    const html = `
        ${emailHeader(`${newTier.toUpperCase()} STATUS`)}
        <div class="content" style="text-align: center;">
            <p class="greeting">Congratulations ${customer.name}!</p>
            <p style="font-size: 20px;">You've unlocked <strong style="color: #F67599;">${newTier.toUpperCase()}</strong> tier status!</p>

            <div class="details-box">
                <h3 style="color: #F67599; margin-bottom: 15px;">Your New Benefits</h3>
                <ul style="text-align: left; color: #414042; padding-left: 20px;">
                    ${benefits.map(b => `<li style="padding: 5px 0;">${b}</li>`).join('')}
                </ul>
            </div>

            <p style="text-align: center;">
                <a href="#" class="cta-button">View All Benefits</a>
            </p>
        </div>
        ${emailFooter()}
    `;

    return sendEmail(customer.email, subject, html);
}

module.exports = {
    sendEmail,
    sendBookingConfirmation,
    sendBookingReminder,
    sendOrderConfirmation,
    sendOrderShipped,
    sendOrderReady,
    sendWelcomeEmail,
    sendTierUpgrade
};
