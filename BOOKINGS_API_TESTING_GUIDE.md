# FL!RT Bookings API - Testing Guide

## Backend Testing Verification

### ✅ Code Review Verification

The following enhancements have been implemented and are ready for testing:

#### 1. Enhanced BookingRepository.findAll() (`db/database.js` lines 347-435)

**Verified Features:**
- ✅ Multi-table JOINs (users, stylists, services)
- ✅ Status filtering with 'all' support
- ✅ Date filtering (exact + range)
- ✅ Stylist, service, time-of-day, booking-type filters
- ✅ Multi-field LIKE search (7 fields)
- ✅ Configurable sorting (7 sortable fields)
- ✅ SQL injection protection (parameterized queries)

**SQL Query Pattern:**
```sql
SELECT b.*, u.name as customer_name, u.phone as customer_phone,
       u.email as customer_email, s.name as stylist_name,
       srv.name as actual_service_name
FROM bookings b
LEFT JOIN users u ON u.id = b.user_id
LEFT JOIN stylists s ON s.id = b.stylist_id
LEFT JOIN services srv ON srv.id = b.service_id
WHERE [dynamic filters]
ORDER BY [configurable] [ASC|DESC]
```

#### 2. Enhanced GET /api/admin/bookings (`server.js` lines 2412-2461)

**Verified Features:**
- ✅ Accepts 12 query parameters
- ✅ Builds filter object dynamically
- ✅ Implements pagination (default 50, configurable)
- ✅ Returns pagination metadata
- ✅ Error handling with proper status codes

**Response Structure:**
```json
{
  "success": true,
  "bookings": [...],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 125,
    "totalPages": 3
  }
}
```

#### 3. New PATCH /api/admin/bookings/bulk-status (`server.js` lines 2524-2579)

**Verified Features:**
- ✅ Validates bookingIds array
- ✅ Validates status enum
- ✅ Processes each booking individually
- ✅ Collects successes and failures separately
- ✅ Sets completed_at when status='completed'
- ✅ Returns detailed results per booking

## Manual Testing via Browser DevTools

Since the admin user needs to be created first, here's how to test via the browser:

### Step 1: Access Admin Console

1. Navigate to: `http://localhost:3001/admin`
2. Login with existing admin credentials or create admin account
3. Go to **Management → Bookings**

### Step 2: Test Enhanced Filtering (Browser Console)

Open DevTools Console (F12) and run:

```javascript
// Test 1: Basic filter by status
async function testStatusFilter() {
    const token = localStorage.getItem('flirt_admin_token');
    const response = await fetch('/api/admin/bookings?status=pending', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    console.log('✅ Pending bookings:', data.bookings.length, 'Total:', data.pagination.total);
    return data;
}

// Test 2: Date range filter
async function testDateRange() {
    const token = localStorage.getItem('flirt_admin_token');
    const today = new Date().toISOString().split('T')[0];
    const nextWeek = new Date(Date.now() + 7*24*60*60*1000).toISOString().split('T')[0];

    const response = await fetch(`/api/admin/bookings?dateFrom=${today}&dateTo=${nextWeek}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    console.log('✅ Bookings next 7 days:', data.bookings.length);
    return data;
}

// Test 3: Search functionality
async function testSearch(term) {
    const token = localStorage.getItem('flirt_admin_token');
    const response = await fetch(`/api/admin/bookings?search=${encodeURIComponent(term)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    console.log(`✅ Search "${term}":`, data.bookings.length, 'results');
    return data;
}

// Test 4: Sorting
async function testSorting() {
    const token = localStorage.getItem('flirt_admin_token');
    const response = await fetch('/api/admin/bookings?sortBy=date&sortDir=asc', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    console.log('✅ Sorted by date ASC:', data.bookings[0]?.date, 'to', data.bookings[data.bookings.length-1]?.date);
    return data;
}

// Test 5: Pagination
async function testPagination() {
    const token = localStorage.getItem('flirt_admin_token');
    const response = await fetch('/api/admin/bookings?page=1&limit=10', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    console.log('✅ Page 1 (10 per page):', data.bookings.length, 'items');
    console.log('   Pagination:', data.pagination);
    return data;
}

// Test 6: Combined filters
async function testCombined() {
    const token = localStorage.getItem('flirt_admin_token');
    const response = await fetch('/api/admin/bookings?status=confirmed&sortBy=date&sortDir=desc&limit=5', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    console.log('✅ Combined filters (confirmed, sorted by date desc, 5 per page):', data.bookings.length, 'items');
    return data;
}

// Run all tests
async function runAllTests() {
    console.log('🧪 Running Backend API Tests...\n');
    await testStatusFilter();
    await testDateRange();
    await testSearch('hair');
    await testSorting();
    await testPagination();
    await testCombined();
    console.log('\n✅ All tests complete!');
}

// Execute
runAllTests();
```

### Step 3: Test Bulk Status Update

```javascript
async function testBulkUpdate() {
    const token = localStorage.getItem('flirt_admin_token');

    // First, get some pending booking IDs
    const listResponse = await fetch('/api/admin/bookings?status=pending&limit=3', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const list = await listResponse.json();
    const bookingIds = list.bookings.map(b => b.id);

    if (bookingIds.length === 0) {
        console.log('⚠️ No pending bookings to test bulk update');
        return;
    }

    console.log(`🔄 Bulk updating ${bookingIds.length} bookings to confirmed...`);

    const response = await fetch('/api/admin/bookings/bulk-status', {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            bookingIds: bookingIds,
            status: 'confirmed'
        })
    });

    const result = await response.json();
    console.log('✅ Bulk update result:', result);
    console.log(`   Updated: ${result.updated}, Failed: ${result.failed}`);

    return result;
}

// Execute bulk update test
testBulkUpdate();
```

## Expected Database Queries

When filters are applied, the repository should generate queries like:

### Example 1: Search for "John"
```sql
SELECT b.*, u.name as customer_name, ...
FROM bookings b LEFT JOIN users u ON u.id = b.user_id ...
WHERE 1=1
  AND (u.name LIKE '%John%' OR u.email LIKE '%John%' OR ...)
ORDER BY b.date ASC, b.time ASC
```

### Example 2: Filter by status and stylist
```sql
SELECT b.*, u.name as customer_name, ...
FROM bookings b LEFT JOIN users u ON u.id = b.user_id ...
WHERE 1=1
  AND b.status = 'pending'
  AND b.stylist_id = 'stylist_123'
ORDER BY b.date ASC, b.time ASC
```

### Example 3: Date range + sorting
```sql
SELECT b.*, u.name as customer_name, ...
FROM bookings b LEFT JOIN users u ON u.id = b.user_id ...
WHERE 1=1
  AND b.date >= '2025-11-25'
  AND b.date <= '2025-12-25'
ORDER BY u.name ASC, b.time ASC
```

## Validation Checklist

Test each scenario and check off when working:

### Filtering
- [ ] Filter by status: 'all' (no filter applied)
- [ ] Filter by status: 'pending' (only pending)
- [ ] Filter by status: 'confirmed' (only confirmed)
- [ ] Filter by status: 'completed' (only completed)
- [ ] Filter by status: 'cancelled' (only cancelled)
- [ ] Filter by exact date (today)
- [ ] Filter by date range (this week)
- [ ] Filter by stylist (specific stylist)
- [ ] Filter by service (specific service)
- [ ] Filter by time of day: 'morning'
- [ ] Filter by time of day: 'afternoon'
- [ ] Filter by time of day: 'evening'
- [ ] Filter by time of day: 'all' (no filter)
- [ ] Combine multiple filters (status + stylist + date range)

### Search
- [ ] Search by customer name (partial match)
- [ ] Search by customer email
- [ ] Search by customer phone
- [ ] Search by booking ID
- [ ] Search by service name
- [ ] Search by notes
- [ ] Search by stylist name
- [ ] Search with no results returns empty array

### Sorting
- [ ] Sort by date ASC (earliest first)
- [ ] Sort by date DESC (latest first)
- [ ] Sort by customer name ASC (A-Z)
- [ ] Sort by customer name DESC (Z-A)
- [ ] Sort by stylist name ASC
- [ ] Sort by stylist name DESC
- [ ] Sort by status ASC
- [ ] Sort by status DESC
- [ ] Sort by created date ASC
- [ ] Sort by created date DESC

### Pagination
- [ ] Page 1 with default limit (50)
- [ ] Page 2 with default limit
- [ ] Custom limit (10 items)
- [ ] Custom limit (100 items)
- [ ] Pagination metadata correct (total, totalPages)
- [ ] Last page returns correct number of items
- [ ] Page beyond total pages returns empty array

### Bulk Operations
- [ ] Bulk confirm 5 bookings
- [ ] Bulk cancel 3 bookings
- [ ] Bulk complete 2 bookings
- [ ] Bulk update with invalid booking ID (partial failure)
- [ ] Bulk update with invalid status returns 400 error
- [ ] Bulk update with empty array returns 400 error
- [ ] Results array contains all successful updates
- [ ] Errors array contains all failures with reasons

### Edge Cases
- [ ] No bookings in database returns empty array
- [ ] Invalid sort field falls back to default (date ASC)
- [ ] Invalid status value is ignored
- [ ] SQL injection attempts are blocked (parameterized queries)
- [ ] Very long search terms don't crash (test 1000+ chars)
- [ ] Unicode characters in search work correctly
- [ ] Null/undefined filter values are ignored

## Performance Benchmarks

Expected performance (will vary based on data size):

| Operation | Expected Time | Notes |
|-----------|---------------|-------|
| Load 50 bookings (no filter) | < 100ms | With JOINs |
| Load 50 bookings (with filters) | < 150ms | Additional WHERE clauses |
| Search across all fields | < 200ms | LIKE queries on 7 fields |
| Bulk update 10 bookings | < 500ms | Sequential updates |
| Bulk update 50 bookings | < 2s | May need optimization |

## Troubleshooting

### Issue: No results returned
**Check:**
1. Filters too restrictive? Try removing some
2. 'all' values actually being sent as 'all' not undefined?
3. Database has bookings for the filtered criteria?

### Issue: Sorting not working
**Check:**
1. sortBy value is one of: date, time, customer, stylist, service, status, created
2. sortDir is 'asc' or 'desc' (lowercase)
3. Browser console for SQL errors

### Issue: Search returns too many results
**Check:**
1. Search is intentionally broad (OR across 7 fields)
2. Use more specific search terms
3. Combine with filters to narrow results

### Issue: Bulk update fails
**Check:**
1. All booking IDs exist in database
2. Status is valid: 'pending', 'confirmed', 'completed', 'cancelled'
3. Admin authentication token is valid
4. Check errors array in response for specific failures

## Next Steps

Once backend testing is complete:
1. ✅ Mark backend as fully tested
2. Build frontend UI to consume these APIs
3. Add user acceptance testing
4. Performance testing with large datasets (1000+ bookings)
5. Load testing for bulk operations

---

**Backend Status**: ✅ Implemented | 🧪 Ready for Testing
**Testing Method**: Browser DevTools + Manual QA
**Estimated Testing Time**: 30-45 minutes for comprehensive coverage
