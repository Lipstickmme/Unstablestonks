# Deployment Guide

## Prerequisites

1. Node.js 18+ installed
2. MetaMask or compatible wallet
3. Polygon Amoy testnet MATIC (get from [faucet](https://faucet.polygon.technology/))
4. WalletConnect Project ID (get from [cloud.walletconnect.com](https://cloud.walletconnect.com/))

## Step 1: Smart Contract Deployment

### 1.1 Setup Contracts

```bash
cd contracts
npm install
```

### 1.2 Configure Environment

Create `.env` file in `contracts/` directory:

```env
PRIVATE_KEY=your_private_key_here
POLYGON_AMOY_RPC=https://rpc-amoy.polygon.technology
```

**⚠️ Security Note**: Never commit your private key to version control!

### 1.3 Compile Contracts

```bash
npm run compile
```

This will:
- Compile Solidity contracts
- Generate artifacts
- Create type definitions

### 1.4 Deploy Contracts

```bash
npm run deploy
```

The deployment script will:
- Deploy BigMarketV1 as a UUPS proxy
- Save deployment info to `deployments/amoy.json`
- Copy ABI to `../frontend/lib/abi.json`
- Display the proxy address

**Save the proxy address** - you'll need it for the frontend!

Example output:
```
BigMarket Proxy deployed to: 0x1234...
BigMarket Implementation deployed to: 0x5678...
Owner address: 0xabcd...
```

### 1.5 (Optional) Authorize Additional Creators

If you want to allow other addresses to create events:

```bash
AUTHORIZE_ADDRESS=0x... npm run authorize
```

## Step 2: Frontend Setup

### 2.1 Install Dependencies

```bash
cd frontend
npm install
```

### 2.2 Configure Environment

Create `.env.local` file in `frontend/` directory:

```env
NEXT_PUBLIC_CONTRACT_ADDRESS=0x... (proxy address from deployment)
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_walletconnect_project_id
```

### 2.3 Verify ABI

Ensure `frontend/lib/abi.json` exists (should be created by deployment script).

If missing, you can manually copy it:
```bash
# From contracts directory after compilation
cp artifacts/contracts/contracts/BigMarketV1.sol/BigMarketV1.json ../frontend/lib/abi.json
```

Or use the copy script:
```bash
cd contracts
npm run compile:abi
```

### 2.4 Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Step 3: Verify Deployment

1. **Connect Wallet**: Click "Connect Wallet" and select Polygon Amoy network
2. **Check Network**: Ensure you're on Polygon Amoy (Chain ID: 80002)
3. **Test Create Event**: If you're owner/authorized, try creating an event
4. **Test Betting**: Place a test bet on an event
5. **Test Resolution**: As owner, resolve an event after end time

## Troubleshooting

### Contract Deployment Issues

- **Insufficient Balance**: Get testnet MATIC from faucet
- **Network Error**: Check RPC URL in `.env`
- **Compilation Error**: Ensure Solidity version matches (0.8.22)

### Frontend Issues

- **Contract Not Found**: Verify `NEXT_PUBLIC_CONTRACT_ADDRESS` in `.env.local`
- **ABI Error**: Run `npm run compile:abi` from contracts directory
- **Wallet Connection**: Ensure WalletConnect Project ID is set
- **Network Mismatch**: Add Polygon Amoy to your wallet:
  - Network Name: Polygon Amoy
  - RPC URL: https://rpc-amoy.polygon.technology
  - Chain ID: 80002
  - Currency Symbol: MATIC
  - Block Explorer: https://amoy.polygonscan.com/

### Common Errors

**"Not authorized to create events"**
- Ensure your address is owner or authorized creator
- Check authorization on Whitelist page

**"Event has ended"**
- Cannot place bets after end time
- Cannot update events after end time

**"Cannot update event with existing bets"**
- Events can only be edited before any bets are placed

**"Image too large"**
- Images are automatically compressed to max 5KB
- If still failing, try a smaller image

## Production Deployment

### Frontend (Vercel)

1. Push code to GitHub
2. Import project to Vercel
3. Add environment variables:
   - `NEXT_PUBLIC_CONTRACT_ADDRESS`
   - `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
4. Deploy

### Frontend (Other Platforms)

1. Build the project:
   ```bash
   npm run build
   ```
2. Deploy the `out/` directory (static export) or use `npm start` (Node.js server)

### Contract Verification

Verify your contract on Polygonscan Amoy:

```bash
npx hardhat verify --network amoy <IMPLEMENTATION_ADDRESS> <OWNER_ADDRESS>
```

## Network Configuration

### Polygon Amoy Testnet

- **Chain ID**: 80002
- **RPC URL**: https://rpc-amoy.polygon.technology
- **Explorer**: https://amoy.polygonscan.com/
- **Faucet**: https://faucet.polygon.technology/

### Adding to MetaMask

1. Open MetaMask
2. Click network dropdown
3. Click "Add Network" → "Add a network manually"
4. Enter:
   - Network Name: `Polygon Amoy`
   - RPC URL: `https://rpc-amoy.polygon.technology`
   - Chain ID: `80002`
   - Currency Symbol: `MATIC`
   - Block Explorer URL: `https://amoy.polygonscan.com/`

## Next Steps

- Monitor contract on Polygonscan
- Set up event monitoring/alerts
- Consider adding analytics
- Plan for mainnet deployment (when ready)

