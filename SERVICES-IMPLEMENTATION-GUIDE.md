# Services Management Implementation Guide

This document provides complete instructions for finishing the dynamic services implementation.

## ✅ Already Completed

1. **Database Migration** - Added `image_url` column and removed service_type constraints
2. **Backend API** - Full CRUD endpoints for admin service management
3. **Seed Data** - 6 services already in database with images

## 📋 Remaining Implementation

### Part 1: Admin Console - Add Services Management UI

#### Step 1.1: Add Navigation Menu Item

In `flirt-admin-console.html`, add this nav item after the "Staff" item (around line 1221):

```html
<a class="nav-item" onclick="showSection('services')">
    <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
    </svg>
    Services
</a>
```

#### Step 1.2: Add Services Section HTML

Find the closing `</div>` for the chat section (around line 5500+) and add before it:

```html
<!-- Services Section -->
<div id="servicesSection" class="admin-section" style="display: none;">
    <div class="section-header">
        <h2>Service Management</h2>
        <button class="btn btn-primary" onclick="openServiceModal()">
            <span style="margin-right: 5px;">+</span> Add New Service
        </button>
    </div>

    <!-- Filters -->
    <div class="card" style="margin-bottom: 20px;">
        <div style="display: flex; gap: 15px; align-items: center;">
            <div style="flex: 1;">
                <input type="text" id="serviceSearchInput" placeholder="Search services..."
                       onkeyup="filterServices()" class="form-control">
            </div>
            <div>
                <select id="serviceTypeFilter" onchange="filterServices()" class="form-control">
                    <option value="">All Types</option>
                </select>
            </div>
            <div>
                <select id="serviceActiveFilter" onchange="filterServices()" class="form-control">
                    <option value="">All Status</option>
                    <option value="1">Active</option>
                    <option value="0">Inactive</option>
                </select>
            </div>
        </div>
    </div>

    <!-- Services Table -->
    <div class="card">
        <table class="data-table">
            <thead>
                <tr>
                    <th>Image</th>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Category</th>
                    <th>Price</th>
                    <th>Duration</th>
                    <th>Status</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody id="servicesTableBody">
                <tr>
                    <td colspan="8" style="text-align: center; padding: 40px;">
                        Loading services...
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
</div>

<!-- Service Modal -->
<div id="serviceModal" class="modal" style="display: none;">
    <div class="modal-content" style="max-width: 600px;">
        <div class="modal-header">
            <h3 id="serviceModalTitle">Add New Service</h3>
            <span class="modal-close" onclick="closeServiceModal()">&times;</span>
        </div>
        <div class="modal-body">
            <form id="serviceForm" onsubmit="saveService(event)">
                <input type="hidden" id="serviceId">

                <div class="form-group">
                    <label>Service Name *</label>
                    <input type="text" id="serviceName" class="form-control" required>
                </div>

                <div class="form-group">
                    <label>Description</label>
                    <textarea id="serviceDescription" class="form-control" rows="3"></textarea>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                    <div class="form-group">
                        <label>Service Type *</label>
                        <input type="text" id="serviceType" class="form-control" required
                               placeholder="e.g., hair, beauty, spa">
                        <small style="color: var(--gray-medium);">Can be any custom type</small>
                    </div>

                    <div class="form-group">
                        <label>Category</label>
                        <input type="text" id="serviceCategory" class="form-control"
                               placeholder="e.g., Extensions, Nails">
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                    <div class="form-group">
                        <label>Price (R) *</label>
                        <input type="number" id="servicePrice" class="form-control" required min="0" step="0.01">
                    </div>

                    <div class="form-group">
                        <label>Duration (minutes)</label>
                        <input type="number" id="serviceDuration" class="form-control" min="0" step="15">
                    </div>
                </div>

                <div class="form-group">
                    <label>Image URL</label>
                    <input type="url" id="serviceImageUrl" class="form-control"
                           placeholder="https://example.com/image.jpg">
                    <small style="color: var(--gray-medium);">URL to service image</small>
                </div>

                <div class="form-group">
                    <label style="display: flex; align-items: center; gap: 10px;">
                        <input type="checkbox" id="serviceActive" checked>
                        <span>Active (visible to customers)</span>
                    </label>
                </div>

                <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
                    <button type="button" class="btn btn-secondary" onclick="closeServiceModal()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Save Service</button>
                </div>
            </form>
        </div>
    </div>
</div>
```

#### Step 1.3: Add JavaScript Functions

Add these functions to the `<script>` section (around line 6000+):

```javascript
// ============================================
// SERVICES MANAGEMENT
// ============================================

let allServices = [];
let currentService = null;

async function loadServices() {
    try {
        const response = await fetch('/api/admin/services', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('adminToken')}` }
        });
        const data = await response.json();

        if (data.success) {
            allServices = data.services;

            // Populate type filter
            const types = [...new Set(allServices.map(s => s.service_type))].sort();
            const typeFilter = document.getElementById('serviceTypeFilter');
            typeFilter.innerHTML = '<option value="">All Types</option>' +
                types.map(type => `<option value="${type}">${type.charAt(0).toUpperCase() + type.slice(1)}</option>`).join('');

            filterServices();
        } else {
            showNotification('Failed to load services', 'error');
        }
    } catch (error) {
        console.error('Error loading services:', error);
        showNotification('Error loading services', 'error');
    }
}

function filterServices() {
    const searchTerm = document.getElementById('serviceSearchInput').value.toLowerCase();
    const typeFilter = document.getElementById('serviceTypeFilter').value;
    const activeFilter = document.getElementById('serviceActiveFilter').value;

    let filtered = allServices.filter(service => {
        const matchesSearch = service.name.toLowerCase().includes(searchTerm) ||
                            (service.description && service.description.toLowerCase().includes(searchTerm));
        const matchesType = !typeFilter || service.service_type === typeFilter;
        const matchesActive = !activeFilter || service.active == activeFilter;

        return matchesSearch && matchesType && matchesActive;
    });

    renderServicesTable(filtered);
}

function renderServicesTable(services) {
    const tbody = document.getElementById('servicesTableBody');

    if (services.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; padding: 40px; color: var(--gray-medium);">
                    No services found
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = services.map(service => `
        <tr>
            <td>
                ${service.image_url ?
                    `<img src="${service.image_url}" alt="${service.name}"
                         style="width: 60px; height: 45px; object-fit: cover; border-radius: 4px;">` :
                    `<div style="width: 60px; height: 45px; background: var(--gray-light); border-radius: 4px; display: flex; align-items: center; justify-content: center; color: var(--gray-medium); font-size: 20px;">📷</div>`
                }
            </td>
            <td>
                <div style="font-weight: 500;">${service.name}</div>
                ${service.description ? `<div style="font-size: 12px; color: var(--gray-medium); margin-top: 2px;">${service.description.substring(0, 50)}${service.description.length > 50 ? '...' : ''}</div>` : ''}
            </td>
            <td>
                <span class="badge" style="background: var(--pink-light); color: var(--pink);">
                    ${service.service_type}
                </span>
            </td>
            <td>${service.category || '-'}</td>
            <td>R${service.price.toFixed(2)}</td>
            <td>${service.duration ? service.duration + ' min' : '-'}</td>
            <td>
                <span class="badge ${service.active ? 'badge-success' : 'badge-secondary'}">
                    ${service.active ? 'Active' : 'Inactive'}
                </span>
            </td>
            <td>
                <div style="display: flex; gap: 5px;">
                    <button class="btn btn-small btn-outline" onclick="editService('${service.id}')" title="Edit">
                        ✏️
                    </button>
                    <button class="btn btn-small ${service.active ? 'btn-secondary' : 'btn-primary'}"
                            onclick="toggleServiceStatus('${service.id}')" title="${service.active ? 'Deactivate' : 'Activate'}">
                        ${service.active ? '⏸️' : '▶️'}
                    </button>
                    <button class="btn btn-small btn-danger" onclick="deleteService('${service.id}')" title="Delete">
                        🗑️
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

function openServiceModal(serviceId = null) {
    currentService = serviceId;
    const modal = document.getElementById('serviceModal');
    const title = document.getElementById('serviceModalTitle');
    const form = document.getElementById('serviceForm');

    form.reset();
    document.getElementById('serviceActive').checked = true;

    if (serviceId) {
        title.textContent = 'Edit Service';
        const service = allServices.find(s => s.id === serviceId);
        if (service) {
            document.getElementById('serviceId').value = service.id;
            document.getElementById('serviceName').value = service.name;
            document.getElementById('serviceDescription').value = service.description || '';
            document.getElementById('serviceType').value = service.service_type;
            document.getElementById('serviceCategory').value = service.category || '';
            document.getElementById('servicePrice').value = service.price;
            document.getElementById('serviceDuration').value = service.duration || '';
            document.getElementById('serviceImageUrl').value = service.image_url || '';
            document.getElementById('serviceActive').checked = service.active == 1;
        }
    } else {
        title.textContent = 'Add New Service';
        document.getElementById('serviceId').value = '';
    }

    modal.style.display = 'flex';
}

function closeServiceModal() {
    document.getElementById('serviceModal').style.display = 'none';
    currentService = null;
}

async function saveService(event) {
    event.preventDefault();

    const serviceId = document.getElementById('serviceId').value;
    const serviceData = {
        name: document.getElementById('serviceName').value.trim(),
        description: document.getElementById('serviceDescription').value.trim() || null,
        service_type: document.getElementById('serviceType').value.trim().toLowerCase(),
        category: document.getElementById('serviceCategory').value.trim() || null,
        price: parseFloat(document.getElementById('servicePrice').value),
        duration: parseInt(document.getElementById('serviceDuration').value) || null,
        image_url: document.getElementById('serviceImageUrl').value.trim() || null,
        active: document.getElementById('serviceActive').checked
    };

    try {
        const url = serviceId ? `/api/admin/services/${serviceId}` : '/api/admin/services';
        const method = serviceId ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
            },
            body: JSON.stringify(serviceData)
        });

        const data = await response.json();

        if (data.success) {
            showNotification(data.message || 'Service saved successfully', 'success');
            closeServiceModal();
            loadServices();
        } else {
            showNotification(data.message || 'Failed to save service', 'error');
        }
    } catch (error) {
        console.error('Error saving service:', error);
        showNotification('Error saving service', 'error');
    }
}

function editService(serviceId) {
    openServiceModal(serviceId);
}

async function toggleServiceStatus(serviceId) {
    try {
        const response = await fetch(`/api/admin/services/${serviceId}/toggle`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
            }
        });

        const data = await response.json();

        if (data.success) {
            showNotification(data.message, 'success');
            loadServices();
        } else {
            showNotification(data.message || 'Failed to toggle service status', 'error');
        }
    } catch (error) {
        console.error('Error toggling service status:', error);
        showNotification('Error toggling service status', 'error');
    }
}

async function deleteService(serviceId) {
    const service = allServices.find(s => s.id === serviceId);
    if (!confirm(`Are you sure you want to delete "${service.name}"?\n\nThis action cannot be undone.`)) {
        return;
    }

    try {
        const response = await fetch(`/api/admin/services/${serviceId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
            }
        });

        const data = await response.json();

        if (data.success) {
            showNotification(data.message, 'success');
            loadServices();
        } else {
            showNotification(data.message || 'Failed to delete service', 'error');
        }
    } catch (error) {
        console.error('Error deleting service:', error);
        showNotification('Error deleting service', 'error');
    }
}
```

#### Step 1.4: Update `showSection()` Function

Find the `showSection()` function and add the services case:

```javascript
function showSection(section) {
    // ... existing code ...

    if (section === 'services') {
        loadServices();
    }

    // ... rest of existing code ...
}
```

---

### Part 2: Client App - Make Booking Section Dynamic

#### Step 2.1: Update Booking Type Cards to Load Dynamically

In `flirt-hair-app.html`, find the `loadBookingTypes()` function (or create it) and replace the hardcoded cards:

Find around line 2895 where the booking type cards are, and replace lines 2895-2927 with:

```html
<!-- Booking Type Selection -->
<div id="bookingTypeSelection">
    <div class="booking-type-cards" id="bookingTypeCardsContainer">
        <!-- Will be populated dynamically -->
        <div style="text-align: center; padding: 40px; color: var(--gray-medium);">
            Loading service types...
        </div>
    </div>
</div>
```

#### Step 2.2: Add JavaScript to Load Service Types Dynamically

Add this function in the JavaScript section:

```javascript
async function loadBookingTypes() {
    try {
        const response = await fetch('/api/service-types');
        const data = await response.json();

        if (data.success && data.types.length > 0) {
            const container = document.getElementById('bookingTypeCardsContainer');

            container.innerHTML = data.types.map(typeData => {
                const typeName = typeData.type.charAt(0).toUpperCase() + typeData.type.slice(1);
                const features = typeData.services.slice(0, 3).map(s => s.name).join('<br>• ');

                // Default images for common types
                const defaultImages = {
                    'hair': 'https://www.flirthair.co.za/wp-content/uploads/2022/03/home-footer-images3.jpg',
                    'beauty': 'https://www.flirthair.co.za/wp-content/uploads/2022/03/home-footer-images2.jpg'
                };

                const imageUrl = defaultImages[typeData.type] || typeData.services[0]?.image_url || defaultImages.hair;

                return `
                    <div class="booking-type-card" onclick="selectBookingType('${typeData.type}')">
                        <div class="booking-type-image" style="background-image: url('${imageUrl}');">
                            <div class="booking-type-overlay"></div>
                        </div>
                        <div class="booking-type-content">
                            <div class="booking-type-title">${typeName} Services</div>
                            <div class="booking-type-description">${typeData.count} service${typeData.count > 1 ? 's' : ''} available</div>
                            <div class="booking-type-features">
                                • ${features}
                                ${typeData.services.length > 3 ? '<br>• And more...' : ''}
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        }
    } catch (error) {
        console.error('Error loading booking types:', error);
    }
}

// Call when booking section is shown
document.addEventListener('DOMContentLoaded', () => {
    loadBookingTypes();
});
```

#### Step 2.3: Make Hair Services Load Dynamically

Replace the hardcoded hair services HTML (lines 3019-3052) with:

```html
<div class="service-grid" id="hairServicesGrid">
    <div style="text-align: center; padding: 40px; color: var(--gray-medium);">
        Loading services...
    </div>
</div>
```

Add JavaScript function:

```javascript
async function loadHairServices() {
    try {
        const response = await fetch('/api/services/hair');
        const data = await response.json();

        if (data.success) {
            const grid = document.getElementById('hairServicesGrid');

            if (data.services.length === 0) {
                grid.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--gray-medium);">No hair services available</div>';
                return;
            }

            grid.innerHTML = data.services.map(service => `
                <div class="service-card" onclick="selectService('${service.id}', this)" data-service='${JSON.stringify(service)}'>
                    <img src="${service.image_url || 'https://via.placeholder.com/400x300'}" alt="${service.name}" class="service-image">
                    <div class="service-content">
                        <div class="service-name">${service.name}</div>
                        <div class="service-duration">${service.duration ? service.duration + ' min' : 'Varies'}</div>
                        <div class="service-price">${service.price > 0 ? 'R' + service.price.toFixed(2) : 'Free'}</div>
                    </div>
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Error loading hair services:', error);
    }
}
```

#### Step 2.4: Make Beauty Services Load Dynamically

Replace beauty services HTML (lines 3164-3213) with:

```html
<div class="service-grid" id="beautyServicesGrid">
    <div style="text-align: center; padding: 40px; color: var(--gray-medium);">
        Loading services...
    </div>
</div>
```

Add JavaScript:

```javascript
async function loadBeautyServices() {
    try {
        const response = await fetch('/api/services/beauty');
        const data = await response.json();

        if (data.success) {
            const grid = document.getElementById('beautyServicesGrid');

            if (data.services.length === 0) {
                grid.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--gray-medium);">No beauty services available</div>';
                return;
            }

            grid.innerHTML = data.services.map(service => `
                <div class="service-card" onclick="selectBeautyService('${service.id}', this)" data-service='${JSON.stringify(service)}'>
                    <img src="${service.image_url || 'https://via.placeholder.com/400x300'}" alt="${service.name}" class="service-image">
                    <div class="service-content">
                        <div class="service-name">${service.name}</div>
                        <div class="service-duration">${service.duration ? service.duration + ' min' : 'Varies'}</div>
                        <div class="service-price">${service.price > 0 ? 'R' + service.price.toFixed(2) : 'Free'}</div>
                    </div>
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Error loading beauty services:', error);
    }
}
```

#### Step 2.5: Update Service Selection Functions

Update the `selectBookingType()` function to load services dynamically:

```javascript
function selectBookingType(type) {
    bookingType = type;

    // Hide booking type selection
    document.getElementById('bookingTypeSelection').style.display = 'none';

    if (type === 'hair') {
        // Show stylist selection for hair extensions
        document.getElementById('stylistSelection').style.display = 'block';
        loadHairServices(); // Load when shown
    } else if (type === 'beauty') {
        // Show beauty service selection (no stylist needed)
        document.getElementById('beautyBooking').style.display = 'block';
        loadBeautyServices(); // Load when shown
    } else {
        // For any other custom service types, treat like beauty (no stylist)
        document.getElementById('beautyBooking').style.display = 'block';
        loadCustomServices(type);
    }
}

async function loadCustomServices(type) {
    try {
        const response = await fetch(`/api/services/${type}`);
        const data = await response.json();

        if (data.success) {
            const grid = document.getElementById('beautyServicesGrid');

            if (data.services.length === 0) {
                grid.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--gray-medium);">No ${type} services available</div>`;
                return;
            }

            grid.innerHTML = data.services.map(service => `
                <div class="service-card" onclick="selectBeautyService('${service.id}', this)" data-service='${JSON.stringify(service)}'>
                    <img src="${service.image_url || 'https://via.placeholder.com/400x300'}" alt="${service.name}" class="service-image">
                    <div class="service-content">
                        <div class="service-name">${service.name}</div>
                        <div class="service-duration">${service.duration ? service.duration + ' min' : 'Varies'}</div>
                        <div class="service-price">${service.price > 0 ? 'R' + service.price.toFixed(2) : 'Free'}</div>
                    </div>
                </div>
            `).join('');
        }
    } catch (error) {
        console.error(`Error loading ${type} services:`, error);
    }
}
```

Update `selectService()` and `selectBeautyService()` to use database service object:

```javascript
function selectService(serviceId, element) {
    const serviceData = JSON.parse(element.getAttribute('data-service'));
    selectedService = serviceData;

    // Rest of existing logic...
    document.getElementById('selectedServiceName').textContent = `${serviceData.name} - R${serviceData.price.toFixed(2)}`;
    // ... etc
}

function selectBeautyService(serviceId, element) {
    const serviceData = JSON.parse(element.getAttribute('data-service'));
    selectedService = serviceData;

    // Rest of existing logic...
    document.getElementById('beautySelectedServiceName').textContent = `${serviceData.name} - R${serviceData.price.toFixed(2)}`;
    // ... etc
}
```

---

## 🧪 Testing Checklist

1. **Admin Console**
   - [ ] Navigate to Services section
   - [ ] View list of existing services
   - [ ] Filter by type and status
   - [ ] Search services by name
   - [ ] Create new service with custom type (e.g., "spa")
   - [ ] Edit existing service
   - [ ] Toggle active/inactive status
   - [ ] Delete service (verify it blocks if used in bookings)

2. **Client Booking Flow**
   - [ ] Booking page shows dynamic service type cards
   - [ ] Clicking "Hair" loads hair services from database
   - [ ] Clicking "Beauty" loads beauty services from database
   - [ ] If you added custom type (spa), verify it appears as card
   - [ ] Service cards show correct image, price, duration
   - [ ] Booking flow completes successfully
   - [ ] Booking saves with correct service_id from database

3. **Database Verification**
   - [ ] Check services table has image_url column
   - [ ] Verify you can add any service_type value (not just hair/beauty)
   - [ ] Confirm bookings reference service_id correctly

---

## 📝 Notes

- The implementation allows **unlimited custom service types** - not just "hair" and "beauty"
- Services with `active = 0` won't show in client booking flow
- Service images can be any URL (Unsplash, company website, etc.)
- Price of 0 displays as "Free"
- Duration is optional (displays "Varies" if not set)

---

## ✅ Once Complete

When all changes are implemented, the booking system will be fully dynamic:
- Admin can add/edit/delete services via UI
- Admin can create entirely new service categories beyond hair/beauty
- Client booking flow automatically adapts to available services
- No more hardcoded HTML service cards!
