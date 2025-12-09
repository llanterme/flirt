// ============================================
// INVOICING SYSTEM JAVASCRIPT
// Insert this into flirt-admin-console.html <script> section
// ============================================

// Global variables for invoice management
let currentInvoice = {
    services: [],
    products: [],
    totals: {
        services_subtotal: 0,
        products_subtotal: 0,
        subtotal: 0,
        discount_amount: 0,
        tax_amount: 0,
        total: 0,
        commission: 0
    }
};

let allServices = [];
let allProducts = [];
let allStylists = [];
let allCustomers = [];
let currentPaymentInvoice = null;

// ============================================
// LOAD INVOICES
// ============================================
async function loadInvoices() {
    try {
        const search = document.getElementById('invoice-search')?.value || '';
        const status = document.getElementById('invoice-status-filter')?.value || '';
        const payment_status = document.getElementById('invoice-payment-filter')?.value || '';
        const stylist_id = document.getElementById('invoice-stylist-filter')?.value || '';

        const params = new URLSearchParams();
        if (search) params.append('search', search);
        if (status) params.append('status', status);
        if (payment_status) params.append('payment_status', payment_status);
        if (stylist_id) params.append('stylist_id', stylist_id);

        const response = await fetch(`/api/admin/invoices?${params}`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });

        const data = await response.json();

        if (data.success) {
            renderInvoiceList(data.invoices);
            updateUnpaidBadge(data.invoices);
        }
    } catch (error) {
        console.error('Error loading invoices:', error);
        showError('Failed to load invoices');
    }
}

function renderInvoiceList(invoices) {
    const container = document.getElementById('invoice-list-container');

    if (!invoices || invoices.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: var(--text-subtle);">
                <svg style="width: 64px; height: 64px; margin-bottom: 16px; opacity: 0.3;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                </svg>
                <p style="font-size: 18px; margin-bottom: 8px;">No invoices found</p>
                <p style="font-size: 14px;">Create your first invoice to get started</p>
            </div>
        `;
        return;
    }

    const html = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>Invoice #</th>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>Stylist</th>
                    <th>Total</th>
                    <th>Payment</th>
                    <th>Status</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${invoices.map(inv => `
                    <tr>
                        <td><strong>${inv.invoice_number || 'DRAFT'}</strong></td>
                        <td>${formatDate(inv.service_date)}</td>
                        <td>${inv.customer_name || 'Unknown'}</td>
                        <td>${inv.stylist_name || 'Unknown'}</td>
                        <td><strong>R${inv.total.toFixed(2)}</strong></td>
                        <td>
                            <span class="badge badge-${getPaymentBadgeClass(inv.payment_status)}">
                                ${inv.payment_status.toUpperCase()}
                            </span>
                            ${inv.payment_status === 'partial' ? `<br><small>R${inv.amount_paid.toFixed(2)} / R${inv.total.toFixed(2)}</small>` : ''}
                        </td>
                        <td>
                            <span class="badge badge-${getStatusBadgeClass(inv.status)}">
                                ${inv.status.toUpperCase()}
                            </span>
                        </td>
                        <td>
                            <button class="btn-icon" onclick="viewInvoice('${inv.id}')" title="View">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                    <circle cx="12" cy="12" r="3"></circle>
                                </svg>
                            </button>
                            ${inv.status === 'draft' ? `
                                <button class="btn-icon" onclick="editInvoice('${inv.id}')" title="Edit">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                    </svg>
                                </button>
                            ` : ''}
                            ${inv.payment_status !== 'paid' && inv.status === 'finalized' ? `
                                <button class="btn-icon" onclick="showPaymentModal('${inv.id}')" title="Record Payment" style="color: var(--success);">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <line x1="12" y1="1" x2="12" y2="23"></line>
                                        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                                    </svg>
                                </button>
                            ` : ''}
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    container.innerHTML = html;
}

function getPaymentBadgeClass(status) {
    const classes = {
        'unpaid': 'danger',
        'partial': 'warning',
        'paid': 'success',
        'refunded': 'secondary'
    };
    return classes[status] || 'secondary';
}

function getStatusBadgeClass(status) {
    const classes = {
        'draft': 'secondary',
        'finalized': 'info',
        'sent': 'success',
        'cancelled': 'danger',
        'void': 'secondary'
    };
    return classes[status] || 'secondary';
}

function updateUnpaidBadge(invoices) {
    const unpaidCount = invoices.filter(inv =>
        inv.status === 'finalized' && inv.payment_status === 'unpaid'
    ).length;

    const badge = document.getElementById('unpaid-invoices-count');
    if (badge) {
        if (unpaidCount > 0) {
            badge.textContent = unpaidCount;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    }
}

// ============================================
// CREATE INVOICE
// ============================================
async function showCreateInvoice() {
    // Reset current invoice
    currentInvoice = {
        services: [],
        products: [],
        totals: {
            services_subtotal: 0,
            products_subtotal: 0,
            subtotal: 0,
            discount_amount: 0,
            tax_amount: 0,
            total: 0,
            commission: 0
        }
    };

    // Load data
    await Promise.all([
        loadServicesForPicker(),
        loadProductsForPicker(),
        loadStylistsForInvoice(),
        loadCustomersForInvoice()
    ]);

    // Set default date to today
    document.getElementById('invoice-service-date').valueAsDate = new Date();

    // Clear form
    document.getElementById('invoice-form').reset();
    document.getElementById('invoice-services-list').innerHTML = '<p style="text-align: center; color: var(--text-subtle); padding: 20px;">No services added yet</p>';
    document.getElementById('invoice-products-list').innerHTML = '<p style="text-align: center; color: var(--text-subtle); padding: 20px;">No products added yet</p>';

    calculateInvoiceTotals();

    document.getElementById('invoice-modal-title').textContent = 'Create Invoice';
    document.getElementById('invoice-modal').classList.add('active');
}

async function loadServicesForPicker() {
    try {
        const response = await fetch('/api/services/all', {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        const data = await response.json();
        allServices = data.services || [];
    } catch (error) {
        console.error('Error loading services:', error);
    }
}

async function loadProductsForPicker() {
    try {
        const response = await fetch('/api/products', {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        const data = await response.json();
        allProducts = data.products || [];
    } catch (error) {
        console.error('Error loading products:', error);
    }
}

async function loadStylistsForInvoice() {
    try {
        const response = await fetch('/api/admin/staff', {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        const data = await response.json();
        allStylists = data.staff || [];

        // Populate stylist dropdowns
        const stylistSelects = document.querySelectorAll('#invoice-stylist, #invoice-stylist-filter, #commission-stylist');
        stylistSelects.forEach(select => {
            const currentValue = select.value;
            const filterSelect = select.id === 'invoice-stylist-filter' || select.id === 'commission-stylist';

            select.innerHTML = filterSelect ? '<option value="">All Stylists</option>' : '<option value="">Select stylist...</option>';

            allStylists.forEach(stylist => {
                const option = document.createElement('option');
                option.value = stylist.id;
                option.textContent = stylist.name;
                select.appendChild(option);
            });

            if (currentValue) select.value = currentValue;
        });
    } catch (error) {
        console.error('Error loading stylists:', error);
    }
}

async function loadCustomersForInvoice() {
    try {
        const response = await fetch('/api/admin/customers', {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        const data = await response.json();
        allCustomers = data.customers || [];

        const customerSelect = document.getElementById('invoice-customer');
        customerSelect.innerHTML = '<option value="">Select customer...</option>';

        allCustomers.forEach(customer => {
            const option = document.createElement('option');
            option.value = customer.id;
            option.textContent = `${customer.name} (${customer.email})`;
            customerSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading customers:', error);
    }
}

// ============================================
// SERVICE PICKER
// ============================================
function showServicePicker() {
    renderServiceList(allServices);
    document.getElementById('service-picker-modal').classList.add('active');
}

function closeServicePicker() {
    document.getElementById('service-picker-modal').classList.remove('active');
}

function filterServices() {
    const search = document.getElementById('service-search').value.toLowerCase();
    const filtered = allServices.filter(s =>
        s.name.toLowerCase().includes(search) ||
        s.category?.toLowerCase().includes(search)
    );
    renderServiceList(filtered);
}

function renderServiceList(services) {
    const container = document.getElementById('service-list');

    if (services.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-subtle); padding: 20px;">No services found</p>';
        return;
    }

    container.innerHTML = services.map(service => `
        <div class="service-picker-item" onclick="addServiceToInvoice('${service.id}')">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <div style="font-weight: 600;">${service.name}</div>
                    <div style="font-size: 13px; color: var(--text-subtle);">${service.category || 'General'}</div>
                </div>
                <div style="font-weight: 700; color: var(--primary); font-size: 16px;">R${service.price.toFixed(2)}</div>
            </div>
        </div>
    `).join('');
}

function addServiceToInvoice(serviceId) {
    const service = allServices.find(s => s.id === serviceId);
    if (!service) return;

    currentInvoice.services.push({
        service_id: service.id,
        service_name: service.name,
        service_category: service.category || 'General',
        unit_price: service.price,
        quantity: 1,
        discount: 0,
        total: service.price,
        commission_rate: service.commission_rate || null
    });

    renderInvoiceServices();
    calculateInvoiceTotals();
    closeServicePicker();
}

function renderInvoiceServices() {
    const container = document.getElementById('invoice-services-list');

    if (currentInvoice.services.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-subtle); padding: 20px;">No services added yet</p>';
        return;
    }

    container.innerHTML = currentInvoice.services.map((service, index) => `
        <div class="line-item">
            <div class="line-item-info">
                <div class="line-item-name">${service.service_name}</div>
                <div class="line-item-details">${service.service_category} • Qty: ${service.quantity}</div>
            </div>
            <div class="line-item-price">R${service.total.toFixed(2)}</div>
            <button class="line-item-remove" onclick="removeService(${index})">Remove</button>
        </div>
    `).join('');
}

function removeService(index) {
    currentInvoice.services.splice(index, 1);
    renderInvoiceServices();
    calculateInvoiceTotals();
}

// ============================================
// PRODUCT PICKER
// ============================================
function showProductPicker() {
    renderProductList(allProducts);
    document.getElementById('product-picker-modal').classList.add('active');
}

function closeProductPicker() {
    document.getElementById('product-picker-modal').classList.remove('active');
}

function filterProducts() {
    const search = document.getElementById('product-search').value.toLowerCase();
    const filtered = allProducts.filter(p =>
        p.name.toLowerCase().includes(search) ||
        p.category?.toLowerCase().includes(search)
    );
    renderProductList(filtered);
}

function renderProductList(products) {
    const container = document.getElementById('product-list');

    if (products.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-subtle); padding: 20px;">No products found</p>';
        return;
    }

    container.innerHTML = products.map(product => `
        <div class="product-picker-item" onclick="showProductQuantityModal('${product.id}')">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="flex: 1;">
                    <div style="font-weight: 600;">${product.name}</div>
                    <div style="font-size: 13px; color: var(--text-subtle);">
                        ${product.category || 'General'}
                        ${product.stock > 0 ? `• Stock: ${product.stock}` : '• <span style="color: var(--danger);">Out of stock</span>'}
                    </div>
                </div>
                <div style="font-weight: 700; color: var(--primary); font-size: 16px;">R${product.price.toFixed(2)}</div>
            </div>
        </div>
    `).join('');
}

function showProductQuantityModal(productId) {
    const product = allProducts.find(p => p.id === productId);
    if (!product) return;

    const quantity = prompt(`How many units of "${product.name}"?`, '1');
    if (!quantity || isNaN(quantity) || parseFloat(quantity) <= 0) return;

    const qty = parseFloat(quantity);
    const productType = confirm('Is this a retail product (customer takes home)?\nClick OK for Retail, Cancel for Service Product (used during treatment)') ? 'retail' : 'service_product';

    addProductToInvoice(product, qty, productType);
}

function addProductToInvoice(product, quantity, productType) {
    const total = product.price * quantity;

    currentInvoice.products.push({
        product_id: product.id,
        product_name: product.name,
        product_category: product.category || 'General',
        product_type: productType,
        unit_price: product.price,
        quantity: quantity,
        discount: 0,
        total: total,
        commission_rate: product.commission_rate || null
    });

    renderInvoiceProducts();
    calculateInvoiceTotals();
    closeProductPicker();
}

function renderInvoiceProducts() {
    const container = document.getElementById('invoice-products-list');

    if (currentInvoice.products.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-subtle); padding: 20px;">No products added yet</p>';
        return;
    }

    container.innerHTML = currentInvoice.products.map((product, index) => `
        <div class="line-item">
            <div class="line-item-info">
                <div class="line-item-name">${product.product_name}</div>
                <div class="line-item-details">
                    ${product.product_category} •
                    Qty: ${product.quantity} •
                    ${product.product_type === 'retail' ? '🛍️ Retail' : '🎨 Service Product'}
                </div>
            </div>
            <div class="line-item-price">R${product.total.toFixed(2)}</div>
            <button class="line-item-remove" onclick="removeProduct(${index})">Remove</button>
        </div>
    `).join('');
}

function removeProduct(index) {
    currentInvoice.products.splice(index, 1);
    renderInvoiceProducts();
    calculateInvoiceTotals();
}

// ============================================
// CALCULATE TOTALS
// ============================================
function calculateInvoiceTotals() {
    // Services subtotal
    const services_subtotal = currentInvoice.services.reduce((sum, s) => sum + s.total, 0);

    // Products subtotal
    const products_subtotal = currentInvoice.products.reduce((sum, p) => sum + p.total, 0);

    // Subtotal
    const subtotal = services_subtotal + products_subtotal;

    // Discount
    const discountType = document.getElementById('invoice-discount-type')?.value || '';
    const discountValue = parseFloat(document.getElementById('invoice-discount-value')?.value) || 0;

    let discount_amount = 0;
    if (discountType === 'percentage') {
        discount_amount = subtotal * (discountValue / 100);
    } else if (discountType === 'fixed') {
        discount_amount = discountValue;
    } else if (discountType === 'loyalty_points') {
        discount_amount = discountValue / 10; // 100 points = R10
    }

    // Tax (15% VAT on subtotal - discount)
    const taxable = subtotal - discount_amount;
    const tax_amount = taxable * 0.15;

    // Total
    const total = taxable + tax_amount;

    // Commission (simplified - would use actual rates in production)
    const commission = subtotal * 0.30; // Approximate 30%

    // Update display
    document.getElementById('invoice-services-subtotal').textContent = `R${services_subtotal.toFixed(2)}`;
    document.getElementById('invoice-products-subtotal').textContent = `R${products_subtotal.toFixed(2)}`;
    document.getElementById('invoice-subtotal').textContent = `R${subtotal.toFixed(2)}`;
    document.getElementById('invoice-discount-amount').textContent = `-R${discount_amount.toFixed(2)}`;
    document.getElementById('invoice-tax-amount').textContent = `R${tax_amount.toFixed(2)}`;
    document.getElementById('invoice-total').textContent = `R${total.toFixed(2)}`;
    document.getElementById('invoice-commission').textContent = `R${commission.toFixed(2)}`;

    // Store in current invoice
    currentInvoice.totals = {
        services_subtotal,
        products_subtotal,
        subtotal,
        discount_amount,
        tax_amount,
        total,
        commission
    };
}

// ============================================
// SAVE INVOICE
// ============================================
async function saveInvoiceAsDraft() {
    await saveInvoice(false);
}

document.getElementById('invoice-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveInvoice(true);
});

async function saveInvoice(finalize = false) {
    try {
        const customerId = document.getElementById('invoice-customer').value;
        const stylistId = document.getElementById('invoice-stylist').value;
        const serviceDate = document.getElementById('invoice-service-date').value;
        const bookingId = document.getElementById('invoice-booking').value || null;

        if (!customerId || !stylistId || !serviceDate) {
            showError('Please fill in all required fields');
            return;
        }

        if (currentInvoice.services.length === 0 && currentInvoice.products.length === 0) {
            showError('Please add at least one service or product');
            return;
        }

        const discountType = document.getElementById('invoice-discount-type').value || null;
        const discountValue = parseFloat(document.getElementById('invoice-discount-value').value) || 0;
        const discountReason = document.getElementById('invoice-discount-reason').value || null;
        const clientNotes = document.getElementById('invoice-client-notes').value || null;
        const internalNotes = document.getElementById('invoice-internal-notes').value || null;

        const invoiceData = {
            booking_id: bookingId,
            user_id: customerId,
            stylist_id: stylistId,
            service_date: serviceDate,
            services: currentInvoice.services,
            products: currentInvoice.products,
            discount_type: discountType,
            discount_value: discountValue,
            discount_reason: discountReason,
            client_notes: clientNotes,
            internal_notes: internalNotes
        };

        // Create invoice
        const response = await fetch('/api/admin/invoices', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getToken()}`
            },
            body: JSON.stringify(invoiceData)
        });

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Failed to create invoice');
        }

        // If finalize is requested, finalize the invoice
        if (finalize) {
            const finalizeResponse = await fetch(`/api/admin/invoices/${data.invoice.id}/finalize`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${getToken()}`
                }
            });

            const finalizeData = await finalizeResponse.json();

            if (!finalizeData.success) {
                throw new Error(finalizeData.error || 'Failed to finalize invoice');
            }

            showSuccess(`Invoice ${finalizeData.invoice.invoice_number} created and finalized!`);
        } else {
            showSuccess('Invoice saved as draft');
        }

        closeInvoiceModal();
        loadInvoices();

    } catch (error) {
        console.error('Error saving invoice:', error);
        showError(error.message || 'Failed to save invoice');
    }
}

function closeInvoiceModal() {
    document.getElementById('invoice-modal').classList.remove('active');
}

// ============================================
// PAYMENT MODAL
// ============================================
async function showPaymentModal(invoiceId) {
    try {
        const response = await fetch(`/api/admin/invoices/${invoiceId}`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });

        const data = await response.json();

        if (!data.success) {
            throw new Error('Invoice not found');
        }

        currentPaymentInvoice = data.invoice;

        document.getElementById('payment-invoice-info').textContent = `${currentPaymentInvoice.invoice_number} - ${currentPaymentInvoice.customer.name}`;
        document.getElementById('payment-amount-due').textContent = `R${currentPaymentInvoice.amount_due.toFixed(2)}`;
        document.getElementById('payment-amount').value = currentPaymentInvoice.amount_due.toFixed(2);

        document.getElementById('payment-modal').classList.add('active');
    } catch (error) {
        console.error('Error loading invoice:', error);
        showError('Failed to load invoice');
    }
}

function closePaymentModal() {
    document.getElementById('payment-modal').classList.remove('active');
    currentPaymentInvoice = null;
}

async function recordPayment(e) {
    e.preventDefault();

    if (!currentPaymentInvoice) return;

    try {
        const amount = parseFloat(document.getElementById('payment-amount').value);
        const paymentMethod = document.getElementById('payment-method').value;
        const reference = document.getElementById('payment-reference').value || null;
        const notes = document.getElementById('payment-notes').value || null;

        const response = await fetch(`/api/admin/invoices/${currentPaymentInvoice.id}/payments`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getToken()}`
            },
            body: JSON.stringify({
                amount,
                payment_method: paymentMethod,
                payment_reference: reference,
                notes
            })
        });

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Failed to record payment');
        }

        showSuccess('Payment recorded successfully!');
        closePaymentModal();
        loadInvoices();

    } catch (error) {
        console.error('Error recording payment:', error);
        showError(error.message || 'Failed to record payment');
    }
}

// ============================================
// COMMISSION REPORTS
// ============================================
async function loadCommissionReport() {
    const stylistId = document.getElementById('commission-stylist').value;
    const startDate = document.getElementById('commission-start-date').value;
    const endDate = document.getElementById('commission-end-date').value;

    if (!stylistId || !startDate || !endDate) {
        showError('Please select stylist and date range');
        return;
    }

    try {
        const response = await fetch(
            `/api/admin/commissions?stylist_id=${stylistId}&start_date=${startDate}&end_date=${endDate}`,
            { headers: { 'Authorization': `Bearer ${getToken()}` } }
        );

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Failed to load report');
        }

        renderCommissionReport(data.summary, data.commissions);

    } catch (error) {
        console.error('Error loading commission report:', error);
        showError(error.message || 'Failed to load report');
    }
}

function renderCommissionReport(summary, commissions) {
    // Show summary
    document.getElementById('comm-invoices-count').textContent = summary.total_invoices;
    document.getElementById('comm-total-sales').textContent = `R${summary.total_sales.toFixed(2)}`;
    document.getElementById('comm-total-commission').textContent = `R${summary.total_commission.toFixed(2)}`;

    document.getElementById('commission-summary').style.display = 'block';
    document.getElementById('commission-detail').style.display = 'block';

    // Render commission list
    const container = document.getElementById('commission-list-container');

    if (commissions.length === 0) {
        container.innerHTML = '<p style="text-align: center; padding: 20px; color: var(--text-subtle);">No commissions found for this period</p>';
        return;
    }

    const html = `
        <table class="data-table">
            <thead>
                <tr>
                    <th><input type="checkbox" onchange="toggleAllCommissions(this)"></th>
                    <th>Invoice</th>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>Total</th>
                    <th>Services Comm.</th>
                    <th>Products Comm.</th>
                    <th>Total Comm.</th>
                    <th>Status</th>
                </tr>
            </thead>
            <tbody>
                ${commissions.map(comm => `
                    <tr>
                        <td>
                            <input type="checkbox" class="commission-checkbox" value="${comm.invoice_id}"
                                ${comm.payment_status === 'paid' ? 'disabled' : ''}>
                        </td>
                        <td><strong>${comm.invoice_number}</strong></td>
                        <td>${formatDate(comm.service_date)}</td>
                        <td>${comm.customer_name}</td>
                        <td>R${comm.invoice_total.toFixed(2)}</td>
                        <td>R${comm.services_commission.toFixed(2)}</td>
                        <td>R${comm.products_commission.toFixed(2)}</td>
                        <td><strong>R${comm.total_commission.toFixed(2)}</strong></td>
                        <td>
                            <span class="badge badge-${comm.payment_status === 'paid' ? 'success' : 'warning'}">
                                ${comm.payment_status.toUpperCase()}
                            </span>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    container.innerHTML = html;
}

function toggleAllCommissions(checkbox) {
    document.querySelectorAll('.commission-checkbox:not(:disabled)').forEach(cb => {
        cb.checked = checkbox.checked;
    });
}

async function markCommissionsAsPaid() {
    const selected = Array.from(document.querySelectorAll('.commission-checkbox:checked')).map(cb => cb.value);

    if (selected.length === 0) {
        showError('Please select commissions to mark as paid');
        return;
    }

    if (!confirm(`Mark ${selected.length} commission(s) as paid?`)) return;

    try {
        const reference = prompt('Enter payroll reference:', `PAYROLL-${new Date().toISOString().slice(0, 7)}`);
        if (!reference) return;

        const response = await fetch('/api/admin/commissions/mark-paid', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getToken()}`
            },
            body: JSON.stringify({
                invoice_ids: selected,
                payment_reference: reference,
                payment_date: new Date().toISOString()
            })
        });

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Failed to mark commissions as paid');
        }

        showSuccess(`${selected.length} commission(s) marked as paid!`);
        loadCommissionReport();

    } catch (error) {
        console.error('Error marking commissions as paid:', error);
        showError(error.message || 'Failed to mark commissions as paid');
    }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================
function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-ZA');
}

function getToken() {
    return localStorage.getItem('token');
}

function showSuccess(message) {
    // Use existing notification system
    if (typeof showNotification === 'function') {
        showNotification(message, 'success');
    } else {
        alert(message);
    }
}

function showError(message) {
    // Use existing notification system
    if (typeof showNotification === 'function') {
        showNotification(message, 'error');
    } else {
        alert(message);
    }
}

// Initialize when section is shown
function initInvoiceSection() {
    loadInvoices();
    loadStylistsForInvoice();

    // Set default commission dates to this month
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    if (document.getElementById('commission-start-date')) {
        document.getElementById('commission-start-date').valueAsDate = firstDay;
    }
    if (document.getElementById('commission-end-date')) {
        document.getElementById('commission-end-date').valueAsDate = lastDay;
    }
}

// Hook into section switching
const originalShowSection = window.showSection;
window.showSection = function(sectionId, event) {
    originalShowSection(sectionId, event);
    if (sectionId === 'invoices') {
        initInvoiceSection();
    }
};
