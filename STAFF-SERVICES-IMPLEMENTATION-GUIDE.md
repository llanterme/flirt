# Staff Services Implementation Guide

## Overview
This guide covers implementing staff-specific service offerings with custom pricing. Staff members can select which services they offer and set their own prices.

## Database Schema
✅ **COMPLETED** - `staff_services` table created with:
- `id` (TEXT PRIMARY KEY)
- `staff_id` (TEXT, FK to stylists)
- `service_id` (TEXT, FK to services)
- `custom_price` (REAL, nullable - overrides service default)
- `custom_duration` (INTEGER, nullable - overrides service default)
- `active` (INTEGER, 0 or 1)
- `created_at`, `updated_at` (TEXT)

## Data Import
✅ **COMPLETED** - 65 beauty services imported from menu

## Remaining Implementation

### 1. Backend API Endpoints (server.js)

Add these endpoints after the existing `/api/admin/services` endpoints:

```javascript
// ========== STAFF SERVICES MANAGEMENT ==========

// Get all services offered by a specific staff member
app.get('/api/admin/staff/:staffId/services', authenticateAdmin, async (req, res) => {
    try {
        const { staffId } = req.params;

        const staffServices = await db.dbAll(`
            SELECT
                ss.*,
                s.name as service_name,
                s.price as default_price,
                s.duration as default_duration,
                s.category,
                s.service_type
            FROM staff_services ss
            JOIN services s ON ss.service_id = s.id
            WHERE ss.staff_id = ?
            ORDER BY s.category, s.name
        `, [staffId]);

        res.json({ success: true, services: staffServices });
    } catch (error) {
        console.error('Error fetching staff services:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch staff services' });
    }
});

// Add a service to a staff member's offerings
app.post('/api/admin/staff/:staffId/services', authenticateAdmin, async (req, res) => {
    try {
        const { staffId } = req.params;
        const { serviceId, customPrice, customDuration } = req.body;

        if (!serviceId) {
            return res.status(400).json({ success: false, message: 'Service ID is required' });
        }

        // Check if already exists
        const existing = await db.dbGet(
            'SELECT id FROM staff_services WHERE staff_id = ? AND service_id = ?',
            [staffId, serviceId]
        );

        if (existing) {
            return res.status(400).json({ success: false, message: 'Service already added to this staff member' });
        }

        const id = require('uuid').v4();
        await db.dbRun(`
            INSERT INTO staff_services (id, staff_id, service_id, custom_price, custom_duration, active)
            VALUES (?, ?, ?, ?, ?, 1)
        `, [id, staffId, serviceId, customPrice || null, customDuration || null]);

        res.json({ success: true, message: 'Service added to staff member' });
    } catch (error) {
        console.error('Error adding staff service:', error);
        res.status(500).json({ success: false, message: 'Failed to add service' });
    }
});

// Update a staff member's service (custom pricing/duration)
app.put('/api/admin/staff/:staffId/services/:serviceId', authenticateAdmin, async (req, res) => {
    try {
        const { staffId, serviceId } = req.params;
        const { customPrice, customDuration, active } = req.body;

        await db.dbRun(`
            UPDATE staff_services
            SET custom_price = ?,
                custom_duration = ?,
                active = ?,
                updated_at = datetime('now')
            WHERE staff_id = ? AND service_id = ?
        `, [customPrice || null, customDuration || null, active !== undefined ? active : 1, staffId, serviceId]);

        res.json({ success: true, message: 'Staff service updated' });
    } catch (error) {
        console.error('Error updating staff service:', error);
        res.status(500).json({ success: false, message: 'Failed to update service' });
    }
});

// Remove a service from a staff member
app.delete('/api/admin/staff/:staffId/services/:serviceId', authenticateAdmin, async (req, res) => {
    try {
        const { staffId, serviceId } = req.params;

        await db.dbRun(
            'DELETE FROM staff_services WHERE staff_id = ? AND service_id = ?',
            [staffId, serviceId]
        );

        res.json({ success: true, message: 'Service removed from staff member' });
    } catch (error) {
        console.error('Error removing staff service:', error);
        res.status(500).json({ success: false, message: 'Failed to remove service' });
    }
});

// Get services for a specific stylist (client-facing, filtered by active and type)
app.get('/api/stylists/:stylistId/services', async (req, res) => {
    try {
        const { stylistId } = req.params;
        const { type } = req.query; // optional filter by service_type

        let query = `
            SELECT
                s.id,
                s.name,
                s.description,
                s.category,
                s.service_type,
                s.image_url,
                COALESCE(ss.custom_price, s.price) as price,
                COALESCE(ss.custom_duration, s.duration) as duration,
                ss.active as staff_service_active
            FROM staff_services ss
            JOIN services s ON ss.service_id = s.id
            WHERE ss.staff_id = ?
              AND ss.active = 1
              AND s.active = 1
        `;

        const params = [stylistId];

        if (type) {
            query += ' AND s.service_type = ?';
            params.push(type);
        }

        query += ' ORDER BY s.category, s.name';

        const services = await db.dbAll(query, params);

        res.json({ success: true, services });
    } catch (error) {
        console.error('Error fetching stylist services:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch services' });
    }
});
```

### 2. Admin Console UI Updates

#### A. Update Staff Modal (flirt-admin-console.html)

Find the staff modal and add a new tab for "Services":

```html
<!-- Add after existing staff form fields, before the save button -->
<div class="form-group">
    <label>Services Offered</label>
    <button type="button" class="btn btn-outline" onclick="openStaffServicesModal(editingStaffId)" style="width: 100%;">
        Manage Services & Pricing
    </button>
</div>
```

#### B. Add Staff Services Modal

Add this modal after the existing staff modal:

```html
<!-- Staff Services Management Modal -->
<div id="staffServicesModal" class="modal" style="display: none;">
    <div class="modal-content" style="max-width: 900px;">
        <div class="modal-header">
            <h3 id="staffServicesModalTitle">Manage Staff Services</h3>
            <span class="modal-close" onclick="closeStaffServicesModal()">&times;</span>
        </div>
        <div class="modal-body">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                <!-- Available Services -->
                <div>
                    <h4>Available Services</h4>
                    <input type="text" id="serviceSearchFilter" placeholder="Search services..."
                           class="form-control" style="margin-bottom: 10px;" onkeyup="filterAvailableServices()">
                    <select id="serviceCategoryFilter" class="form-control" style="margin-bottom: 10px;" onchange="filterAvailableServices()">
                        <option value="">All Categories</option>
                    </select>
                    <div id="availableServicesList" style="max-height: 500px; overflow-y: auto; border: 1px solid var(--border-soft); border-radius: 4px; padding: 10px;">
                        <!-- Populated dynamically -->
                    </div>
                </div>

                <!-- Staff's Services -->
                <div>
                    <h4>Staff's Services</h4>
                    <div id="staffServicesList" style="max-height: 580px; overflow-y: auto;">
                        <!-- Populated dynamically -->
                    </div>
                </div>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeStaffServicesModal()">Done</button>
        </div>
    </div>
</div>
```

#### C. Add JavaScript Functions

Add these functions in the admin console `<script>` section:

```javascript
let currentStaffIdForServices = null;
let allAvailableServices = [];
let staffCurrentServices = [];

// Open staff services management modal
async function openStaffServicesModal(staffId) {
    if (!staffId) {
        showAdminToast('Please save the staff member first', 'error');
        return;
    }

    currentStaffIdForServices = staffId;
    document.getElementById('staffServicesModal').style.display = 'flex';

    // Load all available services and staff's current services
    await Promise.all([
        loadAllAvailableServices(),
        loadStaffServices(staffId)
    ]);

    renderAvailableServices();
    renderStaffServices();
}

function closeStaffServicesModal() {
    document.getElementById('staffServicesModal').style.display = 'none';
    currentStaffIdForServices = null;
}

// Load all available services
async function loadAllAvailableServices() {
    try {
        const data = await apiCall('/admin/services');
        allAvailableServices = data.services || [];

        // Populate category filter
        const categories = [...new Set(allAvailableServices.map(s => s.category))].sort();
        const filterSelect = document.getElementById('serviceCategoryFilter');
        filterSelect.innerHTML = '<option value="">All Categories</option>' +
            categories.map(cat => `<option value="${cat}">${cat}</option>`).join('');
    } catch (error) {
        console.error('Error loading services:', error);
    }
}

// Load staff's current services
async function loadStaffServices(staffId) {
    try {
        const data = await apiCall(`/admin/staff/${staffId}/services`);
        staffCurrentServices = data.services || [];
    } catch (error) {
        console.error('Error loading staff services:', error);
    }
}

// Filter available services
function filterAvailableServices() {
    renderAvailableServices();
}

// Render available services list
function renderAvailableServices() {
    const searchTerm = document.getElementById('serviceSearchFilter').value.toLowerCase();
    const categoryFilter = document.getElementById('serviceCategoryFilter').value;

    // Filter out services already added to staff
    const staffServiceIds = staffCurrentServices.map(s => s.service_id);
    let filtered = allAvailableServices.filter(s => !staffServiceIds.includes(s.id));

    if (searchTerm) {
        filtered = filtered.filter(s =>
            s.name.toLowerCase().includes(searchTerm) ||
            (s.category && s.category.toLowerCase().includes(searchTerm))
        );
    }

    if (categoryFilter) {
        filtered = filtered.filter(s => s.category === categoryFilter);
    }

    const container = document.getElementById('availableServicesList');

    if (filtered.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-subtle);">No services available</div>';
        return;
    }

    container.innerHTML = filtered.map(service => `
        <div style="padding: 10px; border-bottom: 1px solid var(--border-soft); display: flex; justify-content: space-between; align-items: center;">
            <div>
                <strong>${service.name}</strong><br>
                <small style="color: var(--text-subtle);">${service.category} - R${service.price} - ${service.duration}min</small>
            </div>
            <button class="btn btn-sm btn-primary" onclick="addServiceToStaff('${service.id}')">Add</button>
        </div>
    `).join('');
}

// Render staff's services
function renderStaffServices() {
    const container = document.getElementById('staffServicesList');

    if (staffCurrentServices.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-subtle);">No services added yet</div>';
        return;
    }

    container.innerHTML = staffCurrentServices.map(ss => `
        <div class="card" style="margin-bottom: 10px; padding: 15px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
                <div>
                    <strong>${ss.service_name}</strong><br>
                    <small style="color: var(--text-subtle);">${ss.category}</small>
                </div>
                <button class="btn btn-sm btn-outline" onclick="removeServiceFromStaff('${ss.service_id}')"
                        style="color: var(--danger);">Remove</button>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                <div class="form-group" style="margin: 0;">
                    <label style="font-size: 12px;">Custom Price (R)</label>
                    <input type="number" class="form-control"
                           value="${ss.custom_price || ss.default_price}"
                           placeholder="${ss.default_price}"
                           onchange="updateStaffServicePrice('${ss.service_id}', this.value)"
                           step="0.01" min="0">
                    <small style="color: var(--text-subtle);">Default: R${ss.default_price}</small>
                </div>

                <div class="form-group" style="margin: 0;">
                    <label style="font-size: 12px;">Custom Duration (min)</label>
                    <input type="number" class="form-control"
                           value="${ss.custom_duration || ss.default_duration}"
                           placeholder="${ss.default_duration}"
                           onchange="updateStaffServiceDuration('${ss.service_id}', this.value)"
                           step="15" min="0">
                    <small style="color: var(--text-subtle);">Default: ${ss.default_duration}min</small>
                </div>
            </div>
        </div>
    `).join('');
}

// Add service to staff
async function addServiceToStaff(serviceId) {
    try {
        await apiCall(`/admin/staff/${currentStaffIdForServices}/services`, {
            method: 'POST',
            body: JSON.stringify({ serviceId })
        });

        showAdminToast('Service added successfully', 'success');
        await loadStaffServices(currentStaffIdForServices);
        renderAvailableServices();
        renderStaffServices();
    } catch (error) {
        console.error('Error adding service:', error);
        showAdminToast(error.message || 'Failed to add service', 'error');
    }
}

// Remove service from staff
async function removeServiceFromStaff(serviceId) {
    const proceed = await openConfirmDialog({
        title: 'Remove Service?',
        message: 'This will remove this service from the staff member\'s offerings.',
        confirmText: 'Remove',
        tone: 'danger'
    });

    if (!proceed) return;

    try {
        await apiCall(`/admin/staff/${currentStaffIdForServices}/services/${serviceId}`, {
            method: 'DELETE'
        });

        showAdminToast('Service removed successfully', 'success');
        await loadStaffServices(currentStaffIdForServices);
        renderAvailableServices();
        renderStaffServices();
    } catch (error) {
        console.error('Error removing service:', error);
        showAdminToast(error.message || 'Failed to remove service', 'error');
    }
}

// Update staff service custom price
async function updateStaffServicePrice(serviceId, price) {
    try {
        const customPrice = price ? parseFloat(price) : null;
        await apiCall(`/admin/staff/${currentStaffIdForServices}/services/${serviceId}`, {
            method: 'PUT',
            body: JSON.stringify({ customPrice })
        });

        showAdminToast('Price updated', 'success');
        await loadStaffServices(currentStaffIdForServices);
    } catch (error) {
        console.error('Error updating price:', error);
        showAdminToast('Failed to update price', 'error');
    }
}

// Update staff service custom duration
async function updateStaffServiceDuration(serviceId, duration) {
    try {
        const customDuration = duration ? parseInt(duration) : null;
        await apiCall(`/admin/staff/${currentStaffIdForServices}/services/${serviceId}`, {
            method: 'PUT',
            body: JSON.stringify({ customDuration })
        });

        showAdminToast('Duration updated', 'success');
        await loadStaffServices(currentStaffIdForServices);
    } catch (error) {
        console.error('Error updating duration:', error);
        showAdminToast('Failed to update duration', 'error');
    }
}
```

### 3. Client Booking Flow Updates

Update the booking flow in `flirt-hair-app.html` to load services from the selected stylist:

```javascript
// When a stylist is selected, load their services
async function loadStylistServices(stylistId, serviceType) {
    try {
        const response = await fetch(`/api/stylists/${stylistId}/services?type=${serviceType}`);
        const data = await response.json();

        if (data.success) {
            // Render services specific to this stylist
            renderServices(data.services);
        }
    } catch (error) {
        console.error('Error loading stylist services:', error);
    }
}
```

## Testing Checklist

- [ ] Create staff member in admin
- [ ] Open "Manage Services" for that staff member
- [ ] Add multiple services with custom pricing
- [ ] Verify services appear in staff's list
- [ ] Update custom price and duration
- [ ] Remove a service
- [ ] View stylist services from client booking flow
- [ ] Verify custom prices show correctly
- [ ] Book appointment with custom-priced service

## Notes

- Custom prices override default service prices
- If custom_price is NULL, default service price is used
- Same logic applies to custom_duration
- Services can be inactive for a specific staff member while remaining active globally
- Client booking flow filters services by stylist and shows only active services
