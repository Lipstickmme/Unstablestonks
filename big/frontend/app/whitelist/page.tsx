"use client";

import { useState, useEffect } from "react";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { CONTRACT_ADDRESS, formatAddress, formatEther, isValidContractAddress } from "@/lib/contract";
import { isAddress } from "viem";
import { BIG_MARKET_ABI } from "@/lib/abi";

export default function WhitelistPage() {
  const { address, isConnected } = useAccount();
  const [newAddress, setNewAddress] = useState("");
  const [checkAddress, setCheckAddress] = useState("");
  const [adminAddress, setAdminAddress] = useState("");

  const { data: owner } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: BIG_MARKET_ABI,
    functionName: "owner",
    query: {
      enabled: isValidContractAddress() && isConnected,
    },
  });

  const isOwner = !!(owner && address && typeof owner === "string" && address.toLowerCase() === owner.toLowerCase());

  const { data: selfAuthorized } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: BIG_MARKET_ABI,
    functionName: "authorizedCreators",
    args: [((address || "0x0000000000000000000000000000000000000000") as `0x${string}`)],
    query: { enabled: isValidContractAddress() && !!address },
  });

  const { data: selfAdmin } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: BIG_MARKET_ABI,
    functionName: "admins",
    args: [((address || "0x0000000000000000000000000000000000000000") as `0x${string}`)],
    query: { enabled: isValidContractAddress() && !!address },
  });

  const canManageCreators = isOwner || selfAuthorized === true || selfAdmin === true;

  const { data: isAuthorized } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: BIG_MARKET_ABI,
    functionName: "authorizedCreators",
    args: [checkAddress as `0x${string}`],
    query: { enabled: isAddress(checkAddress) },
  });

  const { data: authorizeHash, writeContract: authorizeCreator, isPending: isAuthorizing } = useWriteContract();
  const { isLoading: isAuthorizeConfirming, isSuccess: authorizeSuccess } = useWaitForTransactionReceipt({ hash: authorizeHash });

  const { data: revokeHash, writeContract: revokeCreator, isPending: isRevoking } = useWriteContract();
  const { isLoading: isRevokeConfirming, isSuccess: revokeSuccess } = useWaitForTransactionReceipt({ hash: revokeHash });

  const { data: grantAdminHash, writeContract: grantAdmin, isPending: isGrantingAdmin } = useWriteContract();
  const { isLoading: isGrantAdminConfirming, isSuccess: grantAdminSuccess } = useWaitForTransactionReceipt({ hash: grantAdminHash });
  const { data: revokeAdminHash, writeContract: revokeAdmin, isPending: isRevokingAdmin } = useWriteContract();
  const { isLoading: isRevokeAdminConfirming, isSuccess: revokeAdminSuccess } = useWaitForTransactionReceipt({ hash: revokeAdminHash });

  const canRunAdminOps = isOwner || selfAdmin === true;

  const { data: totalFees, refetch: refetchFees } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: BIG_MARKET_ABI,
    functionName: "totalPlatformFees",
    query: { enabled: canRunAdminOps },
  });

  const { data: withdrawHash, writeContract: withdrawFees, isPending: isWithdrawing } = useWriteContract();
  const { isLoading: isWithdrawConfirming, isSuccess: withdrawSuccess } = useWaitForTransactionReceipt({ hash: withdrawHash });

  const { data: isPaused, refetch: refetchPaused } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: BIG_MARKET_ABI,
    functionName: "paused",
    query: { enabled: canRunAdminOps, retry: false },
  });
  const supportsEmergency = isPaused !== undefined;
  const { data: setPausedHash, writeContract: setPaused, isPending: isSettingPaused } = useWriteContract();
  const { isLoading: isSetPausedConfirming, isSuccess: setPausedSuccess } = useWaitForTransactionReceipt({ hash: setPausedHash });
  const { data: emergencyHash, writeContract: emergencyWithdrawAll, isPending: isEmergencyWithdrawing } = useWriteContract();
  const { isLoading: isEmergencyConfirming, isSuccess: emergencySuccess } = useWaitForTransactionReceipt({ hash: emergencyHash });

  useEffect(() => {
    if (withdrawSuccess) {
      refetchFees?.();
      alert("Fees withdrawn to owner wallet");
    }
  }, [withdrawSuccess, refetchFees]);

  useEffect(() => {
    if (setPausedSuccess) refetchPaused?.();
  }, [setPausedSuccess, refetchPaused]);

  useEffect(() => {
    if (emergencySuccess) {
      refetchFees?.();
      alert("Emergency withdraw completed.");
    }
  }, [emergencySuccess, refetchFees]);

  const handleAuthorize = () => {
    if (!isAddress(newAddress)) {
      alert("Invalid address");
      return;
    }

    authorizeCreator({
      address: CONTRACT_ADDRESS,
      abi: BIG_MARKET_ABI,
      functionName: "authorizeCreator",
      args: [newAddress as `0x${string}`],
    });
  };

  const handleRevoke = (addressToRevoke: string) => {
    if (!isAddress(addressToRevoke)) {
      alert("Invalid address");
      return;
    }

    if (!confirm(`Are you sure you want to revoke authorization for ${formatAddress(addressToRevoke)}?`)) {
      return;
    }

    revokeCreator({
      address: CONTRACT_ADDRESS,
      abi: BIG_MARKET_ABI,
      functionName: "revokeCreator",
      args: [addressToRevoke as `0x${string}`],
    });
  };

  const handleWithdrawFees = () => {
    if (!canRunAdminOps) {
      alert("Only owner/admin can withdraw fees");
      return;
    }
    withdrawFees({
      address: CONTRACT_ADDRESS,
      abi: BIG_MARKET_ABI,
      functionName: "withdrawPlatformFees",
    });
  };

  const handleSetPaused = (paused: boolean) => {
    setPaused({
      address: CONTRACT_ADDRESS,
      abi: BIG_MARKET_ABI,
      functionName: "setPaused",
      args: [paused],
    });
  };

  const handleEmergencyWithdrawAll = () => {
    if (!confirm("Emergency: This will withdraw the full contract balance to your wallet. Only use when the contract is paused. Unclaimed user funds may be included. Continue?")) return;
    emergencyWithdrawAll({
      address: CONTRACT_ADDRESS,
      abi: BIG_MARKET_ABI,
      functionName: "emergencyWithdrawAll",
    });
  };

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
        <Navbar />
        <main className="max-w-2xl mx-auto px-3 sm:px-4 lg:px-6 py-8">
          <div className="text-center py-12">
            <p className="text-gray-400 dark:text-gray-500">Please connect your wallet</p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (!canManageCreators) {
    return (
      <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
        <Navbar />
        <main className="max-w-2xl mx-auto px-3 sm:px-4 lg:px-6 py-8">
          <div className="text-center py-12">
            <p className="text-gray-400 dark:text-gray-500">Only owner/admin/authorized creators can manage creator whitelists</p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (authorizeSuccess || revokeSuccess) {
    window.location.reload();
  }
  if (grantAdminSuccess || revokeAdminSuccess) {
    window.location.reload();
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
      <Navbar />
      <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold mb-6 font-heading">Manage Authorized Creators</h1>

        <div className="bg-gradient-to-r from-orange-500/15 via-pink-500/15 to-purple-500/15 border border-orange-200/60 dark:border-orange-800/60 rounded-xl p-6 mb-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-700 dark:text-gray-300 mb-1">Platform fees collected</p>
              <p className="text-2xl font-semibold text-gray-900 dark:text-gray-50">
                {totalFees ? formatEther(totalFees as bigint) : "0.0000"} POL
              </p>
            </div>
            <button
              onClick={handleWithdrawFees}
              disabled={isWithdrawing || isWithdrawConfirming || !totalFees}
              className="px-4 py-2 rounded-lg bg-orange-600 text-white font-semibold shadow-md disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isWithdrawing || isWithdrawConfirming ? "Withdrawing..." : "Withdraw"}
            </button>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
            Owner-only action to sweep accumulated 2% platform fees to your wallet.
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 mb-6 shadow-sm">
          <h2 className="text-xl font-semibold mb-4 font-heading text-gray-900 dark:text-gray-100">Authorize New Creator</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Address</label>
              <input
                type="text"
                value={newAddress}
                onChange={(e) => setNewAddress(e.target.value)}
                placeholder="0x..."
                className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 dark:focus:ring-orange-400 focus:border-orange-500 dark:focus:border-orange-600 font-mono text-sm text-gray-900 dark:text-gray-100"
              />
            </div>
            <button
              onClick={handleAuthorize}
              disabled={isAuthorizing || isAuthorizeConfirming || !isAddress(newAddress)}
              className="w-full px-6 py-3 bg-orange-600 dark:bg-orange-500 hover:bg-orange-700 dark:hover:bg-orange-600 text-white rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isAuthorizing || isAuthorizeConfirming ? "Authorizing..." : "Authorize Creator"}
            </button>
          </div>
        </div>

        {isOwner && (
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 mb-6 shadow-sm">
            <h2 className="text-xl font-semibold mb-4 font-heading text-gray-900 dark:text-gray-100">Admin Privileges</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Owner can grant or revoke admin privileges. Admins can resolve, pause, withdraw fees, and manage creator whitelists.
            </p>
            <div className="space-y-4">
              <input
                type="text"
                value={adminAddress}
                onChange={(e) => setAdminAddress(e.target.value)}
                placeholder="0x..."
                className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm text-gray-900 dark:text-gray-100"
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  onClick={() =>
                    grantAdmin({
                      address: CONTRACT_ADDRESS,
                      abi: BIG_MARKET_ABI,
                      functionName: "grantAdmin",
                      args: [adminAddress as `0x${string}`],
                    })
                  }
                  disabled={!isAddress(adminAddress) || isGrantingAdmin || isGrantAdminConfirming}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isGrantingAdmin || isGrantAdminConfirming ? "Granting..." : "Grant Admin"}
                </button>
                <button
                  onClick={() =>
                    revokeAdmin({
                      address: CONTRACT_ADDRESS,
                      abi: BIG_MARKET_ABI,
                      functionName: "revokeAdmin",
                      args: [adminAddress as `0x${string}`],
                    })
                  }
                  disabled={!isAddress(adminAddress) || isRevokingAdmin || isRevokeAdminConfirming}
                  className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isRevokingAdmin || isRevokeAdminConfirming ? "Revoking..." : "Revoke Admin"}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 mb-6 shadow-sm">
          <h2 className="text-xl font-semibold mb-4 font-heading text-gray-900 dark:text-gray-100">Check Authorization Status</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700">Address</label>
              <input
                type="text"
                value={checkAddress}
                onChange={(e) => setCheckAddress(e.target.value)}
                placeholder="0x..."
                className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 font-mono text-sm text-gray-900"
              />
            </div>
            {checkAddress && isAddress(checkAddress) && (
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                <p className="text-sm text-gray-600 mb-1">Status:</p>
                <p className={`font-semibold ${isAuthorized === true ? "text-green-600" : "text-red-600"}`}>
                  {isAuthorized === true ? "Authorized" : "Not Authorized"}
                </p>
                {isAuthorized === true && (
                  <button
                    onClick={() => handleRevoke(checkAddress)}
                    disabled={isRevoking || isRevokeConfirming}
                    className="mt-4 w-full px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm disabled:opacity-50"
                  >
                    {isRevoking || isRevokeConfirming ? "Revoking..." : "Revoke Authorization"}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {canRunAdminOps && supportsEmergency && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-6 mb-6">
            <h2 className="text-lg font-semibold text-white mb-2">Emergency</h2>
            <p className="text-sm text-neutral-300 mb-4">
              Pause the contract to block new events and bets. When paused, you can withdraw the full contract balance (use only in emergency).
            </p>
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <span className="text-sm text-neutral-400">Status: {isPaused === true ? "Paused" : "Active"}</span>
              <button
                onClick={() => handleSetPaused(!isPaused)}
                disabled={isSettingPaused || isSetPausedConfirming}
                className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white font-medium border border-white/20 disabled:opacity-50"
              >
                {isSettingPaused || isSetPausedConfirming ? "…" : isPaused ? "Unpause" : "Pause"}
              </button>
              <button
                onClick={handleEmergencyWithdrawAll}
                disabled={!isPaused || isEmergencyWithdrawing || isEmergencyConfirming}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isEmergencyWithdrawing || isEmergencyConfirming ? "…" : "Emergency withdraw all"}
              </button>
            </div>
            <p className="text-xs text-red-300">Emergency withdraw is only available when the contract is paused.</p>
          </div>
        )}

        <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
          <h2 className="text-xl font-semibold mb-4 text-gray-900">Owner Address</h2>
          <p className="text-sm text-gray-600 mb-1">Current owner:</p>
          <p className="font-mono text-sm mb-2 text-gray-900">{typeof owner === "string" ? owner : "Loading..."}</p>
          <p className="text-sm text-gray-600 mb-1">Your address:</p>
          <p className="font-mono text-sm mb-2 text-gray-900">{address || "Not connected"}</p>
          <p className={`text-sm font-semibold ${isOwner ? "text-green-600" : "text-red-600"}`}>
            Status: {isOwner ? "✅ You are the owner" : "❌ You are not the owner"}
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}

