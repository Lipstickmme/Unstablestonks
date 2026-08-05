# BigMarket Contract Upgrade Guide

## Overview

This guide explains how to upgrade the BigMarket contract from V1 to V2. The upgrade adds enhanced event emissions for better portfolio and staking activity tracking while maintaining full backward compatibility and preserving all existing game data.

## What's New in V2

### Enhanced Events

**New Event: `BetPlacedEnhanced`**
- Includes all data from the original `BetPlaced` event
- Adds `timestamp` (block.timestamp when bet was placed)
- Adds `totalPool` (total pool size after the bet)
- Adds `outcomePool` (pool size for the specific outcome after the bet)

**Backward Compatibility**
- Original `BetPlaced` event is still emitted
- All existing frontend code will continue to work
- New frontend code can use `BetPlacedEnhanced` for richer data

## Upgrade Process

### Prerequisites

1. Ensure you have the private key of the contract owner in your `.env` file:
   ```
   PRIVATE_KEY=your_private_key_here
   ```

2. Ensure you have sufficient POL tokens for gas fees

3. Verify you're connected to the correct network (polygon or amoy)

### Step 1: Compile the Contracts

```bash
cd contracts
npm run compile
```

### Step 2: Run the Upgrade Script

For Polygon Mainnet:
```bash
npx hardhat run scripts/upgrade.ts --network polygon
```

For Polygon Amoy Testnet:
```bash
npx hardhat run scripts/upgrade.ts --network amoy
```

### Step 3: Verify the Upgrade

The upgrade script will:
- ✅ Verify contract ownership
- ✅ Deploy the new V2 implementation
- ✅ Upgrade the proxy to point to V2
- ✅ Preserve all existing state and data
- ✅ Update the ABI in the frontend
- ✅ Save deployment information

### Step 4: Update Frontend (Optional)

The frontend can now listen to the enhanced `BetPlacedEnhanced` event for better data tracking:

```typescript
// Example: Listening to enhanced event
const logs = await publicClient.getLogs({
  address: CONTRACT_ADDRESS,
  event: parseAbiItem(
    "event BetPlacedEnhanced(uint256 indexed eventId, address indexed user, uint256 outcome, uint256 amount, uint256 timestamp, uint256 totalPool, uint256 outcomePool)"
  ),
  fromBlock: fromBlock,
  toBlock: "latest",
});
```

## Important Notes

1. **No Data Loss**: All existing events, bets, and game data are preserved
2. **Backward Compatible**: Original `BetPlaced` events continue to be emitted
3. **Proxy Address Unchanged**: The proxy address remains the same, only the implementation changes
4. **Gas Costs**: The upgrade will consume gas, but future transactions will have minimal additional cost
5. **Testing**: Always test on a testnet (amoy) before upgrading mainnet

## Current Deployments

### Polygon Mainnet
- Proxy: `0x307375c13192810bDB240C055a20B78e7D50D1ae`
- Owner: `0x9309075550F1c52ADfc2511F61B9AD11568A28f6`

### Polygon Amoy Testnet
- Proxy: `0x1Ef4F5DC5504b92D479a8E359aeEf83368aA3BE5`
- Owner: `0x9309075550F1c52ADfc2511F61B9AD11568A28f6`

## Troubleshooting

### Error: "Contract owner does not match deployer"
- Ensure the `PRIVATE_KEY` in `.env` matches the contract owner address

### Error: "Deployment file not found"
- Run the initial deployment script first: `npm run deploy`

### Error: "Insufficient funds"
- Ensure you have sufficient POL tokens for gas fees

## Post-Upgrade Checklist

- [ ] Verify the upgrade transaction on Polygonscan
- [ ] Test placing a bet and verify both events are emitted
- [ ] Update frontend to use `BetPlacedEnhanced` event (optional)
- [ ] Verify portfolio and activity pages work correctly
- [ ] Monitor contract for any issues
