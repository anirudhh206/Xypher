# Dashboard Verification Checklist

## 1. Start the Frontend

```bash
cd d:\Xypher\frontend
npm run dev
```

Then open: **http://localhost:3000/dashboard**

---

## 2. Wallet Connection Test

### ✅ Verify:
- [ ] See "Connect Wallet" button in top-right
- [ ] Click button → MetaMask/wallet provider appears
- [ ] Select Sepolia network (chain ID 11155111)
- [ ] After connecting, button changes to show wallet address (shortened)
- [ ] Address format: `0x1234…5678` (first 6 + last 4 chars)

---

## 3. Dashboard Layout Test

After connecting wallet, verify you see:

### Header
- [ ] ConfidentialGuard logo on left
- [ ] Price ticker (ETH $3,700, BTC $41,500)
- [ ] Live indicator (green dot with "Live" text)
- [ ] Connected wallet address on right
- [ ] Disconnect button

### Sidebar
- [ ] Wallet section shows connected address
- [ ] 5 navigation tabs:
  - [ ] **Overview** (currently selected)
  - [ ] **Positions**
  - [ ] **Attestation**
  - [ ] **Borrow**
  - [ ] **Settings**

---

## 4. Overview Tab Test

### Portfolio Summary (Left Column)
Should display 4 cards:

1. **Total Collateral** 
   - [ ] Shows "$0" if no positions
   - [ ] Shows real amount if positions exist (e.g., "$18,500")

2. **Total Debt**
   - [ ] Shows "$0" if no positions
   - [ ] Shows real amount if positions exist (e.g., "$8,000")

3. **Unified Health Factor**
   - [ ] Shows number with 2 decimals (e.g., "2.31")
   - [ ] Green color if > 2.0
   - [ ] Amber color if 1.2-2.0
   - [ ] Red color if < 1.2

4. **Percentage**
   - [ ] Shows percentage of pool used

### Credit Assessment (Right Column)

#### No Positions State:
- [ ] Shows message: "No positions found. Your credit score will appear once you have active positions..."

#### With Positions:
- [ ] Shows tier badge (1-5) with color:
  - [ ] Tier 1: Cyan (#0891b2)
  - [ ] Tier 2: Green (#10b981)
  - [ ] Tier 3: Indigo (#6366f1)
  - [ ] Tier 4: Amber (#f59e0b)
  - [ ] Tier 5: Red (#ef4444)
  
- [ ] Shows tier name (Sovereign, Assured, Verified, Building, Restricted)
- [ ] Shows 4 metrics in grid:
  - [ ] **UHF**: Unified Health Factor value
  - [ ] **Contagion**: Risk score (0-100%)
  - [ ] **DSS**: Debt Serviceability Score (0-100%)
  - [ ] **LTV**: Loan-to-Value percentage

---

## 5. Positions Tab Test

### With No Positions:
- [ ] Shows centered message: "No positions found"

### With Positions:
- [ ] Table appears with columns:
  - [ ] **Protocol** (aave, morpho, compound)
  - [ ] **Chain** (ethereum, base, arbitrum)
  - [ ] **Collateral Asset** (WETH, WBTC, wstETH, etc.)
  - [ ] **Collateral** ($ amount, green color)
  - [ ] **Debt Asset** (USDC, USDT, etc.)
  - [ ] **Debt** ($ amount, red color)
  - [ ] **Health Factor** (number with color coding)

- [ ] Each row updates in real-time (refresh every 30s)

---

## 6. Attestation Tab Test

### No Attestation:
- [ ] Red box appears: "No Active Attestation"
- [ ] Message: "Your credit score attestation has expired..."
- [ ] "Grant Permission" button is clickable

### Click "Grant Permission":
- [ ] Button changes to "Granting Permission..."
- [ ] MetaMask popup appears
- [ ] Transaction is sent to contract
- [ ] Wait for confirmation

### After Attestation Valid:
- [ ] Large tier badge appears (cyan/green/indigo/amber/red circle)
- [ ] Shows tier name (Sovereign, Assured, etc.)
- [ ] Shows "Verified Credit Tier" subtitle
- [ ] Shows expiry date and time
- [ ] Shows link to Etherscan contract

---

## 7. Borrow Tab Test

### Cards Display (Top Row):
- [ ] **Collateral Value**: $ amount from positions
- [ ] **Already Borrowed**: $ amount borrowed so far
- [ ] **Max Borrowable**: collateral × tier LTV percent
- [ ] **Available to Borrow**: max - already borrowed

### Borrow Input:
- [ ] Input field for ETH amount
- [ ] "Borrow" button next to it
- [ ] Button is disabled if:
  - [ ] No amount entered
  - [ ] Amount > available credit
  - [ ] No credit score

### Enter Borrow Amount & Test:
1. [ ] Type valid amount (e.g., "0.5")
2. [ ] Button becomes enabled (blue gradient)
3. [ ] Click "Borrow"
4. [ ] MetaMask popup appears
5. [ ] Transaction sent to ConfidentialLender.borrow()
6. [ ] After success, message appears: "Borrow successful!"

### Active Loans Section (if any loans exist):
- [ ] Shows table with your loans:
  - [ ] **Borrowed**: ETH amount
  - [ ] **Health Factor**: Number with color
  - [ ] **Interest Accrued**: ETH amount
  - [ ] **Tier**: Credit tier badge

---

## 8. Real-Time Data Test

### Refresh & Update Behavior:
1. [ ] Wait 30 seconds
2. [ ] Dashboard values should auto-refresh
3. [ ] Check browser Network tab (DevTools):
   - [ ] No errors in console
   - [ ] RPC calls to contract work
4. [ ] Positions update
5. [ ] Health factor recalculates
6. [ ] Prices in ticker update

### Check Console for Errors:
```
Press F12 → Console tab
Look for:
- [ ] No red error messages
- [ ] No "Cannot find module" errors
- [ ] No RPC errors
```

---

## 9. Navigate to Markets Page

1. [ ] Click header link or navigate to `/markets`
2. [ ] Should see two tabs: "Pool & Rates" and "Risk Simulator"

### Pool & Rates Tab:
- [ ] Shows 4 cards:
  - [ ] **Total Liquidity**: $ amount
  - [ ] **Total Borrowed**: $ amount
  - [ ] **Available ETH**: $ amount
  - [ ] **Utilisation**: % with progress bar

- [ ] Table shows tier rates:
  - [ ] Tier badges (1-5) with colors
  - [ ] APY % for each tier
  - [ ] Min Health Factor requirement
  - [ ] Max LTV %

### Risk Simulator Tab:
1. [ ] Two price sliders appear (ETH, BTC)
2. [ ] Drag ETH slider left (price drop):
   - [ ] Positions show "LIQUIDATION RISK" warning
   - [ ] Health factors turn red
   - [ ] Tier badges may downgrade
3. [ ] Drag ETH slider right (price up):
   - [ ] Warning disappears
   - [ ] Colors return to normal
   - [ ] Tier upgrades if applicable
4. [ ] Test preset buttons:
   - [ ] Click "Crash (-30%)"
   - [ ] Click "Normal"
   - [ ] Click "Rally (+50%)"
   - [ ] Sliders update and values recalculate

---

## 10. Interactive Elements Test

### Tab Switching:
- [ ] Click each tab (Overview → Positions → Attestation → Borrow → Settings)
- [ ] Content changes correctly
- [ ] Previous scroll position doesn't carry over
- [ ] Tab highlight moves with selection

### Button States:
- [ ] Disabled buttons appear grayed out
- [ ] Hovering over buttons changes cursor to pointer
- [ ] Clicked buttons show pending state ("...ing")
- [ ] After transaction, success message appears

### Input Validation:
- [ ] Borrow input rejects invalid amounts
- [ ] Button disables if amount > available
- [ ] All inputs respond to typing

---

## 11. Connection Robustness

### Disconnect & Reconnect:
1. [ ] Click "Disconnect" button
2. [ ] Dashboard shows "Connect Wallet" message
3. [ ] Click "Connect Wallet" again
4. [ ] Reconnect to wallet
5. [ ] Dashboard loads previous state

### Wrong Network:
1. [ ] Switch MetaMask to Ethereum mainnet
2. [ ] Dashboard should alert or show error
3. [ ] Switch back to Sepolia
4. [ ] Dashboard recovers

---

## 12. Performance Test

### Check DevTools Performance:
Press F12 → Performance tab
1. [ ] Record 10 seconds
2. [ ] Stop recording
3. [ ] Look for:
   - [ ] No long main thread blocks (> 100ms)
   - [ ] Smooth 60 FPS during interactions
   - [ ] Tab switches complete < 200ms

---

## 13. Expected Data (Demo Mode)

With wallet address ending in certain values, you should see mock positions:

- **Address hash % 3 == 0**: Aave position (5 ETH collateral, 8000 USDC debt)
- **Address hash % 2 == 0**: Morpho position (3 wstETH, 5000 USDC debt)
- **Address hash % 4 == 0**: Compound position (1 WBTC, 3500 USDC debt)

Test determinism by:
1. [ ] Note positions for your wallet
2. [ ] Disconnect
3. [ ] Reconnect same wallet
4. [ ] Same positions should appear (deterministic)

---

## 14. Smart Contract Interactions

### Verify Contract Calls in MetaMask:

#### grantPermission():
- [ ] Function name visible in popup
- [ ] No gas issues
- [ ] Transaction completes on Sepolia

#### borrow(amount):
- [ ] Function name shows amount in wei
- [ ] Correct contract address (0x5718b01d...)
- [ ] Transaction executes

#### verifyAttestation():
- [ ] Called automatically on Attestation tab load
- [ ] Returns tier (1-5)
- [ ] Returns expiry timestamp

---

## 15. Visual Consistency Test

- [ ] All tier colors match across pages
- [ ] All text sizes are readable
- [ ] Layout is responsive (resize browser)
- [ ] No text cutoff or overflow
- [ ] Buttons have proper hover states
- [ ] Links underline on hover

---

## ✅ All Tests Passed?

If you checked all boxes above, your dashboard is:
- ✅ Showing correct real-time values
- ✅ Fully interactive
- ✅ Properly connected to smart contracts
- ✅ Ready for production

---

## 🐛 Found Issues?

Check console (F12):
```
- RPC errors? → Check contract addresses in src/lib/contracts.ts
- Data not updating? → Check hook refresh intervals (30s default)
- Buttons not working? → Check wallet connection
- Styling broken? → Check globals.css variables
```

Document any issues in `/memories/session/` for debugging.
