// Flirt Hair & Beauty - Payment Integration Service
// Supports PayFast, Yoco, and Float for South African payments

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

// Runtime overrides set from admin console (persisted in DB)
let runtimeConfig = {
    appUrl: null,
    apiBaseUrl: null,
    payfast: {},
    yoco: {},
    float: {}
};

// Compute effective configuration (env vars as baseline, runtime overrides layered on)
function getEffectiveConfig() {
    const envConfig = {
        appUrl: process.env.APP_URL || 'https://flirt.hair',
        apiBaseUrl: process.env.API_BASE_URL || process.env.APP_URL || 'https://flirt.hair',
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
        },
        float: {
            merchantId: process.env.FLOAT_MERCHANT_ID || '',
            clientId: process.env.FLOAT_CLIENT_ID || '',
            clientSecret: process.env.FLOAT_CLIENT_SECRET || '',
            testMode: process.env.FLOAT_TEST_MODE === 'true',
            uatMode: process.env.FLOAT_UAT_MODE === 'true'
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
        },
        float: {
            ...envConfig.float,
            ...runtimeConfig.float
        }
    };

    merged.payfast.baseUrl = merged.payfast.sandbox
        ? 'https://sandbox.payfast.co.za'
        : 'https://www.payfast.co.za';

    // Float uses UAT for testing, Live for production
    merged.float.baseUrl = merged.float.uatMode
        ? 'https://uat-secure.float.co.za'
        : 'https://secure.float.co.za';

    return merged;
}

function setRuntimeConfig(config) {
    runtimeConfig = {
        appUrl: config.appUrl || runtimeConfig.appUrl || null,
        apiBaseUrl: config.apiBaseUrl || runtimeConfig.apiBaseUrl || null,
        payfast: { ...runtimeConfig.payfast, ...(config.payfast || {}) },
        yoco: { ...runtimeConfig.yoco, ...(config.yoco || {}) },
        float: { ...runtimeConfig.float, ...(config.float || {}) }
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
 * @param {Object} options - Optional settings (itemName, itemDescription)
 * @returns {Object} Form data for PayFast redirect
 */
function generatePayFastPayment(order, customer, options = {}) {
    const config = getEffectiveConfig();
    const paymentId = `FLT-${uuidv4().substring(0, 8).toUpperCase()}`;

    // Determine item name and description
    const itemName = options.itemName || `Flirt Order #${order.id.substring(0, 8)}`;
    const itemDescription = options.itemDescription || `${order.items.length} item(s) from Flirt Hair & Beauty`;

    // Build URLs - ensure no double /api/ prefix
    const baseAppUrl = (config.appUrl || 'https://flirt.hair').replace(/\/$/, ''); // Remove trailing slash
    const baseApiUrl = (config.apiBaseUrl || config.appUrl || 'https://flirt.hair').replace(/\/$/, '').replace(/\/api$/, ''); // Remove trailing slash and /api suffix

    // Log configuration for debugging
    console.log('[PayFast] Payment Config:', {
        merchantId: config.payfast.merchantId,
        merchantKey: config.payfast.merchantKey ? `${config.payfast.merchantKey.substring(0, 3)}...${config.payfast.merchantKey.substring(config.payfast.merchantKey.length - 3)}` : 'NOT SET',
        merchantKeyLength: config.payfast.merchantKey?.length || 0,
        merchantKeyFirstChar: config.payfast.merchantKey?.charCodeAt(0) || 'N/A',
        hasPassphrase: !!config.payfast.passphrase,
        passphraseLength: config.payfast.passphrase?.length || 0,
        passphrasePreview: config.payfast.passphrase ? `${config.payfast.passphrase.substring(0, 3)}...` : 'NOT SET',
        sandbox: config.payfast.sandbox,
        baseUrl: config.payfast.baseUrl,
        return_url: `${baseAppUrl}/app?payment=success&ref=${paymentId}`,
        notify_url: `${baseApiUrl}/api/payments/webhook/payfast`
    });

    // CRITICAL: Validate merchant credentials format
    if (config.payfast.merchantId && !/^\d{8}$/.test(config.payfast.merchantId)) {
        console.error('[PayFast] WARNING: Merchant ID should be exactly 8 digits! Got:', config.payfast.merchantId);
    }
    if (config.payfast.merchantKey && config.payfast.merchantKey.length !== 13) {
        console.error('[PayFast] WARNING: Merchant Key should be exactly 13 characters! Got length:', config.payfast.merchantKey.length);
    }

    const data = {
        // Merchant details
        merchant_id: config.payfast.merchantId,
        merchant_key: config.payfast.merchantKey,
        return_url: `${baseAppUrl}/app?payment=success&ref=${paymentId}`,
        cancel_url: `${baseAppUrl}/app?payment=cancelled&ref=${paymentId}`,
        notify_url: `${baseApiUrl}/api/payments/webhook/payfast`,

        // Customer details
        name_first: customer.name.split(' ')[0],
        name_last: customer.name.split(' ').slice(1).join(' ') || '',
        email_address: customer.email,

        // Transaction details
        m_payment_id: paymentId,
        amount: order.total.toFixed(2),
        item_name: itemName,
        item_description: itemDescription,

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
 * Per PayFast docs: https://developers.payfast.co.za/docs#step_2_signature
 * - Parameters must be in the order they appear in the form (not sorted alphabetically for generation)
 * - Values must be URL-encoded
 * - Spaces should be encoded as + (not %20)
 */
function generatePayFastSignature(data, useOriginalOrder = false) {
    const config = getEffectiveConfig();

    // PayFast expects parameters in a specific order for signature generation
    // The order is: merchant details, customer details, transaction details, then custom fields
    const orderedKeys = [
        'merchant_id', 'merchant_key', 'return_url', 'cancel_url', 'notify_url',
        'name_first', 'name_last', 'email_address', 'cell_number',
        'm_payment_id', 'amount', 'item_name', 'item_description',
        'custom_int1', 'custom_int2', 'custom_int3', 'custom_int4', 'custom_int5',
        'custom_str1', 'custom_str2', 'custom_str3', 'custom_str4', 'custom_str5',
        'email_confirmation', 'confirmation_address', 'payment_method', 'subscription_type',
        'billing_date', 'recurring_amount', 'frequency', 'cycles'
    ];

    // Build parameter string
    const params = [];

    if (useOriginalOrder) {
        // For verification, use the order from the received data
        Object.keys(data).forEach(key => {
            if (data[key] !== '' && data[key] !== null && data[key] !== undefined && key !== 'signature') {
                const value = String(data[key]).trim();
                // URL encode and replace %20 with +
                const encoded = encodeURIComponent(value).replace(/%20/g, '+');
                params.push(`${key}=${encoded}`);
            }
        });
    } else {
        // For generation, use the defined order
        orderedKeys.forEach(key => {
            if (data[key] !== '' && data[key] !== null && data[key] !== undefined && key !== 'signature') {
                const value = String(data[key]).trim();
                // URL encode and replace %20 with +
                const encoded = encodeURIComponent(value).replace(/%20/g, '+');
                params.push(`${key}=${encoded}`);
            }
        });

        // Add any extra keys not in the ordered list
        Object.keys(data).forEach(key => {
            if (!orderedKeys.includes(key) && data[key] !== '' && data[key] !== null && data[key] !== undefined && key !== 'signature') {
                const value = String(data[key]).trim();
                const encoded = encodeURIComponent(value).replace(/%20/g, '+');
                params.push(`${key}=${encoded}`);
            }
        });
    }

    let paramString = params.join('&');

    // Add passphrase if configured (must also be URL encoded)
    if (config.payfast.passphrase) {
        const encodedPassphrase = encodeURIComponent(config.payfast.passphrase.trim()).replace(/%20/g, '+');
        paramString += `&passphrase=${encodedPassphrase}`;
    }

    console.log('[PayFast] Signature string (first 200 chars):', paramString.substring(0, 200) + '...');

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

    // Use original order for verification (PayFast sends in a specific order)
    const calculatedSignature = generatePayFastSignature(postData, true);

    if (receivedSignature !== calculatedSignature) {
        console.warn('PayFast signature mismatch. Received:', receivedSignature, 'Calculated:', calculatedSignature);
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

    // Build clean app URL
    const baseAppUrl = config.appUrl.replace(/\/$/, '');

    const payload = {
        amount: Math.round(order.total * 100), // Amount in cents
        currency: 'ZAR',
        successUrl: `${baseAppUrl}/app?payment=success&ref=${paymentId}`,
        cancelUrl: `${baseAppUrl}/app?payment=cancelled&ref=${paymentId}`,
        failureUrl: `${baseAppUrl}/app?payment=failed&ref=${paymentId}`,
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
// FLOAT INTEGRATION (Buy Now Pay Later)
// ============================================

// Float auth token cache
let floatAuthToken = null;
let floatTokenExpiry = null;

/**
 * Clear Float token cache (useful for debugging)
 */
function clearFloatTokenCache() {
    floatAuthToken = null;
    floatTokenExpiry = null;
    console.log('[Float] Token cache cleared');
}

/**
 * Get Float authentication token
 * Uses form-urlencoded POST to /login endpoint (per WooCommerce plugin reference)
 */
async function getFloatAuthToken(forceRefresh = false) {
    const config = getEffectiveConfig();

    // Clear cache if force refresh requested
    if (forceRefresh) {
        clearFloatTokenCache();
    }

    // Return cached token if still valid (with 5 minute buffer)
    if (floatAuthToken && floatTokenExpiry && Date.now() < floatTokenExpiry - 300000) {
        console.log('[Float] Using cached token');
        return floatAuthToken;
    }

    // Float uses /login endpoint (NOT /api/auth/login)
    const authUrl = `${config.float.baseUrl}/login`;

    console.log('[Float] Authenticating with:', {
        url: authUrl,
        baseUrl: config.float.baseUrl,
        uatMode: config.float.uatMode,
        merchantId: config.float.merchantId,
        clientId: config.float.clientId ? `${config.float.clientId.substring(0, 4)}...` : 'NOT SET',
        clientIdLength: config.float.clientId?.length || 0,
        clientSecretLength: config.float.clientSecret?.length || 0
    });

    // Build form-urlencoded body (Float expects this format, not JSON)
    const formBody = new URLSearchParams({
        merchant_id: config.float.merchantId,
        client_id: config.float.clientId,
        client_secret: config.float.clientSecret
    }).toString();

    console.log('[Float] Login request body (masked):', formBody.replace(/client_secret=[^&]+/, 'client_secret=***'));

    try {
        const response = await fetch(authUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json',
                'Cache-Control': 'no-cache'
            },
            body: formBody
        });

        const responseText = await response.text();
        console.log('[Float] Login response status:', response.status);
        console.log('[Float] Login response body:', responseText.substring(0, 500));

        if (!response.ok) {
            console.error('[Float] Auth failed:', response.status, responseText);
            throw new Error(`Float authentication failed: ${response.status} - ${responseText}`);
        }

        let data;
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            console.error('[Float] Failed to parse login response as JSON:', responseText);
            throw new Error('Float login response is not valid JSON');
        }

        console.log('[Float] Login response keys:', Object.keys(data));

        // Extract token - Float returns 'token' key
        const token = data.token || data.access_token;

        if (!token) {
            console.error('[Float] No token in response! Response data:', JSON.stringify(data));
            throw new Error('Float login succeeded but no token returned');
        }

        // Cache token - Float tokens typically expire in 1 hour
        floatAuthToken = token;
        floatTokenExpiry = Date.now() + (data.expires_in ? data.expires_in * 1000 : 3600000);

        console.log('[Float] Authentication successful, token length:', token.length);
        return floatAuthToken;
    } catch (error) {
        console.error('[Float] Auth error:', error.message);
        throw error;
    }
}

/**
 * Create Float checkout session
 * Payload structure matches official Float WooCommerce plugin specification
 * @param {Object} order - Order details
 * @param {Object} customer - Customer details
 * @returns {Promise<Object>} Checkout details with redirect URL
 */
async function createFloatCheckout(order, customer) {
    const config = getEffectiveConfig();
    const paymentId = `FLT-${uuidv4().substring(0, 8).toUpperCase()}`;

    // Get fresh auth token (force refresh to ensure we have a valid token)
    const token = await getFloatAuthToken(true);

    console.log('[Float] Using token for checkout, length:', token?.length || 0);

    // Build URLs
    const baseAppUrl = (config.appUrl || 'https://flirt.hair').replace(/\/$/, '');
    const baseApiUrl = (config.apiBaseUrl || config.appUrl || 'https://flirt.hair').replace(/\/$/, '').replace(/\/api$/, '');

    // Build product items list for Float (must be JSON stringified in purchase.items)
    const productList = order.items.map(item => ({
        description: item.productId || item.id || '',
        sku: item.sku || '',
        price: Math.round((item.unitPrice || 0) * 100), // Price in cents
        qty: item.quantity || 1
    }));

    // Determine mode based on UAT setting
    const mode = config.float.uatMode ? 'UAT' : 'LIVE';

    // Parse customer name
    const firstName = customer.name?.split(' ')[0] || '';
    const lastName = customer.name?.split(' ').slice(1).join(' ') || '';

    // Float expects this exact payload structure (per WooCommerce plugin)
    const payload = {
        purchaseAmount: Math.round(order.total * 100), // Amount in cents as integer
        currency: 'ZAR',
        numberOfPayments: 4, // Standard Float "Pay in 4" installments
        customer: {
            sourceService: 'Flirt Hair & Beauty',
            customerReference: customer.id || '',
            name: firstName,
            lastName: lastName,
            telephoneNumber: customer.phone || '',
            emailAddress: customer.email || '',
            billingAddress: customer.address || ''
        },
        merchant: {
            merchantReference: config.float.merchantId,
            name: 'Flirt Hair & Beauty',
            mode: mode,
            return_url: `${baseAppUrl}/app?payment=success&ref=${paymentId}&provider=float`,
            notify_url: `${baseApiUrl}/api/payments/webhook/float`
        },
        purchase: {
            order_id: order.id,
            purchaseDate: new Date().toISOString().replace('T', ' ').substring(0, 19),
            items: JSON.stringify(productList) // Must be JSON stringified
        }
    };

    console.log('[Float] Creating checkout:', {
        purchaseAmount: payload.purchaseAmount,
        currency: payload.currency,
        mode: mode,
        return_url: payload.merchant.return_url,
        notify_url: payload.merchant.notify_url
    });

    try {
        const checkoutUrl = `${config.float.baseUrl}/payment/checkout`;
        console.log('[Float] Sending checkout request to:', checkoutUrl);
        console.log('[Float] Checkout payload:', JSON.stringify(payload, null, 2));
        console.log('[Float] Authorization header:', `Bearer ${token?.substring(0, 20)}...`);

        // Float uses /payment/checkout endpoint (NOT /api/checkout)
        const response = await fetch(checkoutUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': `Bearer ${token}`,
                'Cache-Control': 'no-cache'
            },
            body: JSON.stringify(payload)
        });

        const responseText = await response.text();
        console.log('[Float] Checkout response status:', response.status);
        console.log('[Float] Checkout response body:', responseText.substring(0, 1000));

        if (!response.ok) {
            console.error('[Float] Checkout creation failed:', response.status, responseText);
            throw new Error(`Float checkout failed: ${response.status} - ${responseText}`);
        }

        let data;
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            console.error('[Float] Failed to parse checkout response as JSON');
            throw new Error('Float checkout response is not valid JSON');
        }

        console.log('[Float] Checkout response keys:', Object.keys(data));
        console.log('[Float] Checkout created:', {
            transaction_id: data.transaction_id,
            redirect_url: data.redirect_url
        });

        // Build the credit card screen redirect URL
        // Float redirects to /payment/credit_card_screen?transaction_id=XXX
        const transactionId = data.transaction_id || data.id;
        const redirectUrl = data.redirect_url || data.checkout_url ||
            `${config.float.baseUrl}/payment/credit_card_screen?transaction_id=${transactionId}`;

        return {
            paymentId,
            transactionId: transactionId,
            redirectUrl: redirectUrl,
            expiresAt: data.expires_at
        };
    } catch (error) {
        console.error('[Float] Checkout error:', error);
        throw error;
    }
}

/**
 * Verify Float webhook callback
 * Float sends webhook notifications for payment status changes
 */
function verifyFloatWebhook(payload, signature, secret) {
    const config = getEffectiveConfig();
    const webhookSecret = secret || config.float.webhookSecret;

    if (!webhookSecret) {
        console.warn('[Float] Webhook secret not configured, skipping signature verification');
        return true; // Allow through if no secret configured
    }

    // Float uses HMAC-SHA256 for webhook signatures
    const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(JSON.stringify(payload))
        .digest('hex');

    return crypto.timingSafeEqual(
        Buffer.from(signature || ''),
        Buffer.from(expectedSignature)
    );
}

/**
 * Process Float webhook event
 */
function processFloatWebhook(data) {
    const status = data.status || data.payment_status;
    const reference = data.reference || data.merchant_reference;

    console.log('[Float] Processing webhook:', { status, reference });

    switch (status?.toLowerCase()) {
        case 'approved':
        case 'completed':
        case 'successful':
            return {
                valid: true,
                completed: true,
                paymentId: reference,
                orderId: data.metadata?.order_id || data.order_id,
                customerId: data.metadata?.customer_id || data.customer_id,
                amount: (data.amount || 0) / 100, // Convert from cents
                floatTransactionId: data.transaction_id
            };

        case 'pending':
        case 'processing':
            return {
                valid: true,
                completed: false,
                status: 'pending',
                paymentId: reference,
                orderId: data.metadata?.order_id
            };

        case 'declined':
        case 'failed':
        case 'cancelled':
            return {
                valid: true,
                completed: false,
                status: 'failed',
                paymentId: reference,
                orderId: data.metadata?.order_id,
                reason: data.decline_reason || data.error_message || 'Payment declined'
            };

        default:
            console.warn('[Float] Unknown webhook status:', status);
            return { valid: true, completed: false, status: status, ignored: true };
    }
}

/**
 * Generate HTML redirect page for Float
 */
function generateFloatRedirectHtml(checkoutData) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Redirecting to Float...</title>
            <style>
                body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f8f8f8; }
                .container { text-align: center; padding: 40px; background: white; border-radius: 10px; box-shadow: 0 2px 20px rgba(0,0,0,0.1); }
                .spinner { width: 50px; height: 50px; border: 4px solid #f3f3f3; border-top: 4px solid #00a86b; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 20px; }
                @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                h2 { color: #414042; margin-bottom: 10px; }
                p { color: #6d6e70; }
                .float-logo { font-size: 24px; font-weight: bold; color: #00a86b; margin-bottom: 20px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="float-logo">Float</div>
                <div class="spinner"></div>
                <h2>Redirecting to Float</h2>
                <p>Please wait while we redirect you to complete your payment...</p>
                <p style="font-size: 12px; margin-top: 20px;">Pay in 4 interest-free installments</p>
            </div>
            <script>
                setTimeout(function() {
                    window.location.href = "${checkoutData.redirectUrl}";
                }, 1000);
            </script>
        </body>
        </html>
    `;
}

// ============================================
// UNIFIED PAYMENT INTERFACE
// ============================================

/**
 * Initialize a payment with the preferred provider
 * @param {string} provider - 'payfast', 'yoco', or 'float'
 * @param {Object} order - Order details
 * @param {Object} customer - Customer details
 * @param {Object} options - Optional settings (itemName, itemDescription)
 */
async function initializePayment(provider, order, customer, options = {}) {
    switch (provider) {
        case 'payfast':
            return {
                provider: 'payfast',
                type: 'redirect',
                ...generatePayFastPayment(order, customer, options)
            };

        case 'yoco':
            const yocoResult = await createYocoCheckout(order, customer);
            return {
                provider: 'yoco',
                type: 'redirect',
                ...yocoResult
            };

        case 'float':
            const floatResult = await createFloatCheckout(order, customer);
            return {
                provider: 'float',
                type: 'redirect',
                ...floatResult
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
            const yocoSignature = headers['yoco-signature'] || '';
            if (!verifyYocoWebhook(data, yocoSignature)) {
                return { valid: false, reason: 'Invalid signature' };
            }
            return processYocoWebhook(data);

        case 'float':
            const floatSignature = headers['x-float-signature'] || headers['float-signature'] || '';
            if (!verifyFloatWebhook(data, floatSignature)) {
                return { valid: false, reason: 'Invalid signature' };
            }
            return processFloatWebhook(data);

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

    // Float configuration status
    const floatMissing = [];
    if (!config.float.merchantId) floatMissing.push('FLOAT_MERCHANT_ID');
    if (!config.float.clientId) floatMissing.push('FLOAT_CLIENT_ID');
    if (!config.float.clientSecret) floatMissing.push('FLOAT_CLIENT_SECRET');

    const floatConfigured = floatMissing.length === 0;
    const floatMode = config.float.uatMode ? 'UAT (test)' : 'live';

    // Build clean URLs for display
    const baseAppUrl = config.appUrl.replace(/\/$/, '');
    const baseApiUrl = config.apiBaseUrl.replace(/\/$/, '').replace(/\/api$/, '');

    return {
        appUrl: config.appUrl,
        apiBaseUrl: config.apiBaseUrl,
        payfast: {
            configured: payfastConfigured,
            mode: payfastMode,
            baseUrl: config.payfast.baseUrl,
            notifyUrl: `${baseApiUrl}/api/payments/webhook/payfast`,
            returnUrl: `${baseAppUrl}/app?payment=success`,
            cancelUrl: `${baseAppUrl}/app?payment=cancelled`,
            hasPassphrase: !!config.payfast.passphrase,
            missingEnvVars: payfastMissing
        },
        yoco: {
            configured: yocoConfigured,
            baseUrl: config.yoco.baseUrl,
            webhookUrl: `${baseApiUrl}/api/payments/webhook/yoco`,
            hasWebhookSecret: !!config.yoco.webhookSecret,
            hasPublicKey: !!config.yoco.publicKey,
            publicKey: config.yoco.publicKey ? `${config.yoco.publicKey.substring(0, 20)}...` : null,
            missingEnvVars: yocoMissing
        },
        float: {
            configured: floatConfigured,
            mode: floatMode,
            baseUrl: config.float.baseUrl,
            webhookUrl: `${baseApiUrl}/api/payments/webhook/float`,
            returnUrl: `${baseAppUrl}/app?payment=success&provider=float`,
            cancelUrl: `${baseAppUrl}/app?payment=cancelled&provider=float`,
            hasWebhookSecret: !!config.float.webhookSecret,
            missingEnvVars: floatMissing
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

    // Float (Buy Now Pay Later)
    createFloatCheckout,
    verifyFloatWebhook,
    processFloatWebhook,
    generateFloatRedirectHtml,

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
