// Flirt Hair & Beauty - Payment Integration Service
// Supports PayFast and Yoco for South African payments

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

// Runtime overrides set from admin console (persisted in DB)
let runtimeConfig = {
    appUrl: null,
    apiBaseUrl: null,
    payfast: {},
    yoco: {}
};

// Compute effective configuration (env vars as baseline, runtime overrides layered on)
function getEffectiveConfig() {
    const envConfig = {
        appUrl: process.env.APP_URL || 'https://flirthair.co.za',
        apiBaseUrl: process.env.API_BASE_URL || process.env.APP_URL || 'https://flirthair.co.za',
        payfast: {
            merchantId: process.env.PAYFAST_MERCHANT_ID || '',
            merchantKey: process.env.PAYFAST_MERCHANT_KEY || '',
            passphrase: process.env.PAYFAST_PASSPHRASE || '',
            sandbox: process.env.PAYFAST_SANDBOX === 'true'
        },
        yoco: {
            secretKey: process.env.YOCO_SECRET_KEY || '',
            publicKey: process.env.YOCO_PUBLIC_KEY || '',
            webhookSecret: process.env.YOCO_WEBHOOK_SECRET || ''
        }
    };

    const merged = {
        appUrl: runtimeConfig.appUrl || envConfig.appUrl,
        apiBaseUrl: runtimeConfig.apiBaseUrl || envConfig.apiBaseUrl,
        payfast: {
            ...envConfig.payfast,
            ...runtimeConfig.payfast
        },
        yoco: {
            ...envConfig.yoco,
            ...runtimeConfig.yoco,
            baseUrl: 'https://payments.yoco.com/api'
        }
    };

    merged.payfast.baseUrl = merged.payfast.sandbox
        ? 'https://sandbox.payfast.co.za'
        : 'https://www.payfast.co.za';

    return merged;
}

function setRuntimeConfig(config) {
    runtimeConfig = {
        appUrl: config.appUrl || runtimeConfig.appUrl || null,
        apiBaseUrl: config.apiBaseUrl || runtimeConfig.apiBaseUrl || null,
        payfast: { ...runtimeConfig.payfast, ...(config.payfast || {}) },
        yoco: { ...runtimeConfig.yoco, ...(config.yoco || {}) }
    };
}

// NOTE: Webhook endpoints must be implemented in server.js:
// - POST /api/payments/webhook/payfast - PayFast ITN handler
// - POST /api/payments/webhook/yoco - Yoco webhook handler
// These endpoints should use processWebhook() function to verify and process payments

// ============================================
// PAYFAST INTEGRATION
// ============================================

/**
 * Generate PayFast payment form data
 * @param {Object} order - Order details
 * @param {Object} customer - Customer details
 * @returns {Object} Form data for PayFast redirect
 */
function generatePayFastPayment(order, customer) {
    const config = getEffectiveConfig();
    const paymentId = `FLT-${uuidv4().substring(0, 8).toUpperCase()}`;

    const data = {
        // Merchant details
        merchant_id: config.payfast.merchantId,
        merchant_key: config.payfast.merchantKey,
        return_url: `${config.appUrl}/payment/success?ref=${paymentId}`,
        cancel_url: `${config.appUrl}/payment/cancel?ref=${paymentId}`,
        notify_url: `${config.apiBaseUrl}/api/payments/webhook/payfast`,

        // Customer details
        name_first: customer.name.split(' ')[0],
        name_last: customer.name.split(' ').slice(1).join(' ') || '',
        email_address: customer.email,

        // Transaction details
        m_payment_id: paymentId,
        amount: order.total.toFixed(2),
        item_name: `Flirt Order #${order.id.substring(0, 8)}`,
        item_description: `${order.items.length} item(s) from Flirt Hair & Beauty`,

        // Custom fields
        custom_str1: order.id,
        custom_str2: customer.id
    };

    // Generate signature
    const signature = generatePayFastSignature(data);
    data.signature = signature;

    return {
        paymentId,
        formAction: `${config.payfast.baseUrl}/eng/process`,
        formData: data
    };
}

/**
 * Generate PayFast MD5 signature
 */
function generatePayFastSignature(data) {
    const config = getEffectiveConfig();
    // Create parameter string (sorted alphabetically)
    const orderedData = {};
    Object.keys(data).sort().forEach(key => {
        if (data[key] !== '' && key !== 'signature') {
            orderedData[key] = data[key];
        }
    });

    let paramString = Object.entries(orderedData)
        .map(([key, value]) => `${key}=${encodeURIComponent(String(value).trim()).replace(/%20/g, '+')}`)
        .join('&');

    // Add passphrase if configured
    if (config.payfast.passphrase) {
        paramString += `&passphrase=${encodeURIComponent(config.payfast.passphrase)}`;
    }

    return crypto.createHash('md5').update(paramString).digest('hex');
}

/**
 * Verify PayFast ITN (Instant Transaction Notification)
 */
function verifyPayFastNotification(postData, requestIp) {
    const config = getEffectiveConfig();
    // Valid PayFast IP addresses
    const validIps = [
        '197.97.145.144', '197.97.145.145', '197.97.145.146', '197.97.145.147',
        '41.74.179.194', '41.74.179.195', '41.74.179.196', '41.74.179.197'
    ];

    // Sandbox IPs
    if (config.payfast.sandbox) {
        validIps.push('127.0.0.1', '::1');
    }

    // Check source IP
    if (!validIps.includes(requestIp)) {
        console.warn('PayFast notification from invalid IP:', requestIp);
        return { valid: false, reason: 'Invalid source IP' };
    }

    // Verify signature
    const receivedSignature = postData.signature;
    delete postData.signature;

    const calculatedSignature = generatePayFastSignature(postData);

    if (receivedSignature !== calculatedSignature) {
        console.warn('PayFast signature mismatch');
        return { valid: false, reason: 'Invalid signature' };
    }

    // Check payment status
    if (postData.payment_status !== 'COMPLETE') {
        return { valid: true, completed: false, status: postData.payment_status };
    }

    return {
        valid: true,
        completed: true,
        paymentId: postData.m_payment_id,
        orderId: postData.custom_str1,
        customerId: postData.custom_str2,
        amount: parseFloat(postData.amount_gross),
        pfPaymentId: postData.pf_payment_id
    };
}

// ============================================
// YOCO INTEGRATION
// ============================================

/**
 * Create a Yoco checkout session
 * @param {Object} order - Order details
 * @param {Object} customer - Customer details
 * @returns {Promise<Object>} Checkout session details
 */
async function createYocoCheckout(order, customer) {
    const config = getEffectiveConfig();
    const paymentId = `FLT-${uuidv4().substring(0, 8).toUpperCase()}`;

    const payload = {
        amount: Math.round(order.total * 100), // Amount in cents
        currency: 'ZAR',
        successUrl: `${config.appUrl}/payment/success?ref=${paymentId}`,
        cancelUrl: `${config.appUrl}/payment/cancel?ref=${paymentId}`,
        failureUrl: `${config.appUrl}/payment/failed?ref=${paymentId}`,
        metadata: {
            orderId: order.id,
            customerId: customer.id,
            paymentId: paymentId,
            customerEmail: customer.email
        },
        lineItems: order.items.map(item => ({
            displayName: item.productName,
            quantity: item.quantity,
            pricingDetails: {
                price: Math.round(item.unitPrice * 100)
            }
        }))
    };

    try {
        const response = await fetch(`${config.yoco.baseUrl}/checkouts`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.yoco.secretKey}`
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to create Yoco checkout');
        }

        const data = await response.json();

        return {
            paymentId,
            checkoutId: data.id,
            redirectUrl: data.redirectUrl,
            expiresAt: data.expiresAt
        };
    } catch (error) {
        console.error('Yoco checkout error:', error);
        throw error;
    }
}

/**
 * Verify Yoco webhook signature
 */
function verifyYocoWebhook(payload, signature) {
    const config = getEffectiveConfig();
    if (!config.yoco.webhookSecret) {
        console.warn('Yoco webhook secret not configured');
        return false;
    }

    const expectedSignature = crypto
        .createHmac('sha256', config.yoco.webhookSecret)
        .update(JSON.stringify(payload))
        .digest('hex');

    return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
    );
}

/**
 * Process Yoco webhook event
 */
function processYocoWebhook(event) {
    const eventType = event.type;
    const payload = event.payload;

    switch (eventType) {
        case 'payment.succeeded':
            return {
                success: true,
                completed: true,
                paymentId: payload.metadata?.paymentId,
                orderId: payload.metadata?.orderId,
                customerId: payload.metadata?.customerId,
                amount: payload.amount / 100,
                yocoPaymentId: payload.id
            };

        case 'payment.failed':
            return {
                success: true,
                completed: false,
                status: 'failed',
                paymentId: payload.metadata?.paymentId,
                orderId: payload.metadata?.orderId,
                reason: payload.failureReason
            };

        case 'refund.succeeded':
            return {
                success: true,
                type: 'refund',
                paymentId: payload.metadata?.paymentId,
                amount: payload.amount / 100
            };

        default:
            return { success: true, type: eventType, ignored: true };
    }
}

// ============================================
// UNIFIED PAYMENT INTERFACE
// ============================================

/**
 * Initialize a payment with the preferred provider
 * @param {string} provider - 'payfast' or 'yoco'
 * @param {Object} order - Order details
 * @param {Object} customer - Customer details
 */
async function initializePayment(provider, order, customer) {
    switch (provider) {
        case 'payfast':
            return {
                provider: 'payfast',
                type: 'redirect',
                ...generatePayFastPayment(order, customer)
            };

        case 'yoco':
            const yocoResult = await createYocoCheckout(order, customer);
            return {
                provider: 'yoco',
                type: 'redirect',
                ...yocoResult
            };

        default:
            throw new Error(`Unknown payment provider: ${provider}`);
    }
}

/**
 * Process payment webhook
 */
function processWebhook(provider, data, headers = {}) {
    switch (provider) {
        case 'payfast':
            const requestIp = headers['x-forwarded-for'] || headers['x-real-ip'] || '';
            return verifyPayFastNotification(data, requestIp.split(',')[0].trim());

        case 'yoco':
            const signature = headers['yoco-signature'] || '';
            if (!verifyYocoWebhook(data, signature)) {
                return { valid: false, reason: 'Invalid signature' };
            }
            return processYocoWebhook(data);

        default:
            return { valid: false, reason: 'Unknown provider' };
    }
}

/**
 * Generate HTML for PayFast redirect form
 */
function generatePayFastRedirectHtml(paymentData) {
    const inputs = Object.entries(paymentData.formData)
        .map(([name, value]) => `<input type="hidden" name="${name}" value="${value}">`)
        .join('\n');

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Redirecting to PayFast...</title>
            <style>
                body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f8f8f8; }
                .container { text-align: center; padding: 40px; background: white; border-radius: 10px; box-shadow: 0 2px 20px rgba(0,0,0,0.1); }
                .spinner { width: 50px; height: 50px; border: 4px solid #f3f3f3; border-top: 4px solid #F67599; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 20px; }
                @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                h2 { color: #414042; margin-bottom: 10px; }
                p { color: #6d6e70; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="spinner"></div>
                <h2>Redirecting to PayFast</h2>
                <p>Please wait while we redirect you to complete your payment...</p>
            </div>
            <form id="payfast-form" action="${paymentData.formAction}" method="POST" style="display:none;">
                ${inputs}
            </form>
            <script>document.getElementById('payfast-form').submit();</script>
        </body>
        </html>
    `;
}

// ============================================
// PAYMENT STATUS HELPERS
// ============================================

const PaymentStatus = {
    PENDING: 'pending',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    FAILED: 'failed',
    REFUNDED: 'refunded',
    CANCELLED: 'cancelled'
};

/**
 * Get payment configuration status for admin diagnostics
 * Returns provider readiness without exposing secrets
 */
function getPaymentConfigStatus() {
    const config = getEffectiveConfig();

    // PayFast configuration status
    const payfastMissing = [];
    if (!config.payfast.merchantId) payfastMissing.push('PAYFAST_MERCHANT_ID');
    if (!config.payfast.merchantKey) payfastMissing.push('PAYFAST_MERCHANT_KEY');

    const payfastConfigured = payfastMissing.length === 0;
    const payfastMode = config.payfast.sandbox ? 'sandbox' : 'live';

    // Yoco configuration status
    const yocoMissing = [];
    if (!config.yoco.secretKey) yocoMissing.push('YOCO_SECRET_KEY');
    if (!config.yoco.publicKey) yocoMissing.push('YOCO_PUBLIC_KEY');

    const yocoConfigured = yocoMissing.length === 0;

    return {
        appUrl: config.appUrl,
        apiBaseUrl: config.apiBaseUrl,
        payfast: {
            configured: payfastConfigured,
            mode: payfastMode,
            baseUrl: config.payfast.baseUrl,
            notifyUrl: `${config.apiBaseUrl}/api/payments/webhook/payfast`,
            returnUrl: `${config.appUrl}/payment/success`,
            cancelUrl: `${config.appUrl}/payment/cancel`,
            hasPassphrase: !!config.payfast.passphrase,
            missingEnvVars: payfastMissing
        },
        yoco: {
            configured: yocoConfigured,
            baseUrl: config.yoco.baseUrl,
            webhookUrl: `${config.apiBaseUrl}/api/payments/webhook/yoco`,
            hasWebhookSecret: !!config.yoco.webhookSecret,
            hasPublicKey: !!config.yoco.publicKey,
            publicKey: config.yoco.publicKey ? `${config.yoco.publicKey.substring(0, 20)}...` : null,
            missingEnvVars: yocoMissing
        }
    };
}

module.exports = {
    // PayFast
    generatePayFastPayment,
    verifyPayFastNotification,
    generatePayFastRedirectHtml,

    // Yoco
    createYocoCheckout,
    verifyYocoWebhook,
    processYocoWebhook,

    // Unified interface
    initializePayment,
    processWebhook,

    // Config & diagnostics
    getPaymentConfigStatus,
    setRuntimeConfig,
    getEffectiveConfig,

    // Constants
    PaymentStatus
};
