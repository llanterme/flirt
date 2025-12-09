# Prompt: Fix All Invoicing System Critical Bugs

## Context
You are a senior full-stack developer fixing critical bugs in an invoicing system that was just integrated into the Flirt Hair & Beauty admin console. A comprehensive bug analysis has identified 12 issues (7 critical, 3 high priority, 2 medium priority) that prevent the system from functioning.

## Your Task
Fix all critical and high-priority bugs in the invoicing system integration. The bugs are documented in INVOICING_SYSTEM_BUGS_AND_ISSUES.md.

## Files to Modify
- `flirt-admin-console.html` - The main admin console file with integrated invoice UI and JavaScript

## Critical Bugs to Fix (Priority Order)

### 1. Fix Form Submit Handler Parameter Order (Issue #1)
**Problem:** Form calls `saveInvoice(event)` but function signature is `saveInvoice(finalize = false, event)`
**Location:** Line 3073 (form tag) and line 12570 (function definition)

**Fix:**
- Change function signature from `async function saveInvoice(finalize = false, event)` to `async function saveInvoice(event, finalize = true)`
- Move `if (event) event.preventDefault();` to the beginning of the function
- Update all calls to `saveInvoice()` to match new signature:
  - `saveInvoiceAsDraft()` should call `await saveInvoice(null, false);`
  - Form submit will call `saveInvoice(event)` which defaults to finalize=true

### 2. Implement showNotification Function (Issue #3)
**Problem:** Invoice code uses `showNotification()` but it doesn't exist
**Location:** Throughout invoice JavaScript

**Fix:**
- Add a `showNotification(message, type)` function before the invoice JavaScript section
- Function should create a toast notification with auto-dismiss
- Support types: 'success', 'error', 'info', 'warning'
- Style the notification to match the admin console design

### 3. Remove Duplicate Event Handler (Issue #4)
**Problem:** Form has both inline `onsubmit` and `addEventListener`
**Location:** Lines around 12555-12558

**Fix:**
- Remove the `document.getElementById('invoice-form')?.addEventListener('submit', ...)` code block entirely
- Keep only the inline `onsubmit="saveInvoice(event)"` handler on the form tag

### 4. Fix Services API Endpoint (Issue #5)
**Problem:** Calls `/api/services/all` which may not exist
**Location:** Line 12264 in `loadServicesForPicker()`

**Fix:**
- Check if endpoint `/api/services/all` exists in server.js
- If not, change to `/api/services` (the standard endpoint)
- Verify response structure matches expectations (should have a `services` array)

### 5. Fix Invoice Data Structure for Payment Modal (Issue #6)
**Problem:** Payment modal expects `customer_name` and `amount_due` but API may return nested structure
**Location:** Lines 12691-12693 in `showPaymentModal()`

**Fix:**
- Change to handle nested customer object:
  ```javascript
  const customerName = currentPaymentInvoice.customer?.name || currentPaymentInvoice.customer_name || 'Unknown';
  document.getElementById('payment-invoice-info').textContent = `${currentPaymentInvoice.invoice_number} - ${customerName}`;
  ```
- Calculate `amount_due` if not provided:
  ```javascript
  const amountDue = currentPaymentInvoice.amount_due || (currentPaymentInvoice.total - (currentPaymentInvoice.amount_paid || 0));
  document.getElementById('payment-amount-due').textContent = `R${amountDue.toFixed(2)}`;
  document.getElementById('payment-amount').value = amountDue.toFixed(2);
  ```

### 6. Fix Commission Data Structure (Issue #7)
**Problem:** Commission report rendering may not match API response structure
**Location:** Lines 12837 in `renderCommissionReport()`

**Fix:**
- Add defensive checks for nested objects:
  ```javascript
  <td>${comm.service_date ? new Date(comm.service_date).toLocaleDateString('en-ZA') : 'N/A'}</td>
  <td>${comm.customer_name || comm.customer?.name || 'Unknown'}</td>
  <td>R${(comm.invoice_total || 0).toFixed(2)}</td>
  <td>R${(comm.services_commission || 0).toFixed(2)}</td>
  <td>R${(comm.products_commission || 0).toFixed(2)}</td>
  <td><strong>R${(comm.total_commission || 0).toFixed(2)}</strong></td>
  ```

### 7. Add Error Notifications to API Calls (Issue #8)
**Problem:** Failed API calls don't notify users
**Location:** Multiple functions - `loadServicesForPicker()`, `loadProductsForPicker()`, `loadStylistsForInvoice()`, `loadCustomersForInvoice()`

**Fix:**
- Add user notification in catch blocks:
  ```javascript
  catch (error) {
      console.error('Error loading services:', error);
      showNotification('Failed to load services. Please refresh and try again.', 'error');
  }
  ```

### 8. Fix Section Initialization Race Condition (Issue #9)
**Problem:** `showSection` override may not work if function doesn't exist yet
**Location:** Lines 12935-12943

**Fix:**
- Wrap in DOMContentLoaded or check if function exists before overriding:
  ```javascript
  // Hook into existing showSection function
  if (typeof window.showSection === 'function') {
      const _originalShowSection = window.showSection;
      window.showSection = function(sectionId, event) {
          _originalShowSection(sectionId, event);
          if (sectionId === 'invoices' || sectionId === 'commissions') {
              setTimeout(() => initInvoiceSection(), 100);
          }
      };
  } else {
      // Fallback: check periodically until showSection exists
      const checkInterval = setInterval(() => {
          if (typeof window.showSection === 'function') {
              clearInterval(checkInterval);
              const _originalShowSection = window.showSection;
              window.showSection = function(sectionId, event) {
                  _originalShowSection(sectionId, event);
                  if (sectionId === 'invoices' || sectionId === 'commissions') {
                      setTimeout(() => initInvoiceSection(), 100);
                  }
              };
          }
      }, 100);
  }
  ```

## Implementation Guidelines

1. **Make ONE change at a time** - Fix issues in the order listed above
2. **Test each fix** - Verify the fix doesn't break existing functionality
3. **Use defensive programming** - Add null checks and fallbacks
4. **Maintain code style** - Match existing admin console code style
5. **Add comments** - Document why fixes were made (reference issue numbers)

## Expected Outcome

After all fixes:
- ✅ Form submission finalizes invoices correctly
- ✅ "Save as Draft" button saves without finalizing
- ✅ All error/success messages show as styled notifications (not alerts)
- ✅ Services and products load correctly in pickers
- ✅ Payment modal displays invoice details correctly
- ✅ Commission reports render without "undefined" values
- ✅ Invoice section initializes when navigated to
- ✅ API failures show user-friendly error messages

## Testing Checklist

After implementing all fixes, verify:
- [ ] Can create invoice and save as draft (check invoice list shows "DRAFT")
- [ ] Can create invoice and finalize (check invoice number is generated)
- [ ] Service picker shows 318 services
- [ ] Product picker shows 949 products
- [ ] Adding services/products updates totals in real-time
- [ ] Error messages show as styled notifications (not browser alerts)
- [ ] Payment modal shows correct invoice details (not "undefined")
- [ ] Recording payment updates invoice status
- [ ] Commission report displays data correctly
- [ ] Navigating to Invoices section loads data automatically

## Code Quality Standards

- Use `async/await` (not `.then()`)
- Add null/undefined checks before accessing nested properties
- Use optional chaining (`?.`) where appropriate
- Provide fallback values with `||` operator
- Keep functions focused on single responsibility
- Add JSDoc comments for complex functions

## Success Criteria

All 7 critical and 3 high-priority bugs fixed, with:
- Zero JavaScript errors in console
- All API calls succeed (200 status codes)
- All UI elements render correctly
- No "undefined" or "NaN" displayed to user
- Smooth user experience with proper notifications

---

**Execute this prompt now to fix all bugs in the invoicing system.**
