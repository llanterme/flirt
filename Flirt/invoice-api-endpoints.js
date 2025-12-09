// ============================================
// INVOICING SYSTEM API ENDPOINTS
// ============================================

// This code should be inserted into server.js before the "START SERVER" section

// ============================================
// INVOICE SETTINGS MANAGEMENT
// ============================================

// Get invoice settings
app.get('/api/admin/invoice-settings', authenticateAdmin, async (req, res) => {
    try {
        const settings = await InvoiceRepository.getSettings();
        res.json({ success: true, settings });
    } catch (error) {
        console.error('Get invoice settings error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update invoice settings
app.put('/api/admin/invoice-settings', authenticateAdmin, async (req, res) => {
    try {
        const settings = await InvoiceRepository.updateSettings(req.body);
        res.json({ success: true, settings });
    } catch (error) {
        console.error('Update invoice settings error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get payment methods
app.get('/api/admin/payment-methods', authenticateAdmin, async (req, res) => {
    try {
        const methods = await db.dbAll('SELECT * FROM payment_methods ORDER BY display_order');
        res.json({ success: true, payment_methods: methods });
    } catch (error) {
        console.error('Get payment methods error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update payment method
app.put('/api/admin/payment-methods/:id', authenticateAdmin, async (req, res) => {
    try {
        const { enabled, transaction_fee_type, transaction_fee_value, description } = req.body;

        await db.dbRun(`
            UPDATE payment_methods
            SET enabled = ?,
                transaction_fee_type = ?,
                transaction_fee_value = ?,
                description = ?
            WHERE id = ?
        `, [enabled, transaction_fee_type, transaction_fee_value, description, req.params.id]);

        const method = await db.dbGet('SELECT * FROM payment_methods WHERE id = ?', [req.params.id]);
        res.json({ success: true, payment_method: method });
    } catch (error) {
        console.error('Update payment method error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get discount presets
app.get('/api/admin/discount-presets', authenticateAdmin, async (req, res) => {
    try {
        const presets = await db.dbAll('SELECT * FROM discount_presets WHERE enabled = 1 ORDER BY display_order');
        res.json({ success: true, discount_presets: presets });
    } catch (error) {
        console.error('Get discount presets error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create discount preset
app.post('/api/admin/discount-presets', authenticateAdmin, async (req, res) => {
    try {
        const { name, description, discount_type, discount_value, requires_approval } = req.body;
        const id = `discount-${Date.now()}`;

        await db.dbRun(`
            INSERT INTO discount_presets (id, name, description, discount_type, discount_value, requires_approval)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [id, name, description, discount_type, discount_value, requires_approval || 0]);

        const preset = await db.dbGet('SELECT * FROM discount_presets WHERE id = ?', [id]);
        res.json({ success: true, discount_preset: preset });
    } catch (error) {
        console.error('Create discount preset error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update discount preset
app.put('/api/admin/discount-presets/:id', authenticateAdmin, async (req, res) => {
    try {
        const { name, description, discount_type, discount_value, enabled, requires_approval } = req.body;

        await db.dbRun(`
            UPDATE discount_presets
            SET name = ?,
                description = ?,
                discount_type = ?,
                discount_value = ?,
                enabled = ?,
                requires_approval = ?
            WHERE id = ?
        `, [name, description, discount_type, discount_value, enabled, requires_approval, req.params.id]);

        const preset = await db.dbGet('SELECT * FROM discount_presets WHERE id = ?', [req.params.id]);
        res.json({ success: true, discount_preset: preset });
    } catch (error) {
        console.error('Update discount preset error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete discount preset
app.delete('/api/admin/discount-presets/:id', authenticateAdmin, async (req, res) => {
    try {
        await db.dbRun('DELETE FROM discount_presets WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete discount preset error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// INVOICE MANAGEMENT
// ============================================

// Create new invoice
app.post('/api/admin/invoices', authenticateToken, adminOrStaff, async (req, res) => {
    try {
        const invoiceData = {
            ...req.body,
            created_by: req.user.id
        };

        const invoice = await InvoiceRepository.create(invoiceData);
        res.json({ success: true, invoice });
    } catch (error) {
        console.error('Create invoice error:', error);
        res.status(500).json({ error: error.message });
    }
});

// List invoices with filters
app.get('/api/admin/invoices', authenticateToken, adminOrStaff, async (req, res) => {
    try {
        const filters = {
            status: req.query.status,
            payment_status: req.query.payment_status,
            stylist_id: req.query.stylist_id,
            user_id: req.query.user_id,
            start_date: req.query.start_date,
            end_date: req.query.end_date,
            search: req.query.search,
            limit: parseInt(req.query.limit) || 50,
            offset: parseInt(req.query.offset) || 0
        };

        const invoices = await InvoiceRepository.list(filters);
        res.json({ success: true, invoices });
    } catch (error) {
        console.error('List invoices error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get single invoice
app.get('/api/admin/invoices/:id', authenticateToken, async (req, res) => {
    try {
        const invoice = await InvoiceRepository.getById(req.params.id);

        if (!invoice) {
            return res.status(404).json({ error: 'Invoice not found' });
        }

        // Allow user to view their own invoice, or admin/staff to view any
        if (invoice.user_id !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'staff') {
            return res.status(403).json({ error: 'Forbidden' });
        }

        res.json({ success: true, invoice });
    } catch (error) {
        console.error('Get invoice error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update draft invoice
app.put('/api/admin/invoices/:id', authenticateToken, adminOrStaff, async (req, res) => {
    try {
        const invoice = await InvoiceRepository.getById(req.params.id);

        if (!invoice) {
            return res.status(404).json({ error: 'Invoice not found' });
        }

        if (invoice.status !== 'draft') {
            return res.status(400).json({ error: 'Can only edit draft invoices' });
        }

        // For simplicity, delete and recreate (in production, you'd update line items)
        await db.dbRun('DELETE FROM invoice_services WHERE invoice_id = ?', [req.params.id]);
        await db.dbRun('DELETE FROM invoice_products WHERE invoice_id = ?', [req.params.id]);
        await db.dbRun('DELETE FROM invoices WHERE id = ?', [req.params.id]);

        const invoiceData = {
            ...req.body,
            created_by: req.user.id
        };

        const newInvoice = await InvoiceRepository.create(invoiceData);
        res.json({ success: true, invoice: newInvoice });
    } catch (error) {
        console.error('Update invoice error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete draft invoice
app.delete('/api/admin/invoices/:id', authenticateToken, adminOrStaff, async (req, res) => {
    try {
        const invoice = await InvoiceRepository.getById(req.params.id);

        if (!invoice) {
            return res.status(404).json({ error: 'Invoice not found' });
        }

        if (invoice.status !== 'draft') {
            return res.status(400).json({ error: 'Can only delete draft invoices' });
        }

        await db.dbRun('DELETE FROM invoices WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete invoice error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Finalize invoice (lock and generate invoice number)
app.put('/api/admin/invoices/:id/finalize', authenticateToken, adminOrStaff, async (req, res) => {
    try {
        const invoice = await InvoiceRepository.finalize(req.params.id);
        res.json({ success: true, invoice });
    } catch (error) {
        console.error('Finalize invoice error:', error);
        res.status(400).json({ error: error.message });
    }
});

// ============================================
// PAYMENT MANAGEMENT
// ============================================

// Record payment
app.post('/api/admin/invoices/:id/payments', authenticateToken, adminOrStaff, async (req, res) => {
    try {
        const paymentData = {
            ...req.body,
            processed_by: req.user.id
        };

        const invoice = await InvoiceRepository.recordPayment(req.params.id, paymentData);
        res.json({ success: true, invoice });
    } catch (error) {
        console.error('Record payment error:', error);
        res.status(400).json({ error: error.message });
    }
});

// Get payments for invoice
app.get('/api/admin/invoices/:id/payments', authenticateToken, async (req, res) => {
    try {
        const invoice = await InvoiceRepository.getById(req.params.id);

        if (!invoice) {
            return res.status(404).json({ error: 'Invoice not found' });
        }

        // Allow user to view their own invoice payments, or admin/staff to view any
        if (invoice.user_id !== req.user.id && req.user.role !== 'admin' && req.user.role !== 'staff') {
            return res.status(403).json({ error: 'Forbidden' });
        }

        res.json({ success: true, payments: invoice.payments });
    } catch (error) {
        console.error('Get payments error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// COMMISSION & PAYROLL
// ============================================

// Get commission report
app.get('/api/admin/commissions', authenticateAdmin, async (req, res) => {
    try {
        const { stylist_id, start_date, end_date } = req.query;

        if (!stylist_id || !start_date || !end_date) {
            return res.status(400).json({ error: 'stylist_id, start_date, and end_date are required' });
        }

        const report = await InvoiceRepository.getCommissionReport(stylist_id, start_date, end_date);
        res.json({ success: true, ...report });
    } catch (error) {
        console.error('Commission report error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get all stylists commission summary
app.get('/api/admin/commissions/summary', authenticateAdmin, async (req, res) => {
    try {
        const { start_date, end_date } = req.query;

        if (!start_date || !end_date) {
            return res.status(400).json({ error: 'start_date and end_date are required' });
        }

        const stylists = await StylistRepository.getAll();
        const summaries = [];

        for (let stylist of stylists) {
            const report = await InvoiceRepository.getCommissionReport(stylist.id, start_date, end_date);
            summaries.push({
                stylist_id: stylist.id,
                stylist_name: stylist.name,
                ...report.summary
            });
        }

        res.json({ success: true, summaries });
    } catch (error) {
        console.error('Commission summary error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Mark commissions as paid (bulk operation)
app.post('/api/admin/commissions/mark-paid', authenticateAdmin, async (req, res) => {
    try {
        const { invoice_ids, payment_reference, payment_date } = req.body;

        if (!invoice_ids || !Array.isArray(invoice_ids) || invoice_ids.length === 0) {
            return res.status(400).json({ error: 'invoice_ids array is required' });
        }

        await InvoiceRepository.markCommissionsPaid(
            invoice_ids,
            payment_reference || `PAYROLL-${Date.now()}`,
            payment_date || new Date().toISOString()
        );

        res.json({ success: true, count: invoice_ids.length });
    } catch (error) {
        console.error('Mark commissions paid error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// CUSTOMER-FACING INVOICE ENDPOINTS
// ============================================

// Get my invoices
app.get('/api/invoices/my-invoices', authenticateToken, async (req, res) => {
    try {
        const invoices = await InvoiceRepository.list({
            user_id: req.user.id,
            status: 'finalized' // Only show finalized invoices to customers
        });

        res.json({ success: true, invoices });
    } catch (error) {
        console.error('Get my invoices error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get single invoice (customer view)
app.get('/api/invoices/:id', authenticateToken, async (req, res) => {
    try {
        const invoice = await InvoiceRepository.getById(req.params.id);

        if (!invoice) {
            return res.status(404).json({ error: 'Invoice not found' });
        }

        // Only allow customer to view their own invoice
        if (invoice.user_id !== req.user.id) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        res.json({ success: true, invoice });
    } catch (error) {
        console.error('Get invoice error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Initiate payment for invoice (redirect to PayFast/Yoco)
app.post('/api/invoices/:id/pay', authenticateToken, async (req, res) => {
    try {
        const invoice = await InvoiceRepository.getById(req.params.id);

        if (!invoice) {
            return res.status(404).json({ error: 'Invoice not found' });
        }

        if (invoice.user_id !== req.user.id) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        if (invoice.payment_status === 'paid') {
            return res.status(400).json({ error: 'Invoice already paid' });
        }

        const { payment_method } = req.body;

        // For now, return payment URL (integration with PayFast/Yoco would go here)
        // This would use the existing PaymentService logic

        res.json({
            success: true,
            payment_url: `/payment/invoice/${invoice.id}?method=${payment_method}`,
            amount: invoice.amount_due
        });
    } catch (error) {
        console.error('Initiate payment error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Helper middleware for admin or staff
function adminOrStaff(req, res, next) {
    if (req.user.role === 'admin' || req.user.role === 'staff') {
        next();
    } else {
        res.status(403).json({ error: 'Admin or staff access required' });
    }
}
