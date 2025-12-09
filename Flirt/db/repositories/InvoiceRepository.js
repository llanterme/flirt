/**
 * Invoice Repository
 * Handles all invoice-related database operations
 */

const { v4: uuidv4 } = require('uuid');

function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function dbGet(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function dbAll(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

class InvoiceRepository {
    constructor(db) {
        this.db = db;
    }

    /**
     * Get invoice settings
     */
    async getSettings() {
        return await dbGet(this.db, 'SELECT * FROM invoice_settings WHERE id = 1');
    }

    /**
     * Update invoice settings
     */
    async updateSettings(settings) {
        const fields = Object.keys(settings).map(key => `${key} = ?`).join(', ');
        const values = Object.values(settings);

        await dbRun(this.db, `
            UPDATE invoice_settings
            SET ${fields},
                updated_at = datetime('now')
            WHERE id = 1
        `, values);

        return this.getSettings();
    }

    /**
     * Generate next invoice number
     * Format: INV-YYYY-NNNNN (e.g., INV-2025-00001)
     */
    async generateInvoiceNumber() {
        const settings = await this.getSettings();
        const year = new Date().getFullYear();
        const prefix = settings.invoice_number_prefix || 'INV';
        const format = settings.invoice_number_format || '{PREFIX}-{YEAR}-{NUMBER}';

        // Get next number
        const nextNum = settings.next_invoice_number || 1;
        const paddedNum = nextNum.toString().padStart(5, '0');

        // Generate invoice number
        const invoiceNumber = format
            .replace('{PREFIX}', prefix)
            .replace('{YEAR}', year)
            .replace('{NUMBER}', paddedNum);

        // Increment counter
        await dbRun(this.db, `
            UPDATE invoice_settings
            SET next_invoice_number = next_invoice_number + 1
            WHERE id = 1
        `);

        return invoiceNumber;
    }

    /**
     * Calculate commission rate for a service/product
     * Hierarchy: line_item > catalog > stylist > settings_default
     */
    async getCommissionRate(itemId, itemType, stylistId, lineItemRate = null) {
        // Line item override
        if (lineItemRate !== null && lineItemRate !== undefined) {
            return lineItemRate;
        }

        // Catalog rate
        const table = itemType === 'service' ? 'services' : 'products';
        const item = await dbGet(this.db, `SELECT commission_rate FROM ${table} WHERE id = ?`, [itemId]);

        if (item && item.commission_rate !== null) {
            return item.commission_rate;
        }

        // Stylist default (services only have stylist commission)
        if (itemType === 'service') {
            const stylist = await dbGet(this.db, 'SELECT commission_rate FROM stylists WHERE id = ?', [stylistId]);
            if (stylist && stylist.commission_rate) {
                return stylist.commission_rate;
            }
        }

        // Settings default
        const settings = await this.getSettings();
        if (itemType === 'service') {
            return settings.default_service_commission_rate || 0.30;
        } else {
            // Check if it's a service product or retail
            const product = await dbGet(this.db, 'SELECT is_service_product FROM products WHERE id = ?', [itemId]);
            if (product && product.is_service_product) {
                return settings.default_service_product_commission_rate || 0.05;
            }
            return settings.default_product_commission_rate || 0.10;
        }
    }

    /**
     * Create new invoice (draft)
     */
    async create(invoiceData) {
        const {
            booking_id,
            user_id,
            stylist_id,
            service_date,
            services = [],
            products = [],
            discount_type,
            discount_value,
            discount_reason,
            client_notes,
            internal_notes,
            created_by
        } = invoiceData;

        const settings = await this.getSettings();
        const invoice_id = uuidv4();

        // Calculate services subtotal and commission
        let services_subtotal = 0;
        let services_commission = 0;

        for (let service of services) {
            const total = (service.unit_price * service.quantity) - (service.discount || 0);
            services_subtotal += total;

            const rate = await this.getCommissionRate(
                service.service_id,
                'service',
                stylist_id,
                service.commission_rate
            );
            services_commission += total * rate;
        }

        // Calculate products subtotal and commission
        let products_subtotal = 0;
        let products_commission = 0;

        for (let product of products) {
            const total = (product.unit_price * product.quantity) - (product.discount || 0);
            products_subtotal += total;

            const rate = await this.getCommissionRate(
                product.product_id,
                'product',
                stylist_id,
                product.commission_rate
            );
            products_commission += total * rate;
        }

        const subtotal = services_subtotal + products_subtotal;

        // Calculate discount
        let discount_amount = 0;
        if (discount_type === 'percentage') {
            discount_amount = subtotal * ((discount_value || 0) / 100);
        } else if (discount_type === 'fixed') {
            discount_amount = discount_value || 0;
        } else if (discount_type === 'loyalty_points') {
            // Points to Rands conversion (e.g., 100 points = R10)
            discount_amount = (discount_value || 0) / 10;
        }

        // Calculate tax
        const taxable_amount = subtotal - discount_amount;
        const tax_amount = settings.tax_enabled ? (taxable_amount * settings.tax_rate) : 0;

        const total = taxable_amount + tax_amount;
        const amount_due = total;

        const commission_total = services_commission + products_commission;

        // Insert invoice header
        await dbRun(this.db, `
            INSERT INTO invoices (
                id, booking_id, user_id, stylist_id,
                services_subtotal, products_subtotal, subtotal,
                discount_type, discount_value, discount_amount, discount_reason,
                tax_rate, tax_amount, total,
                payment_status, amount_paid, amount_due,
                commission_total,
                status, service_date, client_notes, internal_notes,
                created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            invoice_id, booking_id, user_id, stylist_id,
            services_subtotal, products_subtotal, subtotal,
            discount_type, discount_value, discount_amount, discount_reason,
            settings.tax_rate, tax_amount, total,
            'unpaid', 0, amount_due,
            commission_total,
            'draft', service_date, client_notes, internal_notes,
            created_by
        ]);

        // Insert service line items
        for (let service of services) {
            const service_id = uuidv4();
            const line_total = (service.unit_price * service.quantity) - (service.discount || 0);

            const commission_rate = await this.getCommissionRate(
                service.service_id,
                'service',
                stylist_id,
                service.commission_rate
            );

            const commission_amount = line_total * commission_rate;

            await dbRun(this.db, `
                INSERT INTO invoice_services (
                    id, invoice_id, service_id,
                    service_name, service_description, service_category,
                    unit_price, quantity, discount, total,
                    commission_rate, commission_amount,
                    duration_minutes, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                service_id, invoice_id, service.service_id,
                service.service_name, service.service_description || '', service.service_category || '',
                service.unit_price, service.quantity, service.discount || 0, line_total,
                commission_rate, commission_amount,
                service.duration_minutes, service.notes
            ]);
        }

        // Insert product line items
        for (let product of products) {
            const product_id = uuidv4();
            const line_total = (product.unit_price * product.quantity) - (product.discount || 0);

            const commission_rate = await this.getCommissionRate(
                product.product_id,
                'product',
                stylist_id,
                product.commission_rate
            );

            const commission_amount = line_total * commission_rate;

            await dbRun(this.db, `
                INSERT INTO invoice_products (
                    id, invoice_id, product_id,
                    product_name, product_category, product_type,
                    unit_price, quantity, discount, total,
                    commission_rate, commission_amount,
                    notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                product_id, invoice_id, product.product_id,
                product.product_name, product.product_category || '', product.product_type,
                product.unit_price, product.quantity, product.discount || 0, line_total,
                commission_rate, commission_amount,
                product.notes
            ]);
        }

        return this.getById(invoice_id);
    }

    /**
     * Finalize invoice (lock it and generate invoice number)
     */
    async finalize(invoice_id) {
        const invoice = await this.getById(invoice_id);

        if (!invoice) {
            throw new Error('Invoice not found');
        }

        if (invoice.status !== 'draft') {
            throw new Error('Only draft invoices can be finalized');
        }

        const settings = await this.getSettings();
        const invoice_number = await this.generateInvoiceNumber();

        await dbRun(this.db, `
            UPDATE invoices
            SET status = 'finalized',
                invoice_number = ?,
                finalized_at = datetime('now'),
                updated_at = datetime('now')
            WHERE id = ?
        `, [invoice_number, invoice_id]);

        // Create commission record
        const servicesCommission = invoice.services.reduce((sum, s) => sum + s.commission_amount, 0);
        const productsCommission = invoice.products.reduce((sum, p) => sum + p.commission_amount, 0);

        await dbRun(this.db, `
            INSERT INTO invoice_commissions (
                id, invoice_id, stylist_id,
                services_commission, products_commission, total_commission,
                payment_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            uuidv4(),
            invoice_id,
            invoice.stylist_id,
            servicesCommission,
            productsCommission,
            invoice.commission_total,
            'pending'
        ]);

        // If linked to booking, update booking
        if (invoice.booking_id) {
            await dbRun(this.db, `
                UPDATE bookings
                SET invoice_id = ?,
                    invoiced = 1,
                    updated_at = datetime('now')
                WHERE id = ?
            `, [invoice_id, invoice.booking_id]);
        }

        // Deduct retail products from stock (if enabled in settings)
        if (settings.deduct_stock_on_finalize) {
            for (let product of invoice.products) {
                if (product.product_type === 'retail' && !product.deducted_from_stock) {
                    const currentStock = await dbGet(this.db, 'SELECT stock FROM products WHERE id = ?', [product.product_id]);

                    if (!settings.allow_negative_stock && currentStock.stock < product.quantity) {
                        console.warn(`⚠️  Not enough stock for ${product.product_name}: ${currentStock.stock} < ${product.quantity}`);
                        continue;
                    }

                    await dbRun(this.db, `
                        UPDATE products
                        SET stock = stock - ?
                        WHERE id = ?
                    `, [product.quantity, product.product_id]);

                    await dbRun(this.db, `
                        UPDATE invoice_products
                        SET deducted_from_stock = 1
                        WHERE id = ?
                    `, [product.id]);
                }
            }
        }

        return this.getById(invoice_id);
    }

    /**
     * Get invoice by ID with all line items
     */
    async getById(invoice_id) {
        const invoice = await dbGet(this.db, 'SELECT * FROM invoices WHERE id = ?', [invoice_id]);

        if (!invoice) return null;

        // Get line items
        invoice.services = await dbAll(this.db, 'SELECT * FROM invoice_services WHERE invoice_id = ?', [invoice_id]);
        invoice.products = await dbAll(this.db, 'SELECT * FROM invoice_products WHERE invoice_id = ?', [invoice_id]);
        invoice.payments = await dbAll(this.db, 'SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY payment_date DESC', [invoice_id]);
        invoice.commission = await dbGet(this.db, 'SELECT * FROM invoice_commissions WHERE invoice_id = ?', [invoice_id]);

        // Get user, stylist details
        invoice.customer = await dbGet(this.db, 'SELECT id, name, email, phone FROM users WHERE id = ?', [invoice.user_id]);
        invoice.stylist = await dbGet(this.db, 'SELECT id, name, specialty FROM stylists WHERE id = ?', [invoice.stylist_id]);

        if (invoice.booking_id) {
            invoice.booking = await dbGet(this.db, 'SELECT * FROM bookings WHERE id = ?', [invoice.booking_id]);
        }

        return invoice;
    }

    /**
     * List invoices with filters
     */
    async list(filters = {}) {
        const {
            status,
            payment_status,
            stylist_id,
            user_id,
            start_date,
            end_date,
            search,
            limit = 50,
            offset = 0
        } = filters;

        let whereClauses = [];
        let params = [];

        if (status) {
            whereClauses.push('i.status = ?');
            params.push(status);
        }

        if (payment_status) {
            whereClauses.push('i.payment_status = ?');
            params.push(payment_status);
        }

        if (stylist_id) {
            whereClauses.push('i.stylist_id = ?');
            params.push(stylist_id);
        }

        if (user_id) {
            whereClauses.push('i.user_id = ?');
            params.push(user_id);
        }

        if (start_date) {
            whereClauses.push('i.service_date >= ?');
            params.push(start_date);
        }

        if (end_date) {
            whereClauses.push('i.service_date <= ?');
            params.push(end_date);
        }

        if (search) {
            whereClauses.push('(i.invoice_number LIKE ? OR u.name LIKE ? OR u.email LIKE ?)');
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        const whereSQL = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

        const invoices = await dbAll(this.db, `
            SELECT
                i.*,
                u.name as customer_name,
                u.email as customer_email,
                s.name as stylist_name
            FROM invoices i
            LEFT JOIN users u ON i.user_id = u.id
            LEFT JOIN stylists s ON i.stylist_id = s.id
            ${whereSQL}
            ORDER BY i.created_at DESC
            LIMIT ? OFFSET ?
        `, [...params, limit, offset]);

        return invoices;
    }

    /**
     * Record payment against invoice
     */
    async recordPayment(invoice_id, paymentData) {
        const { amount, payment_method, payment_reference, notes, processed_by } = paymentData;

        const invoice = await this.getById(invoice_id);
        const settings = await this.getSettings();

        if (!invoice) {
            throw new Error('Invoice not found');
        }

        if (invoice.status === 'cancelled' || invoice.status === 'void') {
            throw new Error('Cannot record payment on cancelled/void invoice');
        }

        const payment_id = uuidv4();

        // Insert payment record
        await dbRun(this.db, `
            INSERT INTO invoice_payments (
                id, invoice_id, amount, payment_method,
                payment_reference, notes, processed_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [payment_id, invoice_id, amount, payment_method, payment_reference, notes, processed_by]);

        // Update invoice payment status
        const new_amount_paid = invoice.amount_paid + amount;
        const new_amount_due = invoice.total - new_amount_paid;

        let new_payment_status = 'unpaid';
        if (new_amount_paid >= invoice.total) {
            new_payment_status = 'paid';
        } else if (new_amount_paid > 0) {
            new_payment_status = 'partial';
        }

        await dbRun(this.db, `
            UPDATE invoices
            SET amount_paid = ?,
                amount_due = ?,
                payment_status = ?,
                updated_at = datetime('now')
            WHERE id = ?
        `, [new_amount_paid, new_amount_due, new_payment_status, invoice_id]);

        // If fully paid and auto-approve is enabled, approve commission
        if (new_payment_status === 'paid' && settings.auto_approve_commission_on_payment) {
            await dbRun(this.db, `
                UPDATE invoice_commissions
                SET payment_status = 'approved',
                    approved_at = datetime('now')
                WHERE invoice_id = ?
            `, [invoice_id]);

            // Update booking payment status if linked
            if (invoice.booking_id) {
                await dbRun(this.db, `
                    UPDATE bookings
                    SET payment_status = 'paid',
                        payment_date = datetime('now'),
                        updated_at = datetime('now')
                    WHERE id = ?
                `, [invoice.booking_id]);
            }
        }

        return this.getById(invoice_id);
    }

    /**
     * Get commission report for stylist
     */
    async getCommissionReport(stylist_id, start_date, end_date) {
        const commissions = await dbAll(this.db, `
            SELECT
                ic.*,
                i.invoice_number,
                i.service_date,
                i.total as invoice_total,
                i.payment_status,
                u.name as customer_name
            FROM invoice_commissions ic
            LEFT JOIN invoices i ON ic.invoice_id = i.id
            LEFT JOIN users u ON i.user_id = u.id
            WHERE ic.stylist_id = ?
            AND i.service_date BETWEEN ? AND ?
            AND i.status = 'finalized'
            ORDER BY i.service_date DESC
        `, [stylist_id, start_date, end_date]);

        const summary = {
            total_invoices: commissions.length,
            total_sales: commissions.reduce((sum, c) => sum + (c.invoice_total || 0), 0),
            services_commission: commissions.reduce((sum, c) => sum + c.services_commission, 0),
            products_commission: commissions.reduce((sum, c) => sum + c.products_commission, 0),
            total_commission: commissions.reduce((sum, c) => sum + c.total_commission, 0),
            paid_commission: commissions.filter(c => c.payment_status === 'paid')
                .reduce((sum, c) => sum + c.total_commission, 0),
            pending_commission: commissions.filter(c => c.payment_status === 'pending' || c.payment_status === 'approved')
                .reduce((sum, c) => sum + c.total_commission, 0)
        };

        return { summary, commissions };
    }

    /**
     * Mark commissions as paid (bulk operation)
     */
    async markCommissionsPaid(invoice_ids, payment_reference, payment_date) {
        const placeholders = invoice_ids.map(() => '?').join(',');

        await dbRun(this.db, `
            UPDATE invoice_commissions
            SET payment_status = 'paid',
                payment_date = ?,
                payment_reference = ?
            WHERE invoice_id IN (${placeholders})
        `, [payment_date, payment_reference, ...invoice_ids]);

        await dbRun(this.db, `
            UPDATE invoices
            SET commission_paid = 1,
                commission_paid_date = ?
            WHERE id IN (${placeholders})
        `, [payment_date, ...invoice_ids]);

        return true;
    }
}

module.exports = InvoiceRepository;
