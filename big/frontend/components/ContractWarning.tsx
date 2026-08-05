"use client";

import { isValidContractAddress } from "@/lib/contract";

export function ContractWarning() {
  if (isValidContractAddress()) return null;

  return (
    <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-amber-200 text-sm">
      <p>
        Contract not configured. Set <code className="rounded bg-white/10 px-1">NEXT_PUBLIC_CONTRACT_ADDRESS</code> in your environment.
      </p>
    </div>
  );
}
