/**
 * Quote Repository
 * Handles all quote-related database operations
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

class QuoteRepository {
    constructor(db) {
        this.db = db;
    }

    /**
     * Generate next quote number
     * Format: QTE-YYYY-NNNNN (e.g., QTE-2025-00001)
     */
    async generateQuoteNumber() {
        const year = new Date().getFullYear();
        const prefix = 'QTE';

        // Get the highest quote number for this year
        const lastQuote = await dbGet(this.db, `
            SELECT quote_number FROM quotes
            WHERE quote_number LIKE ?
            ORDER BY quote_number DESC LIMIT 1
        `, [`${prefix}-${year}-%`]);

        let nextNum = 1;
        if (lastQuote && lastQuote.quote_number) {
            const parts = lastQuote.quote_number.split('-');
            if (parts.length === 3) {
                nextNum = parseInt(parts[2], 10) + 1;
            }
        }

        const paddedNum = nextNum.toString().padStart(5, '0');
        return `${prefix}-${year}-${paddedNum}`;
    }

    /**
     * Create new quote (draft)
     */
    async create(quoteData) {
        const {
            user_id,
            stylist_id,
            services = [],
            products = [],
            discount_type,
            discount_value,
            discount_reason,
            valid_until,
            client_notes,
            internal_notes,
            customer_type = 'individual',
            company_name,
            business_address,
            vat_number,
            company_reg,
            created_by
        } = quoteData;

        const quote_id = uuidv4();

        // Calculate services subtotal
        let services_subtotal = 0;
        for (let service of services) {
            const total = (service.unit_price * service.quantity) - (service.discount || 0);
            services_subtotal += total;
        }

        // Calculate products subtotal
        let products_subtotal = 0;
        for (let product of products) {
            const total = (product.unit_price * product.quantity) - (product.discount || 0);
            products_subtotal += total;
        }

        const subtotal = services_subtotal + products_subtotal;

        // Calculate discount
        let discount_amount = 0;
        if (discount_type === 'percentage') {
            discount_amount = subtotal * ((discount_value || 0) / 100);
        } else if (discount_type === 'fixed') {
            discount_amount = discount_value || 0;
        } else if (discount_type === 'loyalty_points') {
            discount_amount = (discount_value || 0) / 10;
        }

        // Get business settings for VAT
        const bizSettings = await dbAll(this.db, 'SELECT key, value FROM business_settings');
        const settings = {};
        bizSettings.forEach(row => { settings[row.key] = row.value; });

        const isVatRegistered = settings.vat_registered === 'true';
        const taxable_amount = subtotal - discount_amount;
        const tax_rate = isVatRegistered ? 0.15 : 0;
        const tax_amount = taxable_amount * tax_rate;
        const total = taxable_amount + tax_amount;

        // Default valid_until to 30 days from now if not provided
        const defaultValidUntil = new Date();
        defaultValidUntil.setDate(defaultValidUntil.getDate() + 30);
        const finalValidUntil = valid_until || defaultValidUntil.toISOString().split('T')[0];

        // Insert quote header
        await dbRun(this.db, `
            INSERT INTO quotes (
                id, user_id, stylist_id,
                services_subtotal, products_subtotal, subtotal,
                discount_type, discount_value, discount_amount, discount_reason,
                tax_rate, tax_amount, total,
                status, valid_until, client_notes, internal_notes,
                customer_type, company_name, business_address, vat_number, company_reg,
                created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            quote_id, user_id || null, stylist_id || null,
            services_subtotal, products_subtotal, subtotal,
            discount_type || null, discount_value || 0, discount_amount, discount_reason || null,
            tax_rate, tax_amount, total,
            'draft', finalValidUntil, client_notes || null, internal_notes || null,
            customer_type, company_name || null, business_address || null, vat_number || null, company_reg || null,
            created_by
        ]);

        // Insert service line items
        for (let service of services) {
            const service_line_id = uuidv4();
            const line_total = (service.unit_price * service.quantity) - (service.discount || 0);

            await dbRun(this.db, `
                INSERT INTO quote_services (
                    id, quote_id, service_id,
                    service_name, service_description, service_category,
                    unit_price, quantity, discount, total,
                    duration_minutes, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                service_line_id, quote_id, service.service_id || null,
                service.service_name, service.service_description || '', service.service_category || '',
                service.unit_price, service.quantity || 1, service.discount || 0, line_total,
                service.duration_minutes || null, service.notes || null
            ]);
        }

        // Insert product line items
        for (let product of products) {
            const product_line_id = uuidv4();
            const line_total = (product.unit_price * product.quantity) - (product.discount || 0);

            await dbRun(this.db, `
                INSERT INTO quote_products (
                    id, quote_id, product_id,
                    product_name, product_category, product_type,
                    unit_price, quantity, discount, total, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                product_line_id, quote_id, product.product_id || null,
                product.product_name, product.product_category || '', product.product_type || null,
                product.unit_price, product.quantity || 1, product.discount || 0, line_total,
                product.notes || null
            ]);
        }

        return this.getById(quote_id);
    }

    /**
     * Update existing quote
     */
    async update(quote_id, quoteData) {
        const existing = await this.getById(quote_id);
        if (!existing) {
            throw new Error('Quote not found');
        }

        if (existing.status === 'converted') {
            throw new Error('Cannot edit a converted quote');
        }

        const {
            user_id,
            stylist_id,
            services = [],
            products = [],
            discount_type,
            discount_value,
            discount_reason,
            valid_until,
            client_notes,
            internal_notes,
            customer_type,
            company_name,
            business_address,
            vat_number,
            company_reg
        } = quoteData;

        // Calculate services subtotal
        let services_subtotal = 0;
        for (let service of services) {
            const total = (service.unit_price * service.quantity) - (service.discount || 0);
            services_subtotal += total;
        }

        // Calculate products subtotal
        let products_subtotal = 0;
        for (let product of products) {
            const total = (product.unit_price * product.quantity) - (product.discount || 0);
            products_subtotal += total;
        }

        const subtotal = services_subtotal + products_subtotal;

        // Calculate discount
        let discount_amount = 0;
        if (discount_type === 'percentage') {
            discount_amount = subtotal * ((discount_value || 0) / 100);
        } else if (discount_type === 'fixed') {
            discount_amount = discount_value || 0;
        } else if (discount_type === 'loyalty_points') {
            discount_amount = (discount_value || 0) / 10;
        }

        // Get business settings for VAT
        const bizSettings = await dbAll(this.db, 'SELECT key, value FROM business_settings');
        const settings = {};
        bizSettings.forEach(row => { settings[row.key] = row.value; });

        const isVatRegistered = settings.vat_registered === 'true';
        const taxable_amount = subtotal - discount_amount;
        const tax_rate = isVatRegistered ? 0.15 : 0;
        const tax_amount = taxable_amount * tax_rate;
        const total = taxable_amount + tax_amount;

        // Update quote header
        await dbRun(this.db, `
            UPDATE quotes SET
                user_id = ?,
                stylist_id = ?,
                services_subtotal = ?,
                products_subtotal = ?,
                subtotal = ?,
                discount_type = ?,
                discount_value = ?,
                discount_amount = ?,
                discount_reason = ?,
                tax_rate = ?,
                tax_amount = ?,
                total = ?,
                valid_until = ?,
                client_notes = ?,
                internal_notes = ?,
                customer_type = ?,
                company_name = ?,
                business_address = ?,
                vat_number = ?,
                company_reg = ?,
                updated_at = datetime('now')
            WHERE id = ?
        `, [
            user_id || null, stylist_id || null,
            services_subtotal, products_subtotal, subtotal,
            discount_type || null, discount_value || 0, discount_amount, discount_reason || null,
            tax_rate, tax_amount, total,
            valid_until || existing.valid_until,
            client_notes || null, internal_notes || null,
            customer_type || 'individual', company_name || null, business_address || null, vat_number || null, company_reg || null,
            quote_id
        ]);

        // Delete old line items
        await dbRun(this.db, 'DELETE FROM quote_services WHERE quote_id = ?', [quote_id]);
        await dbRun(this.db, 'DELETE FROM quote_products WHERE quote_id = ?', [quote_id]);

        // Insert new service line items
        for (let service of services) {
            const service_line_id = uuidv4();
            const line_total = (service.unit_price * service.quantity) - (service.discount || 0);

            await dbRun(this.db, `
                INSERT INTO quote_services (
                    id, quote_id, service_id,
                    service_name, service_description, service_category,
                    unit_price, quantity, discount, total,
                    duration_minutes, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                service_line_id, quote_id, service.service_id || null,
                service.service_name, service.service_description || '', service.service_category || '',
                service.unit_price, service.quantity || 1, service.discount || 0, line_total,
                service.duration_minutes || null, service.notes || null
            ]);
        }

        // Insert new product line items
        for (let product of products) {
            const product_line_id = uuidv4();
            const line_total = (product.unit_price * product.quantity) - (product.discount || 0);

            await dbRun(this.db, `
                INSERT INTO quote_products (
                    id, quote_id, product_id,
                    product_name, product_category, product_type,
                    unit_price, quantity, discount, total, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                product_line_id, quote_id, product.product_id || null,
                product.product_name, product.product_category || '', product.product_type || null,
                product.unit_price, product.quantity || 1, product.discount || 0, line_total,
                product.notes || null
            ]);
        }

        return this.getById(quote_id);
    }

    /**
     * Send quote (mark as sent and generate quote number)
     */
    async send(quote_id) {
        const quote = await this.getById(quote_id);

        if (!quote) {
            throw new Error('Quote not found');
        }

        if (quote.status !== 'draft') {
            throw new Error('Only draft quotes can be sent');
        }

        const quote_number = await this.generateQuoteNumber();

        await dbRun(this.db, `
            UPDATE quotes
            SET status = 'sent',
                quote_number = ?,
                updated_at = datetime('now')
            WHERE id = ?
        `, [quote_number, quote_id]);

        return this.getById(quote_id);
    }

    /**
     * Accept quote
     */
    async accept(quote_id) {
        const quote = await this.getById(quote_id);

        if (!quote) {
            throw new Error('Quote not found');
        }

        if (quote.status !== 'sent' && quote.status !== 'draft') {
            throw new Error('Quote cannot be accepted in current status');
        }

        await dbRun(this.db, `
            UPDATE quotes
            SET status = 'accepted',
                accepted_at = datetime('now'),
                updated_at = datetime('now')
            WHERE id = ?
        `, [quote_id]);

        return this.getById(quote_id);
    }

    /**
     * Decline quote
     */
    async decline(quote_id) {
        const quote = await this.getById(quote_id);

        if (!quote) {
            throw new Error('Quote not found');
        }

        await dbRun(this.db, `
            UPDATE quotes
            SET status = 'declined',
                updated_at = datetime('now')
            WHERE id = ?
        `, [quote_id]);

        return this.getById(quote_id);
    }

    /**
     * Convert quote to invoice
     */
    async convertToInvoice(quote_id, invoiceRepo, service_date) {
        const quote = await this.getById(quote_id);

        if (!quote) {
            throw new Error('Quote not found');
        }

        if (quote.status === 'converted') {
            throw new Error('Quote has already been converted');
        }

        if (quote.status === 'declined' || quote.status === 'expired') {
            throw new Error('Cannot convert declined or expired quote');
        }

        // Map services for invoice
        const services = quote.services.map(s => ({
            service_id: s.service_id,
            service_name: s.service_name,
            service_description: s.service_description,
            service_category: s.service_category,
            unit_price: s.unit_price,
            quantity: s.quantity,
            discount: s.discount,
            duration_minutes: s.duration_minutes,
            notes: s.notes
        }));

        // Map products for invoice
        const products = quote.products.map(p => ({
            product_id: p.product_id,
            product_name: p.product_name,
            product_category: p.product_category,
            product_type: p.product_type,
            unit_price: p.unit_price,
            quantity: p.quantity,
            discount: p.discount,
            notes: p.notes
        }));

        // Create invoice from quote data
        const invoice = await invoiceRepo.create({
            user_id: quote.user_id,
            stylist_id: quote.stylist_id,
            service_date: service_date || new Date().toISOString().split('T')[0],
            services,
            products,
            discount_type: quote.discount_type,
            discount_value: quote.discount_value,
            discount_reason: quote.discount_reason,
            client_notes: quote.client_notes,
            internal_notes: `Converted from Quote ${quote.quote_number || quote.id}\n\n${quote.internal_notes || ''}`.trim(),
            customer_type: quote.customer_type,
            company_name: quote.company_name,
            business_address: quote.business_address,
            vat_number: quote.vat_number,
            company_reg: quote.company_reg
        });

        // Update quote to mark as converted
        await dbRun(this.db, `
            UPDATE quotes
            SET status = 'converted',
                converted_invoice_id = ?,
                updated_at = datetime('now')
            WHERE id = ?
        `, [invoice.id, quote_id]);

        return { quote: await this.getById(quote_id), invoice };
    }

    /**
     * Get quote by ID with all line items
     */
    async getById(quote_id) {
        const quote = await dbGet(this.db, 'SELECT * FROM quotes WHERE id = ?', [quote_id]);

        if (!quote) return null;

        // Get line items
        quote.services = await dbAll(this.db, 'SELECT * FROM quote_services WHERE quote_id = ?', [quote_id]);
        quote.products = await dbAll(this.db, 'SELECT * FROM quote_products WHERE quote_id = ?', [quote_id]);

        // Get user, stylist details
        if (quote.user_id) {
            quote.customer = await dbGet(this.db, 'SELECT id, name, email, phone FROM users WHERE id = ?', [quote.user_id]);
        }
        if (quote.stylist_id) {
            quote.stylist = await dbGet(this.db, 'SELECT id, name, specialty FROM stylists WHERE id = ?', [quote.stylist_id]);
        }

        // Check if expired
        if (quote.status === 'sent' && quote.valid_until) {
            const today = new Date().toISOString().split('T')[0];
            if (quote.valid_until < today) {
                quote.status = 'expired';
                // Update in DB
                await dbRun(this.db, `UPDATE quotes SET status = 'expired' WHERE id = ?`, [quote_id]);
            }
        }

        return quote;
    }

    /**
     * List quotes with filters
     */
    async list(filters = {}) {
        const {
            status,
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
            whereClauses.push('q.status = ?');
            params.push(status);
        }

        if (stylist_id) {
            whereClauses.push('q.stylist_id = ?');
            params.push(stylist_id);
        }

        if (user_id) {
            whereClauses.push('q.user_id = ?');
            params.push(user_id);
        }

        if (start_date) {
            whereClauses.push('q.quote_date >= ?');
            params.push(start_date);
        }

        if (end_date) {
            whereClauses.push('q.quote_date <= ?');
            params.push(end_date);
        }

        if (search) {
            whereClauses.push('(q.quote_number LIKE ? OR u.name LIKE ? OR u.email LIKE ?)');
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        const whereSQL = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

        const quotes = await dbAll(this.db, `
            SELECT
                q.*,
                u.name as customer_name,
                u.email as customer_email,
                s.name as stylist_name
            FROM quotes q
            LEFT JOIN users u ON q.user_id = u.id
            LEFT JOIN stylists s ON q.stylist_id = s.id
            ${whereSQL}
            ORDER BY q.created_at DESC
            LIMIT ? OFFSET ?
        `, [...params, limit, offset]);

        // Check for expired quotes
        const today = new Date().toISOString().split('T')[0];
        for (let quote of quotes) {
            if (quote.status === 'sent' && quote.valid_until && quote.valid_until < today) {
                quote.status = 'expired';
            }
        }

        return quotes;
    }

    /**
     * Delete quote (only drafts)
     */
    async delete(quote_id) {
        const quote = await this.getById(quote_id);

        if (!quote) {
            throw new Error('Quote not found');
        }

        if (quote.status !== 'draft') {
            throw new Error('Only draft quotes can be deleted');
        }

        await dbRun(this.db, 'DELETE FROM quote_services WHERE quote_id = ?', [quote_id]);
        await dbRun(this.db, 'DELETE FROM quote_products WHERE quote_id = ?', [quote_id]);
        await dbRun(this.db, 'DELETE FROM quotes WHERE id = ?', [quote_id]);

        return { success: true };
    }

    /**
     * Get quote statistics
     */
    async getStats() {
        const stats = await dbGet(this.db, `
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft,
                SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
                SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) as accepted,
                SUM(CASE WHEN status = 'declined' THEN 1 ELSE 0 END) as declined,
                SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as expired,
                SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END) as converted,
                SUM(total) as total_value,
                SUM(CASE WHEN status = 'converted' THEN total ELSE 0 END) as converted_value
            FROM quotes
        `);

        return stats;
    }
}

module.exports = QuoteRepository;
