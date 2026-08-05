# Pre-Deployment Checklist

> **Historical.** This describes BIG at the V1 prediction-market stage. The platform has
> since gained an Azuro sportsbook, a crash game, fiat rails, and `BigMarketV5`. See
> [`README.md`](./README.md) and [`GAP_ANALYSIS.md`](./GAP_ANALYSIS.md) for current state.

Use this checklist to ensure everything is set up correctly before deploying.

## Smart Contract Setup

- [ ] Node.js 18+ installed
- [ ] Navigated to `contracts/` directory
- [ ] Ran `npm install`
- [ ] Created `.env` file with:
  - [ ] `PRIVATE_KEY` (your deployer private key)
  - [ ] `POLYGON_AMOY_RPC` (https://rpc-amoy.polygon.technology)
- [ ] Have testnet MATIC in deployer wallet
- [ ] Ran `npm run compile` successfully
- [ ] Ready to run `npm run deploy`

## Frontend Setup

- [ ] Navigated to `frontend/` directory
- [ ] Ran `npm install`
- [ ] Created `.env.local` file with:
  - [ ] `NEXT_PUBLIC_CONTRACT_ADDRESS` (will get from deployment)
  - [ ] `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` (from walletconnect.com)
- [ ] ABI file exists at `frontend/lib/abi.json` (created by deploy script)

## After Contract Deployment

- [ ] Contract deployed successfully
- [ ] Saved proxy address from deployment output
- [ ] Updated `frontend/.env.local` with contract address
- [ ] Verified `frontend/lib/abi.json` was created/updated
- [ ] (Optional) Authorized additional creators if needed

## Wallet Configuration

- [ ] MetaMask or compatible wallet installed
- [ ] Polygon Amoy network added to wallet:
  - Network Name: Polygon Amoy
  - RPC URL: https://rpc-amoy.polygon.technology
  - Chain ID: 80002
  - Currency Symbol: MATIC
  - Block Explorer: https://amoy.polygonscan.com/
- [ ] Have testnet MATIC for transactions

## Testing Checklist

After deployment, test these features:

### Basic Functionality
- [ ] Frontend loads without errors
- [ ] Wallet connects successfully
- [ ] Can see contract address warning (if not configured)
- [ ] Network is Polygon Amoy

### Event Creation
- [ ] Can access Create page
- [ ] Form accepts all inputs
- [ ] Image uploads and compresses
- [ ] Can add/remove outcomes
- [ ] Transaction succeeds
- [ ] Event appears on home page

### Betting
- [ ] Can view event details
- [ ] Can select outcome
- [ ] Can enter bet amount
- [ ] Transaction succeeds
- [ ] Bet appears in "Your Bets" section
- [ ] Pool amounts update correctly

### Event Management
- [ ] Can edit event (before bets)
- [ ] Cannot edit after bets placed
- [ ] Cannot edit resolved events
- [ ] Owner can resolve events
- [ ] Resolution sets winning outcome

### Payouts
- [ ] After resolution, can see estimated payout
- [ ] Can claim payout
- [ ] Payout amount is correct
- [ ] Cannot claim twice

### Authorization
- [ ] Owner can access Whitelist page
- [ ] Can authorize new creators
- [ ] Can revoke authorization
- [ ] Authorized creators can create events
- [ ] Non-authorized cannot create events

### UI/UX
- [ ] All pages load correctly
- [ ] Navigation works
- [ ] Search filters events
- [ ] Category filter works
- [ ] Pagination works
- [ ] Charts display correctly
- [ ] Images display correctly
- [ ] Responsive on mobile
- [ ] Loading states show
- [ ] Error messages are clear

## Common Issues to Check

- [ ] Contract address is valid (starts with 0x, 42 characters)
- [ ] WalletConnect Project ID is set
- [ ] Network is Polygon Amoy (not mainnet!)
- [ ] Have enough MATIC for gas
- [ ] Browser console has no errors
- [ ] All environment variables are set

## Production Readiness

Before going to production:

- [ ] All tests pass
- [ ] Security audit completed
- [ ] Contract verified on block explorer
- [ ] Frontend builds without errors (`npm run build`)
- [ ] Environment variables secured
- [ ] Error tracking set up (optional)
- [ ] Analytics set up (optional)
- [ ] Documentation reviewed

---

**Once all items are checked, you're ready to deploy!** 🚀

